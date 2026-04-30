import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

export const BUSCAR_DOCUMENTOS_TOOL_NAME = "buscar_documentos_legales" as const;

export const buscarDocumentosTool: Anthropic.Tool = {
  name: BUSCAR_DOCUMENTOS_TOOL_NAME,
  description:
    "Busca artículos del Código Penal argentino y doctrina de manuales de litigación penal. Usa términos jurídicos específicos como 'homicidio tentativa', 'injurias', 'legítima defensa', 'emoción violenta', 'abuso de arma', etc. Hacé múltiples búsquedas con diferentes términos para cubrir todos los aspectos del caso.",
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
