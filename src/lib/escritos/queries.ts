import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import { CATALOGO_ESTUDIO } from "./catalogo-estudio";
import {
  contarPendientes,
  esModeloDelEstudio,
  esUuid,
  type CategoriaEscrito,
  type EscritoGenerado,
  type EscritoGeneradoLista,
  type EstadoEscrito,
  type ModeloEscrito,
  type ModeloEscritoResumen,
  type OrigenModelo,
  type PerfilProfesional,
  type RolSugerido,
} from "./types";

// Acceso a datos de escritos. Todo lo que toca `modelos_escrito` y
// `escritos_generados` pasa por acá.
//
// === La regla de propiedad ===
//
// El server entra con service_role, que bypassa RLS. Así que cada función que
// lee o escribe una fila de un abogado recibe `usuarioId` y lo pone COMO
// PREDICADO de la query — nunca como un chequeo previo en dos pasos. Es el
// mismo criterio que PATCH /api/casos/[id]: el filtro dentro del UPDATE es el
// único control real, y hacerlo antes en un SELECT abre una ventana entre el
// chequeo y la escritura.
//
// Los modelos del ESTUDIO no tienen dueño: son de los tres, viven en código y
// se leen sin filtro. Ver types.ts.

// La migración 20260904120000 la corre Mateo a mano, y el drift repo↔base
// de este proyecto corta para los dos lados. Mientras no esté aplicada, lo
// que depende SOLO del catálogo versionado (los 50 modelos, la búsqueda, la
// recomendación de LEXIE) tiene que seguir funcionando: acá se detecta "la
// tabla/columna no existe" y se degrada con un warn, en vez de tirar 500 a
// toda la sección por una tabla que todavía no se creó. Lo que sí necesita
// la base (guardar un modelo propio, persistir un escrito) falla con un
// mensaje claro; ver `migracionEscritosAplicada`.
function faltaMigracion(msg: string): boolean {
  return (
    msg.includes("Could not find the table") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

/**
 * Sondeo GRATIS antes de gastar: la ruta de generación lo llama antes de
 * invocar al modelo, porque cobrar una redacción y descubrir al persistirla
 * que la tabla no existe es el peor orden posible.
 */
export async function migracionEscritosAplicada(): Promise<boolean> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("escritos_generados")
    .select("id")
    .limit(1);
  return !error;
}

// ————————————————————————————————————————————————————————————————
// Modelos
// ————————————————————————————————————————————————————————————————

// prettier-ignore
const COLS_MODELO =
  "id, origen, categoria, titulo, suma, cuando, base_normativa, cuerpo, claves, rol_sugerido, creado_en";
// prettier-ignore
const COLS_MODELO_RESUMEN =
  "id, origen, categoria, titulo, suma, cuando, base_normativa, claves, rol_sugerido, creado_en";

type FilaModelo = {
  id: string;
  origen: OrigenModelo;
  categoria: CategoriaEscrito;
  titulo: string;
  suma: string;
  cuando: string | null;
  base_normativa: string | null;
  cuerpo?: string;
  claves: string | null;
  rol_sugerido: RolSugerido;
  creado_en: string;
};

function resumenDe(m: ModeloEscrito): ModeloEscritoResumen {
  const { cuerpo: _cuerpo, ...resto } = m;
  void _cuerpo;
  return resto;
}

/**
 * Todos los modelos que el abogado puede elegir: los 50 del estudio seguidos
 * de los suyos (más nuevos primero). Sin el cuerpo, que es lo pesado: para
 * generar se pide el modelo entero con `obtenerModelo`.
 */
export async function listarModelos(
  usuarioId: string,
): Promise<ModeloEscritoResumen[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("modelos_escrito")
    .select(COLS_MODELO_RESUMEN)
    .eq("usuario_id", usuarioId)
    .eq("archivado", false)
    .order("creado_en", { ascending: false });
  if (error) {
    if (faltaMigracion(error.message)) {
      console.warn("[escritos] modelos_escrito no existe todavía (migración 20260904120000 sin aplicar); se listan sólo los del estudio");
      return CATALOGO_ESTUDIO.map(resumenDe);
    }
    throw new Error(`listarModelos: ${error.message}`);
  }

  const propios = ((data ?? []) as FilaModelo[]).map(
    (f): ModeloEscritoResumen => ({
      id: f.id,
      origen: f.origen,
      numero: null,
      categoria: f.categoria,
      titulo: f.titulo,
      suma: f.suma,
      cuando: f.cuando,
      base_normativa: f.base_normativa,
      claves: f.claves,
      rol_sugerido: f.rol_sugerido,
      creado_en: f.creado_en,
    }),
  );
  return [...CATALOGO_ESTUDIO.map(resumenDe), ...propios];
}

/**
 * Un modelo completo, con el cuerpo. Null si no existe o no es del abogado.
 * El id decide dónde buscar: slug → catálogo versionado; UUID → tabla, con
 * el filtro de propiedad dentro de la query.
 */
export async function obtenerModelo(
  id: string,
  usuarioId: string,
): Promise<ModeloEscrito | null> {
  if (esModeloDelEstudio(id)) {
    return CATALOGO_ESTUDIO.find((m) => m.id === id) ?? null;
  }
  if (!esUuid(id)) return null;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("modelos_escrito")
    .select(COLS_MODELO)
    .eq("id", id)
    .eq("usuario_id", usuarioId)
    .eq("archivado", false)
    .maybeSingle();
  if (error) throw new Error(`obtenerModelo: ${error.message}`);
  if (!data) return null;
  const f = data as FilaModelo;
  return {
    id: f.id,
    origen: f.origen,
    numero: null,
    categoria: f.categoria,
    titulo: f.titulo,
    suma: f.suma,
    cuando: f.cuando,
    base_normativa: f.base_normativa,
    cuerpo: f.cuerpo ?? "",
    claves: f.claves,
    rol_sugerido: f.rol_sugerido,
    creado_en: f.creado_en,
  };
}

export type ModeloInput = {
  categoria: CategoriaEscrito;
  titulo: string;
  suma: string;
  cuando: string | null;
  base_normativa: string | null;
  cuerpo: string;
  claves: string | null;
  rol_sugerido: RolSugerido;
};

// Tope de modelos propios por abogado. No es un número procesal: existe para
// que un bucle (del cliente o de LEXIE) no llene la tabla.
export const MAX_MODELOS_PROPIOS = 200;

export async function crearModelo(
  usuarioId: string,
  input: ModeloInput,
  origen: Exclude<OrigenModelo, "estudio">,
): Promise<ModeloEscrito> {
  const supabase = createServerClient();

  const { count } = await supabase
    .from("modelos_escrito")
    .select("id", { count: "exact", head: true })
    .eq("usuario_id", usuarioId)
    .eq("archivado", false);
  if ((count ?? 0) >= MAX_MODELOS_PROPIOS) {
    throw new Error(`Se alcanzó el tope de ${MAX_MODELOS_PROPIOS} modelos propios`);
  }

  // Lista blanca explícita: `usuario_id` y `origen` los pone el server.
  const { data, error } = await supabase
    .from("modelos_escrito")
    .insert({
      usuario_id: usuarioId,
      origen,
      categoria: input.categoria,
      titulo: input.titulo,
      suma: input.suma,
      cuando: input.cuando,
      base_normativa: input.base_normativa,
      cuerpo: input.cuerpo,
      claves: input.claves,
      rol_sugerido: input.rol_sugerido,
    })
    .select(COLS_MODELO)
    .single();
  if (error || !data) {
    throw new Error(`crearModelo: ${error?.message ?? "sin fila"}`);
  }
  const f = data as FilaModelo;
  return {
    id: f.id,
    origen: f.origen,
    numero: null,
    categoria: f.categoria,
    titulo: f.titulo,
    suma: f.suma,
    cuando: f.cuando,
    base_normativa: f.base_normativa,
    cuerpo: f.cuerpo ?? "",
    claves: f.claves,
    rol_sugerido: f.rol_sugerido,
    creado_en: f.creado_en,
  };
}

/** Edita un modelo propio. Devuelve null si no existe o no es del abogado. */
export async function editarModelo(
  id: string,
  usuarioId: string,
  cambios: Partial<ModeloInput>,
): Promise<ModeloEscrito | null> {
  if (!esUuid(id)) return null;
  // Lista blanca: nunca se derrama `cambios` entero.
  const cols: Record<string, unknown> = {};
  if (cambios.categoria !== undefined) cols.categoria = cambios.categoria;
  if (cambios.titulo !== undefined) cols.titulo = cambios.titulo;
  if (cambios.suma !== undefined) cols.suma = cambios.suma;
  if (cambios.cuando !== undefined) cols.cuando = cambios.cuando;
  if (cambios.base_normativa !== undefined)
    cols.base_normativa = cambios.base_normativa;
  if (cambios.cuerpo !== undefined) cols.cuerpo = cambios.cuerpo;
  if (cambios.claves !== undefined) cols.claves = cambios.claves;
  if (cambios.rol_sugerido !== undefined)
    cols.rol_sugerido = cambios.rol_sugerido;
  if (Object.keys(cols).length === 0) return obtenerModelo(id, usuarioId);

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("modelos_escrito")
    .update(cols)
    .eq("id", id)
    .eq("usuario_id", usuarioId)
    .eq("archivado", false)
    .select(COLS_MODELO)
    .maybeSingle();
  if (error) throw new Error(`editarModelo: ${error.message}`);
  if (!data) return null;
  const f = data as FilaModelo;
  return {
    id: f.id,
    origen: f.origen,
    numero: null,
    categoria: f.categoria,
    titulo: f.titulo,
    suma: f.suma,
    cuando: f.cuando,
    base_normativa: f.base_normativa,
    cuerpo: f.cuerpo ?? "",
    claves: f.claves,
    rol_sugerido: f.rol_sugerido,
    creado_en: f.creado_en,
  };
}

/** Archiva (no borra) un modelo propio. `false` si no existía. */
export async function archivarModelo(
  id: string,
  usuarioId: string,
): Promise<boolean> {
  if (!esUuid(id)) return false;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("modelos_escrito")
    .update({ archivado: true })
    .eq("id", id)
    .eq("usuario_id", usuarioId)
    .eq("archivado", false)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`archivarModelo: ${error.message}`);
  return data !== null;
}

