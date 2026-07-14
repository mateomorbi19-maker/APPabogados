import { NextRequest } from "next/server";
import { z } from "zod";
import {
  crearMensajeInputSchema,
  type AdjuntoInput,
} from "@/lib/schemas";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { enforceTokenLimit } from "@/lib/auth/enforce-rate";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";
import { SYSTEM_PROMPT_CONSULTA } from "@/lib/agent/prompts";
import { parseWithRecovery } from "@/lib/agent/parse";
import { MODELO_POR_NIVEL } from "@/lib/agent/modelos";
import {
  runAgentConsulta,
  type AdjuntoModelo,
} from "@/lib/agent/run-agent-consulta";
import { AgentError } from "@/lib/agent/run-agent";
import {
  convertirHeicAJpeg,
  descargarAdjuntoBytes,
  extraerTextoDocx,
} from "@/lib/casos/descargar-adjunto";
import { transcribirAudio } from "@/lib/casos/transcribir-audio";
import { esAudio } from "@/lib/casos/adjuntos";
import { buildContextoConversacion } from "@/lib/casos/build-contexto-conversacion";

// Latencia esperada similar al análisis original, con headroom extra
// para el nivel "Alto" (Opus, más lento por token) y la transcripción
// de audios. En self-hosted (Easypanel) este valor es inerte, pero
// documenta la intención y aplica si algún día corre en Vercel.
export const maxDuration = 180;

const uuidSchema = z.string().uuid();

function mensajeUserParaError(code: string): string {
  switch (code) {
    case "CAP_EXCEEDED_NO_SYNTHESIS":
      return "Tu mensaje requiere más investigación de la que el sistema permite por turno. Probá reformularlo más específico o partirlo en mensajes más chicos.";
    case "MAX_ITERATIONS":
      return "El análisis no logró converger. Reintentá en unos minutos.";
    case "API_ERROR":
      return "Hubo un error de comunicación con el modelo. Reintentá en unos segundos.";
    default:
      // Default user-friendly: el caso default cubre errores no
      // categorizados. Mensaje accionable sin códigos técnicos.
      return "El agente no pudo responder esta vez. Probá reformular tu pregunta o esperá un momento y reintentá. Si el problema persiste, contactá al administrador.";
  }
}

async function prepararAdjuntoParaModelo(
  a: AdjuntoInput,
): Promise<AdjuntoModelo | null> {
  const descripcion = a.descripcion?.trim() ? a.descripcion.trim() : null;
  if (a.mime_type === "application/pdf") {
    const { base64 } = await descargarAdjuntoBytes(a.storage_path);
    return { kind: "pdf", filename: a.filename, descripcion, base64 };
  }
  if (
    a.mime_type === "image/jpeg" ||
    a.mime_type === "image/png" ||
    a.mime_type === "image/webp"
  ) {
    const { base64 } = await descargarAdjuntoBytes(a.storage_path);
    return {
      kind: "image",
      mediaType: a.mime_type,
      filename: a.filename,
      descripcion,
      base64,
    };
  }
  if (a.mime_type === "image/heic" || a.mime_type === "image/heif") {
    // Fotos de iPhone: Anthropic no acepta HEIC — convertimos a JPEG
    // server-side antes de mandarla como image block.
    const { buffer } = await descargarAdjuntoBytes(a.storage_path);
    const jpeg = await convertirHeicAJpeg(buffer);
    return {
      kind: "image",
      mediaType: "image/jpeg",
      filename: a.filename,
      descripcion,
      base64: jpeg.toString("base64"),
    };
  }
  if (
    a.mime_type ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const { buffer } = await descargarAdjuntoBytes(a.storage_path);
    const texto = await extraerTextoDocx(buffer);
    return { kind: "docx", filename: a.filename, descripcion, texto };
  }
  if (esAudio(a.mime_type)) {
    // Audio: el modelo no puede escucharlo — se transcribe con Whisper
    // y al modelo le llega la transcripción como texto. Si Whisper
    // falla NO rompemos el turno: va transcripcion=null y el agente
    // le avisa al abogado.
    const { buffer } = await descargarAdjuntoBytes(a.storage_path);
    let transcripcion: string | null = null;
    try {
      transcripcion = await transcribirAudio(
        buffer,
        a.filename,
        a.mime_type,
      );
    } catch (e) {
      console.error(
        `[prepararAdjuntoParaModelo] transcripción falló (${a.filename}):`,
        e,
      );
    }
    return { kind: "audio", filename: a.filename, descripcion, transcripcion };
  }
  return null;
}

