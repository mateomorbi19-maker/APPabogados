import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";
import { COLS_CASO_NOMBRE_EXPEDIENTE } from "@/lib/casos/columnas";
import type { Adjunto } from "@/lib/casos/adjuntos";
import {
  editarEscrito,
  getPerfilProfesional,
  obtenerEscrito,
} from "@/lib/escritos/queries";
import { nombreArchivoPdf, renderEscritoPdf } from "@/lib/escritos/render-pdf";
import { contarPendientes } from "@/lib/escritos/types";

const uuidSchema = z.string().uuid();

// El mismo bucket que los adjuntos del timeline y del chat (ver
// /api/casos/[id]/eventos/upload-url): un solo lugar para los archivos de una
// causa, con el prefijo `{usuario_id}/{caso_id}/` que las rutas de eventos
// verifican.
const BUCKET = "eventos-caso-adjuntos";

// === POST /api/casos/[id]/escritos/[escrito_id]/presentar ===
//
// "Lo marqué como presentado" es un acto procesal, y es el ÚNICO momento en
// que generar un escrito toca el timeline de la causa. Tres cosas pasan:
//
//   1. se renderiza el PDF con el texto TAL COMO QUEDÓ (el abogado ya lo
//      corrigió) y se sube al bucket como copia de lo que se presentó;
//   2. se crea un evento `escrito_presentado` en el timeline con ese PDF como
//      adjunto — así queda en el historial, en el contexto del chat y de LEXIE,
//      y mueve la "última actuación" de la ficha;
//   3. el escrito pasa a `presentado`.
//
// Se rechaza si todavía quedan marcas [COMPLETAR: ...]: un escrito con huecos
// no se presentó en ningún lado. Es la contracara de la regla del dato
// faltante: el redactor los deja, y esta ruta se asegura de que se cerraron.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; escrito_id: string }> },
): Promise<Response> {
  const { id: casoId, escrito_id } = await params;
  if (
    !uuidSchema.safeParse(casoId).success ||
    !uuidSchema.safeParse(escrito_id).success
  ) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  const supabase = createServerClient();

  try {
    const [escrito, perfil, casoRes] = await Promise.all([
      obtenerEscrito(escrito_id, casoId, wl.usuario_id),
      getPerfilProfesional(wl.usuario_id),
      supabase
        .from("casos")
        .select(COLS_CASO_NOMBRE_EXPEDIENTE)
        .eq("id", casoId)
        .eq("usuario_id", wl.usuario_id)
        .maybeSingle(),
    ]);
    if (!escrito || !casoRes.data) {
      return jsonResponse({ ok: false, error: "Escrito no encontrado" }, 404);
    }
    if (escrito.estado === "presentado") {
      return jsonResponse(
        { ok: false, error: "Este escrito ya figura como presentado." },
        409,
      );
    }
    const pendientes = contarPendientes(escrito.contenido);
    if (pendientes > 0) {
      return jsonResponse(
        {
          ok: false,
          error: `El escrito todavía tiene ${pendientes} dato${pendientes === 1 ? "" : "s"} por completar. Editalo y cerrá las marcas [COMPLETAR] antes de marcarlo como presentado.`,
          pendientes,
        },
        409,
      );
    }

    // 1. PDF → bucket.
    const bytes = await renderEscritoPdf({
      contenido: escrito.contenido,
      titulo: escrito.titulo,
      autor: perfil.nombre_completo,
    });
    const filename = nombreArchivoPdf(
      escrito.titulo,
      casoRes.data.expediente_numero ?? null,
    );
    const storagePath = `${wl.usuario_id}/${casoId}/${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (upErr) throw new Error(`upload: ${upErr.message}`);

    const adjunto: Adjunto = {
      filename,
      storage_path: storagePath,
      mime_type: "application/pdf",
      size_bytes: bytes.byteLength,
      descripcion: `Escrito presentado: ${escrito.titulo}`,
    };

    // 2. Evento del timeline. `tipo: "manual"` y no "sistema": lo presentó el
    // abogado, la app sólo lo registra.
    const { data: evento, error: evErr } = await supabase
      .from("eventos_caso")
      .insert({
        caso_id: casoId,
        tipo: "manual",
        categoria: "escrito_presentado",
        descripcion: `Presentación de escrito: ${escrito.titulo}`,
        ocurrido_en: new Date().toISOString(),
        estado: "sucedido",
        adjuntos: [adjunto],
      })
      .select("id, tipo, categoria, descripcion, ocurrido_en, estado, creado_en, adjuntos")
      .single();
    if (evErr || !evento) throw new Error(`evento: ${evErr?.message ?? "sin fila"}`);

    // 3. Estado.
    const actualizado = await editarEscrito(
      escrito_id,
      casoId,
      wl.usuario_id,
      { estado: "presentado" },
    );

    // El evento vuelve en la respuesta para que el timeline lo sume sin
    // refetch: GET /eventos es una ruta de polling que pide `desde`.
    return jsonResponse({ ok: true, escrito: actualizado, evento }, 200);
  } catch (e) {
    console.error("[POST escrito presentar] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "No pude registrar la presentación",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}
