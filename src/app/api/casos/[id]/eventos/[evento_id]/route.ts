import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";

const uuidSchema = z.string().uuid();

// === DELETE /api/casos/[id]/eventos/[evento_id] ===
//
// Borra un evento del timeline. Restricciones:
//   1. El caso pertenece al usuario.
//   2. El evento pertenece al caso.
//   3. El evento es de origen 'manual'. Eventos 'sistema' (creación del
//      caso) y 'agente' (respuestas del agente — PR3) NO se pueden
//      borrar: preservan el histórico del caso.
//
// (Decisión del director: borrado solo para manuales. Spec original
// del feature scope-out decía "no permitir borrar"; relajamos para
// manuales porque ya estaba implementado y los abogados lo usan.)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; evento_id: string }> },
): Promise<Response> {
  const { id: casoId, evento_id: eventoId } = await params;
  if (!uuidSchema.safeParse(casoId).success) {
    return jsonResponse({ ok: false, error: "id de caso inválido" }, 400);
  }
  if (!uuidSchema.safeParse(eventoId).success) {
    return jsonResponse({ ok: false, error: "id de evento inválido" }, 400);
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  const supabase = createServerClient();

  // Caso es del usuario.
  const { data: caso, error: casoErr } = await supabase
    .from("casos")
    .select("id")
    .eq("id", casoId)
    .eq("usuario_id", wl.usuario_id)
    .maybeSingle();

  if (casoErr) {
    console.error("[DELETE evento] error cargando caso:", casoErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando caso",
        ...(isDev() ? { detail: casoErr.message } : {}),
      },
      500,
    );
  }
  if (!caso) {
    return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
  }

  // Evento existe + pertenece al caso + es manual. Hacemos un SELECT
  // previo en vez de un DELETE-with-filter porque queremos distinguir
  // 404 (no existe) de 403 (existe pero no es manual). Con DELETE
  // filtrado nos quedaríamos con count=0 sin saber por qué.
  const { data: evento, error: evErr } = await supabase
    .from("eventos_caso")
    .select("id, tipo")
    .eq("id", eventoId)
    .eq("caso_id", casoId)
    .maybeSingle();
  if (evErr) {
    console.error("[DELETE evento] error cargando evento:", evErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando evento",
        ...(isDev() ? { detail: evErr.message } : {}),
      },
      500,
    );
  }
  if (!evento) {
    return jsonResponse({ ok: false, error: "Evento no encontrado" }, 404);
  }
  if (evento.tipo !== "manual") {
    return jsonResponse(
      {
        ok: false,
        error: "Solo se pueden borrar eventos manuales",
      },
      403,
    );
  }

  const { error } = await supabase
    .from("eventos_caso")
    .delete()
    .eq("id", eventoId);

  if (error) {
    console.error("[DELETE evento] error:", error);
    return jsonResponse(
      {
        ok: false,
        error: "Error borrando evento",
        ...(isDev() ? { detail: error.message } : {}),
      },
      500,
    );
  }

  return jsonResponse({ ok: true }, 200);
}
