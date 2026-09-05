import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { gmail_v1 } from "@googleapis/gmail";
import { buscarDocumentosTool, ejecutarToolBuscar } from "@/lib/agent/tools";
import { correrLoop, MotorError, type FamiliaTools } from "@/lib/agent/motor";
import {
  AgentError,
  type AgentErrorCode,
  type Busqueda,
  type RunAgentUsage,
} from "@/lib/agent/run-agent";
import {
  ejecutarToolRepositorio,
  repositorioTools,
  type ConsultaRepositorio,
} from "@/lib/agent/repositorio-tools";
import {
  ejecutarToolLexie,
  lexieTools,
  type ContextoLexie,
} from "@/lib/agent/lexie-tools";
import type { FamiliaLexie } from "@/lib/agent/lexie-dominio";
import { DOMINIOS_LEXIE } from "@/lib/lexie/ejecutar-accion";
import type { AccionLexie } from "@/lib/lexie/acciones";

// El agente de LEXIE. Es el tercer consumidor del motor y el primero que se
// escribió con él ya existente: todo lo que hay acá es DOMINIO — qué familias
// de tools tiene, con qué presupuesto y qué registra de cada una.
//
// Diferencia de fondo con el chat del caso: acá NO hay un caso fijo. El modelo
// elige sobre qué causa trabajar, así que `usuarioId` viaja en el contexto del
// servidor y cada tool que recibe un `caso_id` lo valida contra él. Ver el
// comentario de cabecera de lexie-tools.ts.
//
// === Fase 11: LEXIE con manos ===
//
// Las familias de ESCRITURA (agenda, ficha, escritos, correo) no se declaran
// acá: cada dominio las exporta por el contrato de lexie-dominio.ts y este
// archivo sólo las adapta al motor. Lo que sí hace este archivo, y es lo que
// sostiene la auditoría, es RECOGER `acciones[]`: cada tool devuelve su
// `accion` y acá se acumula por closure, en el orden de ejecución (todas las
// familias de escritura son en serie, así que no hay slot que reservar). El
// motor queda intacto a propósito: tocarlo obliga a re-verificar el chat del
// caso en el mismo commit.

// Presupuestos por turno. Más chicos que los del chat del caso a propósito:
// LEXIE contesta preguntas de trabajo diario ("¿qué tengo mañana?"), no arma
// estrategias. Un turno que necesita ocho búsquedas normativas es un turno que
// se fue de tema.
const CAP_LEXIE = 8;
const CAP_REPOSITORIO = 5;
const CAP_NORMATIVA = 6;

export type RunLexieInput = {
  pregunta: string;
  /**
   * Contexto del abogado (causas + agenda + fecha). Va SOLO en el primer
   * mensaje del hilo: en los turnos siguientes ya vive en el historial, y
   * repetirlo sería pagarlo de nuevo en cada vuelta.
   */
  contextoInicial: string | null;
  systemPrompt: string;
  modelId: string;
  maxTokens?: number;
  maxIterations?: number;
  mensajesPrevios?: Anthropic.MessageParam[];
  /** Del servidor. Nunca del cliente ni del modelo. */
  usuarioId: string;
  nombre: string;
  clerkUserId: string;
  /** Resuelto una vez por turno en la ruta; null sin Google o sin scope. */
  gmail: gmail_v1.Gmail | null;
  /** Ver ContextoLexie.mensajesAbogado. */
  mensajesAbogado: string[];
  casoIdEnPantalla: string | null;
  /** Pendientes vivas del turno anterior, ya parseadas por la ruta. */
  accionesPendientes: AccionLexie[];
  /** Hilos de correo leídos en el turno anterior. */
  hilosLeidosPrevios: string[];
};

