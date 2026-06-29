import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import type { ClaseEvento, EventoAgenda, Prioridad, TipoEvento } from "./types";

// Columnas de eventos_agenda (sin el join). nombre_caso se arma aparte.
const COLS =
  "id, usuario_id, caso_id, titulo, descripcion, tipo, clase, prioridad, fecha_inicio, fecha_fin, todo_el_dia, google_calendar_event_id, google_updated, notas, completado, created_at, updated_at";

// Mismo set + embed del titulo del caso asociado vía la FK caso_id -> casos.id.
const COLS_CON_CASO = `${COLS}, casos(titulo)`;

// Forma cruda que devuelve supabase cuando embebe `casos(titulo)`: relación
// to-one, así que es objeto o null.
type FilaConCaso = Omit<EventoAgenda, "nombre_caso"> & {
  casos: { titulo: string } | null;
};

function mapFila(f: FilaConCaso): EventoAgenda {
  const { casos, ...rest } = f;
  return { ...rest, nombre_caso: casos?.titulo ?? null };
}

export type EventoFiltros = {
  caso_id?: string | null;
  clase?: ClaseEvento | null;
  tipo?: TipoEvento[] | null;
  desde?: string | null; // ISO; filtra fecha_inicio >= desde
  hasta?: string | null; // ISO; filtra fecha_inicio <= hasta
};

export async function getEventosByUser(
  usuarioId: string,
  filtros: EventoFiltros = {},
): Promise<EventoAgenda[]> {
  const supabase = createServerClient();
  let q = supabase
    .from("eventos_agenda")
    .select(COLS_CON_CASO)
    .eq("usuario_id", usuarioId);

  if (filtros.caso_id) q = q.eq("caso_id", filtros.caso_id);
  if (filtros.clase) q = q.eq("clase", filtros.clase);
  if (filtros.tipo && filtros.tipo.length > 0) q = q.in("tipo", filtros.tipo);
  if (filtros.desde) q = q.gte("fecha_inicio", filtros.desde);
  if (filtros.hasta) q = q.lte("fecha_inicio", filtros.hasta);

  const { data, error } = await q.order("fecha_inicio", { ascending: true });
  if (error) throw new Error(`getEventosByUser: ${error.message}`);
  return ((data ?? []) as unknown as FilaConCaso[]).map(mapFila);
}

export async function getEventoById(
  id: string,
  usuarioId: string,
): Promise<EventoAgenda | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("eventos_agenda")
    .select(COLS_CON_CASO)
    .eq("id", id)
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  if (error) throw new Error(`getEventoById: ${error.message}`);
  return data ? mapFila(data as unknown as FilaConCaso) : null;
}

export type CrearEventoData = {
  usuario_id: string;
  titulo: string;
  descripcion: string | null;
  tipo: TipoEvento;
  clase: ClaseEvento;
  prioridad: Prioridad;
  fecha_inicio: string;
  fecha_fin: string | null;
  todo_el_dia: boolean;
  caso_id: string | null;
  notas: string | null;
};

export async function createEvento(
  data: CrearEventoData,
): Promise<EventoAgenda> {
  const supabase = createServerClient();
  const { data: row, error } = await supabase
    .from("eventos_agenda")
    .insert(data)
    .select(COLS_CON_CASO)
    .single();
  if (error || !row) {
    throw new Error(`createEvento: ${error?.message ?? "sin fila"}`);
  }
  return mapFila(row as unknown as FilaConCaso);
}

// Campos editables (sin usuario_id/id). updated_at lo setea esta función.
export type ActualizarEventoData = Partial<{
  titulo: string;
  descripcion: string | null;
  tipo: TipoEvento;
  prioridad: Prioridad;
  fecha_inicio: string;
  fecha_fin: string | null;
  todo_el_dia: boolean;
  caso_id: string | null;
  notas: string | null;
  completado: boolean;
}>;

export async function updateEvento(
  id: string,
  usuarioId: string,
  patch: ActualizarEventoData,
): Promise<EventoAgenda | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("eventos_agenda")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("usuario_id", usuarioId)
    .select(COLS_CON_CASO)
    .maybeSingle();
  if (error) throw new Error(`updateEvento: ${error.message}`);
  return data ? mapFila(data as unknown as FilaConCaso) : null;
}

// Borra validando ownership y devuelve la fila borrada (RETURNING), para que
// el caller tenga el google_calendar_event_id y pueda borrarlo de Google.
export async function deleteEvento(
  id: string,
  usuarioId: string,
): Promise<EventoAgenda | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("eventos_agenda")
    .delete()
    .eq("id", id)
    .eq("usuario_id", usuarioId)
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(`deleteEvento: ${error.message}`);
  return data ? { ...(data as unknown as EventoAgenda), nombre_caso: null } : null;
}

export async function getEventosSinSincronizar(
  usuarioId: string,
): Promise<EventoAgenda[]> {
  const supabase = createServerClient();
  // Solo EVENTOS: las tareas no se sincronizan con Google Calendar.
  const { data, error } = await supabase
    .from("eventos_agenda")
    .select(COLS_CON_CASO)
    .eq("usuario_id", usuarioId)
    .eq("clase", "evento")
    .is("google_calendar_event_id", null)
    .order("fecha_inicio", { ascending: true });
  if (error) throw new Error(`getEventosSinSincronizar: ${error.message}`);
  return ((data ?? []) as unknown as FilaConCaso[]).map(mapFila);
}

export async function updateGoogleEventId(
  id: string,
  usuarioId: string,
  googleEventId: string,
  googleUpdated?: string | null,
): Promise<void> {
  // Doble filtro id + usuario_id por defensa en profundidad, igual que el resto
  // de las queries (los call sites ya son user-filtered, pero no dependemos de eso).
  const supabase = createServerClient();
  const patch: { google_calendar_event_id: string; google_updated?: string | null } =
    { google_calendar_event_id: googleEventId };
  // Solo seteamos google_updated si Google devolvió un timestamp (para no pisar
  // con null un valor previo).
  if (googleUpdated != null) patch.google_updated = googleUpdated;
  const { error } = await supabase
    .from("eventos_agenda")
    .update(patch)
    .eq("id", id)
    .eq("usuario_id", usuarioId);
  if (error) throw new Error(`updateGoogleEventId: ${error.message}`);
}

// Persiste el `updated` de Google tras un push de edición (PUT). Aísla el
// control de conflicto del pull de los cambios que originó la propia app.
export async function setGoogleUpdated(
  id: string,
  usuarioId: string,
  googleUpdated: string,
): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("eventos_agenda")
    .update({ google_updated: googleUpdated })
    .eq("id", id)
    .eq("usuario_id", usuarioId);
  if (error) throw new Error(`setGoogleUpdated: ${error.message}`);
}

// Valida que un caso exista y pertenezca al usuario (para asociar un evento).
export async function casoEsDelUsuario(
  casoId: string,
  usuarioId: string,
): Promise<boolean> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("casos")
    .select("id")
    .eq("id", casoId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  if (error) throw new Error(`casoEsDelUsuario: ${error.message}`);
  return data !== null;
}
