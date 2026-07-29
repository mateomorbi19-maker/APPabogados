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
  type AgentErrorCode,
  type Busqueda,
  type RunAgentResult,
  type RunAgentUsage,
} from "@/lib/agent/run-agent";
import {
  claveRechazo,
  ejecutarToolMapa,
  esToolDeMapa,
  mapaTools,
  type ContextoMapaTools,
  type RechazoConfirmable,
} from "@/lib/agent/mapa-tools";
import type { AccionMapa } from "@/lib/schemas";

// Variante del agente para consultas continuas sobre un caso. Mismo
// mecanismo de cap + síntesis forzada que runAgent del análisis original
// (código de errores idéntico vía AgentError) pero con un user message
// inicial que es un array de content blocks en vez de un string: incluye
// los adjuntos nuevos como contenido nativo (document/image/text)
// seguidos del contexto markdown del caso + la pregunta del abogado.
//
// Presupuesto de tools: HARD_CAP_BUSQUEDAS = 10 búsquedas RAG +
// MAX_ACCIONES_MAPA = 8 acciones sobre el mapa, con maxIterations = 20
// (10 + 8 + 2 de margen). La síntesis final NO depende de ese margen:
// la última vuelta del loop se emite SIEMPRE sin `tools`, así el modelo
// no puede responder con tool_use y el turno nunca muere en
// MAX_ITERATIONS con el trabajo ya hecho.
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
    }
  | {
      // Adjunto que no se pudo procesar (descarga fallida, HEIC
      // corrupto, conversión imposible). Un adjunto malo NO tumba el
      // turno: se degrada a esta referencia y el agente le avisa al
      // abogado.
      kind: "no_procesado";
      filename: string;
      descripcion: string | null;
      motivo: string;
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
  // === Conexión chat ↔ mapa procesal ===
  // casoId y usuarioId vienen SIEMPRE del contexto del servidor (params de la
  // route + requireUsuarioOr403). El modelo no puede elegir sobre qué caso
  // opera: ninguna tool del mapa tiene un parámetro caso_id.
  casoId: string;
  usuarioId: string;
  // Las tools de escritura sobre el mapa se exponen SOLO si el caso ya tiene
  // mapa inicializado. Si no, el modelo no las ve y el contexto le explica que
  // el abogado tiene que inicializarlo desde la vista del mapa.
  mapaHabilitado: boolean;
  // Rechazos confirmables que el agente ya le comunicó al abogado en su turno
  // anterior (los reconstruye la route desde las `acciones` persistidas). Es lo
  // único que habilita un `confirmar: true`: sin esto el modelo podría
  // saltearse las advertencias de R4/R7/R8/R9 en el primer intento.
  rechazosConfirmablesPrevios?: RechazoConfirmable[];
};

// Resultado extendido: RunAgentResult vive en run-agent.ts (compartido con
// /analizar-caso, que no tiene mapa). En vez de tocar ese contrato, el agente
// de consulta devuelve un superset con las acciones del turno.
export type RunAgentConsultaResult = RunAgentResult & {
  acciones: AccionMapa[];
};

// Misma idea para el error: AgentError es común a los dos agentes, así que las
// acciones parciales viajan en una subclase. `e instanceof AgentError` en la
// route sigue funcionando igual.
export class AgentConsultaError extends AgentError {
  partialAcciones: AccionMapa[];
  constructor(
    message: string,
    code: AgentErrorCode,
    partialUsage: RunAgentUsage,
    partialCostoUsd: number,
    partialBusquedas: Busqueda[],
    partialIterations: number,
    partialAcciones: AccionMapa[],
  ) {
    super(
      message,
      code,
      partialUsage,
      partialCostoUsd,
      partialBusquedas,
      partialIterations,
    );
    this.name = "AgentConsultaError";
    this.partialAcciones = partialAcciones;
  }
}

const HARD_CAP_BUSQUEDAS = 10;