export type RunLexieResult = {
  rawText: string;
  usage: RunAgentUsage;
  costo_usd: number;
  iterations: number;
  busquedas: Busqueda[];
  consultas_repositorio: ConsultaRepositorio[];
  /** Nombres de tools efectivamente ejecutadas, en orden. Para metadata. */
  herramientas_usadas: string[];
  degraded_response: boolean;
  /** Lo que el turno HIZO, INTENTÓ o DEJÓ PENDIENTE. Lo arma este archivo. */
  acciones: AccionLexie[];
  /** Hilos leídos en este turno, para sembrar el siguiente. */
  hilos_leidos: string[];
  correo_leido: boolean;
};

// Misma idea que AgentConsultaError: las acciones parciales viajan en una
// subclase, y `e instanceof AgentError` en la ruta sigue funcionando igual.
export class AgentLexieError extends AgentError {
  partialAcciones: AccionLexie[];
  constructor(
    message: string,
    code: AgentErrorCode,
    partialUsage: RunAgentUsage,
    partialCostoUsd: number,
    partialBusquedas: Busqueda[],
    partialIterations: number,
    partialAcciones: AccionLexie[],
  ) {
    super(
      message,
      code,
      partialUsage,
      partialCostoUsd,
      partialBusquedas,
      partialIterations,
    );
    this.name = "AgentLexieError";
    this.partialAcciones = partialAcciones;
  }
}

