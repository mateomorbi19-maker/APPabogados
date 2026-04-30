import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

export const BUSCAR_DOCUMENTOS_TOOL_NAME = "buscar_documentos_legales" as const;

export const buscarDocumentosTool: Anthropic.Tool = {
  name: BUSCAR_DOCUMENTOS_TOOL_NAME,
  description:
    "Busca artículos del Código Penal argentino, del Código Procesal Penal Federal (Ley 27.063, sistema acusatorio, Infojus 2014) y doctrina de manuales de litigación penal. Usa términos jurídicos específicos como 'homicidio tentativa', 'injurias', 'legítima defensa', 'emoción violenta', 'abuso de arma', 'control de detención', 'archivo investigación', etc. Hacé múltiples búsquedas con diferentes términos para cubrir todos los aspectos del caso, incluyendo aspectos sustantivos (Código Penal) y procesales (CPPF).",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Términos jurídicos a buscar, en español. Combiná conceptos relacionados en una sola query.",
      },
    },
    required: ["query"],
  },
};
