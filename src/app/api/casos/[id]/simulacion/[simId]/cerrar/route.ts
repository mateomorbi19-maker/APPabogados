import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { enforceTokenLimit } from "@/lib/auth/enforce-rate";
import { jsonResponse, isDev } from "@/lib/http";
import { buildSystemSimulacion } from "@/lib/simulador/contexto";
import {
  generarDebriefing,
  MODELO_SIMULADOR,
} from "@/lib/simulador/run-simulacion";
import {
  cerrarSimulacion,
  getSimulacionOwned,
  getTurnos,
  registrarEjecucion,
} from "@/lib/simulador/queries";

const uuidSchema = z.string().uuid();

// El debriefing pide 4096 tokens sobre un transcript completo: es la operación
// más lenta de las tres.
export const maxDuration = 120;

// === POST /api/casos/[id]/simulacion/[simId]/cerrar ===
// Cierra la audiencia: genera el informe de desempeño, lo guarda en
// simulaciones_audiencia.debriefing y pasa la sesión a 'finalizada'.
//
// Sin body: la operación no toma parámetros.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; simId: string }> },
): Promise<Response> {
  const { id: casoId, simId } = await params;
  if (!uuidSchema.safeParse(casoId).success) {
    return jsonResponse({ ok: false, error: "id de caso inválido" }, 400);
  }
  if (!uuidSchema.safeParse(simId).success) {
    return jsonResponse({ ok: false, error: "id de simulación inválido" }, 400);
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let simulacion;
  let turnos;
  try {
    simulacion = await getSimulacionOwned(casoId, simId, wl.usuario_id);
    if (simulacion && simulacion.estado === "en_curso") {
      turnos = await getTurnos(simId);
    }
  } catch (e) {
    console.error("[POST /simulacion/cerrar] error consultando simulación:", e);
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
            ? "La audiencia ya está cerrada."
            : "La audiencia fue abandonada: no se puede generar el informe.",
      },
      409,
    );
  }
  if (!turnos || turnos.length === 0) {
    return jsonResponse(
      { ok: false, error: "La audiencia no tiene turnos para evaluar" },
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

  let system: string;
  try {
    system = await buildSystemSimulacion({
      casoId,
      config: {
        rol_usuario: simulacion.rol_usuario,
        dificultad: simulacion.dificultad,
        magistrado_perfil: simulacion.magistrado_perfil,
      },
    });
  } catch (e) {
    console.error("[POST /simulacion/cerrar] error armando el system:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error armando el contexto de la simulación",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }

  let resultado;
  try {
    resultado = await generarDebriefing({ system, turnos });
  } catch (e) {
    console.error("[POST /simulacion/cerrar] Claude API failed:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error generando el informe",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      502,
    );
  }

  // Tracking SIEMPRE (tokens reales del SDK, incluso si el parseo falló). Si
  // el insert falla se corta con 500: sin la fila, el gasto queda fuera del
  // cupo mensual.
  try {
    await registrarEjecucion({
      usuarioId: wl.usuario_id,
      modelo: MODELO_SIMULADOR,
      usage: resultado.usage,
      latenciaMs: resultado.latenciaMs,
      metadata: {
        caso_id: casoId,
        simulacion_id: simId,
        operacion: "generar_debriefing",
        turnos_evaluados: turnos.length,
        resultado: resultado.debriefing,
        parseo_intento: resultado.parseoIntento,
        ...(resultado.parseoError ? { parseo_error: resultado.parseoError } : {}),
        ...(resultado.truncado ? { truncado: true } : {}),
      },
    });
  } catch (e) {
    console.error("[POST /simulacion/cerrar] insert ejecución falló:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error persistiendo ejecución",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }

  if (!resultado.debriefing) {
    // La sesión queda 'en_curso' a propósito: el abogado puede reintentar el
    // cierre sin perder el transcript.
    return jsonResponse(
      {
        ok: false,
        error: "Error procesando el informe del modelo",
        ...(isDev()
          ? {
              raw_response: resultado.texto.slice(0, 2000),
              parse_error: resultado.parseoError,
            }
          : {}),
      },
      502,
    );
  }

  let simulacionCerrada;
  try {
    simulacionCerrada = await cerrarSimulacion(simId, resultado.debriefing);
  } catch (e) {
    console.error("[POST /simulacion/cerrar] error cerrando la simulación:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error guardando el informe",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
  // El UPDATE es condicional a estado='en_curso': null = otro request cerró la
  // audiencia mientras se generaba este informe. No se pisa el ya guardado.
  if (!simulacionCerrada) {
    return jsonResponse(
      { ok: false, error: "La audiencia ya fue cerrada por otra operación." },
      409,
    );
  }

  return jsonResponse(
    {
      ok: true,
      simulacion: simulacionCerrada,
      debriefing: resultado.debriefing,
    },
    200,
  );
}
