import { NextRequest } from "next/server";
import { z } from "zod";
import {
  adjuntoInputSchema,
  type AdjuntoInput,
} from "@/lib/schemas";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { enforceTokenLimit } from "@/lib/auth/enforce-rate";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";
import { MODEL_ID } from "@/lib/anthropic";
import { SYSTEM_PROMPT_CONSULTA } from "@/lib/agent/prompts";
import { parseWithRecovery } from "@/lib/agent/parse";
import { calcularCosto } from "@/lib/agent/pricing";
import {
  runAgentConsulta,
  type AdjuntoModelo,
} from "@/lib/agent/run-agent-consulta";
import { AgentError } from "@/lib/agent/run-agent";
import {
  descargarAdjuntoBytes,
  extraerTextoDocx,
} from "@/lib/casos/descargar-adjunto";
import { buildContextoCaso } from "@/lib/casos/build-contexto-caso";

// Latencia esperada similar al análisis original. 120s da headroom.
export const maxDuration = 120;

const uuidSchema = z.string().uuid();

const consultaInputSchema = z.object({
  pregunta: z.string().min(30).max(3000),
  adjuntos: z.array(adjuntoInputSchema).max(20).default([]),
});

// Reusamos el patrón de mensajes user-friendly de /analizar-caso.
function mensajeParaError(code: string): string {
  switch (code) {
    case "CAP_EXCEEDED_NO_SYNTHESIS":
      return "Tu consulta requiere más investigación de la que el sistema permite por ejecución. Probá reformularla más específica o dividirla en consultas separadas.";
    case "MAX_ITERATIONS":
      return "El análisis no logró converger. Probá reformulando la consulta o reintentá en unos minutos.";
    case "API_ERROR":
      return "Hubo un error de comunicación con el modelo. Reintentá en unos segundos.";
    default:
      return "Tu consulta quedó registrada pero el análisis falló. Probá de nuevo en unos minutos.";
  }
}

