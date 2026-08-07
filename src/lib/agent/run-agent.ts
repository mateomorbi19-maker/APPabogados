import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, MODEL_ID } from "@/lib/anthropic";
import {
  buscarDocumentosTool,
  BUSCAR_DOCUMENTOS_TOOL_NAME,
} from "@/lib/agent/tools";
import {
  ejecutarToolRepositorio,
  esToolDeRepositorio,
  repositorioTools,
  type ConsultaRepositorio,
} from "@/lib/agent/repositorio-tools";
import { calcularCosto } from "@/lib/agent/pricing";
import { embedQuery } from "@/lib/rag/embed";
import { buscarDocumentos } from "@/lib/rag/match-documents";

// Usage de UNA respuesta de la API (no la acumulada del loop). El costo
// se calcula POR RESPUESTA y se suma: el tier long-context de pricing
// se decide por request individual (fix del bug A-3 — antes se decidía
// sobre los tokens sumados de todo el loop y sobreestimaba el costo).
export function usageDeResponse(response: Anthropic.Message): {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
} {
  return {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens:
      response.usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
  };
}

export type RunAgentInput = {
  userPrompt: string;
  systemPrompt: string;
  maxIterations?: number;
  // Autorización del abogado para que el agente consulte el Repositorio interno
  // del estudio (jurisprudencia y doctrina). Va apagado por defecto a
  // propósito: es material privado del estudio y quién lo usa para fundar una
  // estrategia es una decisión del abogado, no del sistema. Sin esto las tools
  // del repositorio ni siquiera se le declaran al modelo.
  usarRepositorio?: boolean;
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

// Copia liviana de cada chunk que el RAG devolvió durante la ejecución,
// acumulada aparte del tool_result que ve el modelo (ese NO cambia). Sirve
// para medir qué recuperó el agente y habilitar futuras verificaciones.
// `contenido` viene truncado (preview), no es el texto íntegro del chunk.
export type ChunkRecuperado = {
  contenido: string;
  articulo: string | null;
  tipo_documento: string | null;
  similarity: number;
};

export type RunAgentResult = {
  rawText: string;
  usage: RunAgentUsage;
  // Costo USD real de la ejecución: suma de calcularCosto por respuesta
  // (el tier long-context se decide por request, no sobre la suma).
  costo_usd: number;
  busquedas: Busqueda[];
  iterations: number;
  // True cuando el agente alcanzó el HARD_CAP_BUSQUEDAS y aun así sintetizó
  // una respuesta. La ejecución es ok pero potencialmente parcial. El INSERT
  // a `ejecuciones` la marca con metadata.degraded_response = true.
  degraded_response: boolean;
  // Chunks recuperados por el RAG (preview truncado), para medición/debug.
  // Opcional: hoy solo lo produce runAgent (analizar-caso); runAgentConsulta no.
  chunks_recuperados?: ChunkRecuperado[];
  // True si hubo búsquedas pero NINGUNA recuperó chunks (cero grounding total).
  // Opcional por el mismo motivo que chunks_recuperados.
  sin_grounding?: boolean;
  // Consultas al Repositorio interno (jurisprudencia y doctrina). Vacío cuando
  // el abogado no autorizó su uso. Se persiste en metadata para poder medir si
  // el agente encuentra precedentes o busca al vacío.
  consultas_repositorio?: ConsultaRepositorio[];
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
  // Costo USD de los requests que SÍ se cobraron antes del fallo
  // (mismo criterio por-respuesta que RunAgentResult.costo_usd).
  partialCostoUsd: number;
  partialBusquedas: Busqueda[];
  partialIterations: number;
  constructor(
    message: string,
    code: AgentErrorCode,
    partialUsage: RunAgentUsage,
    partialCostoUsd: number,
    partialBusquedas: Busqueda[],
    partialIterations: number,
  ) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.partialUsage = partialUsage;
    this.partialCostoUsd = partialCostoUsd;
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

// Tope de operaciones sobre el Repositorio interno (búsquedas + lecturas) por
// ejecución. Es más chico que el del RAG normativo a propósito: la
// jurisprudencia entra al final del razonamiento, para respaldar una hipótesis
// ya construida, y seis consultas cubren de sobra las tres estrategias por rol.
// Un cap alto invitaría al modelo a "pescar" precedentes, que es exactamente lo
// que la regla de orden del system prompt busca evitar.
const HARD_CAP_REPOSITORIO = 6;

// Largo del preview de `contenido` que guardamos por chunk en
// chunks_recuperados. El texto que ve el modelo en el tool_result NO se trunca;
// esto es solo la copia liviana para medición/debug.
const CHUNK_PREVIEW_CHARS = 500;

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
  chunks: ChunkRecuperado[];
}> {
  const embedding = await embedQuery(query);
  const docs = await buscarDocumentos(embedding, 5);
  // El JSON que ve el modelo conserva el contenido íntegro de cada chunk.
  const contentJSON = JSON.stringify(
    docs.map((d) => ({
      content: d.content,
      metadata: d.metadata,
      similarity: Number(d.similarity.toFixed(4)),
    })),
  );
  // Copia liviana para medición/debug: contenido truncado + metadata clave.
  const chunks: ChunkRecuperado[] = docs.map((d) => ({
    contenido: d.content.slice(0, CHUNK_PREVIEW_CHARS),
    articulo: d.metadata?.articulo ?? null,
    tipo_documento: d.metadata?.tipo_documento ?? null,
    similarity: Number(d.similarity.toFixed(4)),
  }));
  const top = docs[0]?.similarity ?? null;
  return {
    contentJSON,
    chunks_devueltos: docs.length,
    similarity_top: top !== null ? Number(top.toFixed(4)) : null,
    chunks,
  };
}

export async function runAgent(
  input: RunAgentInput,
): Promise<RunAgentResult> {
  const { userPrompt, systemPrompt } = input;
  const usarRepositorio = input.usarRepositorio === true;
  // Margen sobre los caps: si el modelo hace una sola llamada por iteración,
  // con maxIterations=cap saldríamos del while justo cuando toca el cap, sin
  // oportunidad de correr la "iteración final sin tools" que garantiza
  // síntesis. Con +2 de margen siempre queda lugar. Con el repositorio
  // autorizado el presupuesto de herramientas es mayor (10 + 6), así que el
  // techo sube en consecuencia.
  const maxIterations = input.maxIterations ?? (usarRepositorio ? 18 : 12);

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
  const chunksRecuperados: ChunkRecuperado[] = [];
  const consultasRepositorio: ConsultaRepositorio[] = [];
  // Cuenta búsquedas Y lecturas del repositorio: las dos gastan una vuelta del
  // loop, así que el presupuesto tiene que ser común.
  let usosRepositorio = 0;
  let sintesisForzada = false;

  // Herramientas vigentes en este momento del loop. Se recalcula antes de cada
  // request: la que agotó su cap desaparece, y `tools` se omite sólo si no
  // quedó ninguna.
  const toolsDisponibles = (): Anthropic.Tool[] => {
    const t: Anthropic.Tool[] = [];
    if (busquedas.length < HARD_CAP_BUSQUEDAS) t.push(buscarDocumentosTool);
    if (usarRepositorio && usosRepositorio < HARD_CAP_REPOSITORIO) {
      t.push(...repositorioTools);
    }
    return t;
  };

  let iterations = 0;
  let costoUsd = 0;

  // Primer call: si falla acá no hay tokens cobrados — dejamos bubblear como error de infra.
  // tool_choice fuerza la búsqueda RAG en este primer turno para garantizar
  // grounding antes de generar contenido. SOLO acá: los calls del loop usan el
  // default `auto` (o van sin `tools` al agotar el cap) para poder sintetizar.
  //
  // Las tools del repositorio NO se declaran en este primer call aunque estén
  // autorizadas, y eso refuerza la regla de orden: el primer movimiento del
  // agente tiene que ser encuadrar el caso en la normativa, nunca salir a
  // buscar un precedente. Aparecen recién en la segunda vuelta.
  let response = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 16000,
    system: systemPrompt,
    tools: [buscarDocumentosTool],
    tool_choice: { type: "tool", name: BUSCAR_DOCUMENTOS_TOOL_NAME },
    messages,
  });
  totalUsage.input_tokens += response.usage.input_tokens;
  totalUsage.output_tokens += response.usage.output_tokens;
  totalUsage.cache_creation_input_tokens +=
    response.usage.cache_creation_input_tokens ?? 0;
  totalUsage.cache_read_input_tokens +=
    response.usage.cache_read_input_tokens ?? 0;
  costoUsd += calcularCosto(MODEL_ID, usageDeResponse(response));

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
              // Acumulamos los chunks (preview) para medición/debug. El orden
              // es de finalización, no de emisión; suficiente para medir.
              chunksRecuperados.push(...r.chunks);
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
          if (esToolDeRepositorio(tu.name)) {
            // Mismo criterio de cap que arriba: se chequea ANTES de ejecutar,
            // el contador se incrementa síncronamente (para que los otros
            // tool_use de esta misma iteración lo vean) y ningún error de la
            // tool sale del loop.
            if (usosRepositorio >= HARD_CAP_REPOSITORIO) {
              return {
                type: "tool_result",
                tool_use_id: tu.id,
                content: `Alcanzaste el límite de consultas al repositorio del estudio (${HARD_CAP_REPOSITORIO}). No se ejecutó esta consulta. Cerrá el análisis con los precedentes que ya recuperaste.`,
              };
            }
            usosRepositorio++;
            try {
              const r = await ejecutarToolRepositorio(tu.name, tu.input);
              if (r.consulta) consultasRepositorio.push(r.consulta);
              return {
                type: "tool_result",
                tool_use_id: tu.id,
                content: r.contentJSON,
              };
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              console.error(`[run-agent] ${tu.name} falló:`, msg);
              return {
                type: "tool_result",
                tool_use_id: tu.id,
                content: `Error consultando el repositorio: ${msg}. Seguí sin él.`,
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
    // ÚLTIMA VUELTA: el request que sale con `iterations === maxIterations` es
    // el último que el while llega a hacer, así que va SIN tools sí o sí. Es la
    // garantía ESTRUCTURAL de síntesis, y no depende de que los caps se agoten
    // — con dos presupuestos (10 búsquedas + 6 consultas al repositorio) eso
    // podía no pasar nunca. Mismo mecanismo que runAgentConsulta.
    //
    // Además, agregamos un text block adicional al user message para que el
    // modelo entienda explícitamente por qué desaparecen las herramientas.
    // Mezclamos tool_results + text en el mismo content array (válido por
    // contrato Anthropic: user messages aceptan text + tool_result).
    const ultimaVuelta = iterations >= maxIterations;
    if (ultimaVuelta) sintesisForzada = true;
    const tools = ultimaVuelta ? [] : toolsDisponibles();

    const avisos: string[] = [];
    if (busquedas.length >= HARD_CAP_BUSQUEDAS) {
      avisos.push(
        `Alcanzaste el límite de búsquedas en el corpus normativo (${HARD_CAP_BUSQUEDAS}): no vas a poder hacer más.`,
      );
    }
    if (usarRepositorio && usosRepositorio >= HARD_CAP_REPOSITORIO) {
      avisos.push(
        `Alcanzaste el límite de consultas al repositorio del estudio (${HARD_CAP_REPOSITORIO}).`,
      );
    }
    if (tools.length === 0) {
      avisos.push(
        "No te queda ninguna herramienta: generá ahora la respuesta final completa basada en el material recolectado.",
      );
    }
    const userContent: Anthropic.MessageParam["content"] =
      avisos.length > 0
        ? [...toolResults, { type: "text" as const, text: avisos.join(" ") }]
        : toolResults;

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: userContent });

    try {
      response = await client.messages.create({
        model: MODEL_ID,
        max_tokens: 16000,
        system: systemPrompt,
        messages,
        ...(tools.length > 0 ? { tools } : {}),
      });
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
    costoUsd += calcularCosto(MODEL_ID, usageDeResponse(response));

    // Defensivo: con `tools` removidas en el call anterior, el modelo no
    // debería poder responder con tool_use. Si por algún cambio del SDK o
    // un escenario inesperado lo hiciera, este branch corta limpio.
    if (tools.length === 0 && response.stop_reason === "tool_use") {
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
    chunks_recuperados: chunksRecuperados,
    consultas_repositorio: consultasRepositorio,
    iterations,
    // Marcamos degraded cualquier ejecución que tocó el cap, sea por
    // bloqueo de búsqueda extra (>cap) o por consumo exacto (==cap), y también
    // la que necesitó la última vuelta sin herramientas para cerrar: en todos
    // esos casos forzamos síntesis, lo que limita la capacidad del modelo de
    // re-evaluar. El panel admin lo expone.
    degraded_response:
      busquedas.length >= HARD_CAP_BUSQUEDAS || sintesisForzada,
    // True si hubo búsquedas pero ninguna recuperó chunks: la respuesta no
    // pudo fundamentarse en el corpus (cero grounding total).
    sin_grounding:
      busquedas.length > 0 &&
      busquedas.every((b) => b.chunks_devueltos === 0),
  };
}
