import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, MODEL_ID } from "@/lib/anthropic";
import {
  buscarDocumentosTool,
  BUSCAR_DOCUMENTOS_TOOL_NAME,
} from "@/lib/agent/tools";
import { embedQuery } from "@/lib/rag/embed";
import { buscarDocumentos } from "@/lib/rag/match-documents";

export type RunAgentInput = {
  userPrompt: string;
  systemPrompt: string;
  maxIterations?: number;
};

export type RunAgentUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

export type Busqueda = {
  query: string;
  chunks_devueltos: number;
  similarity_top: number | null;
};

export type RunAgentResult = {
  rawText: string;
  usage: RunAgentUsage;
  busquedas: Busqueda[];
  iterations: number;
  // True cuando el agente alcanzó el HARD_CAP_BUSQUEDAS y aun así sintetizó
  // una respuesta. La ejecución es ok pero potencialmente parcial. El INSERT
  // a `ejecuciones` la marca con metadata.degraded_response = true.
  degraded_response: boolean;
};

// Códigos estables para distinguir tipos de fallo del loop. El message es
// libre (puede traer detalle de la API), el code se mapea a un mensaje
// user-friendly en el route handler.
export type AgentErrorCode =
  | "API_ERROR"
  | "CAP_EXCEEDED_NO_SYNTHESIS"
  | "MAX_ITERATIONS";

export class AgentError extends Error {
  code: AgentErrorCode;
  partialUsage: RunAgentUsage;
  partialBusquedas: Busqueda[];
  partialIterations: number;
  constructor(
    message: string,
    code: AgentErrorCode,
    partialUsage: RunAgentUsage,
    partialBusquedas: Busqueda[],
    partialIterations: number,
  ) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.partialUsage = partialUsage;
    this.partialBusquedas = partialBusquedas;
    this.partialIterations = partialIterations;
  }
}

// Tope total de búsquedas RAG por ejecución del agente. Subido de 6 a 10
// en mayo 2026 tras detectar que casos multifacéticos reales (homicidio
// con allanamiento ilegal + abuso previo + interrogatorio irregular a
// menor) razonablemente requieren 7-8 ejes legales distintos. Si en el
// futuro vemos que se sigue alcanzando seguido, evaluamos antes de
// volver a subirlo: el problema podría ser de prompt o de corpus.
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

export async function runAgent(
  input: RunAgentInput,
): Promise<RunAgentResult> {
  const { userPrompt, systemPrompt } = input;
  // Margen sobre HARD_CAP_BUSQUEDAS=10: si el modelo hace 1 búsqueda por
  // iteración, con maxIterations=cap saldríamos del while justo cuando
  // toca el cap, sin oportunidad de correr la "iteración final sin tools"
  // que garantiza síntesis. Con +2 de margen siempre queda lugar.
  const maxIterations = input.maxIterations ?? 12;

  const client = getAnthropic();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPrompt },
  ];

  const totalUsage: RunAgentUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  const busquedas: Busqueda[] = [];
  let iterations = 0;

  // Primer call: si falla acá no hay tokens cobrados — dejamos bubblear como error de infra.
  let response = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 16000,
    system: systemPrompt,
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

            // Cap check ANTES de pushear/ejecutar. Si esta búsqueda excedería
            // el cap (incluyendo otros tool_use de la misma iteración que ya
            // pushearon), devolvemos un tool_result sintético: no se gasta
            // embedding ni pgvector y no suma al contador.
            //
            // El `>=` es intencional: HARD_CAP_BUSQUEDAS=10 permite hasta 10
            // búsquedas reales (índices 0..9). Cuando length llega a 10,
            // cualquier búsqueda adicional cae en este branch.
            if (busquedas.length >= HARD_CAP_BUSQUEDAS) {
              return {
                type: "tool_result",
                tool_use_id: tu.id,
                content: `Has alcanzado el límite de búsquedas permitidas (${HARD_CAP_BUSQUEDAS}). No se ejecutó esta búsqueda. Generá la mejor respuesta posible con la información ya recopilada.`,
              };
            }

            // Reservamos el slot síncronamente para preservar el orden
            // en que el agente emitió las queries (no el orden en que terminan).
            // El push síncrono también es lo que hace que el cap-check de los
            // siguientes elementos del map vea el contador actualizado sin race.
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

    // Cap agotado: garantiza síntesis quitando la herramienta del próximo
    // call. Sin `tools` en los params, el modelo no puede técnicamente
    // responder con tool_use; solo puede generar texto. Reemplaza el patrón
    // viejo (mensaje sintético + esperar que el modelo obedezca) que fallaba
    // cuando el modelo lo ignoraba (caso real: ejec 68dbc170... 2026-05-07).
    //
    // Además, agregamos un text block adicional al user message para que el
    // modelo entienda explícitamente por qué desaparecen las herramientas.
    // Mezclamos tool_results + text en el mismo content array (válido por
    // contrato Anthropic: user messages aceptan text + tool_result).
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
              max_tokens: 16000,
              system: systemPrompt,
              messages,
            }
          : {
              model: MODEL_ID,
              max_tokens: 16000,
              system: systemPrompt,
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

    // Defensivo: con `tools` removidas en el call anterior, el modelo no
    // debería poder responder con tool_use. Si por algún cambio del SDK o
    // un escenario inesperado lo hiciera, este branch corta limpio.
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
    // Marcamos degraded cualquier ejecución que tocó el cap, sea por
    // bloqueo de búsqueda extra (>cap) o por consumo exacto (==cap):
    // en ambos casos forzamos síntesis sin tools, lo que limita la
    // capacidad del modelo de re-evaluar. El panel admin lo expone.
    degraded_response: busquedas.length >= HARD_CAP_BUSQUEDAS,
  };
}
