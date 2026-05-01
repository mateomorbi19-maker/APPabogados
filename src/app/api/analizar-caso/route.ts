import { NextRequest } from "next/server";
import { analizarCasoInputSchema } from "@/lib/schemas";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { enforceTokenLimit } from "@/lib/auth/enforce-rate";
import { runAgent, AgentError } from "@/lib/agent/run-agent";
import { armarPrompt, SYSTEM_PROMPT } from "@/lib/agent/prompts";
import { parseWithRecovery } from "@/lib/agent/parse";
import { calcularCosto } from "@/lib/agent/pricing";
import { MODEL_ID } from "@/lib/anthropic";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";

// Latencia medida en sub-paso 3.2: ~87-90s end-to-end. 120s da ~30% headroom.
export const maxDuration = 120;

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
  const userPrompt = armarPrompt(caso, rol, contexto);
  const t0 = Date.now();
  let agentResult: Awaited<ReturnType<typeof runAgent>> | null = null;
  let agentError: AgentError | null = null;
  try {
    agentResult = await runAgent({ userPrompt, systemPrompt: SYSTEM_PROMPT });
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
      costo_usd: calcularCosto(MODEL_ID, usage),
      latencia_ms,
      metadata: {
        caso,
        contexto,
        rol,
        resultado: null,
        busquedas: agentError.partialBusquedas,
        parseo_intento: null,
        iterations: agentError.partialIterations,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        error: agentError.message,
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
        error: agentError.message,
        ...(isDev()
          ? {
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
    costo_usd: calcularCosto(MODEL_ID, usage),
    latencia_ms,
    metadata: {
      caso,
      contexto,
      rol,
      resultado: parsed.ok ? parsed.resultado : null,
      busquedas: agentResult.busquedas,
      parseo_intento: parsed.ok ? parsed.parseo_intento : null,
      iterations: agentResult.iterations,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
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
    },
    200,
  );
}