// ————————————————————————————————————————————————————————————————
// Escritos generados
// ————————————————————————————————————————————————————————————————

// prettier-ignore
export const COLS_ESCRITO =
  "id, caso_id, modelo_id, modelo_titulo, titulo, contenido, instrucciones, estado, presentado_en, ejecucion_id, creado_en, actualizado_en";
/**
 * Los escritos de una causa, más nuevos primero. Se lee el texto para contar
 * las marcas y se descarta antes de devolver: son pocos escritos por causa y
 * varias páginas cada uno, y el contador es lo que la lista muestra.
 */
export async function listarEscritos(
  casoId: string,
  usuarioId: string,
): Promise<EscritoGeneradoLista[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("escritos_generados")
    .select(COLS_ESCRITO)
    .eq("caso_id", casoId)
    .eq("usuario_id", usuarioId)
    .order("creado_en", { ascending: false });
  if (error) throw new Error(`listarEscritos: ${error.message}`);
  return ((data ?? []) as EscritoGenerado[]).map(aFilaDeLista);
}

export function aFilaDeLista(e: EscritoGenerado): EscritoGeneradoLista {
  const { contenido, ...resto } = e;
  return { ...resto, pendientes: contarPendientes(contenido) };
}

export async function obtenerEscrito(
  escritoId: string,
  casoId: string,
  usuarioId: string,
): Promise<EscritoGenerado | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("escritos_generados")
    .select(COLS_ESCRITO)
    .eq("id", escritoId)
    .eq("caso_id", casoId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  if (error) throw new Error(`obtenerEscrito: ${error.message}`);
  return (data as EscritoGenerado | null) ?? null;
}

