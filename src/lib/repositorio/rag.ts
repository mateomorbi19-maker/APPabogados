import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import { embedQuery } from "@/lib/rag/embed";
import { metaTribunal, type Coleccion } from "./types";

// Recuperación sobre el RAG del Repositorio (jurisprudencia y doctrina del
// estudio). El índice lo construye scripts/ingestar-repositorio.ts sobre las
// tablas de supabase/migrations/20260807120000_repositorio_rag.sql.
//
// BÚSQUEDA EN DOS ETAPAS, y esa es toda la idea:
//
//   1. Se busca sobre las FICHAS (una por documento, ~345 filas): un resumen
//      curado con el holding del fallo. Ahí se decide QUÉ documentos sirven.
//   2. Sólo para los que ganaron la etapa 1 se buscan los PASAJES textuales.
//      Ahí se resuelve QUÉ CITAR.
//
// Buscar directo sobre los ~15.000 chunks del corpus sería más simple y peor por
// dos motivos: el ranking lo dominarían los párrafos de trámite (los "VISTOS" se
// parecen entre sí más que las ratios), y devolver 20 chunks crudos al modelo
// cuesta ~8.000 tokens por búsqueda. Con fichas + pasajes acotados, una búsqueda
// entra en ~1.500 tokens y trae la información con la que un abogado realmente
// decide si un precedente aplica.

// ————————————————————————————————————————————————————————————————
// Parámetros de recuperación
// ————————————————————————————————————————————————————————————————

/**
 * Umbral de la etapa 1 (fichas). Deliberadamente bajo: la consulta del agente
 * es la descripción de un caso y la ficha es una regla jurídica abstracta, así
 * que la similitud coseno entre ambas rara vez pasa de 0.5 aunque el precedente
 * sea exactamente el correcto. Lo que hace el trabajo acá es el ORDEN, no el
 * corte; el corte sólo saca la basura. Subirlo devuelve cero resultados en
 * consultas legítimas — el mismo error que costó dos meses de RAG mudo en
 * `match_documents` (ver src/lib/rag/match-documents.ts).
 */
export const UMBRAL_FICHAS = 0.22;

/** Umbral de la etapa 2 (pasajes). Ver la nota de la migración: acá el
 *  documento ya se dio por pertinente y sólo se pide su mejor párrafo. */
export const UMBRAL_PASAJES = 0.15;

/** Documentos que devuelve una búsqueda por defecto. */
const DOCUMENTOS_POR_BUSQUEDA = 6;
const MAX_DOCUMENTOS_POR_BUSQUEDA = 10;

/** Cuántos de los documentos recuperados reciben pasajes textuales. Los de más
 *  abajo del ranking van sólo con su ficha: si el agente los quiere usar, pide
 *  el texto con `leerDocumento`. */
const DOCUMENTOS_CON_PASAJES = 4;
const PASAJES_POR_DOCUMENTO = 2;

/** Recorte de cada pasaje al serializarlo para el modelo. Un chunk entero son
 *  ~450 tokens; con 6 documentos × 2 pasajes eso serían 5.400 tokens sólo de
 *  citas. 700 caracteres alcanzan para un considerando reconocible. */
const PASAJE_MAX_CHARS = 700;

/** Pasajes que devuelve la lectura profunda de un documento puntual. */
const PASAJES_LECTURA = 6;
const PASAJE_LECTURA_MAX_CHARS = 1200;

// ————————————————————————————————————————————————————————————————
// Tipos
// ————————————————————————————————————————————————————————————————

export type Pasaje = {
  pagina: number | null;
  texto: string;
  similitud: number;
};

export type DocumentoRecuperado = {
  documento_id: string;
  titulo: string;
  coleccion: Coleccion;
  /** Nombre corto del tribunal ("Casación Federal"), no el código. */
  tribunal: string | null;
  anio: number | null;
  caratula: string | null;
  autor: string | null;
  materias: string[];
  holding: string | null;
  sumario: string | null;
  normas: string[];
  temas: string[];
  utilidad_defensa: string | null;
  utilidad_acusacion: string | null;
  similitud: number;
  pasajes: Pasaje[];
};

