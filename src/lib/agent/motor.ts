import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/anthropic";
import { calcularCosto } from "@/lib/agent/pricing";
import {
  usageDeResponse,
  type AgentErrorCode,
  type RunAgentUsage,
} from "@/lib/agent/run-agent";

// Motor de tool-use loop, sin dominio.
//
// Existe porque el mismo loop estaba copiado casi verbatim en run-agent.ts y
// run-agent-consulta.ts, y las dos copias YA DIVERGIERON (tool_choice y
// sin_grounding viven solo en una). LEXIE habría sido la tercera, y a partir
// de ahí cada fix —prompt caching, streaming, un cap nuevo— habría que
// aplicarlo tres veces y acordarse de las tres.
//
// Lo que el motor SÍ sabe: pedirle a la API, contar tokens y costo, repartir
// tool calls, respetar presupuestos y garantizar que el turno cierre con una
// síntesis. Lo que NO sabe: qué es una búsqueda, un caso, un nodo del mapa o
// un fallo. Todo eso vive en las familias y en el contexto opaco.
//
// === Las dos invariantes que NO se pueden romper ===
//
// 1. NINGUNA ejecución de tool puede tirar hacia afuera del loop. Un throw que
//    escapa sube como Error común (no AgentError), la route devuelve 500 sin
//    persistir la ejecución, y se pierden los tokens ya facturados — y si el
//    agente venía de mutar algo, esos cambios quedan aplicados sin ninguna fila
//    que los registre. Por eso el motor envuelve TODA llamada a `ejecutar` en
//    try/catch: antes cada familia se acordaba por su cuenta, que es
//    exactamente la clase de cosa que se olvida al agregar la cuarta.
//
// 2. La última vuelta sale SIEMPRE sin tools. Es la garantía ESTRUCTURAL de
//    síntesis: el modelo no puede técnicamente responder con tool_use, así que
//    el turno no puede morir en MAX_ITERATIONS tirando a la basura el trabajo
//    ya hecho. No depende de que se agoten los caps — con dos presupuestos
//    (10 búsquedas + 8 acciones = 18 > 12 iteraciones) eso dejó de pasar en
//    cuanto un caso tenía mapa.

export type ResultadoTool = {
  // Lo que ve el modelo como tool_result. Se llama JSON por costumbre del
  // repo, pero cualquier string sirve.
  contentJSON: string;
  isError?: boolean;
  // Tokens de un call al modelo hecho ADENTRO de la tool (hoy solo
  // mapa_simular_ramas). Se suman al turno para que la ejecución los refleje;
  // si no, quedarían sin trackear y el consumo del mes saldría bajo.
  //
  // Los campos de caché van opcionales y nullables porque así los emite el
  // SDK. El motor los normaliza con `?? 0` al acumular: pedirlos completos
  // obligaría a cada tool a normalizarlos primero, que es exactamente el tipo
  // de trabajo que el motor existe para hacer una sola vez.
  usageExtra?: {
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number | null;
      cache_read_input_tokens?: number | null;
    };
    costoUsd: number;
  };
};