// Tope de acciones sobre el mapa por TURNO. Un mapa se lee de un vistazo: 8
// mutaciones en un solo mensaje ya es más de lo que el abogado puede revisar
// antes de responder. Cuenta también los rechazos, porque cada intento gasta
// una vuelta del loop.
const MAX_ACCIONES_MAPA = 8;

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
    } else if (adj.kind === "no_procesado") {
      blocks.push({
        type: "text",
        text: `${orden}: archivo "${adj.filename}"${desc}. NO se pudo procesar para incluirlo (${adj.motivo}). Avisale al abogado que este adjunto no fue analizado y sugerile reenviarlo en otro formato (por ejemplo JPG, PNG o PDF) si es relevante para la consulta.`,
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
): Promise<RunAgentConsultaResult> {
  // 10 búsquedas + 8 acciones de mapa + 2 de margen. El margen es holgura, no
  // la garantía: la garantía de síntesis es que la última vuelta va sin tools.
  const maxIterations = input.maxIterations ?? 20;
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
  const acciones: AccionMapa[] = [];
  let iterations = 0;
  let costoUsd = 0;

  // true cuando el loop tuvo que cortar las tools por llegar al techo de
  // iteraciones (no por agotar un cap): la respuesta salió igual, pero forzada.
  let sintesisForzada = false;

  const ctxMapa: ContextoMapaTools = {
    casoId: input.casoId,
    usuarioId: input.usuarioId,
    contextoCaso: input.contextoCaso,
    rechazosConfirmables: new Map(
      (input.rechazosConfirmablesPrevios ?? []).map((r) => [
        claveRechazo(r.accion, r.nodoId),
        r,
      ]),
    ),
  };

  // Tools disponibles EN ESTE MOMENTO. Se recalcula antes de cada request: una
  // tool desaparece cuando su cap se agota, y la key `tools` se omite solo si
  // no queda ninguna. (Antes el agotamiento del cap de RAG quitaba la key
  // entera; con tools de mapa eso las dejaría inaccesibles.)
  const toolsDisponibles = (): Anthropic.Tool[] => {
    const t: Anthropic.Tool[] = [];
    if (busquedas.length < HARD_CAP_BUSQUEDAS) t.push(buscarDocumentosTool);
    if (input.mapaHabilitado && acciones.length < MAX_ACCIONES_MAPA) {
      t.push(...mapaTools);
    }
    return t;
  };

  const crearRequest = (
    tools: Anthropic.Tool[],
  ): Anthropic.MessageCreateParamsNonStreaming => ({
    model: modelId,
    max_tokens: maxTokens,
    system: input.systemPrompt,
    messages,
    ...(tools.length > 0 ? { tools } : {}),
  });

  // Snapshot del estado parcial del turno para cualquier corte del loop. Se
  // devuelve el error en vez de tirarlo acá adentro para que el `throw` quede
  // visible en el call site (y el control-flow de TS lo entienda).
  const errorParcial = (
    message: string,
    code: AgentErrorCode,
  ): AgentConsultaError =>
    new AgentConsultaError(
      message,
      code,
      { ...totalUsage },
      Number(costoUsd.toFixed(6)),
      [...busquedas],
      iterations,
      [...acciones],
    );

  // === Dispatcher de tools ===
  // Registry en vez del `if (tu.name === ...)` inline: agregar una tool ahora
  // es agregar una entrada acá.
  const ejecutarBusqueda = async (
    tu: Anthropic.ToolUseBlock,
  ): Promise<Anthropic.ToolResultBlockParam> => {
    const inputObj = (tu.input ?? {}) as { query?: unknown };
    const query = typeof inputObj.query === "string" ? inputObj.query : "";

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
      return { type: "tool_result", tool_use_id: tu.id, content: r.contentJSON };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        type: "tool_result",
        tool_use_id: tu.id,
        content: `Error: ${msg}`,
        is_error: true,
      };
    }
  };

  const ejecutarMapa = async (
    tu: Anthropic.ToolUseBlock,
  ): Promise<Anthropic.ToolResultBlockParam> => {
    if (!input.mapaHabilitado) {
      return {
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify({
          ok: false,
          motivo:
            "El mapa procesal de este caso no está inicializado, así que no se puede modificar.",
          regla: "MAPA_NO_INICIALIZADO",
          sugerencia:
            'Explicale al abogado que primero tiene que inicializar el mapa desde la vista "Mapa procesal" del caso, eligiendo el fuero.',
        }),
      };
    }
    if (acciones.length >= MAX_ACCIONES_MAPA) {
      return {
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify({
          ok: false,
          motivo: `Alcanzaste el límite de ${MAX_ACCIONES_MAPA} acciones sobre el mapa por mensaje. Esta acción NO se ejecutó.`,
          regla: "CAP_ACCIONES_MAPA",
          sugerencia:
            "Contale al abogado qué cambios sí quedaron aplicados y qué falta, y pedile que te lo confirme en el próximo mensaje para seguir.",
        }),
      };
    }

    // Misma invariante que `ejecutarBusqueda`: NINGUNA ejecución de tool puede
    // tirar hacia afuera del loop. Un throw acá sube como Error común (no
    // AgentError) y la route devuelve 500 sin persistir la ejecución — se
    // pierden los tokens ya facturados y, si el agente venía de mutar el mapa,
    // esos cambios quedan aplicados sin ninguna fila que los registre.
    let r: Awaited<ReturnType<typeof ejecutarToolMapa>>;
    try {
      r = await ejecutarToolMapa(tu.name, tu.input, ctxMapa);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[run-agent-consulta] ${tu.name} falló:`, msg);
      return {
        type: "tool_result",
        tool_use_id: tu.id,
        content: `Error: ${msg}`,
        is_error: true,
      };
    }
    acciones.push(r.accion);
    // La simulación de ramas hace su propio call al modelo: sus tokens se
    // suman al turno para que la ejecución los refleje (si no, quedarían sin
    // trackear). El `modelo` de la fila sigue siendo el del chat — el detalle
    // por acción queda en metadata.acciones.
    if (r.usageExtra) {
      totalUsage.input_tokens += r.usageExtra.usage.input_tokens;
      totalUsage.output_tokens += r.usageExtra.usage.output_tokens;
      totalUsage.cache_creation_input_tokens +=
        r.usageExtra.usage.cache_creation_input_tokens ?? 0;
      totalUsage.cache_read_input_tokens +=
        r.usageExtra.usage.cache_read_input_tokens ?? 0;
      costoUsd += r.usageExtra.costoUsd;
    }
    return { type: "tool_result", tool_use_id: tu.id, content: r.contentJSON };
  };

  // Primer call. Si falla acá no hay tokens cobrados, pero igual lo
  // envolvemos en AgentError: antes bubbleaba como 500 crudo y el
  // cliente no disparaba el recovery-polling ni mostraba un mensaje
  // accionable (así se gatilló el incidente de la conversación
  // brickeada del 25/06 — un fallo transitorio en el primer call de un
  // turno con PDF).
  let response: Anthropic.Message;
  try {
    response = await client.messages.create(crearRequest(toolsDisponibles()));
  } catch (e) {
    throw errorParcial(
      e instanceof Error ? e.message : String(e),
      "API_ERROR",
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

    // Las búsquedas son de solo lectura y van en paralelo. Las acciones del
    // mapa van EN SERIE, sí o sí: cada una hace leer-validar-escribir, y dos
    // en paralelo validarían ambas contra el mismo snapshot (el duplicado que
    // crea la segunda nunca vería al que creó la primera).
    const resultadosPorId = new Map<string, Anthropic.ToolResultBlockParam>();
    await Promise.all(
      toolUseBlocks
        .filter((tu) => tu.name === BUSCAR_DOCUMENTOS_TOOL_NAME)
        .map(async (tu) => {
          resultadosPorId.set(tu.id, await ejecutarBusqueda(tu));
        }),
    );
    for (const tu of toolUseBlocks.filter((t) => esToolDeMapa(t.name))) {
      resultadosPorId.set(tu.id, await ejecutarMapa(tu));
    }
    const toolResults: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map(
      (tu) =>
        resultadosPorId.get(tu.id) ?? {
          type: "tool_result",
          tool_use_id: tu.id,
          content: `Error: tool desconocida "${tu.name}"`,
          is_error: true,
        },
    );

    // Se recalcula DESPUÉS de ejecutar las tools: las que agotaron su cap
    // desaparecen del próximo request. La key `tools` se omite solo si no
    // quedó ninguna disponible.
    //
    // ÚLTIMA VUELTA: el request que sale con `iterations === maxIterations` es
    // el último que el while llega a hacer, así que va SIN tools sí o sí. Es la
    // garantía ESTRUCTURAL de síntesis: el modelo no puede técnicamente
    // responder con tool_use, y el turno no puede morir en MAX_ITERATIONS
    // tirando a la basura el trabajo (y las mutaciones del mapa) ya hechos.
    // Antes esto dependía de que se agotaran los caps, cosa que con dos
    // presupuestos (10 búsquedas + 8 acciones = 18 > 12 iteraciones) dejó de
    // pasar en cuanto el caso tenía mapa.
    const ultimaVuelta = iterations >= maxIterations;
    if (ultimaVuelta) sintesisForzada = true;
    const tools = ultimaVuelta ? [] : toolsDisponibles();

    // Avisos de cap: cada tope agotado se le explica al modelo en el mismo
    // user message, para que entienda por qué la herramienta desapareció. El
    // "cerrá y respondé" va SOLO si no le quedó ninguna herramienta: agotar el
    // cap de RAG no debe cortarle las acciones del mapa que todavía tiene
    // disponibles (ni al revés).
    const avisos: string[] = [];
    if (busquedas.length >= HARD_CAP_BUSQUEDAS) {
      avisos.push(
        `Alcanzaste el límite de búsquedas (${HARD_CAP_BUSQUEDAS}): no vas a poder hacer más en este mensaje.`,
      );
    }
    if (input.mapaHabilitado && acciones.length >= MAX_ACCIONES_MAPA) {
      avisos.push(
        `Alcanzaste el límite de acciones sobre el mapa procesal (${MAX_ACCIONES_MAPA}) en este mensaje: contale al abogado qué quedó aplicado y qué falta.`,
      );
    }
    if (tools.length === 0) {
      avisos.push(
        "No te queda ninguna herramienta disponible en este mensaje: generá ahora la respuesta final completa basada en lo que ya hiciste, y contale al abogado qué quedó pendiente.",
      );
    }
    const userContent: Anthropic.MessageParam["content"] =
      avisos.length > 0
        ? [
            ...toolResults,
            { type: "text" as const, text: avisos.join(" ") },
          ]
        : toolResults;

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: userContent });

    try {
      response = await client.messages.create(crearRequest(tools));
    } catch (e) {
      throw errorParcial(
        e instanceof Error ? e.message : String(e),
        "API_ERROR",
      );
    }
    totalUsage.input_tokens += response.usage.input_tokens;
    totalUsage.output_tokens += response.usage.output_tokens;
    totalUsage.cache_creation_input_tokens +=
      response.usage.cache_creation_input_tokens ?? 0;
    totalUsage.cache_read_input_tokens +=
      response.usage.cache_read_input_tokens ?? 0;
    costoUsd += calcularCosto(modelId, usageDeResponse(response));

    // Defensivo: sin ninguna tool en el request el modelo no debería poder
    // responder con tool_use. Si por alguna razón lo hace, cortamos limpio.
    if (tools.length === 0 && response.stop_reason === "tool_use") {
      throw errorParcial(
        "CAP_EXCEEDED_NO_SYNTHESIS",
        "CAP_EXCEEDED_NO_SYNTHESIS",
      );
    }
  }

  if (response.stop_reason === "tool_use") {
    throw errorParcial("MAX_ITERATIONS alcanzado", "MAX_ITERATIONS");
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
    // Lo arma el SERVIDOR desde las tool calls reales, no el modelo: así no
    // puede declarar cambios que nunca ejecutó, y el contrato JSON de salida
    // queda intacto.
    acciones,
    iterations,
    // Degradada si el modelo se quedó sin búsquedas o si el loop le cortó las
    // herramientas para forzar el cierre: en los dos casos respondió con menos
    // de lo que pedía.
    degraded_response: busquedas.length >= HARD_CAP_BUSQUEDAS || sintesisForzada,
  };
}
