import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { buscarDocumentosTool, ejecutarToolBuscar } from "@/lib/agent/tools";
import {
  correrLoop,
  MotorError,
  type FamiliaTools,
} from "@/lib/agent/motor";
import {
  AgentError,
  type AgentErrorCode,
  type Busqueda,
  type RunAgentResult,
  type RunAgentUsage,
} from "@/lib/agent/run-agent";
import {
  claveRechazo,
  ejecutarToolMapa,
  mapaTools,
  type ContextoMapaTools,
  type RechazoConfirmable,
} from "@/lib/agent/mapa-tools";
import {
  ejecutarToolRepositorio,
  repositorioTools,
  type ConsultaRepositorio,
} from "@/lib/agent/repositorio-tools";
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
  consultas_repositorio: ConsultaRepositorio[];
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

// Tope de consultas al Repositorio interno (búsquedas + lecturas) por turno.
// Igual que en /analizar-caso: la jurisprudencia entra al final del
// razonamiento, para respaldar una hipótesis ya construida. En el chat el
// abogado puede volver a preguntar, así que el cap por turno puede ser bajo.
const HARD_CAP_REPOSITORIO = 6;


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
  // Los registros de dominio los acumula el SERVIDOR por closure. El motor
  // solo lleva la cuenta de usos por familia; qué significa cada uso —una
  // búsqueda, un precedente consultado, una acción sobre el mapa— lo sabe
  // este módulo. Por eso `acciones` sigue siendo imposible de inflar por el
  // modelo: se llena desde las tool calls que realmente se ejecutaron.
  const busquedas: Busqueda[] = [];
  const acciones: AccionMapa[] = [];
  const consultasRepositorio: ConsultaRepositorio[] = [];

  // casoId y usuarioId vienen SIEMPRE del contexto del servidor. El modelo no
  // puede elegir sobre qué caso opera: ninguna tool del mapa tiene parámetro
  // caso_id, y este objeto es lo único que se lo dice.
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

  const familias: FamiliaTools<ContextoMapaTools>[] = [
    {
      nombre: "busquedas",
      tools: [buscarDocumentosTool],
      cap: HARD_CAP_BUSQUEDAS,
      paralelizable: true,
      mensajeCapAgotado: `Has alcanzado el límite de búsquedas permitidas (${HARD_CAP_BUSQUEDAS}). No se ejecutó esta búsqueda. Generá la mejor respuesta posible con la información ya recopilada.`,
      avisoCapAgotado: `Alcanzaste el límite de búsquedas (${HARD_CAP_BUSQUEDAS}): no vas a poder hacer más en este mensaje.`,
      ejecutar: async (tu) => {
        const inputObj = (tu.input ?? {}) as { query?: unknown };
        const query = typeof inputObj.query === "string" ? inputObj.query : "";
        // Slot reservado SINCRÓNICAMENTE, antes de cualquier await. Las
        // búsquedas de una misma iteración salen juntas en Promise.all y
        // resuelven en el orden en que conteste OpenAI/pgvector, pero el
        // registro tiene que conservar el orden en que el MODELO las pidió:
        // es el que se numera en el chat ("1. …, 2. …") y el que queda en
        // metadata.busquedas. Empujar al terminar dejaría ese orden atado a
        // la latencia, y por lo tanto distinto entre dos corridas idénticas.
        const idx = busquedas.length;
        busquedas.push({ query, chunks_devueltos: 0, similarity_top: null });
        try {
          const r = await ejecutarToolBuscar(query);
          busquedas[idx] = {
            query,
            chunks_devueltos: r.chunks_devueltos,
            similarity_top: r.similarity_top,
          };
          return { contentJSON: r.contentJSON };
        } catch (e) {
          // El placeholder con ceros ya quedó registrado en `idx`: la búsqueda
          // fallida se sigue viendo en metadata, que es la señal de que el
          // agente sí intentó y el RAG no respondió.
          const msg = e instanceof Error ? e.message : String(e);
          return { contentJSON: `Error: ${msg}`, isError: true };
        }
      },
    },
    {
      nombre: "repositorio",
      tools: repositorioTools,
      cap: HARD_CAP_REPOSITORIO,
      paralelizable: true,
      mensajeCapAgotado: `Alcanzaste el límite de consultas al repositorio del estudio (${HARD_CAP_REPOSITORIO}) en este mensaje. No se ejecutó esta consulta. Respondé con los precedentes que ya recuperaste; si hace falta más, el abogado puede volver a preguntar.`,
      avisoCapAgotado: `Alcanzaste el límite de consultas al repositorio del estudio (${HARD_CAP_REPOSITORIO}) en este mensaje.`,
      ejecutar: async (tu) => {
        try {
          const r = await ejecutarToolRepositorio(tu.name, tu.input);
          if (r.consulta) consultasRepositorio.push(r.consulta);
          return { contentJSON: r.contentJSON };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[run-agent-consulta] ${tu.name} falló:`, msg);
          return {
            contentJSON: `Error consultando el repositorio: ${msg}. Seguí sin él y avisale al abogado en una línea.`,
            isError: true,
          };
        }
      },
    },
    {
      nombre: "mapa",
      tools: mapaTools,
      cap: MAX_ACCIONES_MAPA,
      // Las tools de escritura sobre el mapa se exponen SOLO si el caso ya
      // tiene mapa inicializado.
      habilitada: input.mapaHabilitado,
      // EN SERIE, sí o sí: cada acción hace leer-validar-escribir, y dos en
      // paralelo validarían ambas contra el mismo snapshot.
      paralelizable: false,
      mensajeCapAgotado: JSON.stringify({
        ok: false,
        motivo: `Alcanzaste el límite de ${MAX_ACCIONES_MAPA} acciones sobre el mapa por mensaje. Esta acción NO se ejecutó.`,
        regla: "CAP_ACCIONES_MAPA",
        sugerencia:
          "Contale al abogado qué cambios sí quedaron aplicados y qué falta, y pedile que te lo confirme en el próximo mensaje para seguir.",
      }),
      mensajeDeshabilitada: JSON.stringify({
        ok: false,
        motivo:
          "El mapa procesal de este caso no está inicializado, así que no se puede modificar.",
        regla: "MAPA_NO_INICIALIZADO",
        sugerencia:
          'Explicale al abogado que primero tiene que inicializar el mapa desde la vista "Mapa procesal" del caso, eligiendo el fuero.',
      }),
      avisoCapAgotado: `Alcanzaste el límite de acciones sobre el mapa procesal (${MAX_ACCIONES_MAPA}) en este mensaje: contale al abogado qué quedó aplicado y qué falta.`,
      ejecutar: async (tu, ctx) => {
        const r = await ejecutarToolMapa(tu.name, tu.input, ctx);
        acciones.push(r.accion);
        // La simulación de ramas hace su propio call al modelo: sus tokens se
        // suman al turno para que la ejecución los refleje.
        return { contentJSON: r.contentJSON, usageExtra: r.usageExtra };
      },
    },
  ];

  let res;
  try {
    res = await correrLoop<ContextoMapaTools>({
      systemPrompt: input.systemPrompt,
      // El último mensaje siempre tiene que ser role='user' para que la API
      // acepte la request. Los chequeos del endpoint garantizan que
      // mensajesPrevios termina en assistant o está vacío.
      messages: [
        ...(input.mensajesPrevios ?? []),
        { role: "user", content: buildPrimerUserContent(input) },
      ],
      modelId: input.modelId,
      maxTokens: input.maxTokens,
      // 10 búsquedas + 6 repositorio + 8 acciones de mapa, con techo de 22
      // vueltas. El techo NO cubre la suma de los caps a propósito: el modelo
      // agrupa varias tool calls por iteración, y la garantía de síntesis no
      // es el margen sino que la última vuelta sale sin tools.
      maxIterations: input.maxIterations ?? 22,
      familias,
      contexto: ctxMapa,
    });
  } catch (e) {
    // El motor conoce tokens, costo e iteraciones; los arrays de dominio los
    // tenemos acá. Se recombinan en el error que la route ya sabe leer
    // (`e instanceof AgentError` sigue funcionando igual).
    if (e instanceof MotorError) {
      throw new AgentConsultaError(
        e.message,
        e.code,
        e.partialUsage,
        e.partialCostoUsd,
        [...busquedas],
        e.partialIterations,
        [...acciones],
      );
    }
    throw e;
  }

  return {
    rawText: res.rawText,
    usage: res.usage,
    costo_usd: res.costo_usd,
    busquedas,
    acciones,
    consultas_repositorio: consultasRepositorio,
    iterations: res.iterations,
    // Degradada si el modelo se quedó sin búsquedas o si el loop le cortó las
    // herramientas para forzar el cierre: en los dos casos respondió con menos
    // de lo que pedía. El conteo sale del motor (cuenta dispatches, incluidos
    // los que fallaron) y no de busquedas.length.
    degraded_response:
      res.usos.busquedas >= HARD_CAP_BUSQUEDAS || res.sintesisForzada,
  };
}
