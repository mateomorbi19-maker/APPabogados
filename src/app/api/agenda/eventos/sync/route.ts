import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import {
  getEventosSinSincronizar,
  updateGoogleEventId,
} from "@/lib/agenda/queries";
import {
  getGoogleAccessToken,
  syncPendingEvents,
} from "@/lib/agenda/google-calendar";

// Empuja a Google los eventos del usuario que todavía no tienen
// google_calendar_event_id. Loop secuencial → le damos margen de duración.
export const maxDuration = 60;

// === GET /api/agenda/eventos/sync ===
// Check liviano de conexión (sin efectos): ¿el usuario tiene token de Google con
// scope de calendario? Lo usa google-calendar-status al montar para decidir si
// muestra el badge "conectado" o el banner "conectá tu calendario".
export async function GET(): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  const token = await getGoogleAccessToken(wl.clerk_user_id);
  // GET = objeto crudo (solo los errores llevan `ok: false`).
  return jsonResponse({ connected: token !== null }, 200);
}

// === POST /api/agenda/eventos/sync ===
export async function POST(): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  const token = await getGoogleAccessToken(wl.clerk_user_id);
  if (!token) {
    // No es un error: el usuario simplemente no conectó/concedió el calendario.
    return jsonResponse(
      { ok: true, synced: false, reason: "no_google_token" },
      200,
    );
  }

  let pendientes;
  try {
    pendientes = await getEventosSinSincronizar(wl.usuario_id);
  } catch (e) {
    console.error("[POST /api/agenda/eventos/sync] pendientes:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando eventos a sincronizar",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }

  if (pendientes.length === 0) {
    return jsonResponse({ ok: true, synced: true, count: 0 }, 200);
  }

  const results = await syncPendingEvents(token, pendientes);
  for (const r of results) {
    try {
      await updateGoogleEventId(r.id, wl.usuario_id, r.googleEventId);
    } catch (e) {
      // El evento se creó en Google pero no pudimos guardar el id local: se
      // reintentará en el próximo sync (quedaría como pendiente). Logueamos.
      console.error(
        "[POST /api/agenda/eventos/sync] updateGoogleEventId:",
        r.id,
        e,
      );
    }
  }

  return jsonResponse({ ok: true, synced: true, count: results.length }, 200);
}
