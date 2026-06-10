import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { google, type calendar_v3 } from "googleapis";
import { claveDia } from "./fechas";
import type { EventoAgenda } from "./types";

// TZ de todos los eventos con hora que mandamos a Google.
const TZ = "America/Argentina/Buenos_Aires";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/**
 * Access token de Google OAuth del usuario, gestionado por Clerk. Devuelve null
 * ante cualquier fallo o si el scope de calendario no está concedido (p.ej. el
 * usuario inició sesión antes de que se agregara el scope a la conexión Google).
 *
 * Método verificado contra @clerk/backend@3.3.0 instalado:
 * - `clerkClient` es factory async en @clerk/nextjs v7 → `await clerkClient()`.
 * - provider 'google' (bare). El prefijo 'oauth_google' está @deprecated.
 * - retorno { data: OauthAccessToken[] } → leer data[0].token.
 * - `scopes` es string[] | undefined → guard.
 * Clerk auto-refresca el token, por eso se pide fresco en cada request (no se
 * cachea). Requiere credenciales OAuth custom de Google en Clerk con el scope
 * de calendario (las shared de dev no lo permiten).
 */
export async function getGoogleAccessToken(
  userId: string,
): Promise<string | null> {
  try {
    const client = await clerkClient();
    const response = await client.users.getUserOauthAccessToken(
      userId,
      "google",
    );
    const entry = response.data[0];
    if (!entry?.token) return null;

    const scopes = entry.scopes ?? [];
    const tieneCalendar = scopes.some((s) =>
      s.startsWith("https://www.googleapis.com/auth/calendar"),
    );
    if (!tieneCalendar) return null;

    return entry.token;
  } catch {
    // Usuario sin Google vinculado, error de la Backend API, red, etc.
    return null;
  }
}

export function getCalendarClient(
  accessToken: string,
): calendar_v3.Calendar {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth: oauth2Client });
}

function sumarDiasAClave(clave: string, n: number): string {
  const [y, m, d] = clave.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function sumarUnaHora(iso: string): string {
  return new Date(new Date(iso).getTime() + 3_600_000).toISOString();
}

// Mapea un evento de la app al recurso de Google Calendar.
function eventoARecursoGoogle(
  evento: EventoAgenda,
): calendar_v3.Schema$Event {
  const partesDesc: string[] = [];
  if (evento.descripcion) partesDesc.push(evento.descripcion);
  if (evento.notas) partesDesc.push(evento.notas);
  if (evento.nombre_caso) partesDesc.push(`Caso: ${evento.nombre_caso}`);
  const description = partesDesc.length ? partesDesc.join("\n\n") : undefined;

  let start: calendar_v3.Schema$EventDateTime;
  let end: calendar_v3.Schema$EventDateTime;

  if (evento.todo_el_dia) {
    // Google usa end.date EXCLUSIVO. Para 1 día → end = inicio + 1.
    // Con fecha_fin → end = díaFin + 1 (para incluir el día final).
    const inicioDia = claveDia(evento.fecha_inicio);
    const finDia = evento.fecha_fin ? claveDia(evento.fecha_fin) : inicioDia;
    start = { date: inicioDia };
    end = { date: sumarDiasAClave(finDia, 1) };
  } else {
    const finIso = evento.fecha_fin ?? sumarUnaHora(evento.fecha_inicio);
    start = { dateTime: evento.fecha_inicio, timeZone: TZ };
    end = { dateTime: finIso, timeZone: TZ };
  }

  return { summary: evento.titulo, description, start, end };
}

/** Crea el evento en Google Calendar. Devuelve el googleEventId o null si falla. */
export async function pushEventToGoogle(
  accessToken: string,
  evento: EventoAgenda,
): Promise<string | null> {
  try {
    const calendar = getCalendarClient(accessToken);
    const res = await calendar.events.insert({
      calendarId: "primary",
      requestBody: eventoARecursoGoogle(evento),
    });
    return res.data.id ?? null;
  } catch (e) {
    console.error("[google-calendar] insert falló:", e);
    return null;
  }
}

export async function updateEventInGoogle(
  accessToken: string,
  googleEventId: string,
  evento: EventoAgenda,
): Promise<boolean> {
  try {
    const calendar = getCalendarClient(accessToken);
    await calendar.events.update({
      calendarId: "primary",
      eventId: googleEventId,
      requestBody: eventoARecursoGoogle(evento),
    });
    return true;
  } catch (e) {
    console.error("[google-calendar] update falló:", e);
    return false;
  }
}

export async function deleteEventFromGoogle(
  accessToken: string,
  googleEventId: string,
): Promise<boolean> {
  try {
    const calendar = getCalendarClient(accessToken);
    await calendar.events.delete({
      calendarId: "primary",
      eventId: googleEventId,
    });
    return true;
  } catch (e) {
    console.error("[google-calendar] delete falló:", e);
    return false;
  }
}

// Pushea una lista de eventos sin sincronizar; devuelve los pares
// { id, googleEventId } que se crearon OK (para persistir en Supabase).
export async function syncPendingEvents(
  accessToken: string,
  eventos: EventoAgenda[],
): Promise<Array<{ id: string; googleEventId: string }>> {
  const out: Array<{ id: string; googleEventId: string }> = [];
  for (const ev of eventos) {
    const gid = await pushEventToGoogle(accessToken, ev);
    if (gid) out.push({ id: ev.id, googleEventId: gid });
  }
  return out;
}
