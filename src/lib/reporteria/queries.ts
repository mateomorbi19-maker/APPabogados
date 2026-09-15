import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import {
  contarMarcasReporte,
  type CanalReporte,
  type PlantillaReporte,
  type ReporteCliente,
  type ReporteClienteLista,
} from "./types";

// Acceso a datos de `reportes_cliente`. Mismas reglas que escritos/queries.ts:
//
// - El server entra con service_role (bypassa RLS), así que `usuarioId` va
//   COMO PREDICADO de cada query, junto con `caso_id` y `id`. Nunca es un
//   chequeo previo en dos pasos.
// - Un reporte ENVIADO es inmutable: el UPDATE de edición lleva
//   `.eq("estado", "borrador")` y devuelve null si ya salió. Lo que se le dijo
//   al cliente no se reescribe después.
// - La migración 20260915120000 la corre Mateo a mano: mientras no esté,
//   `migracionReporteriaAplicada()` devuelve false y las rutas responden 503
//   antes de gastar en el modelo.

export async function migracionReporteriaAplicada(): Promise<boolean> {
  const supabase = createServerClient();
  const { error } = await supabase.from("reportes_cliente").select("id").limit(1);
  return !error;
}

// prettier-ignore
export const COLS_REPORTE =
  "id, caso_id, parte_id, destinatario_nombre, plantilla, variante, canal, estado, asunto, contenido_generado, contenido, contenido_enviado, criterio, datos, sin_ia, enviado_en, enviado_a, gmail_message_id, ejecucion_id, creado_en, actualizado_en";

export function aFilaDeListaReporte(r: ReporteCliente): ReporteClienteLista {
  const {
    contenido,
    contenido_generado: _g,
    contenido_enviado: _e,
    criterio: _c,
    datos: _d,
    ...resto
  } = r;
  void _g;
  void _e;
  void _c;
  void _d;
  return { ...resto, pendientes: contarMarcasReporte(contenido) };
}

export async function listarReportes(
  casoId: string,
  usuarioId: string,
): Promise<ReporteClienteLista[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("reportes_cliente")
    .select(COLS_REPORTE)
    .eq("caso_id", casoId)
    .eq("usuario_id", usuarioId)
    .order("creado_en", { ascending: false });
  if (error) throw new Error(`listarReportes: ${error.message}`);
  return ((data ?? []) as unknown as ReporteCliente[]).map(aFilaDeListaReporte);
}

export async function obtenerReporte(
  reporteId: string,
  casoId: string,
  usuarioId: string,
): Promise<ReporteCliente | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("reportes_cliente")
    .select(COLS_REPORTE)
    .eq("id", reporteId)
    .eq("caso_id", casoId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  if (error) throw new Error(`obtenerReporte: ${error.message}`);
  return (data as unknown as ReporteCliente | null) ?? null;
}

export async function insertarReporte(input: {
  casoId: string;
  usuarioId: string;
  parteId: string;
  destinatarioNombre: string;
  plantilla: PlantillaReporte;
  variante: string | null;
  canal: CanalReporte;
  asunto: string | null;
  contenidoGenerado: string;
  contenido: string;
  criterio: Record<string, unknown>;
  datos: Record<string, unknown>;
  sinIa: boolean;
  ejecucionId: string | null;
}): Promise<ReporteCliente> {
  const supabase = createServerClient();
  // Lista blanca explícita: `usuario_id` y `estado` los pone el server.
  const { data, error } = await supabase
    .from("reportes_cliente")
    .insert({
      caso_id: input.casoId,
      usuario_id: input.usuarioId,
      parte_id: input.parteId,
      destinatario_nombre: input.destinatarioNombre,
      plantilla: input.plantilla,
      variante: input.variante,
      canal: input.canal,
      asunto: input.asunto,
      contenido_generado: input.contenidoGenerado,
      contenido: input.contenido,
      criterio: input.criterio,
      datos: input.datos,
      sin_ia: input.sinIa,
      ejecucion_id: input.ejecucionId,
    })
    .select(COLS_REPORTE)
    .single();
  if (error || !data) {
    throw new Error(`insertarReporte: ${error?.message ?? "sin fila"}`);
  }
  return data as unknown as ReporteCliente;
}

export type CambiosReporte = {
  contenido?: string;
  asunto?: string | null;
  canal?: CanalReporte;
  /** La única transición de estado que pasa por acá. */
  estado?: "descartado";
};

/**
 * Edita un BORRADOR. Devuelve null si no existe, no es del abogado o ya no es
 * un borrador (enviado o descartado): en ese caso la ruta responde 404 o 409
 * según lo que encuentre con `obtenerReporte`.
 */