/**
 * `disponible: false` NO es un error: es el estado normal mientras la migración
 * del RAG no se aplicó o la ingesta no corrió. Los call sites lo convierten en
 * un mensaje para el modelo, nunca en una excepción — el chat tiene que seguir
 * funcionando sin repositorio.
 */
export type ResultadoRepositorio =
  | { disponible: true; documentos: DocumentoRecuperado[] }
  | { disponible: false; motivo: string };

// ————————————————————————————————————————————————————————————————
// Disponibilidad del índice
// ————————————————————————————————————————————————————————————————

const MOTIVO_SIN_INDICE =
  "El índice de búsqueda del repositorio todavía no está construido en esta instalación " +
  "(falta aplicar la migración del RAG o correr la ingesta de los PDF).";

// Se cachea sólo el NO: si el índice no está, cada llamada gastaría un embedding
// de OpenAI para chocarse con el mismo 404. El SÍ no se cachea porque no cuesta
// nada equivocarse hacia el lado optimista.
let noDisponibleHasta = 0;
const TTL_NO_DISPONIBLE_MS = 5 * 60 * 1000;

function marcarNoDisponible(): void {
  noDisponibleHasta = Date.now() + TTL_NO_DISPONIBLE_MS;
}

function estaMarcadoNoDisponible(): boolean {
  return Date.now() < noDisponibleHasta;
}

/** Códigos de PostgREST que significan "las tablas/RPC del RAG no existen". */
function esFaltaDeSchema(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    /schema cache/i.test(error.message ?? "")
  );
}

/**
 * Cuántos documentos tienen ficha y embedding. `null` si el índice no existe.
 * Lo consume `GET /api/repositorio/estado` para que se pueda verificar desde
 * afuera si la ingesta corrió.
 */
export async function contarDocumentosIndexados(): Promise<number | null> {
  const supabase = createServerClient();
  const { count, error } = await supabase
    .from("repositorio_documentos")
    .select("documento_id", { count: "exact", head: true })
    .eq("estado", "ok");
  if (error) {
    if (esFaltaDeSchema(error)) return null;
    console.error("[repositorio/rag] contarDocumentosIndexados:", error);
    return null;
  }
  return count ?? 0;
}

// ————————————————————————————————————————————————————————————————
// Filas crudas de las RPC
// ————————————————————————————————————————————————————————————————

type FilaFicha = {
  documento_id: string;
  coleccion: string;
  titulo: string;
  tribunal: string | null;
  anio: number | null;
  caratula: string | null;
  autor: string | null;
  materias: string[] | null;
  holding: string | null;
  sumario: string | null;
  temas: string[] | null;
  normas: string[] | null;
  utilidad_defensa: string | null;
  utilidad_acusacion: string | null;
  similarity: number;
};

type FilaChunk = {
  documento_id: string;
  pagina: number | null;
  contenido: string;
  similarity: number;
};

function redondear(n: number): number {
  return Number(n.toFixed(4));
}

function recortar(texto: string, max: number): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (limpio.length <= max) return limpio;
  // Se corta en el último espacio para no dejar una palabra partida al medio.
  const cortado = limpio.slice(0, max);
  const ultimoEspacio = cortado.lastIndexOf(" ");
  return `${cortado.slice(0, ultimoEspacio > max * 0.6 ? ultimoEspacio : max)}…`;
}

function aDocumento(f: FilaFicha, pasajes: Pasaje[]): DocumentoRecuperado {
  return {
    documento_id: f.documento_id,
    titulo: f.titulo,
    coleccion: f.coleccion === "doctrina" ? "doctrina" : "jurisprudencia",
    tribunal: f.tribunal ? metaTribunal(f.tribunal).corto : null,
    anio: f.anio,
    caratula: f.caratula,
    autor: f.autor,
    materias: f.materias ?? [],
    holding: f.holding,
    sumario: f.sumario,
    temas: f.temas ?? [],
    normas: f.normas ?? [],
    utilidad_defensa: f.utilidad_defensa,
    utilidad_acusacion: f.utilidad_acusacion,
    similitud: redondear(f.similarity),
    pasajes,
  };
}

