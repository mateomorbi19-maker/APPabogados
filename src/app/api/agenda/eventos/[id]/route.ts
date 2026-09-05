import { NextRequest } from "next/server";
import { z } from "zod";
import { editarEventoAgendaSchema } from "@/lib/agenda/types";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import {
  editarEventoConSync,
  eliminarEventoConSync,
  ErrorServicioAgenda,
} from "@/lib/agenda/servicio";

const uuidSchema = z.string().uuid();

// === PUT /api/agenda/eventos/[id] ===
// Edición parcial. Valida ownership (doble filtro id + usuario_id en el UPDATE).
// Si el evento ya estaba sincronizado, intenta reflejar el cambio en Google
// (best-effort). Devuelve el evento actualizado.
//
// La orquestación vive en el servicio de agenda (compartido con LEXIE); acá
// sólo se traduce el resultado al contrato HTTP de siempre.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = editarEventoAgendaSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let resultado;
  try {
    resultado = await editarEventoConSync(
      id,
      wl.usuario_id,
      wl.clerk_user_id,
      parsed.data,
    );
  } catch (e) {
    if (e instanceof ErrorServicioAgenda && e.codigo === "validar_caso") {
      console.error("[PUT /api/agenda/eventos/[id]] casoEsDelUsuario:", e);
      return jsonResponse({ ok: false, error: "Error validando caso" }, 500);
    }
    console.error("[PUT /api/agenda/eventos/[id]] updateEvento:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error actualizando evento",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }

  if (!resultado.ok) {
    switch (resultado.motivo) {
      case "sin_cambios":
        return jsonResponse({ ok: false, error: "Nada para actualizar" }, 400);
      case "caso_ajeno":
        return jsonResponse({ ok: false, error: "Caso no encontrado" }, 400);
      case "no_existe":
        return jsonResponse({ ok: false, error: "Evento no encontrado" }, 404);
    }
  }

  // google_synced acá significa "está vinculado a Google", no "el update de
  // recién anduvo": es lo que la UI siempre leyó de esta respuesta.
  const evento = resultado.despues;
  return jsonResponse(
    { ok: true, evento, google_synced: !!evento.google_calendar_event_id },
    200,
  );
}

// === DELETE /api/agenda/eventos/[id] ===
// Borra validando ownership. Si estaba sincronizado, intenta borrarlo de Google
// (best-effort: con `borrar_local` el evento se va de la app aunque Google
// falle). Responde 204 sin body.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let resultado;
  try {
    resultado = await eliminarEventoConSync(id, wl.usuario_id, wl.clerk_user_id, {
      siGoogleFalla: "borrar_local",
    });
  } catch (e) {
    console.error("[DELETE /api/agenda/eventos/[id]] deleteEvento:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error borrando evento",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }

  if (!resultado.ok) {
    // Con `borrar_local` el único rechazo posible es que no exista; el otro
    // brazo queda por si alguien cambia la política a `abortar`.
    if (resultado.motivo === "google_fallo") {
      return jsonResponse(
        { ok: false, error: "Error borrando evento", detail: resultado.detalle },
        500,
      );
    }
    return jsonResponse({ ok: false, error: "Evento no encontrado" }, 404);
  }

  return new Response(null, { status: 204 });
}