type ConversacionLite = { estado: string; caso_id: string };

async function validarConversacionActiva(
  casoId: string,
  convId: string,
  usuarioId: string,
): Promise<
  | { ok: true }
  | { ok: false; status: number; error: string; detail?: string }
> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("conversaciones_caso")
    .select("estado, caso_id, casos!inner(usuario_id)")
    .eq("id", convId)
    .eq("caso_id", casoId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      status: 500,
      error: "Error consultando conversación",
      detail: error.message,
    };
  }
  if (!data) {
    return { ok: false, status: 404, error: "Conversación no encontrada" };
  }
  const conv = data as unknown as ConversacionLite & {
    casos: { usuario_id: string } | { usuario_id: string }[];
  };
  const usuarioCaso = Array.isArray(conv.casos)
    ? conv.casos[0]?.usuario_id
    : conv.casos?.usuario_id;
  if (usuarioCaso !== usuarioId) {
    return { ok: false, status: 404, error: "Conversación no encontrada" };
  }
  if (conv.estado !== "activa") {
    return {
      ok: false,
      status: 409,
      error:
        "La conversación está archivada. Empezá una nueva o continuá en la conversación activa.",
    };
  }
  return { ok: true };
}

// === POST /api/casos/[id]/conversaciones/[conv_id]/mensajes ===
//
// Agrega un mensaje del usuario a la conversación activa, llama al
// agente con contexto + history, persiste la ejecución, e inserta
// el mensaje del agente con la respuesta estructurada.
//
// Manejo de errores:
//   - El mensaje del usuario se inserta ANTES de llamar al agente.
//     Queda registro aunque el agente falle.
//   - Si el agente tira AgentError, persistimos la ejecución con error
//     y devolvemos 502. NO se inserta mensaje del agente.
//   - Si el parseo del JSON falla, ídem.
//   - El cliente al recibir 502 hace polling al GET /mensajes para
//     ver si el server alcanzó a crear el mensaje del agente (caso
//     edge: el server terminó OK pero el proxy cortó).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; conv_id: string }> },
): Promise<Response> {
  const { id: casoId, conv_id: convId } = await params;
  if (!uuidSchema.safeParse(casoId).success) {
    return jsonResponse({ ok: false, error: "id de caso inválido" }, 400);
  }
  if (!uuidSchema.safeParse(convId).success) {
    return jsonResponse(
      { ok: false, error: "id de conversación inválido" },
      400,
    );
  }

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = crearMensajeInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }
  const { contenido, adjuntos, nivel } = parsed.data;
  // Resolución server-side del modelo desde el nivel (allowlist Zod).
  const { modelId, maxTokens } = MODELO_POR_NIVEL[nivel];

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  // Conversación pertenece al caso del usuario y está activa.
  const v = await validarConversacionActiva(casoId, convId, wl.usuario_id);
  if (!v.ok) {
    return jsonResponse(
      {
        ok: false,
        error: v.error,
        ...(isDev() && v.detail ? { detail: v.detail } : {}),
      },
      v.status,
    );
  }

  // Adjuntos válidos para este caso.
  const expectedPrefix = `${wl.usuario_id}/${casoId}/`;
  for (const a of adjuntos) {
    if (!a.storage_path.startsWith(expectedPrefix)) {
      return jsonResponse(
        { ok: false, error: "Algún adjunto no pertenece a este caso" },
        400,
      );
    }
  }

  // Rate limit.
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

  const supabase = createServerClient();

  // 1. INSERT mensaje del usuario PRIMERO. Queda en BD aunque el
  // agente falle.
  const { data: msgUsuario, error: msgUserErr } = await supabase
    .from("mensajes_conversacion")
    .insert({
      conversacion_id: convId,
      rol: "usuario",
      contenido,
      adjuntos,
    })
    .select(
      "id, conversacion_id, rol, contenido, adjuntos, respuesta_estructurada, ejecucion_id, creado_en",
    )
    .single();
  if (msgUserErr || !msgUsuario) {
    console.error("[POST mensajes] error insertando msg usuario:", msgUserErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error registrando mensaje",
        ...(isDev() && msgUserErr ? { detail: msgUserErr.message } : {}),
      },
      500,
    );
  }

  // 2. Build contexto + mensajesPrevios. Excluimos el mensaje recién
  // insertado porque ese va aparte como user content del último call.
  let contextoMarkdown: string;
  let mensajesPrevios: Awaited<
    ReturnType<typeof buildContextoConversacion>
  >["mensajesPrevios"];
  try {
    const built = await buildContextoConversacion(casoId, convId, {
      excluirMensajeId: msgUsuario.id,
    });
    contextoMarkdown = built.contextoMarkdown;
    mensajesPrevios = built.mensajesPrevios;
  } catch (e) {
    console.error("[POST mensajes] error armando contexto:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error armando el contexto del caso",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
        mensaje_usuario: msgUsuario,
      },
      500,
    );
  }

  // 3. Bajar adjuntos del mensaje actual y prepararlos para el modelo
  // (PDF/imagen → base64, HEIC → JPEG, DOCX → texto, audio → Whisper).
  let adjuntosModelo: AdjuntoModelo[];
  let resultadosPrep: (AdjuntoModelo | null)[];
  try {
    const promesas = adjuntos.map((a) => prepararAdjuntoParaModelo(a));
    resultadosPrep = await Promise.all(promesas);
    adjuntosModelo = resultadosPrep.filter(
      (r): r is AdjuntoModelo => r !== null,
    );
  } catch (e) {
    console.error("[POST mensajes] error preparando adjuntos:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error preparando los adjuntos para el modelo",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
        mensaje_usuario: msgUsuario,
      },
      500,
    );
  }

  // 3b. Persistir transcripciones de audio en el jsonb `adjuntos` del
  // mensaje del usuario: (a) la UI las puede mostrar, (b) el historial
  // las reinyecta en turnos futuros sin re-transcribir. Best-effort:
  // si el UPDATE falla seguimos igual (la transcripción de ESTE turno
  // ya viaja al modelo en memoria).
  const hayTranscripciones = resultadosPrep.some(
    (r) => r?.kind === "audio" && r.transcripcion,
  );
  if (hayTranscripciones) {
    const adjuntosPersistidos = adjuntos.map((a, i) => {
      const r = resultadosPrep[i];
      return r?.kind === "audio" && r.transcripcion
        ? { ...a, transcripcion: r.transcripcion }
        : a;
    });
    const { error: updErr } = await supabase
      .from("mensajes_conversacion")
      .update({ adjuntos: adjuntosPersistidos })
      .eq("id", msgUsuario.id);
    if (updErr) {
      console.error(
        "[POST mensajes] no se pudo persistir transcripciones:",
        updErr,
      );
    } else {
      msgUsuario.adjuntos = adjuntosPersistidos;
    }
  }

  // 4. Llamar al agente con history.
  const t0 = Date.now();
  let agentResult: Awaited<ReturnType<typeof runAgentConsulta>> | null = null;
  let agentError: AgentError | null = null;
  try {
    agentResult = await runAgentConsulta({
      pregunta: contenido,
      contextoCaso: contextoMarkdown,
      adjuntos: adjuntosModelo,
      systemPrompt: SYSTEM_PROMPT_CONSULTA,
      modelId,
      maxTokens,
      mensajesPrevios,
    });
  } catch (e) {
    if (e instanceof AgentError) {
      agentError = e;
    } else {
      console.error("[POST mensajes] runAgentConsulta failed pre-loop:", e);
      return jsonResponse(
        {
          ok: false,
          error: "Error ejecutando agente",
          ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
          mensaje_usuario: msgUsuario,
        },
        500,
      );
    }
  }
  const latencia_ms = Date.now() - t0;

  // 5a. Si AgentError: persistir ejecución parcial y devolver 502.
  if (agentError) {
    const usage = agentError.partialUsage;
    await supabase.from("ejecuciones").insert({
      usuario_id: wl.usuario_id,
      tipo: "consulta_caso",
      modelo: modelId,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      // Costo por-respuesta acumulado en el loop (fix A-3): el tier
      // long-context se decide por request, no sobre la suma.
      costo_usd: agentError.partialCostoUsd,
      latencia_ms,
      metadata: {
        caso_id: casoId,
        conversacion_id: convId,
        mensaje_usuario_id: msgUsuario.id,
        nivel,
        pregunta: contenido,
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
    });
    return jsonResponse(
      {
        ok: false,
        error: mensajeUserParaError(agentError.code),
        mensaje_usuario: msgUsuario,
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
        mensaje_usuario: msgUsuario,
      },
      500,
    );
  }

  // 5b. Parse de la respuesta.
  const parseado = parseWithRecovery(agentResult.rawText);

  // FALLBACK: si el parser falló después de 3 intentos, no rompemos
  // al usuario. Construimos una "respuesta conversacional fallback"
  // con el texto crudo del modelo y persistimos la ejecución con
  // `parser_fallback: true` para que el panel admin la marque como
  // caso a investigar. Mejor entregar prosa que dejar al usuario sin
  // respuesta (decisión PR4 fix-respuesta-adaptable).
  const parserFallback = !parseado.ok;
  const rawTrimmed = agentResult.rawText.trim();

  // 6. INSERT ejecución (siempre, tokens reales).
  const usage = agentResult.usage;
  const insertEjecPayload = {
    usuario_id: wl.usuario_id,
    tipo: "consulta_caso",
    modelo: modelId,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    // Costo por-respuesta acumulado en el loop (fix A-3).
    costo_usd: agentResult.costo_usd,
    latencia_ms,
    metadata: {
      caso_id: casoId,
      conversacion_id: convId,
      mensaje_usuario_id: msgUsuario.id,
      nivel,
      pregunta: contenido,
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
      ...(parserFallback ? { parser_fallback: true } : {}),
    },
  };
  const { data: ejecInsertada, error: ejecErr } = await supabase
    .from("ejecuciones")
    .insert(insertEjecPayload)
    .select("id")
    .single();
  if (ejecErr || !ejecInsertada) {
    console.error("[POST mensajes] insert ejecucion failed:", ejecErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error persistiendo ejecución",
        ...(isDev() && ejecErr ? { detail: ejecErr.message } : {}),
        mensaje_usuario: msgUsuario,
      },
      500,
    );
  }

  // 7. Construir respuesta enriquecida (modo conversacional fallback
  // si el parser falló). Mantiene el shape del schema discriminado
  // para que el cliente la pueda renderizar uniformemente.
  const respuestaEnriquecida = parserFallback
    ? {
        modo: "conversacional" as const,
        respuesta:
          rawTrimmed.length > 0
            ? rawTrimmed
            : "(El agente respondió pero no se pudo interpretar la respuesta. El equipo fue notificado.)",
        analisis: null,
        recomendaciones: null,
        parser_fallback: true as const,
        degraded_response: agentResult.degraded_response,
        ejecucion_id: ejecInsertada.id,
        busquedas: agentResult.busquedas,
      }
    : {
        ...parseado.resultado,
        degraded_response: agentResult.degraded_response,
        ejecucion_id: ejecInsertada.id,
        busquedas: agentResult.busquedas,
      };

  // 8. Crear mensaje del agente (siempre, incluso en fallback).
  const { data: msgAgente, error: msgAgenteErr } = await supabase
    .from("mensajes_conversacion")
    .insert({
      conversacion_id: convId,
      rol: "agente",
      contenido: JSON.stringify(respuestaEnriquecida),
      adjuntos: [],
      respuesta_estructurada: respuestaEnriquecida,
      ejecucion_id: ejecInsertada.id,
    })
    .select(
      "id, conversacion_id, rol, contenido, adjuntos, respuesta_estructurada, ejecucion_id, creado_en",
    )
    .single();
  if (msgAgenteErr || !msgAgente) {
    console.error("[POST mensajes] error insertando msg agente:", msgAgenteErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error registrando la respuesta del agente",
        mensaje_usuario: msgUsuario,
        ejecucion_id: ejecInsertada.id,
        ...(isDev() && msgAgenteErr ? { detail: msgAgenteErr.message } : {}),
      },
      500,
    );
  }

  return jsonResponse(
    {
      ok: true,
      mensaje_usuario: msgUsuario,
      mensaje_agente: msgAgente,
      respuesta: respuestaEnriquecida,
    },
    200,
  );
}