// Una familia es un grupo de tools que comparten UN presupuesto. Es la unidad
// correcta y no la tool individual: "10 búsquedas" y "6 consultas al
// repositorio" son topes de familia, y `buscar_jurisprudencia` y
// `leer_jurisprudencia` gastan del mismo.
export type FamiliaTools<Ctx> = {
  // Identifica la familia en logs y en el resultado. No lo ve el modelo.
  nombre: string;
  tools: Anthropic.Tool[];
  // Tope de usos por turno. Un dispatch = un uso, haya salido bien o mal.
  // Criterio uniforme a propósito: un rechazo de coherencia del mapa también
  // consume presupuesto, porque también costó una vuelta del modelo.
  cap: number;
  // Familia apagada: sus tools no se le declaran al modelo. Sirve para
  // permisos (el mapa sin inicializar) y para autorizaciones del abogado (el
  // repositorio en /analizar-caso).
  habilitada?: boolean;
  // Lecturas en paralelo; mutaciones en serie, sí o sí. Dos mutaciones
  // concurrentes validarían ambas contra el mismo snapshot, y el duplicado
  // que crea la segunda nunca vería al que creó la primera.
  //
  // OJO al escribir una familia paralelizable que lleva su propio registro:
  // el motor invoca los `ejecutar` en el orden en que el modelo pidió las
  // tools, pero resuelven en el orden en que conteste la red. Si el registro
  // se empuja DESPUÉS del await, queda ordenado por latencia y cambia entre
  // dos corridas idénticas. Cuando el orden importa —y importa si el UI lo
  // numera o si se persiste para auditar qué hizo el agente— hay que reservar
  // el slot sincrónicamente antes del primer await y sobrescribirlo al
  // terminar. Ver la familia "busquedas" de run-agent-consulta.ts.
  paralelizable: boolean;
  ejecutar: (tu: Anthropic.ToolUseBlock, ctx: Ctx) => Promise<ResultadoTool>;
  // tool_result cuando la familia ya agotó su cupo. La tool NO se ejecuta.
  mensajeCapAgotado: string;
  // Se le dice al modelo en el user turn, para que entienda por qué la
  // herramienta desapareció del request siguiente.
  avisoCapAgotado: string;
  // tool_result defensivo si el modelo llama una tool de una familia apagada.
  // No debería poder (no se la declaramos), pero si pasa la respuesta tiene
  // que explicar por qué, no ser un "tool desconocida".
  mensajeDeshabilitada?: string;
};

export type MotorInput<Ctx> = {
  systemPrompt: string;
  // El turno completo, incluido el user message nuevo. El motor no arma
  // mensajes: quién sabe cómo se construye el primer user content (adjuntos
  // como content blocks, contexto markdown) es el dominio, no el loop.
  messages: Anthropic.MessageParam[];
  // Model ID resuelto SERVER-SIDE. Nunca viene crudo del cliente y tiene que
  // tener entrada en pricing.ts: calcularCosto tira Error si no la tiene, y
  // eso rompe el turno entero con 500.
  modelId: string;
  maxTokens?: number;
  maxIterations?: number;
  familias: FamiliaTools<Ctx>[];
  // Opaco para el motor; se le pasa tal cual a cada `ejecutar`. Acá viajan
  // usuarioId, casoId y todo lo que el servidor inyecta y el modelo NO puede
  // elegir.
  contexto: Ctx;
  // Prompt caching. Default ON: dentro de un turno el loop hace SIEMPRE dos
  // requests como mínimo (el inicial + el que sigue a las tool calls), y el
  // break-even del caché es exactamente dos lecturas — escribir cuesta 1,25x
  // y leer 0,1x. Apagarlo solo tiene sentido para medir el antes/después.
  cachear?: boolean;
};

export type MotorResult = {
  rawText: string;
  usage: RunAgentUsage;
  costo_usd: number;
  iterations: number;
  // Usos consumidos por familia, por nombre. El dominio lo usa para decidir
  // degraded_response sin tener que contar sus propios arrays.
  usos: Record<string, number>;
  // El loop cortó las tools por llegar al techo de iteraciones (no por agotar
  // un cap): la respuesta salió igual, pero forzada.
  sintesisForzada: boolean;
};

// Error del loop con el estado parcial que el motor SÍ conoce. El dominio lo
// atrapa y lo re-lanza como su propio error, agregándole los arrays que
// acumuló por closure (búsquedas, acciones, consultas). El motor no los
// conoce y no tiene por qué.
export class MotorError extends Error {
  code: AgentErrorCode;
  partialUsage: RunAgentUsage;
  partialCostoUsd: number;
  partialIterations: number;
  constructor(
    message: string,
    code: AgentErrorCode,
    partialUsage: RunAgentUsage,
    partialCostoUsd: number,
    partialIterations: number,
  ) {
    super(message);
    this.name = "MotorError";
    this.code = code;
    this.partialUsage = partialUsage;
    this.partialCostoUsd = partialCostoUsd;
    this.partialIterations = partialIterations;
  }
}