export async function runLexie(input: RunLexieInput): Promise<RunLexieResult> {
  const busquedas: Busqueda[] = [];
  const consultasRepositorio: ConsultaRepositorio[] = [];
  const herramientasUsadas: string[] = [];
  const acciones: AccionLexie[] = [];

  // El Map de pendientes se construye UNA vez, acá, y las tools sólo lo leen:
  // es la propiedad estructural que impide que el modelo se autoconfirme en
  // el mismo turno en que mostró la vista previa.
  const accionesPendientes = new Map<string, AccionLexie>();
  for (const a of input.accionesPendientes) {
    if (a.estado === "pendiente" && a.clave) accionesPendientes.set(a.clave, a);
  }

  const ctx: ContextoLexie = {
    usuarioId: input.usuarioId,
    nombre: input.nombre,
    clerkUserId: input.clerkUserId,
    gmail: input.gmail,
    mensajesAbogado: input.mensajesAbogado,
    casoIdEnPantalla: input.casoIdEnPantalla,
    accionesPendientes,
    clavesConsumidas: new Set(),
    correoLeido: false,
    hilosLeidos: new Set(input.hilosLeidosPrevios),
  };

  // Adapta una familia de LEXIE al motor: registra el nombre de la tool y
  // recoge la `accion` si la hubo. Se hace acá y no en cada dominio para que
  // ninguno pueda olvidarse de registrar (misma razón por la que el motor
  // envuelve todo `ejecutar` en try/catch).
  const adaptar = (f: FamiliaLexie): FamiliaTools<ContextoLexie> => ({
    ...f,
    ejecutar: async (tu, c) => {
      herramientasUsadas.push(tu.name);
      const r = await f.ejecutar(tu, c);
      if (r.accion) acciones.push(r.accion);
      return { contentJSON: r.contentJSON, isError: r.isError };
    },
  });

  const familias: FamiliaTools<ContextoLexie>[] = [
    {
      nombre: "lexie",
      tools: lexieTools,
      cap: CAP_LEXIE,
      // Todas son lecturas: nada que serializar.
      paralelizable: true,
      mensajeCapAgotado: `Alcanzaste el límite de ${CAP_LEXIE} consultas a la app en este mensaje. Respondé con lo que ya tenés y, si hace falta más, pedile al abogado que repregunte.`,
      avisoCapAgotado: `Alcanzaste el límite de consultas a la app (${CAP_LEXIE}) en este mensaje.`,
      ejecutar: async (tu, c) => {
        herramientasUsadas.push(tu.name);
        const r = await ejecutarToolLexie(tu.name, tu.input, c);
        if (r.accion) acciones.push(r.accion);
        return { contentJSON: r.contentJSON, isError: r.isError };
      },
    },
    {
      nombre: "repositorio",
      tools: repositorioTools,
      cap: CAP_REPOSITORIO,
      paralelizable: true,
      mensajeCapAgotado: `Alcanzaste el límite de consultas al repositorio del estudio (${CAP_REPOSITORIO}) en este mensaje. Respondé con los precedentes que ya recuperaste.`,
      avisoCapAgotado: `Alcanzaste el límite de consultas al repositorio (${CAP_REPOSITORIO}) en este mensaje.`,
      ejecutar: async (tu) => {
        herramientasUsadas.push(tu.name);
        try {
          const r = await ejecutarToolRepositorio(tu.name, tu.input);
          if (r.consulta) consultasRepositorio.push(r.consulta);
          return { contentJSON: r.contentJSON };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[run-lexie] ${tu.name} falló:`, msg);
          return {
            contentJSON: `Error consultando el repositorio: ${msg}. Seguí sin él y avisale al abogado en una línea.`,
            isError: true,
          };
        }
      },
    },
    {
      nombre: "normativa",
      tools: [buscarDocumentosTool],
      cap: CAP_NORMATIVA,
      paralelizable: true,
      mensajeCapAgotado: `Alcanzaste el límite de búsquedas normativas (${CAP_NORMATIVA}) en este mensaje. Respondé con lo que ya recopilaste.`,
      avisoCapAgotado: `Alcanzaste el límite de búsquedas normativas (${CAP_NORMATIVA}) en este mensaje.`,
      ejecutar: async (tu) => {
        herramientasUsadas.push(tu.name);
        const args = (tu.input ?? {}) as { query?: unknown };
        const query = typeof args.query === "string" ? args.query : "";
        // Slot reservado ANTES del await: varias búsquedas de la misma
        // iteración salen en paralelo y resuelven en cualquier orden, pero el
        // registro tiene que conservar el orden en que el modelo las pidió.
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
          const msg = e instanceof Error ? e.message : String(e);
          return { contentJSON: `Error: ${msg}`, isError: true };
        }
      },
    },
    // Las familias de cada dominio (agenda, ficha, escritos, correo). Cada
    // dominio decide `habilitada` desde el contexto: sin scope de Gmail, las
    // de correo no se le declaran al modelo.
    ...DOMINIOS_LEXIE.flatMap((d) => d.familias(ctx).map(adaptar)),
  ];

  // El mensaje nuevo del turno: contexto del abogado (solo la primera vez) +
  // su pregunta.
  const contenidoUsuario = input.contextoInicial
    ? `${input.contextoInicial}\n\n---\n\n${input.pregunta}`
    : input.pregunta;

  let res;
  try {
    res = await correrLoop<ContextoLexie>({
      systemPrompt: input.systemPrompt,
      messages: [
        ...(input.mensajesPrevios ?? []),
        { role: "user", content: contenidoUsuario },
      ],
      modelId: input.modelId,
      maxTokens: input.maxTokens ?? 4000,
      // La suma de los caps supera el techo a propósito: el modelo agrupa
      // varias tool calls por iteración, y la síntesis la garantiza la última
      // vuelta sin tools. 18 (antes 14) porque un turno Jarvis típico es
      // leer → resolver ambigüedad → mutar → relatar.
      maxIterations: input.maxIterations ?? 18,
      familias,
      contexto: ctx,
    });
  } catch (e) {
    if (e instanceof MotorError) {
      throw new AgentLexieError(
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
    iterations: res.iterations,
    busquedas,
    consultas_repositorio: consultasRepositorio,
    herramientas_usadas: herramientasUsadas,
    degraded_response:
      res.sintesisForzada || res.usos.normativa >= CAP_NORMATIVA,
    acciones,
    hilos_leidos: [...ctx.hilosLeidos],
    correo_leido: ctx.correoLeido,
  };
}