export async function insertarEscrito(input: {
  casoId: string;
  usuarioId: string;
  modeloId: string | null;
  modeloTitulo: string;
  titulo: string;
  contenido: string;
  instrucciones: string | null;
  ejecucionId: string | null;
}): Promise<EscritoGenerado> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("escritos_generados")
    .insert({
      caso_id: input.casoId,
      usuario_id: input.usuarioId,
      modelo_id: input.modeloId,
      modelo_titulo: input.modeloTitulo,
      titulo: input.titulo,
      contenido: input.contenido,
      instrucciones: input.instrucciones,
      ejecucion_id: input.ejecucionId,
    })
    .select(COLS_ESCRITO)
    .single();
  if (error || !data) {
    throw new Error(`insertarEscrito: ${error?.message ?? "sin fila"}`);
  }
  return data as EscritoGenerado;
}

export async function editarEscrito(
  escritoId: string,
  casoId: string,
  usuarioId: string,
  cambios: { titulo?: string; contenido?: string; estado?: EstadoEscrito },
): Promise<EscritoGenerado | null> {
  const cols: Record<string, unknown> = {};
  if (cambios.titulo !== undefined) cols.titulo = cambios.titulo;
  if (cambios.contenido !== undefined) cols.contenido = cambios.contenido;
  if (cambios.estado !== undefined) {
    cols.estado = cambios.estado;
    cols.presentado_en =
      cambios.estado === "presentado" ? new Date().toISOString() : null;
  }
  if (Object.keys(cols).length === 0) {
    return obtenerEscrito(escritoId, casoId, usuarioId);
  }
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("escritos_generados")
    .update(cols)
    .eq("id", escritoId)
    .eq("caso_id", casoId)
    .eq("usuario_id", usuarioId)
    .select(COLS_ESCRITO)
    .maybeSingle();
  if (error) throw new Error(`editarEscrito: ${error.message}`);
  return (data as EscritoGenerado | null) ?? null;
}

