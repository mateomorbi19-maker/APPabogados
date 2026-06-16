import "server-only";
import { type calendar_v3 } from "@googleapis/calendar";
import { createServerClient } from "@/lib/supabase/server";
import { getCalendarClient, getGoogleAccessToken } from "./google-calendar";

// PULL incremental Google Calendar → app, con syncToken.
//
// Contracara del push (app → Google). Decisiones de producto:
//   1. UPDATE-ONLY: solo eventos que la app ya conoce (match por
//      google_calendar_event_id). Los nacidos en Google se IGNORAN.
//   2. DELETE: si un evento conocido viene cancelado desde Google → se borra.
//   3. CONFLICTO: Google gana en fecha/hora, pero solo si su `updated` es más
//      nuevo que el guardado (evita re-aplicar lo que originó la propia app).
//
// Escribe DIRECTO a Supabase: NO llama a la ruta de push de Google (evita
// eco/loop). Lee el MISMO calendarId al que se hace push ('primary').

const CALENDAR_ID = "primary";
const FULL_SYNC_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000; // 90 días

export type PullResult = { pulled: number; reason?: "no_google_token" };

// 410 GONE = el syncToken expiró. Detectamos el status en las distintas formas
// que puede traer el error de la Google API (gaxios).
function isGone(e: unknown): boolean {
  const err = e as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  return err?.code === 410 || err?.status === 410 || err?.response?.status === 410;
}

