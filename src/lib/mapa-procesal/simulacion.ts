// Simulación de ramas con IA (Fase C del plan). Single-shot estructurado, SIN
// RAG: el esqueleto legal viene de las plantillas curadas (el corpus solo
// cubre el CPPF federal — ver PLAN_MAPA_PROCESAL.md §1.2), y acá el modelo
// solo proyecta cómo puede seguir ESTE caso desde un nodo, dentro del fuero.
//
// Las reglas de congruencia (§6 del plan) van horneadas en el system prompt y
// el esquema de referencia del fuero se inyecta desde FLUJO_POR_FUERO (fuente
// única de verdad — si el template cambia, el prompt cambia solo).
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, MODEL_ID } from "@/lib/anthropic";
import { parseWithRecovery } from "@/lib/agent/parse";
import type { Usage } from "@/lib/agent/pricing";
import { FLUJO_POR_FUERO } from "./plantilla-base";
import {
  FUERO_LABEL,
  ramasSimuladasSchema,
  type Fuero,
  type NodoProcesalDB,
  type RamaSimulada,
} from "./types";

export const SYSTEM_PROMPT_SIMULACION =
  "Sos un abogado penalista argentino experto en derecho procesal. Tu tarea: dado el mapa procesal de un caso real (un árbol de etapas y desenlaces del proceso penal), el fuero/código procesal aplicable y los hechos del caso, proponer las RAMAS HIJAS más probables para un nodo específico del mapa — es decir, cómo puede seguir el proceso desde ese punto EN ESTE caso concreto. " +
  "REGLAS DE CONGRUENCIA (obligatorias, sin excepción): " +
  "(1) UN SOLO FUERO. Usá exclusivamente el vocabulario del código procesal indicado. Prohibido mezclar: 'procesamiento', 'indagatoria', 'instrucción' y 'crítica instructoria' existen SOLO en el proceso mixto (Ley 23.984); 'formalización', 'control de la acusación' e 'impugnación ordinaria' SOLO en el CPPF (Ley 27.063); 'juicio por jurados' y 'particular damnificado' SOLO en PBA (Ley 11.922); 'criterios de oportunidad' y 'conciliación/reparación' NO existen en el proceso de la Ley 23.984 (rige legalidad procesal estricta). " +
  "(2) ORDEN DE FASES. El proceso avanza: actos iniciales → investigación → etapa intermedia → juicio → recursos → ejecución. Una rama nunca salta a una fase anterior a la de su nodo padre. Sí podés proponer incidencias propias de la etapa (planteo de nulidad, pedido de excarcelación o cese de la preventiva, prórroga del plazo, apelación de una medida) cuando los hechos del caso lo justifiquen. " +
  "(3) DESENLACES VÁLIDOS. Los desenlaces estructurales posibles por etapa son los del ESQUEMA DE REFERENCIA del fuero que se te pasa. No inventes etapas estructurales nuevas; las incidencias case-specific están permitidas si son procesalmente correctas en esa etapa y ese fuero. " +
  "(4) RIESGO. riesgo_alto=true SOLO para desenlaces gravosos para el imputado (prisión preventiva, condena, agravamiento de la coerción, revocación de libertad). NUNCA para desenlaces favorables o neutros (sobreseimiento, absolución, archivo, excarcelación concedida). " +
  "(5) SIN DUPLICADOS. No propongas ramas que ya existen como hijos del nodo objetivo (se te listan). Cada rama propuesta debe ser distinta y aportar un escenario diferente. " +
  "(6) FORMATO DE CADA RAMA: titulo corto y de estilo procesal (máximo 60 caracteres, sin numeración); descripcion de 1 a 3 oraciones explicando qué es esa rama EN ESTE caso, con fundamento y — si corresponde — artículos del código del fuero. No inventes números de artículo: si no estás seguro, describí el instituto sin citar artículo. " +
  "(7) CANTIDAD Y ORDEN: entre 2 y 5 ramas, ordenadas de más probable a menos probable según los hechos del caso. " +
  'Respondé SOLO con JSON válido, sin markdown ni backticks, con esta estructura exacta: {"ramas": [{"titulo": "...", "descripcion": "...", "riesgo_alto": false}]}';

