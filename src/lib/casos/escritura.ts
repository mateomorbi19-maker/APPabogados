// Escritura de la ficha de causa y de sus partes, en un solo lugar.
//
// Hasta la Fase 11 esta lógica vivía inline en tres handlers
// (`PATCH /api/casos/[id]`, `POST /api/casos/[id]/partes` y
// `PATCH|DELETE .../partes/[parte_id]`). Cuando LEXIE pasó a poder cargar un
// imputado o corregir una carátula, había que elegir entre copiar esos
// handlers adentro de las tools —y tener dos listas blancas que divergen— o
// sacar el servicio a `src/lib/casos` y que las rutas y las tools llamen al
// MISMO código. Es esto segundo. Las rutas siguen respondiendo lo mismo que
// antes: parsean el body con Zod, llaman acá, y traducen el resultado a HTTP.
//
// Tres invariantes que se mudaron con el código y no se pueden aflojar:
//
//   1. El `.eq("usuario_id", …)` va DENTRO del UPDATE de `casos`, no en un
//      SELECT previo. El server entra con la service_role key, que bypassa
//      RLS: ese filtro es el único control real de propiedad, y hacerlo en dos
//      pasos abre una ventana entre el chequeo y la escritura. Acá SÍ hay un
//      SELECT previo —hace falta para saber qué cambió—, pero es para el diff,
//      no para la seguridad: el UPDATE lleva el filtro igual.
//      En `partes_caso`, que no tiene `usuario_id`, el guard es
//      `casoEsDelUsuario` PRIMERO y `caso_id` en TODAS las escrituras.
//
//   2. Las columnas escribibles se enumeran A MANO. Nunca se derrama el input
//      parseado en el `.update()` o el `.insert()`: un campo de más en el
//      schema pasaría a poder mover `usuario_id`, `ejecucion_origen_id`,
//      `estrategia_snapshot` o `caso_id`.
//
//   3. Nada se escribe si no hay nada que cambiar. Un UPDATE vacío —o uno con
//      el mismo valor que ya está— igual dispara el trigger
//      `casos_set_actualizado_en`, y esa columna ordena el Inicio, el buscador
//      y el contexto de LEXIE: un guardado sin cambios saltearía la causa al
//      tope de las tres listas. Por eso `body_vacio` y `sin_cambios` son
//      resultados, no UPDATEs.
//
// Los resultados vienen como uniones discriminadas (`ok: true | false` con
// `motivo`) y no como excepciones, porque un rechazo no es un error: es el
// sistema frenando algo que no corresponde, y quien llama —la ruta o la
// tool— tiene que poder explicárselo al abogado. Lo único que tira es un
// error de la base, que sí es un 500.
//
// Todo lo que muta devuelve `antes` (y `despues`, o la fila eliminada). Es lo
// que le permite a LEXIE mostrar qué cambió y ofrecer deshacerlo, y a un
// verificador restaurar el estado original.

import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import { normalizar } from "@/lib/casos/buscar";
import { COLS_CASO, COLS_PARTE } from "@/lib/casos/columnas";
import { casoEsDelUsuario } from "@/lib/casos/propiedad";
import type {
  CrearParteInput,
  EditarCasoInput,
  EditarParteInput,
} from "@/lib/schemas";
import type { Caso, ParteCaso } from "@/lib/types";

// La fila de `casos` leída con `COLS_CASO`. Es exactamente `Caso` de
// `@/lib/types`; el alias existe para que quien consume este servicio nombre
// lo que recibe sin tener que saber qué subconjunto de columnas trae.
export type CasoFicha = Caso;
export type { ParteCaso };

// Cuántas personas puede tener una causa. No hay caso penal con 80 partes
// cargadas a mano; el tope existe para que un bucle del cliente —o un modelo
// insistiendo— no llene la tabla, no porque 40 sea un número procesalmente
// significativo.
export const MAX_PARTES = 40;

// El texto del rechazo por fuero congelado. Lo exporta el servicio para que la
// ruta responda exactamente lo mismo que antes y la tool se lo pueda repetir al
// abogado sin reescribirlo.
export const MENSAJE_FUERO_CONGELADO =
  "El mapa procesal de esta causa ya está armado con el fuero anterior. Para cambiar de fuero hay que reiniciar el mapa, que borra el progreso: se hace desde el Mapa procesal.";

// === Lecturas ===

/**
 * La ficha completa de una causa (todas las columnas de `COLS_CASO`), sólo si
 * es del usuario. `null` si no existe o es de otro abogado: son
 * indistinguibles a propósito, un "existe pero no es tuya" confirmaría la
 * existencia de la causa.
 */
