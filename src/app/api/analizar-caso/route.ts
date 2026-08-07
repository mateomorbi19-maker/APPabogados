import { NextRequest } from "next/server";
import { analizarCasoInputSchema } from "@/lib/schemas";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { enforceTokenLimit } from "@/lib/auth/enforce-rate";
import {
  runAgent,
  AgentError,
  type AgentErrorCode,
} from "@/lib/agent/run-agent";
import { armarPrompt, systemPromptAnalisis } from "@/lib/agent/prompts";
import { parseWithRecovery } from "@/lib/agent/parse";
import { MODEL_ID } from "@/lib/anthropic";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";

// Latencia medida en sub-paso 3.2: ~87-90s end-to-end. 120s da ~30% headroom.
export const maxDuration = 120;

// Mapea códigos de AgentError a mensajes pensados para el abogado, no para
// el desarrollador. El message técnico sigue persistiéndose en metadata.error
// para auditoría; lo que llega al cliente es lo de acá.
function mensajeUsuarioParaAgentError(code: AgentErrorCode): string {
  switch (code) {
    case "CAP_EXCEEDED_NO_SYNTHESIS":
      return "Tu caso requiere más investigación de la que el sistema permite por ejecución. Probá dividirlo en consultas más específicas.";
    case "MAX_ITERATIONS":
      return "El análisis no logró converger. Probá con un caso más acotado o reintentá.";
    case "API_ERROR":
      return "Hubo un error de comunicación con el modelo. Reintentá en unos segundos.";
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  // 1. Body
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse(
      { ok: false, error: "Body no es JSON válido" },
      400,
    );
  }
  const parsedBody = analizarCasoInputSchema.safeParse(bodyJson);
  if (!parsedBody.success) {
    return jsonResponse(
      {
        ok: false,
        error: "Body inválido",
        issues: parsedBody.error.issues,
      },
      400,
    );
  }
  const { caso, rol } = parsedBody.data;
  const contexto = parsedBody.data.contexto ?? {};
  const usarRepositorio = parsedBody.data.usar_repositorio;

  // 2. Auth + whitelist
  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  // 3. Rate limit
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

  // 4. runAgent
  const userPrompt = armarPrompt(caso, rol, contexto, usarRepositorio);
  const t0 = Date.now();
  let agentResult: Awaited<ReturnType<typeof runAgent>> | null = null;
  let agentError: AgentError | null = null;
  try {
    agentResult = await runAgent({
      userPrompt,
      systemPrompt: systemPromptAnalisis(usarRepositorio),
      usarRepositorio,
    });
  } catch (e) {
    if (e instanceof AgentError) {
      agentError = e;
    } else {
      console.error("[/api/analizar-caso] runAgent failed pre-loop:", e);
      return jsonResponse(
        {
          ok: false,
          error: "Error ejecutando agente",
          ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
        },
        500,
      );
    }
  }
  const latencia_ms = Date.now() - t0;

  // 5a. Si AgentError: persistir parcial y devolver 502
  if (agentError) {
    const supabase = createServerClient();
    const usage = agentError.partialUsage;
    const insertPayload = {
      usuario_id: wl.usuario_id,
      tipo: "analizar_caso",
      modelo: MODEL_ID,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      // Costo por-respuesta acumulado en el loop (fix A-3): el tier
      // long-context se decide por request, no sobre la suma del loop.
      costo_usd: agentError.partialCostoUsd,
      latencia_ms,
      metadata: {
        caso,
        contexto,
        rol,
        usar_repositorio: usarRepositorio,
        resultado: null,
        busquedas: agentError.partialBusquedas,
        parseo_intento: null,
        iterations: agentError.partialIterations,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        error: agentError.message,
        error_code: agentError.code,
      },
    };
    const { error: insertError } = await supabase
      .from("ejecuciones")
      .insert(insertPayload);
    if (insertError) {
      console.error(
        "[/api/analizar-caso] insert (agent error) failed:",
        insertError,
      );
    }
    return jsonResponse(
      {
        ok: false,
        error: mensajeUsuarioParaAgentError(agentError.code),
        ...(isDev()
          ? {
              error_code: agentError.code,
              error_detail: agentError.message,
              partial_busquedas: agentError.partialBusquedas,
              partial_iterations: agentError.partialIterations,
            }
          : {}),
      },
      502,
    );
  }

  if (!agentResult) {
    return jsonResponse(
      { ok: false, error: "Estado interno inválido" },
      500,
    );
  }

  // 5b. Parse del rawText
  const parsed = parseWithRecovery(agentResult.rawText);

  // 6. INSERT ejecucion (siempre que tengamos tokens reales del agente)
  const supabase = createServerClient();
  const usage = agentResult.usage;
  const insertPayload = {
    usuario_id: wl.usuario_id,
    tipo: "analizar_caso",
    modelo: MODEL_ID,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    // Costo por-respuesta acumulado en el loop (fix A-3).
    costo_usd: agentResult.costo_usd,
    latencia_ms,
    metadata: {
      caso,
      contexto,
      rol,
      usar_repositorio: usarRepositorio,
      consultas_repositorio: agentResult.consultas_repositorio ?? [],
      resultado: parsed.ok ? parsed.resultado : null,
      busquedas: agentResult.busquedas,
      parseo_intento: parsed.ok ? parsed.parseo_intento : null,
      iterations: agentResult.iterations,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      degraded_response: agentResult.degraded_response,
      sin_grounding: agentResult.sin_grounding ?? false,
      // Resumen de chunks recuperados (sin el `contenido`, que es mucho texto):
      // solo articulo/tipo_documento/similarity, suficiente para medir.
      chunks_recuperados: (agentResult.chunks_recuperados ?? []).map((c) => ({
        articulo: c.articulo,
        tipo_documento: c.tipo_documento,
        similarity: c.similarity,
      })),
      ...(parsed.ok ? {} : { parseo_error: parsed.error }),
    },
  };
  const { data: insertResult, error: insertError } = await supabase
    .from("ejecuciones")
    .insert(insertPayload)
    .select("id")
    .single();
  if (insertError || !insertResult) {
    console.error("[/api/analizar-caso] insert failed:", insertError);
    return jsonResponse(
      {
        ok: false,
        error: "Error persistiendo ejecución",
        ...(isDev() && insertError ? { detail: insertError.message } : {}),
      },
      500,
    );
  }

  // 7. Response
  if (!parsed.ok) {
    return jsonResponse(
      {
        ok: false,
        error: "Error procesando respuesta del modelo",
        ...(isDev()
          ? { raw_response: parsed.raw_response, parse_error: parsed.error }
          : {}),
      },
      502,
    );
  }
  return jsonResponse(
    {
      ok: true,
      ejecucion_id: insertResult.id,
      ...parsed.resultado,
      busquedas: agentResult.busquedas,
      sin_grounding: agentResult.sin_grounding ?? false,
      consultas_repositorio: agentResult.consultas_repositorio ?? [],
      // Para debug/medición (no para UI de usuario final).
      chunks_recuperados: agentResult.chunks_recuperados ?? [],
    },
    200,
  );
}