function isToolUseBlock(b: Anthropic.ContentBlock): b is Anthropic.ToolUseBlock {
  return b.type === "tool_use";
}

function isTextBlock(b: Anthropic.ContentBlock): b is Anthropic.TextBlock {
  return b.type === "text";
}

export async function correrLoop<Ctx>(
  input: MotorInput<Ctx>,
): Promise<MotorResult> {
  const maxIterations = input.maxIterations ?? 22;
  const modelId = input.modelId;
  const maxTokens = input.maxTokens ?? 16000;
  const client = getAnthropic();

  // Copia: el motor empuja assistant/user a medida que avanza y no debe
  // mutar el array que le pasó el caller.
  const messages: Anthropic.MessageParam[] = [...input.messages];

  const totalUsage: RunAgentUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  let costoUsd = 0;
  let iterations = 0;
  let sintesisForzada = false;

  // Índice tool name → familia. Se arma una vez: el dispatch es por nombre y
  // no queremos recorrer familias por cada tool_use.
  const familiaDe = new Map<string, FamiliaTools<Ctx>>();
  for (const f of input.familias) {
    for (const t of f.tools) familiaDe.set(t.name, f);
  }
  const usos: Record<string, number> = {};
  for (const f of input.familias) usos[f.nombre] = 0;

  const acumularUsage = (response: Anthropic.Message) => {
    totalUsage.input_tokens += response.usage.input_tokens;
    totalUsage.output_tokens += response.usage.output_tokens;
    totalUsage.cache_creation_input_tokens +=
      response.usage.cache_creation_input_tokens ?? 0;
    totalUsage.cache_read_input_tokens +=
      response.usage.cache_read_input_tokens ?? 0;
    costoUsd += calcularCosto(modelId, usageDeResponse(response));
  };

  // Tools disponibles EN ESTE MOMENTO. Se recalcula antes de cada request: una
  // familia desaparece cuando agota su cap, y la key `tools` se omite solo si
  // no queda ninguna. Agotar el cap de una familia NO puede cortarle las tools
  // a otra que todavía tiene cupo.
  //
  // INTERACCIÓN CON EL CACHÉ: las tools son parte del prefijo cacheado, así
  // que cada vez que este array cambia se pierde el caché de ahí en adelante.
  // Se aceptó a propósito en vez de declarar siempre todas las tools y
  // rechazar por cap en el tool_result: eso ahorraría un cache miss ocasional
  // a cambio de dejar que el modelo siga llamando herramientas agotadas y
  // queme iteraciones. El miss es raro —solo cuando una familia agota su
  // presupuesto, o en la última vuelta que sale sin tools— y el caso común
  // (ninguna familia agotada) mantiene el prefijo intacto todo el turno.
  const toolsDisponibles = (): Anthropic.Tool[] => {
    const t: Anthropic.Tool[] = [];
    for (const f of input.familias) {
      if (f.habilitada === false) continue;
      if (usos[f.nombre] >= f.cap) continue;
      t.push(...f.tools);
    }
    return t;
  };

  // === Prompt caching ===
  //
  // Dos breakpoints, que es lo que esta forma de conversación pide:
  //
  // 1. Sobre el system. El caché es un PREFIJO en el orden canónico de la
  //    request (tools → system → messages), así que un solo breakpoint acá
  //    cubre tools + system: los ~6.000 tokens que hoy se pagan enteros en
  //    cada llamada. No hace falta marcar también la última tool.
  //
  // 2. Sobre el final del HISTORIAL (no del mensaje nuevo). En el turno N+1 el
  //    prefijo estable es todo lo que ya se dijo hasta el turno N; el mensaje
  //    nuevo cambia siempre y marcarlo no serviría de nada. Acá es donde el
  //    caché realmente paga: en el quinto mensaje de una conversación se
  //    re-mandan los cuatro anteriores completos.
  //
  // Si el prefijo no llega al mínimo cacheable (1.024 tokens en Sonnet y Opus,
  // 2.048 en Haiku) la API ignora el cache_control en silencio, sin error.
  const cachear = input.cachear !== false;

  const systemParam = (): Anthropic.MessageCreateParams["system"] =>
    cachear
      ? [
          {
            type: "text" as const,
            text: input.systemPrompt,
            cache_control: { type: "ephemeral" as const },
          },
        ]
      : input.systemPrompt;

  // Devuelve una copia del mensaje con cache_control en su último bloque. No
  // muta el original: el array `messages` se sigue usando para armar el turno
  // siguiente y no queremos dejarle breakpoints viejos pegados.
  const conBreakpoint = (msg: Anthropic.MessageParam): Anthropic.MessageParam => {
    // Content string → hay que volverlo bloque para poder marcarlo.
    if (typeof msg.content === "string") {
      return {
        role: msg.role,
        content: [
          {
            type: "text" as const,
            text: msg.content,
            cache_control: { type: "ephemeral" as const },
          },
        ],
      };
    }
    if (msg.content.length === 0) return msg;
    const bloques = [...msg.content];
    const ultimo = bloques[bloques.length - 1];
    bloques[bloques.length - 1] = {
      ...ultimo,
      cache_control: { type: "ephemeral" as const },
    } as typeof ultimo;
    return { role: msg.role, content: bloques };
  };

  // Índice del último mensaje del HISTORIAL previo: el que precede al mensaje
  // nuevo de este turno. -1 cuando el turno es el primero de la conversación
  // (no hay historial que cachear).
  const idxFinHistorial = input.messages.length - 2;

  const mensajesParaRequest = (): Anthropic.MessageParam[] => {
    if (!cachear || idxFinHistorial < 0) return messages;
    return messages.map((m, i) => (i === idxFinHistorial ? conBreakpoint(m) : m));
  };

  const crearRequest = (
    tools: Anthropic.Tool[],
  ): Anthropic.MessageCreateParamsNonStreaming => ({
    model: modelId,
    max_tokens: maxTokens,
    system: systemParam(),
    messages: mensajesParaRequest(),
    ...(tools.length > 0 ? { tools } : {}),
  });

  const errorParcial = (message: string, code: AgentErrorCode): MotorError =>
    new MotorError(
      message,
      code,
      { ...totalUsage },
      Number(costoUsd.toFixed(6)),
      iterations,
    );

  // Dispatch de UNA tool call. Nunca tira: cualquier fallo vuelve como
  // tool_result con is_error para que el modelo lo lea y siga.
  const despachar = async (
    tu: Anthropic.ToolUseBlock,
  ): Promise<Anthropic.ToolResultBlockParam> => {
    const familia = familiaDe.get(tu.name);
    if (!familia) {
      return {
        type: "tool_result",
        tool_use_id: tu.id,
        content: `Error: tool desconocida "${tu.name}"`,
        is_error: true,
      };
    }
    if (familia.habilitada === false) {
      return {
        type: "tool_result",
        tool_use_id: tu.id,
        content:
          familia.mensajeDeshabilitada ??
          `La herramienta "${tu.name}" no está disponible en este contexto.`,
      };
    }
    if (usos[familia.nombre] >= familia.cap) {
      return {
        type: "tool_result",
        tool_use_id: tu.id,
        content: familia.mensajeCapAgotado,
      };
    }

    // Incremento SÍNCRONO, antes de cualquier await: las otras tool calls de
    // esta misma iteración tienen que ver el contador actualizado antes de que
    // este await resuelva. Si se incrementara después, N llamadas paralelas
    // pasarían todas el chequeo de cap y el tope se excedería.
    usos[familia.nombre]++;

    let r: ResultadoTool;
    try {
      r = await familia.ejecutar(tu, input.contexto);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[motor] ${tu.name} (${familia.nombre}) falló:`, msg);
      return {
        type: "tool_result",
        tool_use_id: tu.id,
        content: `Error: ${msg}`,
        is_error: true,
      };
    }

    if (r.usageExtra) {
      totalUsage.input_tokens += r.usageExtra.usage.input_tokens;
      totalUsage.output_tokens += r.usageExtra.usage.output_tokens;
      totalUsage.cache_creation_input_tokens +=
        r.usageExtra.usage.cache_creation_input_tokens ?? 0;
      totalUsage.cache_read_input_tokens +=
        r.usageExtra.usage.cache_read_input_tokens ?? 0;
      costoUsd += r.usageExtra.costoUsd;
    }

    return {
      type: "tool_result",
      tool_use_id: tu.id,
      content: r.contentJSON,
      ...(r.isError ? { is_error: true } : {}),
    };
  };

  // Primer call. Si falla acá no hay tokens cobrados, pero igual va envuelto
  // en MotorError: crudo bubbleaba como 500 y el cliente no disparaba el
  // recovery-polling ni mostraba un mensaje accionable (así se gatilló el
  // incidente de la conversación brickeada del 25/06).
  let response: Anthropic.Message;
  try {
    response = await client.messages.create(crearRequest(toolsDisponibles()));
  } catch (e) {
    throw errorParcial(e instanceof Error ? e.message : String(e), "API_ERROR");
  }
  acumularUsage(response);

  while (response.stop_reason === "tool_use" && iterations < maxIterations) {
    iterations++;
    const toolUseBlocks = response.content.filter(isToolUseBlock);
    const resultadosPorId = new Map<string, Anthropic.ToolResultBlockParam>();

    // Paralelizables juntas; el resto en serie y en el orden en que el modelo
    // las pidió.
    const enParalelo = toolUseBlocks.filter(
      (tu) => familiaDe.get(tu.name)?.paralelizable ?? true,
    );
    const enSerie = toolUseBlocks.filter(
      (tu) => familiaDe.get(tu.name)?.paralelizable === false,
    );

    await Promise.all(
      enParalelo.map(async (tu) => {
        resultadosPorId.set(tu.id, await despachar(tu));
      }),
    );
    for (const tu of enSerie) {
      resultadosPorId.set(tu.id, await despachar(tu));
    }

    // El orden de los tool_result sigue el de los tool_use del modelo, no el
    // de ejecución.
    const toolResults: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map(
      (tu) =>
        resultadosPorId.get(tu.id) ?? {
          type: "tool_result",
          tool_use_id: tu.id,
          content: `Error: la tool "${tu.name}" no devolvió resultado`,
          is_error: true,
        },
    );

    // Se recalcula DESPUÉS de ejecutar: las familias que agotaron su cap
    // desaparecen del próximo request.
    const ultimaVuelta = iterations >= maxIterations;
    if (ultimaVuelta) sintesisForzada = true;
    const tools = ultimaVuelta ? [] : toolsDisponibles();

    // Avisos de cap: cada tope agotado se le explica al modelo en el mismo
    // user message. El "cerrá y respondé" va SOLO si no le quedó ninguna
    // herramienta — agotar un presupuesto no debe cortarle a las familias que
    // todavía tienen cupo.
    const avisos: string[] = [];
    for (const f of input.familias) {
      if (f.habilitada === false) continue;
      if (usos[f.nombre] >= f.cap) avisos.push(f.avisoCapAgotado);
    }
    if (tools.length === 0) {
      avisos.push(
        "No te queda ninguna herramienta disponible en este mensaje: generá ahora la respuesta final completa basada en lo que ya hiciste, y contale al abogado qué quedó pendiente.",
      );
    }
    const userContent: Anthropic.MessageParam["content"] =
      avisos.length > 0
        ? [...toolResults, { type: "text" as const, text: avisos.join(" ") }]
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
    acumularUsage(response);

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

  return {
    rawText: response.content
      .filter(isTextBlock)
      .map((b) => b.text)
      .join(""),
    usage: totalUsage,
    costo_usd: Number(costoUsd.toFixed(6)),
    iterations,
    usos,
    sintesisForzada,
  };
}