// Serializa el esquema de referencia del fuero (la plantilla curada) como
// árbol indentado, para que el modelo conozca las etapas y desenlaces válidos.
export function serializarEsquemaFuero(fuero: Fuero): string {
  const flujo = FLUJO_POR_FUERO[fuero];
  const hijos = new Map<string | null, typeof flujo>();
  for (const n of flujo) {
    const arr = hijos.get(n.padre) ?? [];
    arr.push(n);
    hijos.set(n.padre, arr);
  }
  const lineas: string[] = [];
  const walk = (padre: string | null, depth: number) => {
    for (const n of hijos.get(padre) ?? []) {
      lineas.push(
        `${"  ".repeat(depth)}- ${n.titulo}${n.riesgoAlto ? " [RIESGO]" : ""}`,
      );
      walk(n.key, depth + 1);
    }
  };
  walk(null, 0);
  return lineas.join("\n");
}

// Serializa el mapa REAL del caso (con estados) marcando el nodo objetivo.
export function serializarMapaActual(
  nodos: NodoProcesalDB[],
  nodoObjetivoId: string,
): string {
  const hijos = new Map<string | null, NodoProcesalDB[]>();
  for (const n of nodos) {
    const arr = hijos.get(n.padre_id) ?? [];
    arr.push(n);
    hijos.set(n.padre_id, arr);
  }
  const lineas: string[] = [];
  const walk = (padreId: string | null, depth: number) => {
    for (const n of hijos.get(padreId) ?? []) {
      const estado = n.estado === "ocurrido" ? "[OCURRIDO]" : "[posible]";
      const riesgo = n.riesgo_alto ? " [RIESGO]" : "";
      const marca = n.id === nodoObjetivoId ? "  ⟵ NODO OBJETIVO" : "";
      lineas.push(`${"  ".repeat(depth)}- ${n.titulo} ${estado}${riesgo}${marca}`);
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return lineas.join("\n");
}

export function armarPromptSimulacion(input: {
  fuero: Fuero;
  contextoCaso: string;
  nodos: NodoProcesalDB[];
  nodoObjetivo: NodoProcesalDB;
}): string {
  const { fuero, contextoCaso, nodos, nodoObjetivo } = input;
  const hijosActuales = nodos.filter((n) => n.padre_id === nodoObjetivo.id);

  return `FUERO / CÓDIGO APLICABLE: ${FUERO_LABEL[fuero]}

ESQUEMA DE REFERENCIA DEL FUERO (etapas y desenlaces estructurales válidos):
${serializarEsquemaFuero(fuero)}

MAPA ACTUAL DEL CASO (lo ya ocurrido está marcado [OCURRIDO]):
${serializarMapaActual(nodos, nodoObjetivo.id)}

NODO OBJETIVO: "${nodoObjetivo.titulo}" (estado: ${nodoObjetivo.estado === "ocurrido" ? "ya ocurrió" : "posible"})${
    nodoObjetivo.descripcion ? `\nDescripción del nodo: ${nodoObjetivo.descripcion}` : ""
  }
Hijos que YA tiene (no los repitas): ${
    hijosActuales.length > 0
      ? hijosActuales.map((h) => `"${h.titulo}"`).join(", ")
      : "(ninguno)"
  }

${contextoCaso}

Proponé entre 2 y 5 ramas hijas para el NODO OBJETIVO: los escenarios más probables de cómo puede seguir el proceso desde ahí EN ESTE caso, respetando el fuero, el orden de fases y las reglas de congruencia del system prompt. Respondé SOLO el JSON.`;
}

export type SimulacionResult = {
  ramas: RamaSimulada[] | null; // null si el parseo/validación falló
  parseoError: string | null;
  parseoIntento: number | null;
  usage: Usage;
  latenciaMs: number;
  rawText: string;
};

export async function runSimulacionMapa(input: {
  fuero: Fuero;
  contextoCaso: string;
  nodos: NodoProcesalDB[];
  nodoObjetivo: NodoProcesalDB;
}): Promise<SimulacionResult> {
  const t0 = Date.now();
  const client = getAnthropic();
  const response: Anthropic.Message = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 2048,
    system: SYSTEM_PROMPT_SIMULACION,
    messages: [{ role: "user", content: armarPromptSimulacion(input) }],
  });
  const latenciaMs = Date.now() - t0;

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const usage: Usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
  };

  const parsed = parseWithRecovery(rawText);
  if (!parsed.ok) {
    return {
      ramas: null,
      parseoError: parsed.error,
      parseoIntento: null,
      usage,
      latenciaMs,
      rawText,
    };
  }
  const validado = ramasSimuladasSchema.safeParse(parsed.resultado);
  if (!validado.success) {
    return {
      ramas: null,
      parseoError: `Output con shape inválido: ${validado.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      parseoIntento: parsed.parseo_intento,
      usage,
      latenciaMs,
      rawText,
    };
  }
  return {
    ramas: validado.data.ramas,
    parseoError: null,
    parseoIntento: parsed.parseo_intento,
    usage,
    latenciaMs,
    rawText,
  };
}