export async function leerFicha(
  casoId: string,
  usuarioId: string,
): Promise<CasoFicha | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("casos")
    .select(COLS_CASO)
    .eq("id", casoId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  if (error) throw new Error(`leerFicha: ${error.message}`);
  return data ? (data as unknown as CasoFicha) : null;
}

/**
 * Las partes de una causa, en orden de carga.
 *
 * NO valida propiedad: `partes_caso` no tiene `usuario_id` y esta query filtra
 * sólo por `caso_id`. El caller tiene que haber pasado por `casoEsDelUsuario`
 * (o por `leerFicha`) antes; es el mismo contrato que `buildContextoCaso`.
 */
export async function listarPartes(casoId: string): Promise<ParteCaso[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("partes_caso")
    .select(COLS_PARTE)
    .eq("caso_id", casoId)
    .order("creado_en", { ascending: true });
  if (error) throw new Error(`listarPartes: ${error.message}`);
  return (data ?? []) as unknown as ParteCaso[];
}

/**
 * Una parte por id, siempre con `caso_id` en el filtro: adivinar el UUID de
 * una parte no alcanza si el caso no coincide. Misma nota de propiedad que
 * `listarPartes`: el caller ya validó que el caso sea del usuario.
 */
export async function leerParte(
  casoId: string,
  parteId: string,
): Promise<ParteCaso | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("partes_caso")
    .select(COLS_PARTE)
    .eq("id", parteId)
    .eq("caso_id", casoId)
    .maybeSingle();
  if (error) throw new Error(`leerParte: ${error.message}`);
  return data ? (data as unknown as ParteCaso) : null;
}

// === Ficha ===

// Las columnas de `casos` que la ficha puede escribir. Es la lista blanca:
// cualquier columna que no esté acá no se toca desde este servicio, venga de
// donde venga el input.
type ColumnaFicha =
  | "caratula"
  | "expediente_numero"
  | "organismo"
  | "secretaria"
  | "juez"
  | "fiscalia"
  | "delitos"
  | "estado_seguimiento"
  | "fuero"
  | "titulo";

type PatchFicha = Partial<Pick<CasoFicha, ColumnaFicha>>;

export type ResultadoEditarFicha =
  | { ok: true; antes: CasoFicha; despues: CasoFicha; cambios: string[] }
  | {
      ok: false;
      motivo: "no_existe" | "sin_cambios" | "fuero_congelado" | "body_vacio";
      detalle?: string;
    };

// `delitos` es el único campo que no es escalar. Dos arrays con los mismos
// elementos en el mismo orden son el mismo valor; el schema ya deduplicó y
// recortó, así que no hace falta normalizar acá.
function mismoValor(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

// El subconjunto del patch que efectivamente va al UPDATE: sólo las columnas
// que difieren. Genérico para que lo compartan la ficha y las partes.
function soloEstas<T extends object>(cols: T, claves: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of claves) out[k] = cols[k];
  return out;
}

async function mapaTieneNodos(casoId: string): Promise<boolean> {
  const supabase = createServerClient();
  const { count, error } = await supabase
    .from("mapa_procesal_nodos")
    .select("id", { count: "exact", head: true })
    .eq("caso_id", casoId);
  if (error) throw new Error(`mapaTieneNodos: ${error.message}`);
  return (count ?? 0) > 0;
}

/**
 * Edita la ficha de una causa del usuario.
 *
 * Semántica del patch: `undefined` = ese campo no vino, no se toca; `null` =
 * el abogado lo vació a propósito, se borra. Sin esa distinción, guardar desde
 * un formulario parcial borraría todo lo que ese formulario no muestra.
 *
 * `opts.mapaArmado` deja que un caller que ya sabe si el mapa procesal tiene
 * nodos (el chat del caso lo tiene en `mapaInicializado`) se ahorre la
 * consulta; si no viene, se cuenta acá.
 *
 * Resultados de rechazo:
 *   - `body_vacio`: ningún campo escribible vino en el patch.
 *   - `no_existe`: la causa no existe o es de otro abogado.
 *   - `sin_cambios`: todo lo que vino ya vale eso. No se escribe nada, así que
 *     `actualizado_en` no se mueve.
 *   - `fuero_congelado`: se quiso cambiar el fuero con el mapa ya instanciado.
 *     `casos.fuero` no es descriptivo: la plantilla del mapa se generó UNA vez
 *     con ese fuero y no se regenera, así que cambiarlo dejaría el fuero de un
 *     código y el árbol de otro (los títulos canónicos de coherencia.ts
 *     degradarían cada nodo troncal a rama hipotética y el simulador, que sólo
 *     soporta PBA, se habilitaría sobre un mapa de Nación). El único camino es
 *     reiniciar el mapa, que es destructivo a propósito.
 */
