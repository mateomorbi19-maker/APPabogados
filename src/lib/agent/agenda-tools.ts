import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { nombreCaso } from "@/lib/casos/nombre";
import type { CasoNombrable } from "@/lib/types";
import { getEventoById } from "@/lib/agenda/queries";
import {
  buscarEventos,
  crearEventoConSync,
  editarEventoConSync,
  eliminarEventoConSync,
  ErrorServicioAgenda,
  existeEventoSimilar,
  type ResultadoGoogle,
} from "@/lib/agenda/servicio";
import {
  ahoraPartesAR,
  DIAS_ABBR,
  dowDe,
  fmtHora,
  isoAPartesAR,
  MESES_ABBR,
  MESES_LARGO,
  partesAIsoAR,
  partesAMin,
  sumarDias,
  sumarMinutos,
  type PartesFecha,
} from "@/lib/agenda/tz-ar";
import {
  CLASES_EVENTO_VALUES,
  crearEventoAgendaSchema,
  editarEventoAgendaSchema,
  PRIORIDADES_VALUES,
  TIPOS_EVENTO,
  TIPOS_EVENTO_VALUES,
  type EventoAgenda,
  type EventoAgendaInsert,
  type EventoAgendaUpdate,
} from "@/lib/agenda/types";
import type { AccionLexie } from "@/lib/lexie/acciones";
import {
  emitirPendiente,
  jsonRechazoConfirmacion,
  resolverConfirmacion,
} from "@/lib/lexie/confirmacion";
import {
  ejecutarPorTexto,
  resolverPendiente,
  type CtxEjecucion,
  type DominioLexie,
  type FamiliaLexie,
} from "@/lib/agent/lexie-dominio";
import {
  cuandoLegible,
  dictadoPorElAbogado,
  enCuarentena,
  NOTA_CUARENTENA,
  rangoAFechas,
  RANGOS,
  type ContextoLexie,
  type ResultadoToolLexie,
} from "@/lib/agent/lexie-tools";

// Dominio AGENDA de LEXIE: buscar, crear, editar y eliminar eventos y tareas.
//
// === Tres familias, por reversibilidad ===
//
//   - `agenda_lectura` (cap 4, paralela): `agenda_buscar_evento`, la tool de
//     DESAMBIGUACIÓN. "La audiencia de Pérez" no es un id; esta tool devuelve
//     los candidatos con `evento_id` y el modelo pregunta cuál si hay más de
//     uno. Nunca se muta por nombre.
//   - `agenda_escritura` (cap 3, en serie): crear y editar. Son reversibles
//     (lo creado se edita o se borra; lo editado vuelve con el `antes` que
//     queda en la tarjeta), así que se ejecutan DIRECTO. Dos excepciones que
//     las vuelven confirmables: la cuarentena de correo, y —sólo al crear— que
//     ya exista un evento igual ese día.
//   - `agenda_eliminacion` (cap 1, en serie): eliminar. Irreversible y con
//     efecto externo (Google Calendar), así que SIEMPRE pide confirmación.
//
// === Qué construye el servidor, y qué no construye el modelo ===
//
// El modelo manda fecha `YYYY-MM-DD` y hora `HH:MM` de pared argentina. El
// ISO con `-03:00` lo arma este archivo (`armarFechasEvento`): dejarle el
// offset al modelo es la forma más silenciosa de agendar una audiencia en el
// día equivocado. Lo mismo con la `cuando` legible: sale de acá, con día de
// semana, para que el modelo la relate y no la recalcule.
//
// Los `caso_id` y `evento_id` que vienen del modelo se validan contra
// `ctx.usuarioId` ANTES de leer o escribir: `getEventoById` filtra por
// usuario, y la causa se resuelve con el `.eq("usuario_id")` dentro de la
// misma query que trae su nombre. Un id ajeno se contesta igual que uno
// inexistente, sin revelar nada. Abajo no hay red: el server entra con
// service_role.

export const AGENDA_TOOL_NAMES = {
  buscar: "agenda_buscar_evento",
  crear: "agenda_crear_evento",
  editar: "agenda_editar_evento",
  eliminar: "agenda_eliminar_evento",
} as const;

const HREF_AGENDA = "/dashboard/agenda";
const DURACION_DEFAULT_MIN = 60;
const MAX_CANDIDATOS = 25;

// ============================================================================
// Declaración de las tools
// ============================================================================
//
// Las descripciones son deliberadamente cortas (sub-paso 11.9): entran en el
// prefijo cacheado de LEXIE y se pagan en cada apertura de hilo de los tres
// abogados. El protocolo de confirmación, la cuarentena de correo, la
// desambiguación y "no inventes datos" ya están en «CÓMO ACTUÁS» del system
// prompt; acá va sólo lo que el modelo necesita para llamar bien a CADA tool.

const DESC_CLAVE = "Clave de la pendiente a confirmar.";
const DESC_CONFIRMAR = "true sólo al confirmar una pendiente.";
const DESC_EVENTO_ID = "UUID del evento.";
const DESC_CASO_ID = "UUID de la causa (contexto o buscar_mis_casos).";

export const agendaLecturaTools: Anthropic.Tool[] = [
  {
    name: AGENDA_TOOL_NAMES.buscar,
    description:
      "Busca eventos y tareas por texto, rango o causa (sin rango, ±60 días). Devuelve candidatos con evento_id, cuándo (hora argentina, día de semana), tipo, clase, causa y si está en Google.",
    input_schema: {
      type: "object",
      properties: {
        texto: {
          type: "string",
          description: "Palabras del título o la descripción. Máximo 120 caracteres.",
        },
        rango: {
          type: "string",
          enum: [...RANGOS],
          description: "Acotar a un período.",
        },
        caso_id: {
          type: "string",
          description: DESC_CASO_ID,
        },
      },
    },
  },
];

export const agendaEscrituraTools: Anthropic.Tool[] = [
  {
    name: AGENDA_TOOL_NAMES.crear,
    description:
      "Crea un evento (cita con hora, va a Google Calendar) o una tarea (pendiente del día, sin hora ni Google). Fecha 'YYYY-MM-DD' y hora 'HH:MM' de pared argentina; el ISO lo arma el servidor. Devuelve evento_id, cuándo y google_synced. Directo; si ya hay uno igual ese día queda pendiente. Un vencimiento_procesal sólo con la fecha que el abogado dictó.",
    input_schema: {
      type: "object",
      properties: {
        titulo: {
          type: "string",
          description: "Corto y reconocible.",
        },
        clase: {
          type: "string",
          enum: [...CLASES_EVENTO_VALUES],
        },
        tipo: {
          type: "string",
          enum: [...TIPOS_EVENTO_VALUES],
        },
        fecha: {
          type: "string",
          description: "'YYYY-MM-DD'.",
        },
        hora: {
          type: "string",
          description: "'HH:MM'. Obligatoria en un evento salvo todo_el_dia.",
        },
        duracion_min: {
          type: "integer",
          description: "Minutos. Default 60.",
        },
        todo_el_dia: {
          type: "boolean",
          description: "Evento sin hora.",
        },
        prioridad: {
          type: "string",
          enum: [...PRIORIDADES_VALUES],
          description: "Default 'media'.",
        },
        caso_id: {
          type: "string",
          description: DESC_CASO_ID,
        },
        descripcion: {
          type: "string",
        },
        notas: {
          type: "string",
          description: "Notas internas (sólo eventos).",
        },
        clave: {
          type: "string",
          description: DESC_CLAVE,
        },
        confirmar: {
          type: "boolean",
          description: DESC_CONFIRMAR,
        },
      },
      required: ["titulo", "clase", "tipo", "fecha"],
    },
  },
  {
    name: AGENDA_TOOL_NAMES.editar,
    description:
      "Modifica un evento o tarea por evento_id (de mi_agenda o agenda_buscar_evento). En `cambios` va sólo lo que cambia; lo demás se conserva; la clase no se cambia. Directo; devuelve antes y después. Si estaba en Google, pisa lo editado desde el celular. completado: true es la alternativa suave a eliminar.",
    input_schema: {
      type: "object",
      properties: {
        evento_id: {
          type: "string",
          description: DESC_EVENTO_ID,
        },
        cambios: {
          type: "object",
          description: "Sólo lo que cambia.",
          properties: {
            titulo: { type: "string" },
            fecha: { type: "string", description: "'YYYY-MM-DD', hora argentina." },
            hora: { type: "string", description: "'HH:MM'." },
            duracion_min: { type: "integer", description: "Minutos." },
            todo_el_dia: { type: "boolean" },
            tipo: { type: "string", enum: [...TIPOS_EVENTO_VALUES] },
            prioridad: { type: "string", enum: [...PRIORIDADES_VALUES] },
            caso_id: {
              type: ["string", "null"],
              description: "UUID, o null para desasociar.",
            },
            descripcion: { type: ["string", "null"] },
            notas: { type: ["string", "null"] },
            completado: { type: "boolean" },
          },
        },
        clave: {
          type: "string",
          description: DESC_CLAVE,
        },
        confirmar: {
          type: "boolean",
          description: DESC_CONFIRMAR,
        },
      },
      required: ["evento_id"],
    },
  },
];

