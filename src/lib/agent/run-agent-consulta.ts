import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, MODEL_ID } from "@/lib/anthropic";
import {
  buscarDocumentosTool,
  BUSCAR_DOCUMENTOS_TOOL_NAME,
} from "@/lib/agent/tools";
import { embedQuery } from "@/lib/rag/embed";
import { buscarDocumentos } from "@/lib/rag/match-documents";
import {
  AgentError,
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
      mediaType: "image/jpeg" | "image/png";
      filename: string;
      descripcion: string | null;
      base64: string;
    }
  | {
      kind: "docx";
      filename: string;
      descripcion: string | null;
      texto: string;
    };

export type RunAgentConsultaInput = {
  pregunta: string;
  contextoCaso: string;
  adjuntos: AdjuntoModelo[];
  systemPrompt: string;
  maxIterations?: number;
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
          media_type: "image/jpeg" | "image/png";
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

  const client = getAnthropic();
  const messages: Anthropic.MessageParam[] = [
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

  // Primer call. Si falla acá, no hay tokens cobrados — bubblea como
  // error de infra.
  let response = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 8192,
    system: input.systemPrompt,
    tools: [buscarDocumentosTool],
    messages,
  });
  totalUsage.input_tokens += response.usage.input_tokens;
  totalUsage.output_tokens += response.usage.output_tokens;
  totalUsage.cache_creation_input_tokens +=
    response.usage.cache_creation_input_tokens ?? 0;
  totalUsage.cache_read_input_tokens +=
    response.usage.cache_read_input_tokens ?? 0;

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
              model: MODEL_ID,
              max_tokens: 8192,
              system: input.systemPrompt,
              messages,
            }
          : {
              model: MODEL_ID,
              max_tokens: 8192,
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

    // Defensivo: con tools removidas en el call anterior el modelo no
    // debería responder con tool_use. Si por alguna razón lo hace,
    // cortamos limpio.
    if (capAgotado && response.stop_reason === "tool_use") {
      throw new AgentError(
        "CAP_EXCEEDED_NO_SYNTHESIS",
        "CAP_EXCEEDED_NO_SYNTHESIS",
        { ...totalUsage },
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
    busquedas,
    iterations,
    degraded_response: busquedas.length >= HARD_CAP_BUSQUEDAS,
  };
}
