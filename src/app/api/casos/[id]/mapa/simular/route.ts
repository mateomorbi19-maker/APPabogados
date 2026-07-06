import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { enforceTokenLimit } from "@/lib/auth/enforce-rate";
import { jsonResponse, isDev } from "@/lib/http";
import { createServerClient } from "@/lib/supabase/server";
import { buildContextoCaso } from "@/lib/casos/build-contexto-caso";
import { calcularCosto } from "@/lib/agent/pricing";
import { MODEL_ID } from "@/lib/anthropic";
import { simularInputSchema } from "@/lib/mapa-procesal/types";
import { runSimulacionMapa } from "@/lib/mapa-procesal/simulacion";
import { crearRamasSimuladas, getNodosByCaso } from "@/lib/mapa-procesal/queries";

const uuidSchema = z.string().uuid();

// Single-shot sin tools ni RAG (como pre-analisis). Latencia esperada 10-30s.
export const maxDuration = 60;

// === POST /api/casos/[id]/mapa/simular ===
// Simula con IA las ramas hijas más probables de un nodo del mapa y las
// inserta como nodos 'prediccion' (el abogado las conserva, edita o borra).
// Trackea tokens/costo en ejecuciones con tipo='simular_mapa'.
export async function POST(
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
  const parsed = simularInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }
  const { nodo_id } = parsed.data;

  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  // Rate limit (endpoint LLM).
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

  // Estado del mapa: necesita fuero asignado, mapa inicializado y nodo válido.
  let mapa;
  try {
    mapa = await getNodosByCaso(id, wl.usuario_id);
  } catch (e) {
    console.error("[POST /mapa/simular] error cargando mapa:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando el mapa",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
  if (mapa === null) {
    return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
  }
  if (mapa.fuero === null || mapa.nodos.length === 0) {
    return jsonResponse(
      { ok: false, error: "El mapa no está inicializado con un fuero" },
      400,
    );
  }
  const nodoObjetivo = mapa.nodos.find((n) => n.id === nodo_id);
  if (!nodoObjetivo) {
    return jsonResponse({ ok: false, error: "Nodo no encontrado" }, 404);
  }

  // Contexto del caso (caso original + formulario + estrategia + eventos).
  let contextoCaso: string;
  try {
    const ctx = await buildContextoCaso(id);
    contextoCaso = ctx.contextoMarkdown;
  } catch (e) {
    console.error("[POST /mapa/simular] error armando contexto:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error armando el contexto del caso",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }

  // Llamada al modelo.
  let sim;
  try {
    sim = await runSimulacionMapa({
      fuero: mapa.fuero,
      contextoCaso,
      nodos: mapa.nodos,
      nodoObjetivo,
    });
  } catch (e) {
    console.error("[POST /mapa/simular] Claude API failed:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error procesando la simulación",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }

  // Tracking SIEMPRE (tokens reales del SDK, incluso si el parseo falló).
  const supabase = createServerClient();
  const { error: insertError } = await supabase.from("ejecuciones").insert({
    usuario_id: wl.usuario_id,
    tipo: "simular_mapa",
    modelo: MODEL_ID,
    input_tokens: sim.usage.input_tokens,
    output_tokens: sim.usage.output_tokens,
    costo_usd: calcularCosto(MODEL_ID, sim.usage),
    latencia_ms: sim.latenciaMs,
    metadata: {
      caso_id: id,
      nodo_id,
      nodo_titulo: nodoObjetivo.titulo,
      fuero: mapa.fuero,
      resultado: sim.ramas,
      parseo_intento: sim.parseoIntento,
      cache_creation_input_tokens: sim.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: sim.usage.cache_read_input_tokens ?? 0,
      ...(sim.parseoError ? { parseo_error: sim.parseoError } : {}),
    },
  });
  if (insertError) {
    console.error("[POST /mapa/simular] insert ejecución falló:", insertError);
    return jsonResponse(
      {
        ok: false,
        error: "Error persistiendo ejecución",
        ...(isDev() ? { detail: insertError.message } : {}),
      },
      500,
    );
  }

  if (!sim.ramas) {
    return jsonResponse(
      {
        ok: false,
        error: "Error procesando respuesta del modelo",
        ...(isDev()
          ? { raw_response: sim.rawText.slice(0, 2000), parse_error: sim.parseoError }
          : {}),
      },
      502,
    );
  }

  // Insertar las ramas como nodos 'prediccion' hijos del objetivo.
  let nodosNuevos;
  try {
    nodosNuevos = await crearRamasSimuladas(id, nodo_id, wl.usuario_id, sim.ramas);
  } catch (e) {
    console.error("[POST /mapa/simular] insert ramas falló:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error insertando las ramas simuladas",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
  if (nodosNuevos === null) {
    return jsonResponse({ ok: false, error: "Nodo no encontrado" }, 404);
  }

  return jsonResponse({ ok: true, nodos: nodosNuevos }, 201);
}