export async function editarFicha(
  casoId: string,
  usuarioId: string,
  patch: EditarCasoInput,
  opts?: { mapaArmado?: boolean },
): Promise<ResultadoEditarFicha> {
  // Lista blanca explícita, campo por campo. No se itera sobre las claves del
  // input: si el schema creciera, la columna nueva no se escribe hasta que
  // alguien la agregue acá a mano.
  const cols: PatchFicha = {};
  if (patch.caratula !== undefined) cols.caratula = patch.caratula;
  if (patch.expediente_numero !== undefined)
    cols.expediente_numero = patch.expediente_numero;
  if (patch.organismo !== undefined) cols.organismo = patch.organismo;
  if (patch.secretaria !== undefined) cols.secretaria = patch.secretaria;
  if (patch.juez !== undefined) cols.juez = patch.juez;
  if (patch.fiscalia !== undefined) cols.fiscalia = patch.fiscalia;
  if (patch.delitos !== undefined) cols.delitos = patch.delitos;
  if (patch.estado_seguimiento !== undefined)
    cols.estado_seguimiento = patch.estado_seguimiento;
  if (patch.fuero !== undefined) cols.fuero = patch.fuero;
  // Sin `.trim()`: el schema ya lo normalizó, igual que el resto de los campos.
  if (patch.titulo !== undefined) cols.titulo = patch.titulo;

  const columnas = Object.keys(cols) as ColumnaFicha[];
  if (columnas.length === 0) {
    return { ok: false, motivo: "body_vacio" };
  }

  const antes = await leerFicha(casoId, usuarioId);
  if (!antes) return { ok: false, motivo: "no_existe" };

  // Sólo lo que difiere del valor actual cuenta como cambio. Un patch que
  // repite lo que ya está no escribe: ver la invariante 3 del encabezado.
  const cambios = columnas.filter((c) => !mismoValor(cols[c], antes[c]));
  if (cambios.length === 0) {
    return { ok: false, motivo: "sin_cambios" };
  }
  const soloCambios = soloEstas(cols, cambios);

  if (cambios.includes("fuero")) {
    const armado = opts?.mapaArmado ?? (await mapaTieneNodos(casoId));
    if (armado) {
      return {
        ok: false,
        motivo: "fuero_congelado",
        detalle: MENSAJE_FUERO_CONGELADO,
      };
    }
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("casos")
    .update(soloCambios)
    .eq("id", casoId)
    .eq("usuario_id", usuarioId)
    .select(COLS_CASO)
    .maybeSingle();
  if (error) throw new Error(`editarFicha: ${error.message}`);
  // Sin fila después del UPDATE: la causa desapareció entre la lectura y la
  // escritura (un DELETE concurrente). Se informa igual que si nunca hubiera
  // existido.
  if (!data) return { ok: false, motivo: "no_existe" };

  return {
    ok: true,
    antes,
    despues: data as unknown as CasoFicha,
    cambios,
  };
}

// === Partes ===

// Cómo se compara un nombre para decidir que dos partes son la misma persona:
// minúsculas, sin tildes y con los espacios colapsados. "Rodríguez, Carlos" y
// "rodriguez,  carlos" son la misma carga hecha dos veces, no dos personas.
// Se apoya en `normalizar` del buscador (que ya sabe de tildes) y suma el
// colapso de espacios, que el buscador no necesita.
function nombreComparable(nombre: string): string {
  return normalizar(nombre).replace(/\s+/g, " ").trim();
}

export type ResultadoAgregarParte =
  | { ok: true; parte: ParteCaso }
  | {
      ok: false;
      motivo: "caso_ajeno" | "tope" | "duplicada";
      parte_existente?: ParteCaso;
    };

/**
 * Carga una persona en la causa. `casoEsDelUsuario` va PRIMERO: `partes_caso`
 * no tiene `usuario_id`, así que este chequeo es lo único que impide que un
 * abogado cargue un imputado en la causa de otro con solo adivinar el UUID.
 *
 * `duplicada` cuando ya hay una parte con el mismo nombre (comparado con
 * `nombreComparable`) en la misma causa: la parte existente vuelve en
 * `parte_existente` para que el caller pueda ofrecer editarla en vez de
 * repetirla. Es la protección contra LEXIE cargando dos veces a la misma
 * persona en turnos distintos.
 */
export async function agregarParte(
  casoId: string,
  usuarioId: string,
  input: CrearParteInput,
): Promise<ResultadoAgregarParte> {
  if (!(await casoEsDelUsuario(casoId, usuarioId))) {
    return { ok: false, motivo: "caso_ajeno" };
  }

  const existentes = await listarPartes(casoId);

  const nombre = input.nombre.trim();
  const clave = nombreComparable(nombre);
  const repetida = existentes.find((p) => nombreComparable(p.nombre) === clave);
  if (repetida) {
    return { ok: false, motivo: "duplicada", parte_existente: repetida };
  }

  if (existentes.length >= MAX_PARTES) {
    return { ok: false, motivo: "tope" };
  }

  // Lista blanca explícita: `caso_id` sale del argumento (que ya pasó el
  // guard), nunca del input. Si viniera del input, un abogado podría cargar
  // una parte en la causa de otro.
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("partes_caso")
    .insert({
      caso_id: casoId,
      nombre,
      rol: input.rol,
      es_cliente: input.es_cliente,
      situacion_libertad: input.situacion_libertad ?? null,
      documento: input.documento ?? null,
    })
    .select(COLS_PARTE)
    .single();
  if (error || !data) {
    throw new Error(`agregarParte: ${error?.message ?? "sin fila"}`);
  }

  return { ok: true, parte: data as unknown as ParteCaso };
}

type ColumnaParte =
  | "nombre"
  | "rol"
  | "es_cliente"
  | "situacion_libertad"
  | "documento";

type PatchParte = Partial<Pick<ParteCaso, ColumnaParte>>;

export type ResultadoEditarParte =
  | { ok: true; antes: ParteCaso; despues: ParteCaso }
  | { ok: false; motivo: "caso_ajeno" | "no_existe" | "sin_cambios" };

/**
 * Edita una parte. Propiedad en dos capas: `casoEsDelUsuario` antes, y el
 * UPDATE lleva `caso_id` además del `id` de la parte, así que adivinar dos
 * UUIDs no alcanza si no van juntos.
 *
 * `sin_cambios` cubre dos casos que para el que escribe son el mismo: no vino
 * ningún campo escribible, o todo lo que vino ya vale eso. En ninguno se
 * escribe.
 */
export async function editarParte(
  casoId: string,
  usuarioId: string,
  parteId: string,
  cambios: EditarParteInput,
): Promise<ResultadoEditarParte> {
  if (!(await casoEsDelUsuario(casoId, usuarioId))) {
    return { ok: false, motivo: "caso_ajeno" };
  }

  // Lista blanca, igual que en la ficha: nunca se derrama el input, o un
  // campo de más en el schema pasaría a poder mover `caso_id`.
  const cols: PatchParte = {};
  if (cambios.nombre !== undefined) cols.nombre = cambios.nombre.trim();
  if (cambios.rol !== undefined) cols.rol = cambios.rol;
  if (cambios.es_cliente !== undefined) cols.es_cliente = cambios.es_cliente;
  if (cambios.situacion_libertad !== undefined)
    cols.situacion_libertad = cambios.situacion_libertad;
  if (cambios.documento !== undefined) cols.documento = cambios.documento;

  const columnas = Object.keys(cols) as ColumnaParte[];
  if (columnas.length === 0) return { ok: false, motivo: "sin_cambios" };

  const antes = await leerParte(casoId, parteId);
  if (!antes) return { ok: false, motivo: "no_existe" };

  const distintas = columnas.filter((c) => cols[c] !== antes[c]);
  if (distintas.length === 0) return { ok: false, motivo: "sin_cambios" };

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("partes_caso")
    .update(soloEstas(cols, distintas))
    .eq("id", parteId)
    .eq("caso_id", casoId)
    .select(COLS_PARTE)
    .maybeSingle();
  if (error) throw new Error(`editarParte: ${error.message}`);
  if (!data) return { ok: false, motivo: "no_existe" };

  return { ok: true, antes, despues: data as unknown as ParteCaso };
}

export type ResultadoEliminarParte =
  | { ok: true; eliminada: ParteCaso }
  | { ok: false; motivo: "caso_ajeno" | "no_existe" };

/**
 * Quita una persona de la causa. Devuelve la fila borrada: es lo que permite
 * recrearla a mano si el abogado se arrepiente (o si LEXIE la borró por una
 * confirmación mal entendida). El DELETE lleva `caso_id` además del `id`.
 */
export async function eliminarParte(
  casoId: string,
  usuarioId: string,
  parteId: string,
): Promise<ResultadoEliminarParte> {
  if (!(await casoEsDelUsuario(casoId, usuarioId))) {
    return { ok: false, motivo: "caso_ajeno" };
  }

  const eliminada = await leerParte(casoId, parteId);
  if (!eliminada) return { ok: false, motivo: "no_existe" };

  const supabase = createServerClient();
  const { error, count } = await supabase
    .from("partes_caso")
    .delete({ count: "exact" })
    .eq("id", parteId)
    .eq("caso_id", casoId);
  if (error) throw new Error(`eliminarParte: ${error.message}`);
  // Cero filas: alguien la borró entre la lectura y el DELETE.
  if (count === 0) return { ok: false, motivo: "no_existe" };

  return { ok: true, eliminada };
}