export const agendaEliminacionTools: Anthropic.Tool[] = [
  {
    name: AGENDA_TOOL_NAMES.eliminar,
    description:
      "Elimina un evento o tarea por evento_id (de mi_agenda o agenda_buscar_evento), también de Google Calendar si estaba sincronizado. Confirmable: queda pendiente con vista previa; {clave, confirmar: true} en tu próximo mensaje la ejecuta. Si Google no puede borrarlo, tampoco se borra de la app: la alternativa es agenda_editar_evento con completado: true.",
    input_schema: {
      type: "object",
      properties: {
        evento_id: {
          type: "string",
          description: DESC_EVENTO_ID,
        },
        clave: {
          type: "string",
          description: DESC_CLAVE,
        },
        confirmar: {
          type: "boolean",
          description: DESC_CONFIRMAR,
        },
      },
      required: ["evento_id"],
    },
  },
];

export function esToolDeAgenda(nombre: string): boolean {
  return (Object.values(AGENDA_TOOL_NAMES) as string[]).includes(nombre);
}

// ============================================================================
// Schemas: el output del modelo es input no confiable
// ============================================================================

const fechaSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "fecha tiene que ser 'YYYY-MM-DD'");
const horaSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "hora tiene que ser 'HH:MM' (24 h)");
const uuidSchema = z.string().uuid();
const duracionSchema = z.number().int().min(5).max(24 * 60);

const confirmacionSchema = z.object({
  clave: z.string().trim().min(1).optional(),
  confirmar: z.boolean().optional(),
});

const buscarSchema = z.object({
  texto: z.string().trim().max(120).optional(),
  rango: z.enum(RANGOS).optional(),
  caso_id: uuidSchema.optional(),
});

const crearSchema = z.object({
  titulo: z.string().trim().min(1).max(300),
  clase: z.enum(CLASES_EVENTO_VALUES),
  tipo: z.enum(TIPOS_EVENTO_VALUES),
  fecha: fechaSchema,
  hora: horaSchema.optional(),
  duracion_min: duracionSchema.optional(),
  todo_el_dia: z.boolean().optional(),
  prioridad: z.enum(PRIORIDADES_VALUES).optional(),
  caso_id: uuidSchema.optional(),
  descripcion: z.string().trim().max(5000).optional(),
  notas: z.string().trim().max(5000).optional(),
  clave: z.string().trim().min(1).optional(),
  confirmar: z.boolean().optional(),
});

const cambiosSchema = z.object({
  titulo: z.string().trim().min(1).max(300).optional(),
  fecha: fechaSchema.optional(),
  hora: horaSchema.optional(),
  duracion_min: duracionSchema.optional(),
  todo_el_dia: z.boolean().optional(),
  tipo: z.enum(TIPOS_EVENTO_VALUES).optional(),
  prioridad: z.enum(PRIORIDADES_VALUES).optional(),
  caso_id: uuidSchema.nullable().optional(),
  descripcion: z.string().trim().max(5000).nullable().optional(),
  notas: z.string().trim().max(5000).nullable().optional(),
  completado: z.boolean().optional(),
});

const editarSchema = z.object({
  evento_id: uuidSchema,
  cambios: cambiosSchema.default({}),
  clave: z.string().trim().min(1).optional(),
  confirmar: z.boolean().optional(),
});

const eliminarSchema = z.object({
  evento_id: uuidSchema,
  clave: z.string().trim().min(1).optional(),
  confirmar: z.boolean().optional(),
});

function detalleZod(e: z.ZodError): string {
  return e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
}

function invalido(motivo: string, sugerencia: string): ResultadoToolLexie {
  return {
    contentJSON: JSON.stringify({ ok: false, motivo, sugerencia }),
    isError: true,
  };
}

// ============================================================================
// Fechas: del "10/09 a las 10" del abogado al ISO con -03:00
// ============================================================================

const p2 = (n: number) => String(n).padStart(2, "0");

/** 'YYYY-MM-DD' → partes (a las 00:00), o null si el día no existe (30/02). */
function parsearFecha(fecha: string): PartesFecha | null {
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return { y, mo: m - 1, d, h: 0, mi: 0 };
}

function parsearHora(hora: string): { h: number; mi: number } {
  const [h, mi] = hora.split(":").map(Number);
  return { h, mi };
}

export type FechasEvento = {
  fecha_inicio: string;
  fecha_fin: string | null;
  todo_el_dia: boolean;
};

/**
 * Arma `fecha_inicio`/`fecha_fin` con offset `-03:00` desde la fecha y la hora
 * de pared que dictó el abogado. Es PURA y se exporta para poder verificarla
 * sin base.
 *
 * - Tarea: siempre todo el día (00:00 del día, sin fin), como hace el form.
 * - Evento de todo el día: ídem, sin fin.
 * - Evento con hora: fin = inicio + duración (default 60 min).
 *
 * Devuelve `{ error }` cuando la combinación no alcanza (un evento sin hora
 * ni todo_el_dia) o el día no existe.
 */
export function armarFechasEvento(input: {
  clase: "evento" | "tarea";
  fecha: string;
  hora?: string | null;
  duracion_min?: number | null;
  todo_el_dia?: boolean | null;
}): FechasEvento | { error: string } {
  const dia = parsearFecha(input.fecha);
  if (!dia) return { error: `La fecha ${input.fecha} no existe en el calendario.` };

  const todoElDia = input.clase === "tarea" || input.todo_el_dia === true;
  if (todoElDia) {
    return { fecha_inicio: partesAIsoAR(dia), fecha_fin: null, todo_el_dia: true };
  }
  if (!input.hora) {
    return {
      error:
        "Un evento necesita hora ('HH:MM') o todo_el_dia: true. Si el abogado no dijo la hora, preguntásela.",
    };
  }
  const { h, mi } = parsearHora(input.hora);
  const inicio: PartesFecha = { ...dia, h, mi };
  const fin = sumarMinutos(inicio, input.duracion_min ?? DURACION_DEFAULT_MIN);
  return {
    fecha_inicio: partesAIsoAR(inicio),
    fecha_fin: partesAIsoAR(fin),
    todo_el_dia: false,
  };
}

/** Duración vigente de un evento con hora, o el default si no tiene fin. */
function duracionActualMin(e: EventoAgenda): number {
  if (e.todo_el_dia || !e.fecha_fin) return DURACION_DEFAULT_MIN;
  const d = partesAMin(isoAPartesAR(e.fecha_fin)) - partesAMin(isoAPartesAR(e.fecha_inicio));
  return d > 0 ? d : DURACION_DEFAULT_MIN;
}