// Suma n días a una clave "YYYY-MM-DD" (aritmética en UTC, sin TZ drift).
function sumarDiasAClave(clave: string, n: number): string {
  const [y, m, d] = clave.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

type FechasApp = {
  fecha_inicio: string;
  fecha_fin: string | null;
  todo_el_dia: boolean;
};

// Mapea start/end de un evento de Google al modelo de la app.
//   - Con hora: .dateTime (ISO con offset) → se guarda tal cual.
//   - Todo el día: .date ("YYYY-MM-DD"). Google usa end.date EXCLUSIVO (último
//     día + 1), MISMA convención que el push, así que para fecha_fin restamos
//     un día para volver al último día inclusivo. Anclamos a mediodía UTC (como
//     lib/agenda/fechas.ts) para que claveDia() en TZ AR dé el día correcto y
//     el round-trip con el push sea estable.
function mapGoogleDates(item: calendar_v3.Schema$Event): FechasApp {
  const start = item.start ?? {};
  const end = item.end ?? {};

  if (start.dateTime) {
    return {
      fecha_inicio: start.dateTime,
      fecha_fin: end.dateTime ?? null,
      todo_el_dia: false,
    };
  }

  const startDate = start.date ?? "";
  const fecha_inicio = `${startDate}T12:00:00.000Z`;
  let fecha_fin: string | null = null;
  if (end.date) {
    const ultimoInclusivo = sumarDiasAClave(end.date, -1);
    // Evento de un solo día → fecha_fin null (el push re-deriva end = inicio+1).
    fecha_fin =
      ultimoInclusivo === startDate ? null : `${ultimoInclusivo}T12:00:00.000Z`;
  }
  return { fecha_inicio, fecha_fin, todo_el_dia: true };
}

// Lista todos los eventos paginando hasta agotar pageToken. Solo la ÚLTIMA
// página trae nextSyncToken.
async function listAllEvents(
  calendar: calendar_v3.Calendar,
  syncToken: string | null,
): Promise<{ items: calendar_v3.Schema$Event[]; nextSyncToken: string | null }> {
  const items: calendar_v3.Schema$Event[] = [];
  let nextSyncToken: string | null = null;
  let pageToken: string | undefined;

  do {
    const params: calendar_v3.Params$Resource$Events$List = {
      calendarId: CALENDAR_ID,
      singleEvents: true,
      showDeleted: true,
      maxResults: 250,
    };
    // Páginas siguientes: SOLO pageToken (lleva el contexto de la query).
    // Primera página: syncToken (incremental) o timeMin (full sync). Mezclar
    // syncToken con timeMin/q/orderBy = 400, por eso son mutuamente excluyentes.
    if (pageToken) {
      params.pageToken = pageToken;
    } else if (syncToken) {
      params.syncToken = syncToken;
    } else {
      params.timeMin = new Date(Date.now() - FULL_SYNC_LOOKBACK_MS).toISOString();
    }

    const res = await calendar.events.list(params);
    if (res.data.items) items.push(...res.data.items);
    pageToken = res.data.nextPageToken ?? undefined;
    if (res.data.nextSyncToken) nextSyncToken = res.data.nextSyncToken;
  } while (pageToken);

  return { items, nextSyncToken };
}

export async function pullFromGoogle(
  usuarioId: string,
  clerkUserId: string,
): Promise<PullResult> {
  // Mismo patrón silencioso que el push: sin token no rompemos nada.
  const token = await getGoogleAccessToken(clerkUserId);
  if (!token) return { pulled: 0, reason: "no_google_token" };

  const calendar = getCalendarClient(token);
  const supabase = createServerClient();

  const { data: syncRow } = await supabase
    .from("google_calendar_sync")
    .select("sync_token")
    .eq("user_id", usuarioId)
    .maybeSingle();
  let syncToken: string | null = syncRow?.sync_token ?? null;

  // Listar. Si el syncToken expiró (410 GONE) → borrarlo y full sync desde cero.
  let listed: { items: calendar_v3.Schema$Event[]; nextSyncToken: string | null };
  try {
    listed = await listAllEvents(calendar, syncToken);
  } catch (e) {
    if (isGone(e)) {
      await supabase
        .from("google_calendar_sync")
        .update({ sync_token: null })
        .eq("user_id", usuarioId);
      syncToken = null;
      listed = await listAllEvents(calendar, null);
    } else {
      throw e;
    }
  }

  let pulled = 0;
  for (const item of listed.items) {
    const gid = item.id;
    if (!gid) continue;

    // Decisión 1: update-only. Solo eventos que la app ya conoce.
    const { data: ev } = await supabase
      .from("eventos_agenda")
      .select("id, google_updated")
      .eq("usuario_id", usuarioId)
      .eq("google_calendar_event_id", gid)
      .maybeSingle();
    if (!ev) continue;

    // Decisión 2: cancelado en Google → borrar en la app.
    if (item.status === "cancelled") {
      const { error } = await supabase
        .from("eventos_agenda")
        .delete()
        .eq("id", ev.id)
        .eq("usuario_id", usuarioId);
      if (!error) pulled++;
      continue;
    }

    // Decisión 3: aplicar solo si el `updated` de Google es más nuevo que el
    // guardado (o si no hay guardado).
    const gUpdatedMs = item.updated ? Date.parse(item.updated) : NaN;
    const storedMs = ev.google_updated ? Date.parse(ev.google_updated) : NaN;
    if (
      !Number.isNaN(storedMs) &&
      !Number.isNaN(gUpdatedMs) &&
      gUpdatedMs <= storedMs
    ) {
      continue;
    }

    const fechas = mapGoogleDates(item);
    const patch: Record<string, unknown> = {
      fecha_inicio: fechas.fecha_inicio,
      fecha_fin: fechas.fecha_fin,
      todo_el_dia: fechas.todo_el_dia,
      google_updated: item.updated ?? null,
      updated_at: new Date().toISOString(),
    };
    // titulo solo si vino no vacío: no pisamos un título existente con "".
    if (typeof item.summary === "string" && item.summary.trim().length > 0) {
      patch.titulo = item.summary;
    }

    const { error } = await supabase
      .from("eventos_agenda")
      .update(patch)
      .eq("id", ev.id)
      .eq("usuario_id", usuarioId);
    if (!error) pulled++;
  }

  // Guardar el nuevo syncToken (solo la última página lo trae) para el próximo
  // pull incremental.
  if (listed.nextSyncToken) {
    await supabase.from("google_calendar_sync").upsert({
      user_id: usuarioId,
      calendar_id: CALENDAR_ID,
      sync_token: listed.nextSyncToken,
      updated_at: new Date().toISOString(),
    });
  }

  return { pulled };
}
