import { NextRequest } from "next/server";
import { z } from "zod";
import {
  crearEventoAgendaSchema,
  TIPOS_EVENTO_VALUES,
  type ClaseEvento,
  type TipoEvento,
} from "@/lib/agenda/types";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import {
  casoEsDelUsuario,
  createEvento,
  getEventosByUser,
  updateGoogleEventId,
} from "@/lib/agenda/queries";
import {
  getGoogleAccessToken,
  pushEventToGoogle,
} from "@/lib/agenda/google-calendar";

const uuidSchema = z.string().uuid();
const isoSchema = z.string().datetime({ offset: true });

// === GET /api/agenda/eventos ===
// Lista los eventos del usuario, con filtros opcionales por caso, tipo (uno o
// varios), y rango sobre fecha_inicio (desde/hasta). Ordenados ASC.
export async function GET(req: NextRequest): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  const sp = new URL(req.url).searchParams;

  const casoRaw = sp.get("caso_id");
  const caso_id =
    casoRaw && uuidSchema.safeParse(casoRaw).success ? casoRaw : null;

  const tipos = sp
    .getAll("tipo")
    .filter((t): t is TipoEvento =>
      (TIPOS_EVENTO_VALUES as readonly string[]).includes(t),
    );

  const claseRaw = sp.get("clase");
  const clase: ClaseEvento | null =
    claseRaw === "tarea" || claseRaw === "evento" ? claseRaw : null;

  const desdeRaw = sp.get("desde");
  const desde =
    desdeRaw && isoSchema.safeParse(desdeRaw).success ? desdeRaw : null;
  const hastaRaw = sp.get("hasta");
  const hasta =
    hastaRaw && isoSchema.safeParse(hastaRaw).success ? hastaRaw : null;

  try {
    const eventos = await getEventosByUser(wl.usuario_id, {
      caso_id,
      clase,
      tipo: tipos.length ? tipos : null,
      desde,
      hasta,
    });
    // Éxito de GET = objeto crudo (convención del repo: solo los errores llevan
    // `ok: false`; ver GET /api/casos, GET /api/consumo).
    return jsonResponse({ eventos }, 200);
  } catch (e) {
    console.error("[GET /api/agenda/eventos] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando eventos",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}

// === POST /api/agenda/eventos ===
// Crea un evento. El CRUD local manda: el push a Google es best-effort y nunca
// rompe la creación. Devuelve el evento + flag google_synced.
export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = crearEventoAgendaSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  const d = parsed.data;

  // Si asocia un caso, debe ser del propio usuario.
  if (d.caso_id) {
    let pertenece = false;
    try {
      pertenece = await casoEsDelUsuario(d.caso_id, wl.usuario_id);
    } catch (e) {
      console.error("[POST /api/agenda/eventos] casoEsDelUsuario:", e);
      return jsonResponse({ ok: false, error: "Error validando caso" }, 500);
    }
    if (!pertenece) {
      return jsonResponse({ ok: false, error: "Caso no encontrado" }, 400);
    }
  }

  // Una tarea es un to-do por fecha: sin hora (todo_el_dia) y sin fin. Lo
  // normalizamos server-side para no depender solo de que el form mande bien.
  const esTarea = d.clase === "tarea";

  let evento;
  try {
    evento = await createEvento({
      usuario_id: wl.usuario_id,
      titulo: d.titulo,
      descripcion: d.descripcion ?? null,
      tipo: d.tipo,
      clase: d.clase,
      prioridad: d.prioridad,
      fecha_inicio: d.fecha_inicio,
      fecha_fin: esTarea ? null : (d.fecha_fin ?? null),
      todo_el_dia: esTarea ? true : d.todo_el_dia,
      caso_id: d.caso_id ?? null,
      notas: esTarea ? null : (d.notas ?? null),
    });
  } catch (e) {
    console.error("[POST /api/agenda/eventos] createEvento:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error creando evento",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }

  // Push best-effort a Google Calendar. Cualquier fallo se loguea y se sigue:
  // el evento ya está creado en Supabase.
  //
  // google_error se setea SOLO cuando hay token pero el insert falla (para que
  // la UI muestre el motivo real). Cuando no hay token (desconectado) se deja
  // null: de eso ya avisa el banner "Conectá tu Google Calendar".
  let google_synced = false;
  let google_error: string | null = null;
  // Solo los EVENTOS se pushean a Google Calendar; las tareas son locales.
  if (!esTarea) {
    try {
      const token = await getGoogleAccessToken(wl.clerk_user_id);
      if (token) {
        const r = await pushEventToGoogle(token, evento);
        if (r.id) {
          // Guardamos también r.updated: el control de conflicto del pull lo usa
          // para no re-aplicar este cambio cuando vuelva desde Google.
          await updateGoogleEventId(evento.id, wl.usuario_id, r.id, r.updated);
          evento = {
            ...evento,
            google_calendar_event_id: r.id,
            google_updated: r.updated,
          };
          google_synced = true;
        } else {
          google_error = r.error;
        }
      }
    } catch (e) {
      google_error = e instanceof Error ? e.message : String(e);
      console.error("[POST /api/agenda/eventos] push google (no bloqueante):", e);
    }
  }

  return jsonResponse(
    { ok: true, evento, google_synced, ...(google_error ? { google_error } : {}) },
    201,
  );
}