/** "mar 10/09 10:00" — para el resumen de la tarjeta. */
function cuandoCorto(e: Pick<EventoAgenda, "fecha_inicio" | "todo_el_dia">): string {
  const i = isoAPartesAR(e.fecha_inicio);
  const dia = `${DIAS_ABBR[dowDe(i)]} ${p2(i.d)}/${p2(i.mo + 1)}`;
  return e.todo_el_dia ? `${dia} (todo el día)` : `${dia} ${fmtHora(i.h, i.mi)}`;
}

function mismoDia(a: PartesFecha, b: PartesFecha): boolean {
  return a.y === b.y && a.mo === b.mo && a.d === b.d;
}

/**
 * ¿El abogado DICTÓ esta fecha en el hilo? Es el guard del vencimiento
 * procesal: LEXIE puede cargar el plazo que le dicen, no derivar uno. Se
 * aceptan las formas en que un argentino escribe una fecha (10/9, 10/09/2026,
 * 10 de septiembre, 2026-09-10) y las relativas inmediatas (hoy, mañana,
 * pasado mañana) cuando coinciden con el día pedido. "El lunes" no cuenta:
 * ya es un cálculo.
 */
function fechaDictada(ctx: ContextoLexie, dia: PartesFecha): boolean {
  const d = dia.d;
  const m = dia.mo + 1;
  const y = dia.y;
  const formas = [
    `${d}/${m}`,
    `${p2(d)}/${p2(m)}`,
    `${d}/${m}/${y}`,
    `${p2(d)}/${p2(m)}/${y}`,
    `${d}/${m}/${String(y).slice(2)}`,
    `${y}-${p2(m)}-${p2(d)}`,
    `${d} de ${MESES_LARGO[dia.mo]}`,
    `${d} ${MESES_LARGO[dia.mo]}`,
    `${d} de ${MESES_ABBR[dia.mo]}`,
    `${d} ${MESES_ABBR[dia.mo]}`,
  ];
  if (formas.some((f) => dictadoPorElAbogado(ctx, f))) return true;

  const hoy = ahoraPartesAR();
  if (mismoDia(dia, hoy) && dictadoPorElAbogado(ctx, "hoy")) return true;
  if (mismoDia(dia, sumarDias(hoy, 2)) && dictadoPorElAbogado(ctx, "pasado mañana")) return true;
  if (mismoDia(dia, sumarDias(hoy, 1)) && dictadoPorElAbogado(ctx, "mañana")) return true;
  return false;
}

// ============================================================================
// Helpers de presentación
// ============================================================================

function labelTipo(tipo: string): string {
  return TIPOS_EVENTO[tipo as keyof typeof TIPOS_EVENTO]?.label ?? tipo;
}

/** Fila compacta para el modelo: lo que necesita para relatar y para volver a apuntar al evento. */
function filaEvento(e: EventoAgenda) {
  return {
    evento_id: e.id,
    titulo: e.titulo,
    cuando: cuandoLegible(e),
    tipo: labelTipo(e.tipo),
    clase: e.clase,
    prioridad: e.prioridad,
    causa: e.nombre_caso ?? null,
    sincronizado_google: !!e.google_calendar_event_id,
    completado: e.completado,
    ...(e.descripcion ? { descripcion: e.descripcion } : {}),
  };
}

/** Lo que Google hizo con la escritura, en una frase para que LEXIE la repita tal cual. */
function fraseGoogle(g: ResultadoGoogle, clase: EventoAgenda["clase"]): string {
  if (g.synced) return "Sincronizado con el Google Calendar del abogado.";
  switch (g.motivo) {
    case "no_aplica":
      return clase === "tarea"
        ? "Las tareas no van a Google: queda sólo en la app."
        : "Este evento no está en Google: queda sólo en la app.";
    case "sin_google":
      return "El abogado no tiene Google vinculado: queda sólo en la app. NO digas que lo agendaste en su Google.";
    case "sin_scope_calendar":
      return "Falta el permiso de calendario de Google: queda sólo en la app. Decile que vuelva a entrar con Google y acepte el permiso de calendario. NO digas que lo agendaste en su Google.";
    case "error":
      return `Google falló (${g.detalle ?? "sin detalle"}): queda sólo en la app; el próximo sync lo reintenta. NO digas que lo agendaste en su Google.`;
    default:
      return "No se sincronizó con Google.";
  }
}

