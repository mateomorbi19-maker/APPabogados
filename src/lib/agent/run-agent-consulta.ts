import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/anthropic";
import {
  buscarDocumentosTool,
  BUSCAR_DOCUMENTOS_TOOL_NAME,
} from "@/lib/agent/tools";
import { calcularCosto } from "@/lib/agent/pricing";
import { embedQuery } from "@/lib/rag/embed";
import { buscarDocumentos } from "@/lib/rag/match-documents";
import {
  AgentError,
  usageDeResponse,
  type Busqueda,
  type RunAgentResult,
  type RunAgentUsage,
} from "@/lib/agent/run-agent";

// Variante del agente para consultas continuas sobre un caso. Misma
// lógica de cap + síntesis forzada que runAgent del análisis original
// (HARD_CAP_BUSQUEDAS = 10, maxIterations = 12, código de errores
// idéntico vía AgentError) pero con un user message inicial que es un
// array de content blocks en vez de un string: incluye los adjuntos
// nuevos como contenido nativo (document/image/text) seguidos del
// contexto markdown del caso + la pregunta del abogado.
//
// Compartiría el loop con runAgent extrayendo una función común, pero
// /analizar-caso ya corre en producción y prefiero no refactorizarlo
// en este PR. Hallazgo colateral documentado en el reporte: candidato
// a refactor en una iteración futura para extraer agent-loop común.

// Tipos discriminados para que el endpoint /consultar arme la lista
// con shapes claros. El loop convierte cada uno al content block
// correspondiente del SDK.
export type AdjuntoModelo =
  | {
      kind: "pdf";
      filename: string;
      descripcion: string | null;
      base64: string;
    }
  | {
      kind: "image";
      // Solo los mimes que Anthropic acepta como image block. Las HEIC
      // se convierten a JPEG server-side antes de llegar acá.
      mediaType: "image/jpeg" | "image/png" | "image/webp";
      filename: string;
      descripcion: string | null;
      base64: string;
    }
  | {
      kind: "docx";
      filename: string;
      descripcion: string | null;
      texto: string;
    }
  | {
      // Audio: la Messages API no acepta audio como content block, así
      // que va la TRANSCRIPCIÓN (Whisper) como texto etiquetado.
      // transcripcion === null significa que la transcripción falló.
      kind: "audio";
      filename: string;
      descripcion: string | null;
      transcripcion: string | null;
    };

export type RunAgentConsultaInput = {
  pregunta: string;
  contextoCaso: string;
  adjuntos: AdjuntoModelo[];
  systemPrompt: string;
  // Model ID resuelto SERVER-SIDE desde el nivel elegido por el abogado
  // (Bajo/Medio/Alto → src/lib/agent/modelos.ts). Nunca viene crudo del
  // cliente. Debe tener pricing en pricing.ts.
  modelId: string;
  maxTokens?: number;
  maxIterations?: number;
  // Historial previo de la conversación. Cada item es un MessageParam
  // ya construido (user/assistant text). El último mensaje del usuario
  // (la pregunta nueva) NO se incluye acá — se arma con buildPrimerUserContent
  // adentro del loop con contexto + adjuntos nuevos como contenido nativo.
  // Para llamadas que no son chat (one-shot del PR3), pasar [] o nada.
  mensajesPrevios?: Anthropic.MessageParam[];
};

const HARD_CAP_BUSQUEDAS = 10;

function isToolUseBlock(
  block: Anthropic.ContentBlock,
): block is Anthropic.ToolUseBlock {
  return block.type === "tool_use";
}

function isTextBlock(
  block: Anthropic.ContentBlock,
): block is Anthropic.TextBlock {
  return block.type === "text";
}

async function ejecutarToolBuscar(query: string): Promise<{
  contentJSON: string;
  chunks_devueltos: number;
  similarity_top: number | null;
}> {
  const embedding = await embedQuery(query);
  const docs = await buscarDocumentos(embedding, 5);
  const contentJSON = JSON.stringify(
    docs.map((d) => ({
      content: d.content,
      metadata: d.metadata,
      similarity: Number(d.similarity.toFixed(4)),
    })),
  );
  const top = docs[0]?.similarity ?? null;
  return {
    contentJSON,
    chunks_devueltos: docs.length,
    similarity_top: top !== null ? Number(top.toFixed(4)) : null,
  };
}

