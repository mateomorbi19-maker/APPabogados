// Acceso a datos del Simulador de Audiencias. Mismo split que
// mapa-procesal (simulacion.ts = modelo, queries.ts = DB): las rutas quedan
// finas y la lógica de ownership/persistencia no se triplica entre los tres
// endpoints.
//
// OWNERSHIP: ninguna de las dos tablas tiene usuario_id (decisión de la
// migración 20260721120000). La pertenencia se resuelve por join !inner a
// casos.usuario_id, y el "no es tuyo" se responde 404 —no 403— para no
// revelar existencia, igual que validarConversacionActiva en el chat.
import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import { calcularCosto, type Usage } from "@/lib/agent/pricing";
import type {
  EmisorTurno,
  SimulacionAudiencia,
  TurnoSimulacion,
} from "@/lib/types";
import type { ConfigSesion } from "./contexto";

const COLS_SIM =
  "id, caso_id, tipo_audiencia, rol_usuario, dificultad, magistrado_perfil, estado, debriefing, creada_en, actualizada_en, finalizada_en";
const COLS_TURNO =
  "id, simulacion_id, emisor, emisor_nombre, contenido, metadata, ejecucion_id, creado_en";

export async function casoPerteneceAUsuario(
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
  if (error) throw new Error(`casoPerteneceAUsuario: ${error.message}`);
  return data !== null;
}

// Devuelve la simulación solo si pertenece al caso Y el caso al usuario.
// null = no existe o no es suya (el caller responde 404 en ambos casos).
export async function getSimulacionOwned(
  casoId: string,
  simId: string,
  usuarioId: string,
): Promise<SimulacionAudiencia | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("simulaciones_audiencia")
    .select(`${COLS_SIM}, casos!inner(usuario_id)`)
    .eq("id", simId)
    .eq("caso_id", casoId)
    .maybeSingle();
  if (error) throw new Error(`getSimulacionOwned: ${error.message}`);
  if (!data) return null;

  // El join viene como objeto o array de uno según cómo lo resuelva PostgREST.
  const row = data as unknown as Record<string, unknown> & {
    casos: { usuario_id: string } | { usuario_id: string }[];
  };
  const dueno = Array.isArray(row.casos)
    ? row.casos[0]?.usuario_id
    : row.casos?.usuario_id;
  if (dueno !== usuarioId) return null;

  // La fila que devolvemos no lleva el join.
  const sim: Record<string, unknown> = { ...row };
  delete sim.casos;
  return sim as unknown as SimulacionAudiencia;
}

// Marca como 'abandonada' la simulación en curso del caso (si hay). Se llama
// ANTES de insertar la nueva: el partial unique index de la migración
// 20260721140000 rechaza dos 'en_curso' sobre el mismo caso.
export async function abandonarEnCurso(casoId: string): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("simulaciones_audiencia")
    .update({ estado: "abandonada", actualizada_en: new Date().toISOString() })
    .eq("caso_id", casoId)
    .eq("estado", "en_curso");
  if (error) throw new Error(`abandonarEnCurso: ${error.message}`);
}

export async function crearSimulacion(
  casoId: string,
  config: ConfigSesion,
): Promise<SimulacionAudiencia> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("simulaciones_audiencia")
    .insert({
      caso_id: casoId,
      rol_usuario: config.rol_usuario,
      dificultad: config.dificultad,
      magistrado_perfil: config.magistrado_perfil,
    })
    .select(COLS_SIM)
    .single();
  if (error) throw new Error(`crearSimulacion: ${error.message}`);
  return data as SimulacionAudiencia;
}

export async function getTurnos(simId: string): Promise<TurnoSimulacion[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("turnos_simulacion")
    .select(COLS_TURNO)
    .eq("simulacion_id", simId)
    .order("creado_en", { ascending: true });
  if (error) throw new Error(`getTurnos: ${error.message}`);
  return (data ?? []) as TurnoSimulacion[];
}

export async function insertarTurno(input: {
  simulacionId: string;
  emisor: EmisorTurno;
  contenido: string;
  metadata?: Record<string, unknown>;
  ejecucionId?: string | null;
}): Promise<TurnoSimulacion> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("turnos_simulacion")
    .insert({
      simulacion_id: input.simulacionId,
      emisor: input.emisor,
      contenido: input.contenido,
      metadata: input.metadata ?? {},
      ejecucion_id: input.ejecucionId ?? null,
    })
    .select(COLS_TURNO)
    .single();
  if (error) throw new Error(`insertarTurno: ${error.message}`);
  return data as TurnoSimulacion;
}

// Tracking de tokens. Se llama SIEMPRE que hubo respuesta del SDK, incluso si
// el parseo posterior falló (mismo criterio que /mapa/simular). Devuelve el id
// de la ejecución para linkearlo al turno, o null si el insert falló: perder
// el link no debe tumbar un turno que el abogado ya vio.
export async function registrarEjecucion(input: {
  usuarioId: string;
  modelo: string;
  usage: Usage;
  latenciaMs: number;
  metadata: Record<string, unknown>;
}): Promise<string | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("ejecuciones")
    .insert({
      usuario_id: input.usuarioId,
      tipo: "simular_audiencia",
      modelo: input.modelo,
      input_tokens: input.usage.input_tokens,
      output_tokens: input.usage.output_tokens,
      costo_usd: calcularCosto(input.modelo, input.usage),
      latencia_ms: input.latenciaMs,
      metadata: {
        ...input.metadata,
        cache_creation_input_tokens: input.usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: input.usage.cache_read_input_tokens ?? 0,
      },
    })
    .select("id")
    .single();
  if (error) {
    console.error("[simulador] insert ejecución falló:", error);
    return null;
  }
  return (data as { id: string }).id;
}

export async function cerrarSimulacion(
  simId: string,
  debriefing: Record<string, unknown>,
): Promise<SimulacionAudiencia> {
  const supabase = createServerClient();
  const ahora = new Date().toISOString();
  const { data, error } = await supabase
    .from("simulaciones_audiencia")
    .update({
      estado: "finalizada",
      debriefing,
      finalizada_en: ahora,
      actualizada_en: ahora,
    })
    .eq("id", simId)
    .select(COLS_SIM)
    .single();
  if (error) throw new Error(`cerrarSimulacion: ${error.message}`);
  return data as SimulacionAudiencia;
}