// Convierte un AdjuntoInput (lo que el cliente subió + describió) al
// shape que runAgentConsulta espera (con base64 o texto extraído).
async function prepararAdjuntoParaModelo(
  a: AdjuntoInput,
): Promise<AdjuntoModelo | null> {
  const descripcion = a.descripcion?.trim() ? a.descripcion.trim() : null;
  if (a.mime_type === "application/pdf") {
    const { base64 } = await descargarAdjuntoBytes(a.storage_path);
    return {
      kind: "pdf",
      filename: a.filename,
      descripcion,
      base64,
    };
  }
  if (a.mime_type === "image/jpeg" || a.mime_type === "image/png") {
    const { base64 } = await descargarAdjuntoBytes(a.storage_path);
    return {
      kind: "image",
      mediaType: a.mime_type,
      filename: a.filename,
      descripcion,
      base64,
    };
  }
  if (
    a.mime_type ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const { buffer } = await descargarAdjuntoBytes(a.storage_path);
    const texto = await extraerTextoDocx(buffer);
    return {
      kind: "docx",
      filename: a.filename,
      descripcion,
      texto,
    };
  }
  // Mime fuera del allowlist — lo ignoramos en silencio (no debería
  // pasar porque el upload-url ya valida, pero defense-in-depth).
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: casoId } = await params;
  if (!uuidSchema.safeParse(casoId).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

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
  const parsed = consultaInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }
  const { pregunta, adjuntos } = parsed.data;

  // 2. Auth + whitelist
  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  // 3. Cada adjunto debe pertenecer a este caso del usuario.
  const expectedPrefix = `${wl.usuario_id}/${casoId}/`;
  for (const a of adjuntos) {
    if (!a.storage_path.startsWith(expectedPrefix)) {
      return jsonResponse(
        {
          ok: false,
          error: "Algún adjunto no pertenece a este caso",
        },
        400,
      );
    }
  }

  // 4. Caso pertenece al usuario.
  const supabase = createServerClient();
  const { data: caso, error: casoErr } = await supabase
    .from("casos")
    .select("id")
    .eq("id", casoId)
    .eq("usuario_id", wl.usuario_id)
    .maybeSingle();
  if (casoErr) {
    console.error("[POST consultar] error cargando caso:", casoErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando caso",
        ...(isDev() ? { detail: casoErr.message } : {}),
      },
      500,
    );
  }
  if (!caso) {
    return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
  }

  // 5. Rate limit
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

  // 6. Crear el evento de consulta ANTES de llamar al agente. Si el
  // agente falla, este registro queda en el timeline igual.
  // tipo='manual' (lo creó el abogado), categoria='consulta_agente'.
  const ahoraIso = new Date().toISOString();
  const { data: eventoConsulta, error: evConsultaErr } = await supabase
    .from("eventos_caso")
    .insert({
      caso_id: casoId,
      tipo: "manual",
      categoria: "consulta_agente",
      descripcion: pregunta,
      ocurrido_en: ahoraIso,
      estado: "sucedido",
      adjuntos,
    })
    .select(
      "id, tipo, categoria, descripcion, ocurrido_en, estado, creado_en, adjuntos",
    )
    .single();
  if (evConsultaErr || !eventoConsulta) {
    console.error("[POST consultar] error creando evento consulta:", evConsultaErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error registrando consulta",
        ...(isDev() && evConsultaErr
          ? { detail: evConsultaErr.message }
          : {}),
      },
      500,
    );
  }

  // 7. Construir contexto del caso (caso + estrategia + historial).
  let contextoMarkdown: string;
  try {
    const built = await buildContextoCaso(casoId);
    contextoMarkdown = built.contextoMarkdown;
  } catch (e) {
    console.error("[POST consultar] error armando contexto:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error armando el contexto del caso",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
        evento_consulta_id: eventoConsulta.id,
      },
      500,
    );
  }

  // 8. Bajar y preparar los adjuntos nuevos para el modelo. Los
  // PDF/imagen van como base64; los DOCX como texto extraído.
  let adjuntosModelo: AdjuntoModelo[];
  try {
    const promesas = adjuntos.map((a) => prepararAdjuntoParaModelo(a));
    const resultados = await Promise.all(promesas);
    adjuntosModelo = resultados.filter(
      (r): r is AdjuntoModelo => r !== null,
    );
  } catch (e) {
    console.error("[POST consultar] error preparando adjuntos:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error preparando los adjuntos para el modelo",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
        evento_consulta_id: eventoConsulta.id,
      },
      500,
    );
  }

  // 9. Llamar al agente.
  const t0 = Date.now();
  let agentResult: Awaited<ReturnType<typeof runAgentConsulta>> | null = null;
  let agentError: AgentError | null = null;
  try {
    agentResult = await runAgentConsulta({
      pregunta,
      contextoCaso: contextoMarkdown,
      adjuntos: adjuntosModelo,
      systemPrompt: SYSTEM_PROMPT_CONSULTA,
    });
  } catch (e) {
    if (e instanceof AgentError) {
      agentError = e;
    } else {
      console.error("[POST consultar] runAgentConsulta failed pre-loop:", e);
      return jsonResponse(
        {
          ok: false,
          error: "Error ejecutando agente",
          ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
          evento_consulta_id: eventoConsulta.id,
        },
        500,
      );
    }
  }
  const latencia_ms = Date.now() - t0;

  // 10a. Si AgentError: persistir parcial y devolver 502. NO se crea
  // evento de respuesta (la consulta ya está en el timeline).
  if (agentError) {
    const usage = agentError.partialUsage;
    const insertPayload = {
      usuario_id: wl.usuario_id,
      tipo: "consulta_caso",
      modelo: MODEL_ID,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      costo_usd: calcularCosto(MODEL_ID, usage),
      latencia_ms,
      metadata: {
        caso_id: casoId,
        evento_consulta_id: eventoConsulta.id,
        pregunta,
        adjuntos,
        contexto_usado: contextoMarkdown,
        resultado: null,
        busquedas: agentError.partialBusquedas,
        iterations: agentError.partialIterations,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        error: agentError.message,
        error_code: agentError.code,
      },
    };
    const { error: insErr } = await supabase
      .from("ejecuciones")
      .insert(insertPayload);
    if (insErr) {
      console.error("[POST consultar] insert (agent error) failed:", insErr);
    }
    return jsonResponse(
      {
        ok: false,
        error: mensajeParaError(agentError.code),
        evento_consulta_id: eventoConsulta.id,
        ...(isDev()
          ? {
              error_code: agentError.code,
              error_detail: agentError.message,
            }
          : {}),
      },
      502,
    );
  }

  if (!agentResult) {
    return jsonResponse(
      {
        ok: false,
        error: "Estado interno inválido",
        evento_consulta_id: eventoConsulta.id,
      },
      500,
    );
  }

  // 10b. Parse de la respuesta del modelo.
  const parseado = parseWithRecovery(agentResult.rawText);

  // 11. INSERT ejecucion siempre (tokens reales del agente).
  const usage = agentResult.usage;
  const insertPayload = {
    usuario_id: wl.usuario_id,
    tipo: "consulta_caso",
    modelo: MODEL_ID,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    costo_usd: calcularCosto(MODEL_ID, usage),
    latencia_ms,
    metadata: {
      caso_id: casoId,
      evento_consulta_id: eventoConsulta.id,
      pregunta,
      adjuntos,
      contexto_usado: contextoMarkdown,
      resultado: parseado.ok ? parseado.resultado : null,
      busquedas: agentResult.busquedas,
      parseo_intento: parseado.ok ? parseado.parseo_intento : null,
      iterations: agentResult.iterations,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      degraded_response: agentResult.degraded_response,
      ...(parseado.ok ? {} : { parseo_error: parseado.error }),
    },
  };
  const { data: insertedEjec, error: insertErr } = await supabase
    .from("ejecuciones")
    .insert(insertPayload)
    .select("id")
    .single();
  if (insertErr || !insertedEjec) {
    console.error("[POST consultar] insert ejecucion failed:", insertErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error persistiendo ejecución",
        ...(isDev() && insertErr ? { detail: insertErr.message } : {}),
        evento_consulta_id: eventoConsulta.id,
      },
      500,
    );
  }

  // 12. Si el parseo falló: no creamos evento de respuesta (la
  // ejecución queda persistida con parseo_error para auditoría).
  if (!parseado.ok) {
    return jsonResponse(
      {
        ok: false,
        error: "El modelo devolvió una respuesta que no se pudo procesar.",
        evento_consulta_id: eventoConsulta.id,
        ejecucion_id: insertedEjec.id,
        ...(isDev()
          ? {
              raw_response: parseado.raw_response,
              parse_error: parseado.error,
            }
          : {}),
      },
      502,
    );
  }

  // 13. Crear evento de respuesta del agente. La descripción es el
  // JSON serializado de la respuesta enriquecida con metadata de la
  // ejecución (degraded_response, búsquedas, ejecucion_id) — el front
  // la parsea para renderizarla.
  const respuestaPayload = {
    ...parseado.resultado,
    degraded_response: agentResult.degraded_response,
    ejecucion_id: insertedEjec.id,
    busquedas: agentResult.busquedas,
  };
  const { data: eventoRespuesta, error: evRespErr } = await supabase
    .from("eventos_caso")
    .insert({
      caso_id: casoId,
      tipo: "agente",
      categoria: "respuesta_agente",
      descripcion: JSON.stringify(respuestaPayload),
      ocurrido_en: new Date().toISOString(),
      estado: "sucedido",
      adjuntos: [],
    })
    .select(
      "id, tipo, categoria, descripcion, ocurrido_en, estado, creado_en, adjuntos",
    )
    .single();
  if (evRespErr || !eventoRespuesta) {
    console.error("[POST consultar] error creando evento respuesta:", evRespErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error registrando la respuesta del agente",
        evento_consulta_id: eventoConsulta.id,
        ejecucion_id: insertedEjec.id,
        ...(isDev() && evRespErr ? { detail: evRespErr.message } : {}),
      },
      500,
    );
  }

  return jsonResponse(
    {
      ok: true,
      evento_consulta: eventoConsulta,
      evento_respuesta: eventoRespuesta,
      respuesta: respuestaPayload,
    },
    200,
  );
}