// ————————————————————————————————————————————————————————————————
// Búsqueda
// ————————————————————————————————————————————————————————————————

export type OpcionesBusquedaRepositorio = {
  consulta: string;
  /** null = las dos colecciones. */
  coleccion?: Coleccion | null;
  limite?: number;
};

export async function buscarEnRepositorio(
  opciones: OpcionesBusquedaRepositorio,
): Promise<ResultadoRepositorio> {
  const consulta = opciones.consulta.trim();
  if (consulta.length === 0) {
    return { disponible: false, motivo: "La consulta vino vacía." };
  }
  if (estaMarcadoNoDisponible()) {
    return { disponible: false, motivo: MOTIVO_SIN_INDICE };
  }

  const limite = Math.min(
    Math.max(opciones.limite ?? DOCUMENTOS_POR_BUSQUEDA, 1),
    MAX_DOCUMENTOS_POR_BUSQUEDA,
  );

  const supabase = createServerClient();
  const embedding = await embedQuery(consulta);

  // --- etapa 1: fichas ---
  const { data: fichasRaw, error: errFichas } = await supabase.rpc(
    "match_repositorio_documentos",
    {
      query_embedding: embedding,
      match_count: limite,
      match_threshold: UMBRAL_FICHAS,
      filtro_coleccion: opciones.coleccion ?? null,
    },
  );

  if (errFichas) {
    if (esFaltaDeSchema(errFichas)) {
      marcarNoDisponible();
      return { disponible: false, motivo: MOTIVO_SIN_INDICE };
    }
    throw new Error(`match_repositorio_documentos falló: ${errFichas.message}`);
  }

  const fichas = (fichasRaw ?? []) as FilaFicha[];
  if (fichas.length === 0) {
    return { disponible: true, documentos: [] };
  }

  // --- etapa 2: pasajes, sólo para la cabeza del ranking ---
  const conPasajes = fichas.slice(0, DOCUMENTOS_CON_PASAJES);
  const pasajesPorDoc = await buscarPasajes(
    embedding,
    conPasajes.map((f) => f.documento_id),
    conPasajes.length * PASAJES_POR_DOCUMENTO,
    PASAJES_POR_DOCUMENTO,
    PASAJE_MAX_CHARS,
  );

  return {
    disponible: true,
    documentos: fichas.map((f) =>
      aDocumento(f, pasajesPorDoc.get(f.documento_id) ?? []),
    ),
  };
}

/**
 * Pasajes de un conjunto de documentos, agrupados por documento y con tope por
 * documento. Se pide `match_count` global y se reparte acá en vez de hacer una
 * RPC por documento: una sola query resuelve los cuatro.
 */
async function buscarPasajes(
  embedding: number[],
  documentoIds: string[],
  matchCount: number,
  maxPorDocumento: number,
  maxChars: number,
): Promise<Map<string, Pasaje[]>> {
  const porDoc = new Map<string, Pasaje[]>();
  if (documentoIds.length === 0) return porDoc;

  const supabase = createServerClient();
  const { data, error } = await supabase.rpc("match_repositorio_chunks", {
    query_embedding: embedding,
    // Se pide de más porque el reparto por documento descarta los excedentes:
    // sin el ×2, un fallo largo que copa el ranking dejaría a los otros tres sin
    // ningún pasaje.
    match_count: Math.max(matchCount * 2, 8),
    match_threshold: UMBRAL_PASAJES,
    filtro_documentos: documentoIds,
  });

  if (error) {
    // Un fallo acá NO tumba la búsqueda: las fichas solas ya son útiles y el
    // agente puede pedir el texto después con `leerDocumento`.
    if (!esFaltaDeSchema(error)) {
      console.error("[repositorio/rag] match_repositorio_chunks:", error);
    }
    return porDoc;
  }

  for (const c of (data ?? []) as FilaChunk[]) {
    const lista = porDoc.get(c.documento_id) ?? [];
    if (lista.length >= maxPorDocumento) continue;
    lista.push({
      pagina: c.pagina,
      texto: recortar(c.contenido, maxChars),
      similitud: redondear(c.similarity),
    });
    porDoc.set(c.documento_id, lista);
  }
  return porDoc;
}

