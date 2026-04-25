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

export type RunAgentResult = {
  rawText: string;
  usage: RunAgentUsage;
  busquedas: string[];
  iterations: number;
};

export class AgentError extends Error {
  partialUsage: RunAgentUsage;
  partialBusquedas: string[];
  partialIterations: number;
  constructor(
    message: string,
    partialUsage: RunAgentUsage,
    partialBusquedas: string[],
    partialIterations: number,
  ) {
    super(message);
    this.name = "AgentError";
    this.partialUsage = partialUsage;
    this.partialBusquedas = partialBusquedas;
    this.partialIterations = partialIterations;
  }
}

const HARD_CAP_BUSQUEDAS = 6;

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

async function ejecutarToolBuscar(query: string): Promise<string> {
  const embedding = await embedQuery(query);
  const docs = await buscarDocumentos(embedding, 5);
  return JSON.stringify(
    docs.map((d) => ({
      content: d.content,
      metadata: d.metadata,
      similarity: Number(d.similarity.toFixed(4)),
    })),
  );
}

export async function runAgent(
  input: RunAgentInput,
): Promise<RunAgentResult> {
  const { userPrompt, systemPrompt } = input;
  const maxIterations = input.maxIterations ?? 10;

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
  const busquedas: string[] = [];
  let iterations = 0;

  // Primer call: si falla acá no hay tokens cobrados — dejamos bubblear como error de infra.
  let response = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 8192,
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
            busquedas.push(query);
            try {
              const content = await ejecutarToolBuscar(query);
              return {
                type: "tool_result",
                tool_use_id: tu.id,
                content,
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

    if (busquedas.length > HARD_CAP_BUSQUEDAS) {
      throw new AgentError(
        "LIMITE_BUSQUEDAS_EXCEDIDO",
        { ...totalUsage },
        [...busquedas],
        iterations,
      );
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });

    try {
      response = await client.messages.create({
        model: MODEL_ID,
        max_tokens: 8192,
        system: systemPrompt,
        tools: [buscarDocumentosTool],
        messages,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new AgentError(
        msg,
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
  }

  if (response.stop_reason === "tool_use") {
    throw new AgentError(
      "MAX_ITERATIONS alcanzado",
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
  };
}
