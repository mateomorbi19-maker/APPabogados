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
import { getEventosByUser } from "@/lib/agenda/queries";
import {
  crearEventoConSync,
  ErrorServicioAgenda,
} from "@/lib/agenda/servicio";

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
//
// La orquestación (validar la causa, normalizar la tarea, crear, pushear a
// Google) vive en el servicio de agenda, que comparte con las tools de LEXIE.
// Esta ruta sólo traduce su resultado al contrato HTTP de siempre.
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

  let resultado;
  try {
    resultado = await crearEventoConSync(
      wl.usuario_id,
      wl.clerk_user_id,
      parsed.data,
    );
  } catch (e) {
    if (e instanceof ErrorServicioAgenda && e.codigo === "caso_ajeno") {
      return jsonResponse({ ok: false, error: "Caso no encontrado" }, 400);
    }
    if (e instanceof ErrorServicioAgenda && e.codigo === "validar_caso") {
      console.error("[POST /api/agenda/eventos] casoEsDelUsuario:", e);
      return jsonResponse({ ok: false, error: "Error validando caso" }, 500);
    }
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

  // google_error se manda SOLO cuando hubo token pero el push falló (para que
  // la UI muestre el motivo real). Sin token (desconectado o sin scope) se
  // omite: de eso ya avisa el banner "Conectá tu Google Calendar".
  const { evento, google } = resultado;
  const google_error = google.motivo === "error" ? (google.detalle ?? null) : null;

  return jsonResponse(
    {
      ok: true,
      evento,
      google_synced: google.synced,
      ...(google_error ? { google_error } : {}),
    },
    201,
  );
}
