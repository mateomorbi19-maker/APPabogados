import { NextRequest } from "next/server";
import { z } from "zod";
import { editarEventoAgendaSchema } from "@/lib/agenda/types";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import {
  casoEsDelUsuario,
  deleteEvento,
  setGoogleUpdated,
  updateEvento,
  type ActualizarEventoData,
} from "@/lib/agenda/queries";
import {
  deleteEventFromGoogle,
  getGoogleAccessToken,
  updateEventInGoogle,
} from "@/lib/agenda/google-calendar";

const uuidSchema = z.string().uuid();

// === PUT /api/agenda/eventos/[id] ===
// Edición parcial. Valida ownership (doble filtro id + usuario_id en el UPDATE).
// Si el evento ya estaba sincronizado, intenta reflejar el cambio en Google
// (best-effort). Devuelve el evento actualizado.
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

  const d = parsed.data;

  // Solo las keys efectivamente presentes en el body entran al patch (evita
  // pisar columnas con undefined/null no enviados).
  const patch: ActualizarEventoData = {};
  if (d.titulo !== undefined) patch.titulo = d.titulo;
  if (d.descripcion !== undefined) patch.descripcion = d.descripcion ?? null;
  if (d.tipo !== undefined) patch.tipo = d.tipo;
  if (d.fecha_inicio !== undefined) patch.fecha_inicio = d.fecha_inicio;
  if (d.fecha_fin !== undefined) patch.fecha_fin = d.fecha_fin ?? null;
  if (d.todo_el_dia !== undefined) patch.todo_el_dia = d.todo_el_dia;
  if (d.caso_id !== undefined) patch.caso_id = d.caso_id ?? null;
  if (d.notas !== undefined) patch.notas = d.notas ?? null;
  if (d.completado !== undefined) patch.completado = d.completado;

  if (Object.keys(patch).length === 0) {
    return jsonResponse({ ok: false, error: "Nada para actualizar" }, 400);
  }

  // Si se asocia/reasocia a un caso (no-null), validar ownership.
  if (patch.caso_id) {
    let pertenece = false;
    try {
      pertenece = await casoEsDelUsuario(patch.caso_id, wl.usuario_id);
    } catch (e) {
      console.error("[PUT /api/agenda/eventos/[id]] casoEsDelUsuario:", e);
      return jsonResponse({ ok: false, error: "Error validando caso" }, 500);
    }
    if (!pertenece) {
      return jsonResponse({ ok: false, error: "Caso no encontrado" }, 400);
    }
  }

  let evento;
  try {
    evento = await updateEvento(id, wl.usuario_id, patch);
  } catch (e) {
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
  if (!evento) {
    return jsonResponse({ ok: false, error: "Evento no encontrado" }, 404);
  }

  // Reflejar en Google si ya estaba sincronizado. Best-effort.
  if (evento.google_calendar_event_id) {
    try {
      const token = await getGoogleAccessToken(wl.clerk_user_id);
      if (token) {
        const r = await updateEventInGoogle(
          token,
          evento.google_calendar_event_id,
          evento,
        );
        // Guardamos el nuevo `updated` para que el pull no re-aplique este
        // cambio (que originó la propia app) cuando vuelva desde Google.
        if (r.ok && r.updated) {
          await setGoogleUpdated(evento.id, wl.usuario_id, r.updated);
          evento = { ...evento, google_updated: r.updated };
        }
      }
    } catch (e) {
      console.error(
        "[PUT /api/agenda/eventos/[id]] update google (no bloqueante):",
        e,
      );
    }
  }

  return jsonResponse(
    { ok: true, evento, google_synced: !!evento.google_calendar_event_id },
    200,
  );
}

// === DELETE /api/agenda/eventos/[id] ===
// Borra validando ownership. Si estaba sincronizado, intenta borrarlo de Google
// (best-effort). Responde 204 sin body.
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

  let eliminado;
  try {
    eliminado = await deleteEvento(id, wl.usuario_id);
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
  if (!eliminado) {
    return jsonResponse({ ok: false, error: "Evento no encontrado" }, 404);
  }

  if (eliminado.google_calendar_event_id) {
    try {
      const token = await getGoogleAccessToken(wl.clerk_user_id);
      if (token) {
        await deleteEventFromGoogle(token, eliminado.google_calendar_event_id);
      }
    } catch (e) {
      console.error(
        "[DELETE /api/agenda/eventos/[id]] delete google (no bloqueante):",
        e,
      );
    }
  }

  return new Response(null, { status: 204 });
}
