import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { enforceTokenLimit } from "@/lib/auth/enforce-rate";
import { jsonResponse, isDev } from "@/lib/http";
import { buildSystemSimulacion } from "@/lib/simulador/contexto";
import { crearSimulacionInputSchema } from "@/lib/simulador/schemas";
import {
  abrirAudiencia,
  MODELO_SIMULADOR,
} from "@/lib/simulador/run-simulacion";
import {
  abandonarEnCurso,
  casoPerteneceAUsuario,
  crearSimulacion,
  insertarTurno,
  registrarEjecucion,
} from "@/lib/simulador/queries";

const uuidSchema = z.string().uuid();

// Single-shot sin tools ni RAG, pero con un system grande (guion + contexto
// del caso + estrategia). Margen sobre la latencia de /mapa/simular.
export const maxDuration = 120;

// === POST /api/casos/[id]/simulacion ===
// Crea una sesión del Simulador de Audiencias sobre el caso y genera el primer
// turno (la apertura de la sala). Trackea tokens en ejecuciones con
// tipo='simular_audiencia'.
//
// ORDEN DE ESCRITURA (importante): se llama al modelo ANTES de tocar la DB.
// Si la API falla, no queda ni una simulación vacía ni la sesión anterior
// abandonada al pedo. Recién con la respuesta en mano se registra la ejecución
// (los tokens ya se gastaron: se trackean sí o sí), se abandona la sesión en
// curso y se inserta la nueva — update primero, insert después, porque el
// partial unique index uq_simulacion_en_curso_por_caso rechaza dos 'en_curso'.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: casoId } = await params;
  if (!uuidSchema.safeParse(casoId).success) {
    return jsonResponse({ ok: false, error: "id de caso inválido" }, 400);
  }

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = crearSimulacionInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }
  const config = parsed.data;

  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  // Ownership: 404 (no 403) para no revelar existencia.
  try {
    if (!(await casoPerteneceAUsuario(casoId, wl.usuario_id))) {
      return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
    }
  } catch (e) {
    console.error("[POST /simulacion] error validando caso:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando el caso",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
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
    system = await buildSystemSimulacion({ casoId, config });
  } catch (e) {
    console.error("[POST /simulacion] error armando el system:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error armando el contexto de la simulación",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }

  let apertura;
  try {
    apertura = await abrirAudiencia({ system });
  } catch (e) {
    console.error("[POST /simulacion] Claude API failed:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error abriendo la audiencia",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      502,
    );
  }

  // Tokens gastados: se trackean antes que nada, para que un fallo de DB más
  // abajo no los deje sin registrar. La ejecución todavía no conoce el id de
  // la simulación; el link inverso lo aporta turnos_simulacion.ejecucion_id.
  const ejecucionId = await registrarEjecucion({
    usuarioId: wl.usuario_id,
    modelo: MODELO_SIMULADOR,
    usage: apertura.usage,
    latenciaMs: apertura.latenciaMs,
    metadata: {
      caso_id: casoId,
      operacion: "abrir_audiencia",
      tipo_audiencia: "prision_preventiva",
      rol_usuario: config.rol_usuario,
      dificultad: config.dificultad,
      magistrado_perfil: config.magistrado_perfil,
    },
  });

  let simulacion;
  let turno;
  try {
    await abandonarEnCurso(casoId);
    simulacion = await crearSimulacion(casoId, config);
    turno = await insertarTurno({
      simulacionId: simulacion.id,
      emisor: "sistema",
      contenido: apertura.texto,
      metadata: { operacion: "abrir_audiencia" },
      ejecucionId,
    });
  } catch (e) {
    console.error("[POST /simulacion] error persistiendo la simulación:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error creando la simulación",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }

  return jsonResponse({ ok: true, simulacion, turnos: [turno] }, 201);
}
