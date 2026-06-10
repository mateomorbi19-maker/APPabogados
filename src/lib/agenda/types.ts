// Tipos, constantes de presentación y schemas de validación de la feature Agenda.
// Las zod schemas de input (crear/editar) viven acá para co-locar todo lo de
// agenda en el módulo; los tipos Insert/Update se infieren de ellas.

import { z } from "zod";

export const TIPOS_EVENTO_VALUES = [
  "audiencia",
  "vencimiento_procesal",
  "presentacion_escrito",
  "reunion_cliente",
  "tramite_administrativo",
  "visita_detenido",
  "otro",
] as const;

export type TipoEvento = (typeof TIPOS_EVENTO_VALUES)[number];

// Metadata de presentación por tipo. Las clases Tailwind se guardan COMPLETAS
// (literales) a propósito: Tailwind v4 detecta clases por escaneo de strings en
// el código fuente, así que `bg-${color}-500/10` construido en runtime NO se
// generaría. Tonos suaves /10 sobre dark (la app es dark-only) en vez de los
// `bg-{c}-100 text-{c}-700` del spec, que son para light mode y se verían
// quemados sobre #0a0e17.
export type TipoEventoMeta = {
  label: string;
  /** Clases del badge (bg + text + border). */
  badge: string;
  /** Clase del borde izquierdo de la card. */
  borde: string;
  /** Clase de fondo del puntito/indicador. */
  dot: string;
};

export const TIPOS_EVENTO: Record<TipoEvento, TipoEventoMeta> = {
  audiencia: {
    label: "Audiencia",
    badge: "bg-blue-500/10 text-blue-300 border-blue-500/20",
    borde: "border-l-blue-500",
    dot: "bg-blue-500",
  },
  vencimiento_procesal: {
    label: "Vencimiento procesal",
    badge: "bg-rose-500/10 text-rose-300 border-rose-500/20",
    borde: "border-l-rose-500",
    dot: "bg-rose-500",
  },
  presentacion_escrito: {
    label: "Presentación de escrito",
    badge: "bg-amber-500/10 text-amber-300 border-amber-500/20",
    borde: "border-l-amber-500",
    dot: "bg-amber-500",
  },
  reunion_cliente: {
    label: "Reunión con cliente",
    badge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    borde: "border-l-emerald-500",
    dot: "bg-emerald-500",
  },
  tramite_administrativo: {
    label: "Trámite administrativo",
    badge: "bg-slate-500/10 text-slate-300 border-slate-500/20",
    borde: "border-l-slate-500",
    dot: "bg-slate-500",
  },
  visita_detenido: {
    label: "Visita a detenido",
    badge: "bg-violet-500/10 text-violet-300 border-violet-500/20",
    borde: "border-l-violet-500",
    dot: "bg-violet-500",
  },
  otro: {
    label: "Otro",
    badge: "bg-zinc-500/10 text-zinc-300 border-zinc-500/20",
    borde: "border-l-zinc-500",
    dot: "bg-zinc-500",
  },
};

export function tipoLabel(tipo: string): string {
  return (TIPOS_EVENTO as Record<string, TipoEventoMeta>)[tipo]?.label ?? tipo;
}

// Opción de caso para los selects/filtros del UI (id + titulo).
export type CasoOption = { id: string; titulo: string };

// Fila completa de eventos_agenda. `nombre_caso` NO es columna: es un
// enriquecimiento del query (titulo del caso asociado, si tiene caso_id).
export type EventoAgenda = {
  id: string;
  usuario_id: string;
  caso_id: string | null;
  titulo: string;
  descripcion: string | null;
  tipo: TipoEvento;
  fecha_inicio: string; // ISO TIMESTAMPTZ
  fecha_fin: string | null;
  todo_el_dia: boolean;
  google_calendar_event_id: string | null;
  notas: string | null;
  completado: boolean;
  created_at: string;
  updated_at: string;
  nombre_caso?: string | null;
};

// === Validación de input (zod en el borde de las API routes) ===

export const tipoEventoSchema = z.enum(TIPOS_EVENTO_VALUES);

// Base sin defaults: así `.partial()` para el PATCH no reinyecta valores
// cuando el campo se omite (un default acá pisaría el tipo a 'otro' en cada
// edición que no mande tipo). Los campos opcionales son nullish (null | undefined)
// para tolerar "Sin caso", descripcion/notas vacías, etc.
const eventoAgendaBaseSchema = z.object({
  titulo: z.string().trim().min(1, "El título es obligatorio").max(300),
  descripcion: z.string().max(5000).nullish(),
  tipo: tipoEventoSchema,
  fecha_inicio: z.string().datetime({ offset: true }),
  fecha_fin: z.string().datetime({ offset: true }).nullish(),
  todo_el_dia: z.boolean(),
  caso_id: z.string().uuid().nullish(),
  notas: z.string().max(5000).nullish(),
});

// Si vienen ambas fechas, fin no puede ser anterior a inicio.
const finNoAnteriorAInicio = (d: {
  fecha_inicio?: string;
  fecha_fin?: string | null;
}) =>
  !d.fecha_inicio || !d.fecha_fin
    ? true
    : new Date(d.fecha_fin).getTime() >= new Date(d.fecha_inicio).getTime();

const FIN_INVALIDO = {
  message: "La fecha de fin no puede ser anterior a la de inicio",
  path: ["fecha_fin"],
};

export const crearEventoAgendaSchema = eventoAgendaBaseSchema.refine(
  finNoAnteriorAInicio,
  FIN_INVALIDO,
);
export type EventoAgendaInsert = z.infer<typeof crearEventoAgendaSchema>;

export const editarEventoAgendaSchema = eventoAgendaBaseSchema
  .partial()
  .extend({ completado: z.boolean().optional() })
  .refine(finNoAnteriorAInicio, FIN_INVALIDO);
export type EventoAgendaUpdate = z.infer<typeof editarEventoAgendaSchema>;