export async function editarReporte(
  reporteId: string,
  casoId: string,
  usuarioId: string,
  cambios: CambiosReporte,
): Promise<ReporteCliente | null> {
  const cols: Record<string, unknown> = {};
  if (cambios.contenido !== undefined) cols.contenido = cambios.contenido;
  if (cambios.asunto !== undefined) cols.asunto = cambios.asunto;
  if (cambios.canal !== undefined) cols.canal = cambios.canal;
  if (cambios.estado !== undefined) cols.estado = cambios.estado;
  if (Object.keys(cols).length === 0) {
    return obtenerReporte(reporteId, casoId, usuarioId);
  }
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("reportes_cliente")
    .update(cols)
    .eq("id", reporteId)
    .eq("caso_id", casoId)
    .eq("usuario_id", usuarioId)
    .eq("estado", "borrador")
    .select(COLS_REPORTE)
    .maybeSingle();
  if (error) throw new Error(`editarReporte: ${error.message}`);
  return (data as unknown as ReporteCliente | null) ?? null;
}

/**
 * Reserva el envío: borrador → enviado, con lo que sale y a quién, en UN solo
 * UPDATE condicional. Si devuelve null es que ya no era un borrador (doble
 * click, dos pestañas): no se manda nada. El `gmail_message_id` se completa
 * después con `registrarMessageId`, y si el envío falla `revertirEnvio`
 * devuelve la fila a borrador.
 */
export async function reservarEnvio(
  reporteId: string,
  casoId: string,
  usuarioId: string,
  envio: { canal: CanalReporte; enviadoA: string; contenidoEnviado: string; asunto: string | null },
): Promise<ReporteCliente | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("reportes_cliente")
    .update({
      estado: "enviado",
      canal: envio.canal,
      enviado_a: envio.enviadoA,
      contenido_enviado: envio.contenidoEnviado,
      asunto: envio.asunto,
      enviado_en: new Date().toISOString(),
    })
    .eq("id", reporteId)
    .eq("caso_id", casoId)
    .eq("usuario_id", usuarioId)
    .eq("estado", "borrador")
    .select(COLS_REPORTE)
    .maybeSingle();
  if (error) throw new Error(`reservarEnvio: ${error.message}`);
  return (data as unknown as ReporteCliente | null) ?? null;
}

export async function registrarMessageId(
  reporteId: string,
  casoId: string,
  usuarioId: string,
  gmailMessageId: string,
): Promise<ReporteCliente | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("reportes_cliente")
    .update({ gmail_message_id: gmailMessageId })
    .eq("id", reporteId)
    .eq("caso_id", casoId)
    .eq("usuario_id", usuarioId)
    .select(COLS_REPORTE)
    .maybeSingle();
  if (error) throw new Error(`registrarMessageId: ${error.message}`);
  return (data as unknown as ReporteCliente | null) ?? null;
}

export async function revertirEnvio(
  reporteId: string,
  casoId: string,
  usuarioId: string,
): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("reportes_cliente")
    .update({
      estado: "borrador",
      enviado_a: null,
      contenido_enviado: null,
      enviado_en: null,
      gmail_message_id: null,
    })
    .eq("id", reporteId)
    .eq("caso_id", casoId)
    .eq("usuario_id", usuarioId)
    .eq("estado", "enviado")
    .is("gmail_message_id", null);
  if (error) throw new Error(`revertirEnvio: ${error.message}`);
}

/** Borra un reporte que NO se envió. `false` si no existía o ya se envió. */
export async function borrarReporte(
  reporteId: string,
  casoId: string,
  usuarioId: string,
): Promise<boolean> {
  const supabase = createServerClient();
  const { count, error } = await supabase
    .from("reportes_cliente")
    .delete({ count: "exact" })
    .eq("id", reporteId)
    .eq("caso_id", casoId)
    .eq("usuario_id", usuarioId)
    .neq("estado", "enviado");
  if (error) throw new Error(`borrarReporte: ${error.message}`);
  return (count ?? 0) > 0;
}

/**
 * Cuándo salió el último reporte de cada causa del abogado. Para la tarjeta
 * del Inicio y para el bloque de la ficha. Una sola query, ordenada, y se
 * queda con la primera fila de cada causa.
 */
export async function ultimoEnvioPorCaso(
  usuarioId: string,
): Promise<Map<string, string>> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("reportes_cliente")
    .select("caso_id, enviado_en")
    .eq("usuario_id", usuarioId)
    .eq("estado", "enviado")
    .not("enviado_en", "is", null)
    .order("enviado_en", { ascending: false });
  if (error) throw new Error(`ultimoEnvioPorCaso: ${error.message}`);
  const out = new Map<string, string>();
  for (const f of (data ?? []) as { caso_id: string; enviado_en: string }[]) {
    if (!out.has(f.caso_id)) out.set(f.caso_id, f.enviado_en);
  }
  return out;
}