// Arma el content array del primer user message: cada adjunto nuevo
// va como bloque nativo precedido por una pequeña etiqueta de texto
// que le dice al modelo qué archivo está mirando (filename + descripcion
// si existe). Esto ayuda al modelo a referenciar los adjuntos por
// nombre cuando los cita en su respuesta.
function buildPrimerUserContent(
  input: RunAgentConsultaInput,
): Anthropic.MessageParam["content"] {
  const blocks: Array<
    | { type: "text"; text: string }
    | {
        type: "document";
        source: { type: "base64"; media_type: "application/pdf"; data: string };
        title?: string;
      }
    | {
        type: "image";
        source: {
          type: "base64";
          media_type: "image/jpeg" | "image/png" | "image/webp";
          data: string;
        };
      }
  > = [];

  for (let i = 0; i < input.adjuntos.length; i++) {
    const adj = input.adjuntos[i];
    const orden = `Adjunto ${i + 1} de ${input.adjuntos.length}`;
    const desc = adj.descripcion ? ` — ${adj.descripcion}` : "";

    if (adj.kind === "pdf") {
      blocks.push({
        type: "text",
        text: `${orden}: archivo "${adj.filename}"${desc}. PDF adjunto a continuación.`,
      });
      blocks.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: adj.base64,
        },
        title: adj.filename,
      });
    } else if (adj.kind === "image") {
      blocks.push({
        type: "text",
        text: `${orden}: imagen "${adj.filename}"${desc}.`,
      });
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: adj.mediaType,
          data: adj.base64,
        },
      });
    } else if (adj.kind === "docx") {
      // Para DOCX no hay content block nativo; pasamos el texto
      // extraído por mammoth como text block etiquetado.
      blocks.push({
        type: "text",
        text: `${orden}: documento Word "${adj.filename}"${desc}. Contenido extraído:\n\n${adj.texto || "(no se pudo extraer texto del archivo)"}`,
      });
    } else if (adj.kind === "audio") {
      // Audio: va la transcripción de Whisper como texto etiquetado
      // (la API no acepta audio nativo).
      blocks.push({
        type: "text",
        text:
          adj.transcripcion && adj.transcripcion.length > 0
            ? `${orden}: audio "${adj.filename}"${desc}. Transcripción del audio:\n\n«${adj.transcripcion}»`
            : `${orden}: audio "${adj.filename}"${desc}. La transcripción automática falló o el audio no tiene voz detectable — pedile al abogado que reenvíe el audio o escriba su contenido si es relevante.`,
      });
    }
  }

  // Texto principal: contexto del caso + pregunta. Va al final para
  // que el modelo procese la pregunta después de haber visto los
  // adjuntos en orden.
  blocks.push({
    type: "text",
    text: `${input.contextoCaso}\n\n---\n\n## PREGUNTA DEL ABOGADO\n\n${input.pregunta}`,
  });

  return blocks;
}