// ————————————————————————————————————————————————————————————————
// Lectura profunda de un documento
// ————————————————————————————————————————————————————————————————

export type ResultadoLectura =
  | { encontrado: true; documento: DocumentoRecuperado }
  | { encontrado: false; motivo: string };

/**
 * Más texto de UN documento ya identificado. Con `consulta` devuelve los pasajes
 * más pertinentes a ese ángulo; sin ella, el comienzo del documento (que en un
 * fallo es la carátula y el objeto de la causa).
 */
export async function leerDocumentoRepositorio(
  documentoId: string,
  consulta?: string,
): Promise<ResultadoLectura> {
  if (estaMarcadoNoDisponible()) {
    return { encontrado: false, motivo: MOTIVO_SIN_INDICE };
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("repositorio_documentos")
    .select(
      "documento_id, coleccion, titulo, tribunal, anio, caratula, autor, materias, holding, sumario, temas, normas, utilidad_defensa, utilidad_acusacion, estado",
    )
    .eq("documento_id", documentoId)
    .maybeSingle();

  if (error) {
    if (esFaltaDeSchema(error)) {
      marcarNoDisponible();
      return { encontrado: false, motivo: MOTIVO_SIN_INDICE };
    }
    throw new Error(`lectura del repositorio falló: ${error.message}`);
  }
  if (!data) {
    return {
      encontrado: false,
      motivo: `No hay ningún documento indexado con id "${documentoId}". Usá exactamente el documento_id que devolvió la búsqueda.`,
    };
  }
  if (data.estado !== "ok") {
    return {
      encontrado: false,
      motivo: `El documento "${data.titulo}" está en el repositorio pero no tiene texto indexado (probablemente sea un PDF escaneado sin OCR). Podés mencionarlo por su título, pero no citarlo textualmente.`,
    };
  }

  const ficha = data as unknown as FilaFicha & { estado: string };

  let pasajes: Pasaje[];
  if (consulta && consulta.trim().length > 0) {
    const embedding = await embedQuery(consulta.trim());
    const mapa = await buscarPasajes(
      embedding,
      [documentoId],
      PASAJES_LECTURA,
      PASAJES_LECTURA,
      PASAJE_LECTURA_MAX_CHARS,
    );
    pasajes = mapa.get(documentoId) ?? [];
  } else {
    pasajes = [];
  }

  // Sin consulta (o si la búsqueda vectorial no devolvió nada) caemos al
  // comienzo del documento: siempre es mejor devolver texto real que un
  // documento vacío que el agente no puede citar.
  if (pasajes.length === 0) {
    const { data: primeros, error: errPrimeros } = await supabase
      .from("repositorio_chunks")
      .select("pagina, contenido")
      .eq("documento_id", documentoId)
      .order("chunk_index", { ascending: true })
      .limit(PASAJES_LECTURA);
    if (errPrimeros) {
      console.error("[repositorio/rag] primeros chunks:", errPrimeros);
    }
    pasajes = ((primeros ?? []) as { pagina: number | null; contenido: string }[]).map(
      (c) => ({
        pagina: c.pagina,
        texto: recortar(c.contenido, PASAJE_LECTURA_MAX_CHARS),
        similitud: 0,
      }),
    );
  }

  return {
    encontrado: true,
    documento: aDocumento({ ...ficha, similarity: 1 }, pasajes),
  };
}