/** Nombre de la causa si es del abogado; null si no existe o es ajena (misma respuesta a propósito). */
async function nombreCasoPropio(casoId: string, usuarioId: string): Promise<string | null> {
  const supabase = createServerClient();
  // El `.eq("usuario_id")` es el control de propiedad, y va en la misma query
  // que trae el nombre (mismo criterio que resolver-ubicacion.ts): chequear en
  // un SELECT y leer en otro abre una ventana entre los dos.
  const { data, error } = await supabase
    .from("casos")
    .select("id, titulo, caratula")
    .eq("id", casoId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  if (error) throw new Error(`nombreCasoPropio: ${error.message}`);
  return data ? nombreCaso(data as CasoNombrable) : null;
}

const RESPUESTA_CAUSA_AJENA = {
  ok: false,
  motivo: "No existe ninguna causa con ese id entre las causas de este abogado.",
  sugerencia:
    "Puede que hayas inventado o confundido el id. Usá buscar_mis_casos o la lista del contexto, o pedile al abogado que te diga de qué causa se trata.",
};

const RESPUESTA_EVENTO_INEXISTENTE = {
  ok: false,
  motivo: "No existe ningún evento con ese id en la agenda de este abogado.",
  sugerencia:
    "No inventes ids. Buscalo con agenda_buscar_evento o mi_agenda y usá el evento_id que devuelvan.",
};

/**
 * Pull de Google best-effort antes de mutar: reduce el desfase con lo que el
 * abogado movió desde el celular. Nunca tira. Se carga en diferido por la
 * misma razón que en servicio.ts: `google-pull.ts` arrastra Clerk, que bajo
 * `--conditions=react-server` (los scripts de verificación) no carga.
 */
async function pullGoogleBestEffort(usuarioId: string, clerkUserId: string): Promise<void> {
  if (!clerkUserId) return;
  try {
    const { pullFromGoogle } = await import("@/lib/agenda/google-pull");
    await pullFromGoogle(usuarioId, clerkUserId);
  } catch (e) {
    console.warn(
      "[agenda-tools] pull de Google salteado:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

/** Confirmación por clave: el payload que se ejecuta es el PERSISTIDO, así que el resto del input no se parsea. */
async function resolverPorClave(
  ctx: ContextoLexie,
  tool: string,
  clave: string,
  confirmar: boolean | undefined,
  resumen: string,
): Promise<ResultadoToolLexie> {
  const r = resolverConfirmacion(ctx, tool, {}, { clave, confirmar });
  if (r.modo === "rechazar") {
    return {
      contentJSON: jsonRechazoConfirmacion(r),
      accion: {
        tool,
        estado: "rechazada",
        resumen,
        seccion: "agenda",
        motivo: r.motivo,
        sugerencia: r.sugerencia,
      },
    };
  }
  if (r.modo === "ejecutar") return ejecutarPorTexto(ctx, r.pendiente, DOMINIO_AGENDA);
  // `emitir` no puede pasar con clave (resolverConfirmacion sólo emite sin
  // clave ni confirmar), pero el tipo lo contempla.
  return invalido(
    "No se pudo resolver la confirmación.",
    "Emití la acción de nuevo sin clave para que el abogado vea la vista previa.",
  );
}

// ============================================================================
// Las tools
// ============================================================================

export async function ejecutarToolAgenda(
  nombre: string,
  input: unknown,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  const args = (input ?? {}) as Record<string, unknown>;

  switch (nombre) {
    case AGENDA_TOOL_NAMES.buscar:
      return buscarEvento(args, ctx);
    case AGENDA_TOOL_NAMES.crear:
      return crearEvento(args, ctx);
    case AGENDA_TOOL_NAMES.editar:
      return editarEvento(args, ctx);
    case AGENDA_TOOL_NAMES.eliminar:
      return eliminarEvento(args, ctx);
    default:
      return {
        contentJSON: `Error: "${nombre}" no es una tool de agenda.`,
        isError: true,
      };
  }
}

// --- agenda_buscar_evento -----------------------------------------------------

async function buscarEvento(
  args: Record<string, unknown>,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  const parseado = buscarSchema.safeParse(args);
  if (!parseado.success) {
    return invalido(
      `Input inválido: ${detalleZod(parseado.error)}`,
      "texto (≤120), rango (uno de la lista) y caso_id (UUID) son opcionales.",
    );
  }
  const d = parseado.data;

  if (d.caso_id) {
    const nombre = await nombreCasoPropio(d.caso_id, ctx.usuarioId);
    if (nombre === null) return { contentJSON: JSON.stringify(RESPUESTA_CAUSA_AJENA) };
  }

  const rango = d.rango ? rangoAFechas(d.rango) : null;
  const eventos = await buscarEventos(ctx.usuarioId, {
    texto: d.texto ?? null,
    desde: rango?.desde ?? null,
    hasta: rango?.hasta ?? null,
    casoId: d.caso_id ?? null,
  });
  const candidatos = eventos.slice(0, MAX_CANDIDATOS).map(filaEvento);

  const nota =
    eventos.length === 0
      ? "Ningún evento cargado en la app coincide. Decíselo al abogado tal cual y, si él está seguro de que existe, aclarale que sólo ves lo cargado desde la app (lo creado en Google Calendar desde el celular no te llega)."
      : eventos.length === 1
        ? "Un solo candidato: ese es el evento_id que usás para editar o eliminar."
        : "Hay más de un candidato. Si el abogado se refería a uno en particular, preguntale cuál (con su fecha y hora) antes de editar o eliminar. Nunca elijas vos.";

  return {
    contentJSON: JSON.stringify({
      total: eventos.length,
      mostrados: candidatos.length,
      rango: rango?.etiqueta ?? "±60 días alrededor de hoy",
      candidatos,
      nota,
    }),
  };
}

// --- agenda_crear_evento -------------------------------------------------------

/** Lo que se persiste en la pendiente y se ejecuta al confirmar. */
type PayloadCrear = {
  evento: EventoAgendaInsert;
  /** true cuando la pendiente nació de un duplicado que el abogado ya vio. */
  forzar_duplicado: boolean;
};

function resumenCreado(e: Pick<EventoAgenda, "titulo" | "clase" | "fecha_inicio" | "todo_el_dia">): string {
  return `${e.clase === "tarea" ? "Tarea creada" : "Evento creado"}: ${e.titulo}, ${cuandoCorto(e)}`;
}

function vistaPreviaCrear(ev: EventoAgendaInsert, causa: string | null): Record<string, unknown> {
  return {
    titulo: ev.titulo,
    cuando: cuandoLegible({
      fecha_inicio: ev.fecha_inicio,
      fecha_fin: ev.fecha_fin ?? null,
      todo_el_dia: ev.todo_el_dia,
    }),
    clase: ev.clase,
    tipo: labelTipo(ev.tipo),
    prioridad: ev.prioridad,
    causa: causa ?? "Sin causa asociada",
    ...(ev.descripcion ? { descripcion: ev.descripcion } : {}),
    ...(ev.notas ? { notas: ev.notas } : {}),
    google:
      ev.clase === "tarea"
        ? "Las tareas no se sincronizan con Google."
        : "Se sincroniza con Google Calendar al crearlo.",
  };
}

async function crearEvento(
  args: Record<string, unknown>,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  const TOOL = AGENDA_TOOL_NAMES.crear;

  // Confirmación de una pendiente: vale la clave, no el input nuevo.
  const conf = confirmacionSchema.safeParse(args);
  if (conf.success && conf.data.clave) {
    return resolverPorClave(ctx, TOOL, conf.data.clave, conf.data.confirmar, "Crear evento");
  }

  const parseado = crearSchema.safeParse(args);
  if (!parseado.success) {
    return invalido(
      `Input inválido: ${detalleZod(parseado.error)}`,
      "titulo (1-300), clase ('evento'|'tarea'), tipo (de la lista) y fecha ('YYYY-MM-DD') son obligatorios; hora es 'HH:MM'; duracion_min entre 5 y 1440; caso_id un UUID.",
    );
  }
  const d = parseado.data;

  const fechas = armarFechasEvento(d);
  if ("error" in fechas) {
    return invalido(fechas.error, "Corregí la fecha/hora o preguntale al abogado.");
  }

  // El vencimiento sólo con la fecha que dictó el abogado: LEXIE no calcula
  // plazos, y este guard es lo que lo hace cumplir del lado del servidor.
  if (d.tipo === "vencimiento_procesal") {
    const dia = parsearFecha(d.fecha);
    if (!dia || !fechaDictada(ctx, dia)) {
      return {
        contentJSON: JSON.stringify({
          ok: false,
          motivo:
            "LEXIE no calcula plazos procesales: un vencimiento sólo se carga con la fecha que el abogado dictó, y esa fecha no aparece en sus mensajes.",
          sugerencia:
            "Decile que no calculás plazos y pedile la fecha exacta del vencimiento (día y mes). Si la dice, volvé a llamar con esa fecha.",
        }),
        accion: {
          tool: TOOL,
          estado: "rechazada",
          resumen: `Cargar vencimiento: ${d.titulo}`,
          seccion: "agenda",
          motivo: "La fecha del vencimiento no fue dictada por el abogado: LEXIE no calcula plazos.",
          sugerencia: "Pedile la fecha exacta.",
        },
      };
    }
  }

  let causa: string | null = null;
  if (d.caso_id) {
    causa = await nombreCasoPropio(d.caso_id, ctx.usuarioId);
    if (causa === null) return { contentJSON: JSON.stringify(RESPUESTA_CAUSA_AJENA) };
  }

  const candidato: EventoAgendaInsert = {
    titulo: d.titulo,
    descripcion: d.descripcion ?? null,
    tipo: d.tipo,
    clase: d.clase,
    prioridad: d.prioridad ?? "media",
    fecha_inicio: fechas.fecha_inicio,
    fecha_fin: fechas.fecha_fin,
    todo_el_dia: fechas.todo_el_dia,
    caso_id: d.caso_id ?? null,
    notas: d.clase === "tarea" ? null : (d.notas ?? null),
  };
  const validado = crearEventoAgendaSchema.safeParse(candidato);
  if (!validado.success) {
    return invalido(`Evento inválido: ${detalleZod(validado.error)}`, "Revisá fecha, hora y duración.");
  }
  const evento = validado.data;

  // Antes de agendar encima de algo, traer lo que el abogado movió en Google.
  await pullGoogleBestEffort(ctx.usuarioId, ctx.clerkUserId);

  const existente = await existeEventoSimilar(ctx.usuarioId, {
    titulo: evento.titulo,
    fechaInicioIso: evento.fecha_inicio,
    casoId: evento.caso_id ?? null,
    todoElDia: evento.todo_el_dia,
  });

  const payload: PayloadCrear = { evento, forzar_duplicado: existente !== null };
  const r = resolverConfirmacion(ctx, TOOL, payload, { clave: undefined, confirmar: d.confirmar });
  const resumenPendiente = `Crear ${evento.clase}: ${evento.titulo}, ${cuandoCorto(evento)}`;

  if (r.modo === "rechazar") {
    return {
      contentJSON: jsonRechazoConfirmacion(r),
      accion: {
        tool: TOOL,
        estado: "rechazada",
        resumen: resumenPendiente,
        seccion: "agenda",
        motivo: r.motivo,
        sugerencia: r.sugerencia,
      },
    };
  }
  if (r.modo === "ejecutar") return ejecutarPorTexto(ctx, r.pendiente, DOMINIO_AGENDA);

  // r.modo === "emitir": ¿directo, o pendiente?
  const vista = vistaPreviaCrear(evento, causa);
  const notas: string[] = [];
  if (existente) {
    notas.push(
      `Ya existe un evento igual ese día: «${existente.titulo}», ${cuandoLegible(existente)} (evento_id ${existente.id}). NO lo crees de nuevo por tu cuenta: decíselo al abogado y, sólo si igual quiere otro, que lo confirme.`,
    );
    vista.advertencia = `Ya existe uno igual: «${existente.titulo}», ${cuandoLegible(existente)}.`;
  }
  if (enCuarentena(ctx)) notas.push(NOTA_CUARENTENA);

  if (notas.length > 0) {
    const pend = emitirPendiente({
      tool: TOOL,
      clave: r.clave,
      resumen: resumenPendiente,
      seccion: "agenda",
      vista_previa: vista,
      payload,
      nota: notas.join(" "),
    });
    if (!existente) return pend;
    const base = JSON.parse(pend.contentJSON) as Record<string, unknown>;
    return {
      accion: pend.accion,
      contentJSON: JSON.stringify({
        ...base,
        motivo: "Ya hay un evento igual ese día (mismo título, causa y hora).",
        evento_existente: filaEvento(existente),
      }),
    };
  }

  // Directo.
  try {
    const creado = await crearEventoConSync(ctx.usuarioId, ctx.clerkUserId, evento);
    return respuestaCreado(creado.evento, creado.google);
  } catch (e) {
    return errorCrear(e, evento);
  }
}

function respuestaCreado(e: EventoAgenda, google: ResultadoGoogle): ResultadoToolLexie {
  const resumen = resumenCreado(e);
  return {
    contentJSON: JSON.stringify({
      ok: true,
      evento_id: e.id,
      titulo: e.titulo,
      clase: e.clase,
      tipo: labelTipo(e.tipo),
      cuando: cuandoLegible(e),
      causa: e.nombre_caso ?? null,
      google_synced: google.synced,
      google_motivo: google.motivo,
      nota: `${fraseGoogle(google, e.clase)} Decile al abogado la fecha completa con día de semana tal como viene en "cuando", y que lo ve en Agenda.`,
    }),
    accion: {
      tool: AGENDA_TOOL_NAMES.crear,
      estado: "ok",
      resumen,
      seccion: "agenda",
      vista_previa: {
        titulo: e.titulo,
        cuando: cuandoLegible(e),
        tipo: labelTipo(e.tipo),
        causa: e.nombre_caso ?? "Sin causa asociada",
        google: fraseGoogle(google, e.clase).split(" NO digas")[0],
      },
      datos: { href: HREF_AGENDA, evento_id: e.id, google_synced: google.synced },
    },
  };
}

function errorCrear(e: unknown, evento: EventoAgendaInsert): ResultadoToolLexie {
  if (e instanceof ErrorServicioAgenda && e.codigo === "caso_ajeno") {
    return { contentJSON: JSON.stringify(RESPUESTA_CAUSA_AJENA) };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return {
    contentJSON: JSON.stringify({ ok: false, motivo: `No se pudo crear el evento: ${msg}` }),
    isError: true,
    accion: {
      tool: AGENDA_TOOL_NAMES.crear,
      estado: "error",
      resumen: `No se creó «${evento.titulo}»`,
      seccion: "agenda",
      error: msg,
    },
  };
}

// --- agenda_editar_evento ------------------------------------------------------

type PayloadEditar = {
  evento_id: string;
  cambios: EventoAgendaUpdate;
};

// Columnas reales del evento que un patch puede tocar. Es lo que se guarda en
// `antes` (crudo, para comparar al ejecutar la pendiente) y lo que se compara
// contra la base: si alguna cambió desde que el abogado la vio, no se pisa.
const COLUMNAS_EDITABLES = [
  "titulo",
  "descripcion",
  "tipo",
  "prioridad",
  "fecha_inicio",
  "fecha_fin",
  "todo_el_dia",
  "caso_id",
  "notas",
  "completado",
] as const;
type ColumnaEditable = (typeof COLUMNAS_EDITABLES)[number];

function esColumnaEditable(k: string): k is ColumnaEditable {
  return (COLUMNAS_EDITABLES as readonly string[]).includes(k);
}

/** Snapshot crudo de las columnas que el patch toca, más lo legible. */
function snapshotAntes(e: EventoAgenda, patch: EventoAgendaUpdate): Record<string, unknown> {
  const out: Record<string, unknown> = { evento_id: e.id, cuando: cuandoLegible(e) };
  for (const k of Object.keys(patch)) {
    if (esColumnaEditable(k)) out[k] = e[k];
  }
  return out;
}

function mismoInstante(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  return new Date(String(a)).getTime() === new Date(String(b)).getTime();
}

/** ¿Alguna columna del snapshot cambió en la base desde que se emitió la pendiente? */
function cambioDesdeQueLoVio(antes: Record<string, unknown>, actual: EventoAgenda): string | null {
  for (const k of Object.keys(antes)) {
    if (!esColumnaEditable(k)) continue;
    const viejo = antes[k];
    const nuevo = actual[k];
    const igual =
      k === "fecha_inicio" || k === "fecha_fin"
        ? mismoInstante(viejo, nuevo)
        : (viejo ?? null) === (nuevo ?? null);
    if (!igual) return k;
  }
  return null;
}

/** El evento como quedaría con el patch aplicado (para la vista previa). */
function proyectar(e: EventoAgenda, patch: EventoAgendaUpdate): EventoAgenda {
  const out: EventoAgenda = { ...e };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || !esColumnaEditable(k)) continue;
    (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}

function valorLegible(k: ColumnaEditable, e: EventoAgenda, causa: string | null): string {
  switch (k) {
    case "fecha_inicio":
    case "fecha_fin":
    case "todo_el_dia":
      return cuandoLegible(e);
    case "tipo":
      return labelTipo(e.tipo);
    case "caso_id":
      return causa ?? (e.caso_id ? e.caso_id : "Sin causa");
    case "completado":
      return e.completado ? "Completado" : "Pendiente";
    default: {
      const v = e[k];
      return v == null || v === "" ? "(vacío)" : String(v);
    }
  }
}

/** Diff legible "antes → después", una entrada por campo tocado (las fechas colapsan en "cuando"). */
function diffLegible(
  antes: EventoAgenda,
  despues: EventoAgenda,
  patch: EventoAgendaUpdate,
  causaAntes: string | null,
  causaDespues: string | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(patch)) {
    if (!esColumnaEditable(k)) continue;
    const etiqueta = k === "fecha_inicio" || k === "fecha_fin" || k === "todo_el_dia" ? "cuando" : k;
    if (out[etiqueta]) continue;
    out[etiqueta] = `${valorLegible(k, antes, causaAntes)} → ${valorLegible(k, despues, causaDespues)}`;
  }
  return out;
}

const AVISO_PISA_GOOGLE =
  "El evento está en Google Calendar: la edición se refleja allá y pisa lo que se haya cambiado desde el celular.";

async function editarEvento(
  args: Record<string, unknown>,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  const TOOL = AGENDA_TOOL_NAMES.editar;

  const conf = confirmacionSchema.safeParse(args);
  if (conf.success && conf.data.clave) {
    return resolverPorClave(ctx, TOOL, conf.data.clave, conf.data.confirmar, "Editar evento");
  }

  const parseado = editarSchema.safeParse(args);
  if (!parseado.success) {
    return invalido(
      `Input inválido: ${detalleZod(parseado.error)}`,
      "evento_id (UUID) es obligatorio; en cambios van sólo los campos que cambian (fecha 'YYYY-MM-DD', hora 'HH:MM', caso_id UUID o null).",
    );
  }
  const d = parseado.data;
  const c = d.cambios;

  // Propiedad primero: getEventoById filtra por usuario, así que un id ajeno
  // es "no existe" y no se revela nada.
  const antes = await getEventoById(d.evento_id, ctx.usuarioId);
  if (!antes) return { contentJSON: JSON.stringify(RESPUESTA_EVENTO_INEXISTENTE) };

  let causaDespues: string | null = antes.nombre_caso ?? null;
  if (c.caso_id) {
    causaDespues = await nombreCasoPropio(c.caso_id, ctx.usuarioId);
    if (causaDespues === null) return { contentJSON: JSON.stringify(RESPUESTA_CAUSA_AJENA) };
  } else if (c.caso_id === null) {
    causaDespues = null;
  }

  // El patch: sólo lo que vino. Las fechas se recalculan si cambió cualquiera
  // de fecha/hora/duración/todo_el_dia, conservando lo que no se dijo.
  const patch: EventoAgendaUpdate = {};
  if (c.titulo !== undefined) patch.titulo = c.titulo;
  if (c.tipo !== undefined) patch.tipo = c.tipo;
  if (c.prioridad !== undefined) patch.prioridad = c.prioridad;
  if (c.descripcion !== undefined) patch.descripcion = c.descripcion;
  if (c.notas !== undefined) patch.notas = c.notas;
  if (c.completado !== undefined) patch.completado = c.completado;
  if (c.caso_id !== undefined) patch.caso_id = c.caso_id;

  const tocaFechas =
    c.fecha !== undefined ||
    c.hora !== undefined ||
    c.duracion_min !== undefined ||
    c.todo_el_dia !== undefined;
  if (tocaFechas) {
    const base = isoAPartesAR(antes.fecha_inicio);
    const fecha =
      c.fecha ?? `${base.y}-${p2(base.mo + 1)}-${p2(base.d)}`;
    // Una hora nueva convierte un evento de todo el día en uno con hora, salvo
    // que el modelo diga explícitamente todo_el_dia: true.
    const todoElDia =
      antes.clase === "tarea" ? true : (c.todo_el_dia ?? (c.hora !== undefined ? false : antes.todo_el_dia));
    const hora =
      c.hora ?? (antes.todo_el_dia ? null : fmtHora(base.h, base.mi));
    const fechas = armarFechasEvento({
      clase: antes.clase,
      fecha,
      hora,
      duracion_min: c.duracion_min ?? duracionActualMin(antes),
      todo_el_dia: todoElDia,
    });
    if ("error" in fechas) {
      return invalido(fechas.error, "Pasá hora ('HH:MM') o todo_el_dia: true, o preguntale al abogado.");
    }
    patch.fecha_inicio = fechas.fecha_inicio;
    patch.fecha_fin = fechas.fecha_fin;
    patch.todo_el_dia = fechas.todo_el_dia;
  }

  if (Object.keys(patch).length === 0) {
    return {
      contentJSON: JSON.stringify({
        ok: false,
        motivo: "No mandaste ningún cambio.",
        sugerencia: "Poné en `cambios` al menos un campo (titulo, fecha, hora, completado…).",
      }),
    };
  }
  const validado = editarEventoAgendaSchema.safeParse(patch);
  if (!validado.success) {
    return invalido(`Cambios inválidos: ${detalleZod(validado.error)}`, "Revisá fecha, hora y duración.");
  }

  const payload: PayloadEditar = { evento_id: antes.id, cambios: validado.data };
  const despuesPrevisto = proyectar(antes, validado.data);
  const diff = diffLegible(antes, despuesPrevisto, validado.data, antes.nombre_caso ?? null, causaDespues);
  const resumen = `Editar ${antes.clase}: ${antes.titulo}, ${cuandoCorto(antes)} (${Object.keys(diff).join(", ")})`;
  const snapshot = snapshotAntes(antes, validado.data);

  const r = resolverConfirmacion(ctx, TOOL, payload, { clave: undefined, confirmar: d.confirmar });
  if (r.modo === "rechazar") {
    return {
      contentJSON: jsonRechazoConfirmacion(r),
      accion: {
        tool: TOOL,
        estado: "rechazada",
        resumen,
        seccion: "agenda",
        motivo: r.motivo,
        sugerencia: r.sugerencia,
      },
    };
  }
  if (r.modo === "ejecutar") return ejecutarPorTexto(ctx, r.pendiente, DOMINIO_AGENDA);

  if (enCuarentena(ctx)) {
    return emitirPendiente({
      tool: TOOL,
      clave: r.clave,
      resumen,
      seccion: "agenda",
      vista_previa: {
        evento: antes.titulo,
        cuando: cuandoLegible(antes),
        cambios: diff,
        ...(antes.google_calendar_event_id ? { google: AVISO_PISA_GOOGLE } : {}),
      },
      payload,
      antes: snapshot,
      nota: NOTA_CUARENTENA,
    });
  }

  try {
    const res = await editarEventoConSync(antes.id, ctx.usuarioId, ctx.clerkUserId, validado.data);
    return respuestaEditado(res, antes, validado.data, snapshot, causaDespues);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      contentJSON: JSON.stringify({ ok: false, motivo: `No se pudo editar el evento: ${msg}` }),
      isError: true,
      accion: { tool: TOOL, estado: "error", resumen, seccion: "agenda", error: msg },
    };
  }
}

function respuestaEditado(
  res: Awaited<ReturnType<typeof editarEventoConSync>>,
  leido: EventoAgenda,
  patch: EventoAgendaUpdate,
  snapshot: Record<string, unknown>,
  causaDespues: string | null,
): ResultadoToolLexie {
  const TOOL = AGENDA_TOOL_NAMES.editar;
  if (!res.ok) {
    if (res.motivo === "caso_ajeno") return { contentJSON: JSON.stringify(RESPUESTA_CAUSA_AJENA) };
    if (res.motivo === "no_existe") {
      return {
        contentJSON: JSON.stringify({
          ok: false,
          motivo: "El evento ya no existe: se borró mientras lo editabas.",
          sugerencia: "Decíselo al abogado y volvé a buscarlo con agenda_buscar_evento.",
        }),
      };
    }
    return {
      contentJSON: JSON.stringify({
        ok: false,
        motivo: "No había nada para cambiar.",
        sugerencia: "Poné en `cambios` al menos un campo distinto del actual.",
      }),
    };
  }
  const { antes, despues, google } = res;
  const diff = diffLegible(antes, despues, patch, antes.nombre_caso ?? null, causaDespues);
  const enGoogle = !!antes.google_calendar_event_id;
  const resumen = `Evento editado: ${despues.titulo}, ${cuandoCorto(despues)} (${Object.keys(diff).join(", ")})`;
  return {
    contentJSON: JSON.stringify({
      ok: true,
      evento_id: despues.id,
      antes: { titulo: antes.titulo, cuando: cuandoLegible(antes), tipo: labelTipo(antes.tipo), causa: antes.nombre_caso ?? null, completado: antes.completado },
      despues: { titulo: despues.titulo, cuando: cuandoLegible(despues), tipo: labelTipo(despues.tipo), causa: despues.nombre_caso ?? null, completado: despues.completado },
      cambios: diff,
      google_synced: google.synced,
      google_motivo: google.motivo,
      ...(enGoogle ? { aviso: AVISO_PISA_GOOGLE } : {}),
      nota: enGoogle
        ? fraseGoogle(google, despues.clase)
        : "El evento no estaba en Google: el cambio queda sólo en la app. Relatá la fecha completa con día de semana tal como viene en `despues.cuando`.",
    }),
    accion: {
      tool: TOOL,
      estado: "ok",
      resumen,
      seccion: "agenda",
      vista_previa: { evento: despues.titulo, cuando: cuandoLegible(despues), cambios: diff },
      datos: { href: HREF_AGENDA, evento_id: despues.id, google_synced: google.synced },
      antes: snapshot,
    },
  };
}

// --- agenda_eliminar_evento ----------------------------------------------------

type PayloadEliminar = { evento_id: string };

function snapshotEliminar(e: EventoAgenda): Record<string, unknown> {
  return {
    evento_id: e.id,
    titulo: e.titulo,
    fecha_inicio: e.fecha_inicio,
    fecha_fin: e.fecha_fin,
    todo_el_dia: e.todo_el_dia,
    tipo: e.tipo,
    clase: e.clase,
    prioridad: e.prioridad,
    caso_id: e.caso_id,
    descripcion: e.descripcion,
    notas: e.notas,
    cuando: cuandoLegible(e),
    causa: e.nombre_caso ?? null,
    en_google: !!e.google_calendar_event_id,
  };
}

async function eliminarEvento(
  args: Record<string, unknown>,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  const TOOL = AGENDA_TOOL_NAMES.eliminar;

  const conf = confirmacionSchema.safeParse(args);
  if (conf.success && conf.data.clave) {
    return resolverPorClave(ctx, TOOL, conf.data.clave, conf.data.confirmar, "Eliminar evento");
  }

  const parseado = eliminarSchema.safeParse(args);
  if (!parseado.success) {
    return invalido(`Input inválido: ${detalleZod(parseado.error)}`, "evento_id tiene que ser el UUID que devolvió mi_agenda o agenda_buscar_evento.");
  }
  const d = parseado.data;

  const evento = await getEventoById(d.evento_id, ctx.usuarioId);
  if (!evento) return { contentJSON: JSON.stringify(RESPUESTA_EVENTO_INEXISTENTE) };

  const payload: PayloadEliminar = { evento_id: evento.id };
  const resumen = `Eliminar ${evento.clase}: ${evento.titulo}, ${cuandoCorto(evento)}`;
  const r = resolverConfirmacion(ctx, TOOL, payload, { clave: undefined, confirmar: d.confirmar });
  if (r.modo === "rechazar") {
    return {
      contentJSON: jsonRechazoConfirmacion(r),
      accion: {
        tool: TOOL,
        estado: "rechazada",
        resumen,
        seccion: "agenda",
        motivo: r.motivo,
        sugerencia: r.sugerencia,
      },
    };
  }
  if (r.modo === "ejecutar") return ejecutarPorTexto(ctx, r.pendiente, DOMINIO_AGENDA);

  const enGoogle = !!evento.google_calendar_event_id;
  return emitirPendiente({
    tool: TOOL,
    clave: r.clave,
    resumen,
    seccion: "agenda",
    vista_previa: {
      titulo: evento.titulo,
      cuando: cuandoLegible(evento),
      tipo: labelTipo(evento.tipo),
      clase: evento.clase,
      causa: evento.nombre_caso ?? "Sin causa asociada",
      google: enGoogle
        ? "Está en Google Calendar: se borra también de ahí."
        : "No está en Google Calendar.",
      ...(evento.completado ? { estado: "Ya está marcado como completado" } : {}),
    },
    payload,
    antes: snapshotEliminar(evento),
    nota:
      "Es irreversible. Si el abogado sólo quiere sacarlo de la vista porque ya pasó o ya lo hizo, ofrecé marcarlo completado con agenda_editar_evento {completado: true} en vez de borrarlo." +
      (enGoogle
        ? " Si al confirmar Google no lo puede borrar, no se borra tampoco de la app y te lo voy a decir."
        : ""),
  });
}

// ============================================================================
// Ejecución de pendientes (botón o texto): SIEMPRE el payload persistido
// ============================================================================

async function ejecutarPendienteAgenda(
  accion: AccionLexie,
  ctx: CtxEjecucion,
): Promise<AccionLexie | null> {
  switch (accion.tool) {
    case AGENDA_TOOL_NAMES.crear:
      return ejecutarCrearPendiente(accion, ctx);
    case AGENDA_TOOL_NAMES.editar:
      return ejecutarEditarPendiente(accion, ctx);
    case AGENDA_TOOL_NAMES.eliminar:
      return ejecutarEliminarPendiente(accion, ctx);
    default:
      return null;
  }
}

async function ejecutarCrearPendiente(accion: AccionLexie, ctx: CtxEjecucion): Promise<AccionLexie> {
  const p = (accion.payload ?? {}) as Partial<PayloadCrear>;
  // El payload viene de metadata jsonb persistida: se re-valida como cualquier
  // input, no se le cree por haber sido nuestro.
  const validado = crearEventoAgendaSchema.safeParse(p.evento);
  if (!validado.success) {
    return resolverPendiente(accion, {
      estado: "error",
      error: `La pendiente no tiene un evento válido: ${detalleZod(validado.error)}`,
    });
  }
  const evento = validado.data;

  await pullGoogleBestEffort(ctx.usuarioId, ctx.clerkUserId);

  // Si la pendiente NO nació de un duplicado (fue la cuarentena), un igual que
  // haya aparecido mientras tanto la frena: el abogado no lo vio.
  if (p.forzar_duplicado !== true) {
    const existente = await existeEventoSimilar(ctx.usuarioId, {
      titulo: evento.titulo,
      fechaInicioIso: evento.fecha_inicio,
      casoId: evento.caso_id ?? null,
      todoElDia: evento.todo_el_dia,
    });
    if (existente) {
      return resolverPendiente(accion, {
        estado: "rechazada",
        motivo: `Ya existe un evento igual ese día: «${existente.titulo}», ${cuandoLegible(existente)}.`,
        sugerencia: "Mostráselo al abogado y, si igual quiere otro, emití la creación de nuevo para que la confirme.",
      });
    }
  }

  try {
    const creado = await crearEventoConSync(ctx.usuarioId, ctx.clerkUserId, evento);
    const e = creado.evento;
    return resolverPendiente(accion, {
      estado: "ok",
      resumen: resumenCreado(e),
      vista_previa: {
        titulo: e.titulo,
        cuando: cuandoLegible(e),
        tipo: labelTipo(e.tipo),
        causa: e.nombre_caso ?? "Sin causa asociada",
        google: fraseGoogle(creado.google, e.clase).split(" NO digas")[0],
      },
      datos: { href: HREF_AGENDA, evento_id: e.id, google_synced: creado.google.synced },
    });
  } catch (e) {
    if (e instanceof ErrorServicioAgenda && e.codigo === "caso_ajeno") {
      return resolverPendiente(accion, {
        estado: "rechazada",
        motivo: "La causa asociada ya no existe entre las causas del abogado.",
        sugerencia: "Volvé a emitir la creación sin causa o con la causa correcta.",
      });
    }
    return resolverPendiente(accion, {
      estado: "error",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function ejecutarEditarPendiente(accion: AccionLexie, ctx: CtxEjecucion): Promise<AccionLexie> {
  const p = (accion.payload ?? {}) as Partial<PayloadEditar>;
  if (typeof p.evento_id !== "string") {
    return resolverPendiente(accion, { estado: "error", error: "La pendiente no tiene evento_id." });
  }
  const validado = editarEventoAgendaSchema.safeParse(p.cambios ?? {});
  if (!validado.success || Object.keys(validado.data).length === 0) {
    return resolverPendiente(accion, {
      estado: "error",
      error: `La pendiente no tiene cambios válidos${validado.success ? "" : `: ${detalleZod(validado.error)}`}.`,
    });
  }

  const actual = await getEventoById(p.evento_id, ctx.usuarioId);
  if (!actual) {
    return resolverPendiente(accion, {
      estado: "rechazada",
      motivo: "El evento ya no está en la agenda.",
      sugerencia: "Decíselo al abogado; no hay nada que editar.",
    });
  }
  const campo = accion.antes ? cambioDesdeQueLoVio(accion.antes, actual) : null;
  if (campo) {
    return resolverPendiente(accion, {
      estado: "rechazada",
      motivo: `Cambió desde que lo viste: el campo «${campo}» ya no es el que se mostró en la vista previa.`,
      sugerencia: "Mostrale al abogado el estado actual del evento y volvé a emitir la edición.",
    });
  }

  try {
    const res = await editarEventoConSync(p.evento_id, ctx.usuarioId, ctx.clerkUserId, validado.data);
    if (!res.ok) {
      const motivo =
        res.motivo === "no_existe"
          ? "El evento se borró mientras se ejecutaba la edición."
          : res.motivo === "caso_ajeno"
            ? "La causa asociada ya no existe entre las causas del abogado."
            : "No había nada para cambiar.";
      return resolverPendiente(accion, { estado: "rechazada", motivo, sugerencia: "Decíselo al abogado tal cual." });
    }
    const { antes, despues, google } = res;
    const diff = diffLegible(antes, despues, validado.data, antes.nombre_caso ?? null, despues.nombre_caso ?? null);
    return resolverPendiente(accion, {
      estado: "ok",
      resumen: `Evento editado: ${despues.titulo}, ${cuandoCorto(despues)} (${Object.keys(diff).join(", ")})`,
      vista_previa: { evento: despues.titulo, cuando: cuandoLegible(despues), cambios: diff },
      datos: { href: HREF_AGENDA, evento_id: despues.id, google_synced: google.synced },
      antes: accion.antes ?? snapshotAntes(antes, validado.data),
    });
  } catch (e) {
    return resolverPendiente(accion, { estado: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

async function ejecutarEliminarPendiente(accion: AccionLexie, ctx: CtxEjecucion): Promise<AccionLexie> {
  const p = (accion.payload ?? {}) as Partial<PayloadEliminar>;
  if (typeof p.evento_id !== "string") {
    return resolverPendiente(accion, { estado: "error", error: "La pendiente no tiene evento_id." });
  }

  const actual = await getEventoById(p.evento_id, ctx.usuarioId);
  if (!actual) {
    return resolverPendiente(accion, {
      estado: "rechazada",
      motivo: "El evento ya no está en la agenda: no hay nada que eliminar.",
      sugerencia: "Decíselo al abogado tal cual.",
    });
  }
  // Lo que el abogado confirmó es lo que VIO: si el título o la fecha ya no
  // son esos, no se borra otra cosa en su nombre.
  const a = accion.antes ?? {};
  if (
    (typeof a.titulo === "string" && a.titulo !== actual.titulo) ||
    (a.fecha_inicio !== undefined && !mismoInstante(a.fecha_inicio, actual.fecha_inicio))
  ) {
    return resolverPendiente(accion, {
      estado: "rechazada",
      motivo: `Cambió desde que lo viste: ahora es «${actual.titulo}», ${cuandoLegible(actual)}.`,
      sugerencia: "Mostrale al abogado el evento actual y, si igual quiere borrarlo, volvé a emitir la eliminación.",
    });
  }

  try {
    const res = await eliminarEventoConSync(p.evento_id, ctx.usuarioId, ctx.clerkUserId, {
      siGoogleFalla: "abortar",
    });
    if (!res.ok) {
      if (res.motivo === "google_fallo") {
        return resolverPendiente(accion, {
          estado: "rechazada",
          motivo: `Google Calendar no pudo borrar el evento (${res.detalle ?? "sin detalle"}), así que tampoco se borró de la app: no se deja un evento fantasma en el celular.`,
          sugerencia:
            "Decíselo al abogado y ofrecé la alternativa: marcarlo como completado con agenda_editar_evento {completado: true}, o borrarlo él desde Google Calendar y después desde Agenda.",
        });
      }
      return resolverPendiente(accion, {
        estado: "rechazada",
        motivo: "El evento ya no está en la agenda: se borró mientras tanto.",
        sugerencia: "Decíselo al abogado tal cual.",
      });
    }
    const e = res.eliminado;
    return resolverPendiente(accion, {
      estado: "ok",
      resumen: `Evento eliminado: ${e.titulo}, ${cuandoCorto(e)}`,
      vista_previa: {
        titulo: e.titulo,
        cuando: cuandoLegible(e),
        google: res.google.synced
          ? `Borrado también de Google Calendar${res.google.detalle ? ` (${res.google.detalle})` : ""}.`
          : res.google.motivo === "no_aplica"
            ? "No estaba en Google Calendar."
            : `No se pudo tocar Google (${res.google.motivo}); borrado sólo de la app.`,
      },
      datos: { href: HREF_AGENDA, evento_id: e.id, google_synced: res.google.synced },
    });
  } catch (e) {
    return resolverPendiente(accion, { estado: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

// ============================================================================
// El dominio
// ============================================================================

const CAP_AGENDA_LECTURA = 4;
const CAP_AGENDA_ESCRITURA = 3;
const CAP_AGENDA_ELIMINACION = 1;

// Lo específico del dominio que el system no dice. Reversibilidad,
// cuarentena, desambiguación y «nunca digas que hiciste» ya están en
// «CÓMO ACTUÁS»; los plazos, en «PLAZOS PROCESALES».
export const PROMPT_AGENDA =
  "AGENDA: BUSCAR, DESAMBIGUAR, MUTAR, RELATAR. El `evento_id` lo devuelven `mi_agenda` y `agenda_buscar_evento`; la agenda del contexto NO trae ids. " +
  "Relatá el resultado con la fecha completa y el día de semana tal como te la devolvió la herramienta («queda para el martes 10/09 a las 10:00»), sin recalcularla. " +
  "FECHAS: «el martes» o «la semana que viene» se resuelven con la fecha de hoy del contexto, y se lo decís con el número. Si no dijo la hora de un evento, preguntala. Si le pisa otra cosa a esa hora, avisale. " +
  "VENCIMIENTOS: sólo con la fecha que el abogado dictó; si no la dijo, pedísela. " +
  "ELIMINAR: antes de proponerlo, ofrecé marcarlo completado; si ya pasó o ya se hizo, eso es lo que suele querer. " +
  "GOOGLE: decí «sincronizado con tu Google Calendar» SOLO si la herramienta devolvió google_synced: true; si no, quedó en la app y repetí el motivo que te dio. " +
  "Si editás algo que está en Google, avisale que pisa lo que haya tocado desde el celular.";

export const MANUAL_AGENDA =
  "AGENDA (dónde se ve lo que hiciste): menú «Agenda», agrupado por día, con filtros por rango, clase y causa. " +
  "Marcar completado no borra: queda tachado, y la casilla de la tarjeta lo vuelve a pendiente.";

export const DOMINIO_AGENDA: DominioLexie = {
  nombre: "agenda",
  familias: (): FamiliaLexie[] => [
    {
      nombre: "agenda_lectura",
      tools: agendaLecturaTools,
      cap: CAP_AGENDA_LECTURA,
      paralelizable: true,
      mensajeCapAgotado: `Alcanzaste el límite de ${CAP_AGENDA_LECTURA} búsquedas en la agenda en este mensaje. Trabajá con los candidatos que ya tenés o pedile al abogado que precise.`,
      avisoCapAgotado: `Alcanzaste el límite de búsquedas en la agenda (${CAP_AGENDA_LECTURA}) en este mensaje.`,
      ejecutar: (tu, c) => ejecutarToolAgenda(tu.name, tu.input, c),
    },
    {
      nombre: "agenda_escritura",
      tools: agendaEscrituraTools,
      cap: CAP_AGENDA_ESCRITURA,
      // Mutaciones: en serie, para que la segunda vea lo que creó la primera
      // (y el dedupe funcione dentro del mismo turno).
      paralelizable: false,
      mensajeCapAgotado: `Ya hiciste ${CAP_AGENDA_ESCRITURA} cambios en la agenda en este mensaje. Contale al abogado lo que quedó hecho y, si falta algo, que te lo pida en el próximo.`,
      avisoCapAgotado: `Alcanzaste el límite de cambios en la agenda (${CAP_AGENDA_ESCRITURA}) en este mensaje.`,
      ejecutar: (tu, c) => ejecutarToolAgenda(tu.name, tu.input, c),
    },
    {
      nombre: "agenda_eliminacion",
      tools: agendaEliminacionTools,
      cap: CAP_AGENDA_ELIMINACION,
      // Irreversible: una por turno, en serie.
      paralelizable: false,
      mensajeCapAgotado:
        "Ya propusiste o ejecutaste una eliminación en este mensaje. Si el abogado quiere borrar otro evento, que te lo pida en el próximo.",
      avisoCapAgotado: "Ya usaste la eliminación de agenda en este mensaje.",
      ejecutar: (tu, c) => ejecutarToolAgenda(tu.name, tu.input, c),
    },
  ],
  ejecutarPendiente: ejecutarPendienteAgenda,
  prompt: PROMPT_AGENDA,
  manual: MANUAL_AGENDA,
};