export async function runAgentConsulta(
  input: RunAgentConsultaInput,
): Promise<RunAgentResult> {
  const maxIterations = input.maxIterations ?? 12;
  const modelId = input.modelId;
  const maxTokens = input.maxTokens ?? 16000;

  const client = getAnthropic();
  // Mensajes previos del chat (si los hay) + el nuevo mensaje del
  // usuario con contexto markdown + adjuntos nuevos como contenido
  // nativo. El último mensaje del array siempre tiene que ser
  // role='user' para que la API acepte la request — los chequeos
  // del flujo del endpoint garantizan que mensajesPrevios termina en
  // assistant (porque el último insertado es la respuesta agente
  // anterior) o está vacío.
  const messages: Anthropic.MessageParam[] = [
    ...(input.mensajesPrevios ?? []),
    { role: "user", content: buildPrimerUserContent(input) },
  ];

  const totalUsage: RunAgentUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  const busquedas: Busqueda[] = [];
  let iterations = 0;
  let costoUsd = 0;

  // Primer call. Si falla acá no hay tokens cobrados, pero igual lo
  // envolvemos en AgentError: antes bubbleaba como 500 crudo y el
  // cliente no disparaba el recovery-polling ni mostraba un mensaje
  // accionable (así se gatilló el incidente de la conversación
  // brickeada del 25/06 — un fallo transitorio en el primer call de un
  // turno con PDF).
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: modelId,
      max_tokens: maxTokens,
      system: input.systemPrompt,
      tools: [buscarDocumentosTool],
      messages,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new AgentError(
      msg,
      "API_ERROR",
      { ...totalUsage },
      0,
      [...busquedas],
      iterations,
    );
  }
  totalUsage.input_tokens += response.usage.input_tokens;
  totalUsage.output_tokens += response.usage.output_tokens;
  totalUsage.cache_creation_input_tokens +=
    response.usage.cache_creation_input_tokens ?? 0;
  totalUsage.cache_read_input_tokens +=
    response.usage.cache_read_input_tokens ?? 0;
  costoUsd += calcularCosto(modelId, usageDeResponse(response));

  while (
    response.stop_reason === "tool_use" &&
    iterations < maxIterations
  ) {
    iterations++;
    const toolUseBlocks = response.content.filter(isToolUseBlock);

    const toolResults = await Promise.all(
      toolUseBlocks.map(
        async (tu): Promise<Anthropic.ToolResultBlockParam> => {
          if (tu.name === BUSCAR_DOCUMENTOS_TOOL_NAME) {
            const inputObj = (tu.input ?? {}) as { query?: unknown };
            const query =
              typeof inputObj.query === "string" ? inputObj.query : "";

            if (busquedas.length >= HARD_CAP_BUSQUEDAS) {
              return {
                type: "tool_result",
                tool_use_id: tu.id,
                content: `Has alcanzado el límite de búsquedas permitidas (${HARD_CAP_BUSQUEDAS}). No se ejecutó esta búsqueda. Generá la mejor respuesta posible con la información ya recopilada.`,
              };
            }

            const idx = busquedas.length;
            busquedas.push({ query, chunks_devueltos: 0, similarity_top: null });
            try {
              const r = await ejecutarToolBuscar(query);
              busquedas[idx] = {
                query,
                chunks_devueltos: r.chunks_devueltos,
                similarity_top: r.similarity_top,
              };
              return {
                type: "tool_result",
                tool_use_id: tu.id,
                content: r.contentJSON,
              };
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              return {
                type: "tool_result",
                tool_use_id: tu.id,
                content: `Error: ${msg}`,
                is_error: true,
              };
            }
          }
          return {
            type: "tool_result",
            tool_use_id: tu.id,
            content: `Error: tool desconocida "${tu.name}"`,
            is_error: true,
          };
        },
      ),
    );

    const capAgotado = busquedas.length >= HARD_CAP_BUSQUEDAS;
    const userContent: Anthropic.MessageParam["content"] = capAgotado
      ? [
          ...toolResults,
          {
            type: "text" as const,
            text: `Has alcanzado el límite de búsquedas (${HARD_CAP_BUSQUEDAS}). Generá ahora la respuesta final completa basada en el material recolectado. No vas a poder hacer más búsquedas.`,
          },
        ]
      : toolResults;

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: userContent });

    try {
      response = await client.messages.create(
        capAgotado
          ? {
              model: modelId,
              max_tokens: maxTokens,
              system: input.systemPrompt,
              messages,
            }
          : {
              model: modelId,
              max_tokens: maxTokens,
              system: input.systemPrompt,
              tools: [buscarDocumentosTool],
              messages,
            },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new AgentError(
        msg,
        "API_ERROR",
        { ...totalUsage },
        Number(costoUsd.toFixed(6)),
        [...busquedas],
        iterations,
      );
    }
    totalUsage.input_tokens += response.usage.input_tokens;
    totalUsage.output_tokens += response.usage.output_tokens;
    totalUsage.cache_creation_input_tokens +=
      response.usage.cache_creation_input_tokens ?? 0;
    totalUsage.cache_read_input_tokens +=
      response.usage.cache_read_input_tokens ?? 0;
    costoUsd += calcularCosto(modelId, usageDeResponse(response));

    // Defensivo: con tools removidas en el call anterior el modelo no
    // debería responder con tool_use. Si por alguna razón lo hace,
    // cortamos limpio.
    if (capAgotado && response.stop_reason === "tool_use") {
      throw new AgentError(
        "CAP_EXCEEDED_NO_SYNTHESIS",
        "CAP_EXCEEDED_NO_SYNTHESIS",
        { ...totalUsage },
        Number(costoUsd.toFixed(6)),
        [...busquedas],
        iterations,
      );
    }
  }

  if (response.stop_reason === "tool_use") {
    throw new AgentError(
      "MAX_ITERATIONS alcanzado",
      "MAX_ITERATIONS",
      { ...totalUsage },
      Number(costoUsd.toFixed(6)),
      [...busquedas],
      iterations,
    );
  }

  const rawText = response.content
    .filter(isTextBlock)
    .map((b) => b.text)
    .join("");

  return {
    rawText,
    usage: totalUsage,
    costo_usd: Number(costoUsd.toFixed(6)),
    busquedas,
    iterations,
    degraded_response: busquedas.length >= HARD_CAP_BUSQUEDAS,
  };
}
