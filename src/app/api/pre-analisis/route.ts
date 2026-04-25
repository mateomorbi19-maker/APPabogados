import { NextRequest } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { preAnalisisInputSchema } from "@/lib/schemas";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { enforceTokenLimit } from "@/lib/auth/enforce-rate";
import {
  PRE_ANALISIS_SYSTEM_PROMPT,
  armarPromptPreAnalisis,
} from "@/lib/agent/prompts";
import { parseWithRecovery } from "@/lib/agent/parse";
import { calcularCosto } from "@/lib/agent/pricing";
import { getAnthropic, MODEL_ID } from "@/lib/anthropic";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";

// Sin tool-use, sin RAG. Latencia esperada 10-30s; 60s da 2x headroom.
export const maxDuration = 60;

function tieneShapeValido(resultado: Record<string, unknown>): boolean {
  if (typeof resultado.resumen_preliminar !== "string") return false;
  if (
    typeof resultado.datos_detectados !== "object" ||
    resultado.datos_detectados === null
  ) {
    return false;
  }
  if (!Array.isArray(resultado.preguntas)) return false;
  if (resultado.preguntas.length === 0) return false;
  for (const p of resultado.preguntas) {
    if (typeof p !== "object" || p === null) return false;
    const pr = p as Record<string, unknown>;
    if (typeof pr.id !== "string") return false;
    if (typeof pr.label !== "string") return false;
    if (typeof pr.tipo !== "string") return false;
  }
  return true;
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
  const parsedBody = preAnalisisInputSchema.safeParse(bodyJson);
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
  const { caso } = parsedBody.data;

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

  // 4. Llamada a Claude (single-shot, sin tools)
  const t0 = Date.now();
  let response: Anthropic.Message;
  try {
    const client = getAnthropic();
    response = await client.messages.create({
      model: MODEL_ID,
      max_tokens: 4096,
      system: PRE_ANALISIS_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: armarPromptPreAnalisis(caso) },
      ],
    });
  } catch (e) {
    console.error("[/api/pre-analisis] Claude API failed:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error procesando solicitud",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
  const latencia_ms = Date.now() - t0;

  // 5. Extraer rawText
  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  // 6. Parser + 7. validación estructural mínima
  const parsed = parseWithRecovery(rawText);
  let outputOk = parsed.ok;
  let parseoError: string | null = parsed.ok ? null : parsed.error;
  if (parsed.ok && !tieneShapeValido(parsed.resultado)) {
    outputOk = false;
    parseoError = "Output con shape inválido";
  }

  // 8. INSERT (siempre que haya usage del SDK)
  const supabase = createServerClient();
  const usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
  };
  const insertPayload = {
    usuario_id: wl.usuario_id,
    tipo: "pre_analisis",
    modelo: MODEL_ID,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    costo_usd: calcularCosto(MODEL_ID, usage),
    latencia_ms,
    metadata: {
      caso,
      resultado: outputOk && parsed.ok ? parsed.resultado : null,
      parseo_intento: outputOk && parsed.ok ? parsed.parseo_intento : null,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      ...(outputOk ? {} : { parseo_error: parseoError }),
    },
  };
  const { error: insertError } = await supabase
    .from("ejecuciones")
    .insert(insertPayload);
  if (insertError) {
    console.error("[/api/pre-analisis] insert failed:", insertError);
    return jsonResponse(
      {
        ok: false,
        error: "Error persistiendo ejecución",
        ...(isDev() ? { detail: insertError.message } : {}),
      },
      500,
    );
  }

  // 9. Response
  if (!outputOk || !parsed.ok) {
    return jsonResponse(
      {
        ok: false,
        error: "Error procesando respuesta del modelo",
        ...(isDev()
          ? {
              raw_response: parsed.ok
                ? rawText.slice(0, 2000)
                : parsed.raw_response,
              parse_error: parseoError,
            }
          : {}),
      },
      502,
    );
  }
  return jsonResponse({ ok: true, ...parsed.resultado }, 200);
}