export async function borrarEscrito(
  escritoId: string,
  casoId: string,
  usuarioId: string,
): Promise<boolean> {
  const supabase = createServerClient();
  const { count, error } = await supabase
    .from("escritos_generados")
    .delete({ count: "exact" })
    .eq("id", escritoId)
    .eq("caso_id", casoId)
    .eq("usuario_id", usuarioId);
  if (error) throw new Error(`borrarEscrito: ${error.message}`);
  return (count ?? 0) > 0;
}

// ————————————————————————————————————————————————————————————————
// Perfil profesional del abogado
// ————————————————————————————————————————————————————————————————

const COLS_PERFIL =
  "nombre_completo, matricula, domicilio_constituido, domicilio_electronico";

export async function getPerfilProfesional(
  usuarioId: string,
): Promise<PerfilProfesional> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("usuarios")
    .select(COLS_PERFIL)
    .eq("id", usuarioId)
    .maybeSingle();
  if (error && !faltaMigracion(error.message)) {
    throw new Error(`getPerfilProfesional: ${error.message}`);
  }
  if (error) {
    console.warn("[escritos] usuarios sin columnas de perfil (migración 20260904120000 sin aplicar); perfil vacío");
  }
  const p = (data ?? {}) as Partial<PerfilProfesional>;
  return {
    nombre_completo: p.nombre_completo ?? null,
    matricula: p.matricula ?? null,
    domicilio_constituido: p.domicilio_constituido ?? null,
    domicilio_electronico: p.domicilio_electronico ?? null,
  };
}

/**
 * Sólo el propio. Nunca `nombre` ni `email`: esos son el identificador lógico
 * del sistema y los administra el lazy-sync de Clerk (whitelist.ts).
 */
export async function actualizarPerfilProfesional(
  usuarioId: string,
  cambios: Partial<PerfilProfesional>,
): Promise<PerfilProfesional> {
  const cols: Record<string, unknown> = {};
  if (cambios.nombre_completo !== undefined)
    cols.nombre_completo = cambios.nombre_completo;
  if (cambios.matricula !== undefined) cols.matricula = cambios.matricula;
  if (cambios.domicilio_constituido !== undefined)
    cols.domicilio_constituido = cambios.domicilio_constituido;
  if (cambios.domicilio_electronico !== undefined)
    cols.domicilio_electronico = cambios.domicilio_electronico;
  if (Object.keys(cols).length === 0) return getPerfilProfesional(usuarioId);

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("usuarios")
    .update(cols)
    .eq("id", usuarioId)
    .select(COLS_PERFIL)
    .single();
  if (error || !data) {
    throw new Error(`actualizarPerfilProfesional: ${error?.message ?? "sin fila"}`);
  }
  return data as PerfilProfesional;
}
