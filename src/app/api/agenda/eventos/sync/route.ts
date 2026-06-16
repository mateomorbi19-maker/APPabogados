import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse } from "@/lib/http";
import {
  getEventosSinSincronizar,
  updateGoogleEventId,
} from "@/lib/agenda/queries";
import {
  getGoogleAccessToken,
  syncPendingEvents,
} from "@/lib/agenda/google-calendar";
import { pullFromGoogle } from "@/lib/agenda/google-pull";

// Sincronización bidireccional: empuja los pendientes (app → Google) y después
// trae los cambios remotos (Google → app, pull incremental con syncToken).
// Loop secuencial + paginación → le damos margen de duración.
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
// Push de pendientes + pull incremental. Devuelve { pushed, pulled }. Ningún
// fallo de Google rompe la operación: la agenda local siempre queda consistente.
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

  // 1) PUSH de pendientes (app → Google), como antes.
  let pushed = 0;
  try {
    const pendientes = await getEventosSinSincronizar(wl.usuario_id);
    if (pendientes.length > 0) {
      const results = await syncPendingEvents(token, pendientes);
      for (const r of results) {
        try {
          await updateGoogleEventId(
            r.id,
            wl.usuario_id,
            r.googleEventId,
            r.googleUpdated,
          );
        } catch (e) {
          // El evento se creó en Google pero no pudimos guardar el id local: se
          // reintentará en el próximo sync (queda como pendiente). Logueamos.
          console.error("[POST /api/agenda/eventos/sync] updateGoogleEventId:", r.id, e);
        }
      }
      pushed = results.length;
    }
  } catch (e) {
    // Un fallo del push no aborta el pull: el pendiente se reintenta luego.
    console.error("[POST /api/agenda/eventos/sync] push:", e);
  }

  // 2) PULL incremental (Google → app).
  let pulled = 0;
  try {
    const r = await pullFromGoogle(wl.usuario_id, wl.clerk_user_id);
    pulled = r.pulled;
  } catch (e) {
    // El pull es best-effort: si falla, el push ya se hizo y la agenda local
    // sigue intacta. Se reintenta en el próximo sync.
    console.error("[POST /api/agenda/eventos/sync] pull:", e);
  }

  return jsonResponse({ ok: true, synced: true, pushed, pulled }, 200);
}
