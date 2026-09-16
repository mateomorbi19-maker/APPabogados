import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/anthropic";
import { calcularCosto } from "@/lib/agent/pricing";
import {
  AgentError,
  usageDeResponse,
  type RunAgentUsage,
} from "@/lib/agent/run-agent";
import { REPORTE_SYSTEM_PROMPT } from "./prompt";

// El redactor de reportes: UNA llamada al modelo, sin tools.
//
// No usa el motor a propósito: no hay nada que buscar. El mensaje al cliente
// se escribe con lo que la causa ya tiene (el borrador y los datos crudos), y
// darle al modelo la búsqueda normativa o el repositorio sería invitarlo a
// sumar un artículo o un fallo a un mensaje que no debe tenerlos. Es el mismo
// esquema single-shot que /api/pre-analisis, con el system cacheado.
//
// El resultado es texto plano. Para correo, la primera línea `Asunto: …` se
// separa del cuerpo acá, para que la ruta no tenga que parsear nada.

export type RunReporteInput = {
  mensaje: string;
  modelId: string;
  maxTokens?: number;
};

export type RunReporteResult = {
  contenido: string;
  /** Sólo cuando el modelo escribió la línea de asunto (canal correo). */
  asunto: string | null;
  usage: RunAgentUsage;
  costo_usd: number;
};

const USAGE_CERO: RunAgentUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

/** Quita un cerco ``` si el modelo lo puso igual, y separa el asunto. */
export function separarAsunto(raw: string): { asunto: string | null; cuerpo: string } {
  let t = raw.trim();
  const fence = t.match(/^```[a-z]*\s*\n([\s\S]*?)\n```\s*$/i);
  if (fence) t = fence[1].trim();
  const m = t.match(/^Asunto:\s*(.+)\n+([\s\S]*)$/i);
  if (m) {
    return { asunto: m[1].trim().replace(/^["«]|["»]$/g, ""), cuerpo: m[2].trim() };
  }
  return { asunto: null, cuerpo: t };
}

export async function runReporte(input: RunReporteInput): Promise<RunReporteResult> {
  const client = getAnthropic();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: input.modelId,
      max_tokens: input.maxTokens ?? 2000,
      system: [
        {
          type: "text",
          text: REPORTE_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: input.mensaje }],
    });
  } catch (e) {
    throw new AgentError(
      e instanceof Error ? e.message : String(e),
      "API_ERROR",
      { ...USAGE_CERO },
      0,
      [],
      0,
    );
  }

  const usage = usageDeResponse(response);
  const costo = Number(calcularCosto(input.modelId, usage).toFixed(6));
  const texto = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (texto.length === 0) {
    throw new AgentError(
      "El modelo devolvió una respuesta vacía.",
      "API_ERROR",
      usage,
      costo,
      [],
      1,
    );
  }

  const { asunto, cuerpo } = separarAsunto(texto);
  return { contenido: cuerpo, asunto, usage, costo_usd: costo };
}