// === GET /api/casos/[id]/conversaciones/[conv_id]/mensajes?desde=<iso> ===
//
// Polling para recovery post-502: el cliente al recibir 502 al hacer
// POST hace polling acá durante 60s buscando el mensaje del agente
// que el server pudo haber alcanzado a insertar antes del corte.
const queryGet = z.object({
  desde: z.string().datetime({ offset: true }),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; conv_id: string }> },
): Promise<Response> {
  const { id: casoId, conv_id: convId } = await params;
  if (!uuidSchema.safeParse(casoId).success) {
    return jsonResponse({ ok: false, error: "id de caso inválido" }, 400);
  }
  if (!uuidSchema.safeParse(convId).success) {
    return jsonResponse(
      { ok: false, error: "id de conversación inválido" },
      400,
    );
  }

  const url = new URL(req.url);
  const parsed = queryGet.safeParse({ desde: url.searchParams.get("desde") });
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Query inválida", issues: parsed.error.issues },
      400,
    );
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  const supabase = createServerClient();

  // Caso del usuario + conversación del caso. Mismo patrón que el
  // helper del [conv_id]/route.ts pero inline acá para no introducir
  // un import circular.
  const { data: conv, error: convErr } = await supabase
    .from("conversaciones_caso")
    .select("id, casos!inner(usuario_id)")
    .eq("id", convId)
    .eq("caso_id", casoId)
    .maybeSingle();
  if (convErr) {
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando conversación",
        ...(isDev() ? { detail: convErr.message } : {}),
      },
      500,
    );
  }
  if (!conv) {
    return jsonResponse(
      { ok: false, error: "Conversación no encontrada" },
      404,
    );
  }
  const casos = (conv as unknown as { casos: { usuario_id: string } | { usuario_id: string }[] }).casos;
  const usuarioCaso = Array.isArray(casos) ? casos[0]?.usuario_id : casos?.usuario_id;
  if (usuarioCaso !== wl.usuario_id) {
    return jsonResponse(
      { ok: false, error: "Conversación no encontrada" },
      404,
    );
  }

  const { data, error } = await supabase
    .from("mensajes_conversacion")
    .select(
      "id, conversacion_id, rol, contenido, adjuntos, respuesta_estructurada, ejecucion_id, creado_en",
    )
    .eq("conversacion_id", convId)
    .gte("creado_en", parsed.data.desde)
    .order("creado_en", { ascending: true })
    .limit(20);

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando mensajes",
        ...(isDev() ? { detail: error.message } : {}),
      },
      500,
    );
  }

  return jsonResponse({ mensajes: data ?? [] }, 200);
}
