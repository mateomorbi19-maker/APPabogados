import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { enforceTokenLimit } from "@/lib/auth/enforce-rate";
import { jsonResponse, isDev } from "@/lib/http";
import { buildSystemSimulacion } from "@/lib/simulador/contexto";
import { crearTurnoInputSchema } from "@/lib/simulador/schemas";
import {
  responderTurno,
  MODELO_SIMULADOR,
} from "@/lib/simulador/run-simulacion";
import {
  getSimulacionOwned,
  getTurnos,
  insertarTurno,
  registrarEjecucion,
} from "@/lib/simulador/queries";

const uuidSchema = z.string().uuid();

export const maxDuration = 120;

// === POST /api/casos/[id]/simulacion/[simId]/turno ===
// El abogado interviene en la audiencia; la sala le responde.
//
// El turno del usuario se persiste ANTES de llamar al modelo (mismo criterio
// que el chat por caso): si el modelo o el proxy fallan, la intervención no se
// pierde y el turno queda en el transcript.
//
// SIMPLIFICACIÓN v1: cada respuesta del modelo se guarda como UN turno con
// emisor='sistema'. El texto ya trae los rótulos de quién habla ("JUEZ:",
// "AGENTE FISCAL:", ...) porque el guion lo exige. El desglose en un turno por
// personaje —usando los valores 'juez'/'fiscal'/'imputado'/etc. que el CHECK
// de turnos_simulacion ya admite— queda como refinamiento futuro: requiere
// parsear los rótulos del texto y eso es frágil sin un contrato estructurado.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; simId: string }> },
): Promise<Response> {
  const { id: casoId, simId } = await params;
  if (!uuidSchema.safeParse(casoId).success) {
    return jsonResponse({ ok: false, error: "id de caso inválido" }, 400);
  }
  if (!uuidSchema.safeParse(simId).success) {
    return jsonResponse({ ok: false, error: "id de simulación inválido" }, 400);
  }

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = crearTurnoInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }
  const { contenido } = parsed.data;

  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let simulacion;
  try {
    simulacion = await getSimulacionOwned(casoId, simId, wl.usuario_id);
  } catch (e) {
    console.error("[POST /simulacion/turno] error consultando simulación:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando la simulación",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
  if (!simulacion) {
    return jsonResponse({ ok: false, error: "Simulación no encontrada" }, 404);
  }
  if (simulacion.estado !== "en_curso") {
    return jsonResponse(
      {
        ok: false,
        error:
          simulacion.estado === "finalizada"
            ? "La audiencia ya está cerrada. Revisá el informe o empezá una nueva."
            : "La audiencia fue abandonada. Empezá una nueva.",
      },
      409,
    );
  }

  const rl = await enforceTokenLimit(wl.usuario_id);
  if (!rl.ok) {
    return jsonResponse(
      {
        ok: false,
        error: "Cupo mensual de tokens agotado",
        tokens_usados: rl.tokens_usados,
        limite: rl.limite,
      },
      429,
    );
  }

  // Se persiste primero: si el modelo falla, la intervención no se pierde.
  let turnoUsuario;
  try {
    turnoUsuario = await insertarTurno({
      simulacionId: simId,
      emisor: "usuario",
      contenido,
      metadata: { rol_usuario: simulacion.rol_usuario },
    });
  } catch (e) {
    console.error("[POST /simulacion/turno] insert turno usuario falló:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error guardando tu intervención",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }

  let system: string;
  let turnos;
  try {
    // El system se recalcula en cada turno para que el modelo vea el estado
    // actual del expediente (mismo criterio que el chat por caso).
    [system, turnos] = await Promise.all([
      buildSystemSimulacion({
        casoId,
        config: {
          rol_usuario: simulacion.rol_usuario,
          dificultad: simulacion.dificultad,
          magistrado_perfil: simulacion.magistrado_perfil,
        },
      }),
      // Incluye el turno recién insertado: queda último en el array.
      getTurnos(simId),
    ]);
  } catch (e) {
    console.error("[POST /simulacion/turno] error armando el contexto:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error armando el contexto de la simulación",
        turno_usuario: turnoUsuario,
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }

  let respuesta;
  try {
    respuesta = await responderTurno({ system, turnos });
  } catch (e) {
    console.error("[POST /simulacion/turno] Claude API failed:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error generando la respuesta de la sala",
        // El turno del usuario YA quedó guardado: el cliente lo necesita para
        // no duplicarlo si reintenta.
        turno_usuario: turnoUsuario,
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      502,
    );
  }

  // Corta con 500 si el tracking no se pudo persistir: sin esa fila el gasto
  // real queda fuera de v_consumo_mensual y del cupo mensual.
  let ejecucionId: string;
  try {
    ejecucionId = await registrarEjecucion({
      usuarioId: wl.usuario_id,
      modelo: MODELO_SIMULADOR,
      usage: respuesta.usage,
      latenciaMs: respuesta.latenciaMs,
      metadata: {
        caso_id: casoId,
        simulacion_id: simId,
        operacion: "responder_turno",
        turno_numero: turnos.length,
        rol_usuario: simulacion.rol_usuario,
        dificultad: simulacion.dificultad,
        magistrado_perfil: simulacion.magistrado_perfil,
        ...(respuesta.truncado ? { truncado: true } : {}),
      },
    });
  } catch (e) {
    console.error("[POST /simulacion/turno] insert ejecución falló:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error persistiendo ejecución",
        turno_usuario: turnoUsuario,
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }

  // Revalidación del estado: entre el chequeo inicial y acá pasaron los
  // decenas de segundos que tarda el modelo, y en esa ventana un POST /cerrar
  // pudo haber finalizado la audiencia. Sin esto se insertan turnos en una
  // sesión ya cerrada y el debriefing queda describiendo un transcript que ya
  // no es el guardado.
  let sigueEnCurso = false;
  try {
    const simAhora = await getSimulacionOwned(casoId, simId, wl.usuario_id);
    sigueEnCurso = simAhora?.estado === "en_curso";
  } catch (e) {
    console.error("[POST /simulacion/turno] revalidación de estado falló:", e);
  }
  if (!sigueEnCurso) {
    return jsonResponse(
      {
        ok: false,
        error:
          "La audiencia se cerró mientras se generaba la respuesta. Tu intervención quedó guardada.",
        turno_usuario: turnoUsuario,
      },
      409,
    );
  }

  let turnoSistema;
  try {
    turnoSistema = await insertarTurno({
      simulacionId: simId,
      emisor: "sistema",
      contenido: respuesta.texto,
      metadata: {
        operacion: "responder_turno",
        ...(respuesta.truncado ? { truncado: true } : {}),
      },
      ejecucionId,
    });
  } catch (e) {
    console.error("[POST /simulacion/turno] insert turno sistema falló:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error guardando la respuesta de la sala",
        turno_usuario: turnoUsuario,
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }

  return jsonResponse(
    { ok: true, turnos: [turnoUsuario, turnoSistema] },
    201,
  );
}
