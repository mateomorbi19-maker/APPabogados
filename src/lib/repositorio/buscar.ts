// Buscador del Repositorio. Puro, sin IO: recibe el catálogo y devuelve
// resultados. Se puede llamar desde cualquier lado (route handler, RSC, test).
//
// Con ~350 documentos en memoria no hace falta índice invertido ni pgvector:
// un scan lineal con puntaje es instantáneo y mucho más simple de auditar.

import {
  metaTribunal,
  slugMateria,
  COLECCIONES,
  COLECCIONES_VALUES,
  type Coleccion,
  type DocumentoRepositorio,
  type Facetas,
  type FiltrosRepositorio,
  type ResultadoBusqueda,
} from "./types";
import { normalizarTexto, tokenizar } from "./texto";

// ————————————————————————————————————————————————————————————————
// Índice derivado (memoizado por documento)
// ————————————————————————————————————————————————————————————————

type Indice = {
  tituloNorm: string;
  tituloTokens: string[];
  /** Carátula + autor: los campos "quién" del documento. */
  nombresNorm: string;
  materiasNorm: string;
  materiasSlug: string[];
  /** Década como string ("2010"), o null si el documento no tiene año. */
  decada: string | null;
};

// WeakMap: el catálogo es un módulo constante, así que el índice se calcula
// una sola vez por proceso y se libera solo si el documento deja de existir.
const CACHE = new WeakMap<DocumentoRepositorio, Indice>();

function indice(d: DocumentoRepositorio): Indice {
  const previo = CACHE.get(d);
  if (previo) return previo;
  const tituloNorm = normalizarTexto(d.titulo);
  const nuevo: Indice = {
    tituloNorm,
    tituloTokens: tituloNorm.length === 0 ? [] : tituloNorm.split(" "),
    nombresNorm: normalizarTexto(`${d.caratula ?? ""} ${d.autor ?? ""}`),
    materiasNorm: normalizarTexto(d.materias.join(" ")),
    materiasSlug: d.materias.map((m) => slugMateria(d.coleccion, m)),
    decada: d.anio === null ? null : String(Math.floor(d.anio / 10) * 10),
  };
  CACHE.set(d, nuevo);
  return nuevo;
}

// ————————————————————————————————————————————————————————————————
// Filtros
// ————————————————————————————————————————————————————————————————

export type OpcionesBusqueda = Partial<FiltrosRepositorio>;

type FiltrosNormalizados = {
  frase: string;
  tokens: string[];
  coleccion: Coleccion | null;
  materia: string | null;
  tribunal: string | null;
  anio: number | null;
};

function normalizarFiltros(o: OpcionesBusqueda): FiltrosNormalizados {
  const frase = normalizarTexto(o.q ?? "");
  return {
    frase,
    tokens: tokenizar(o.q ?? ""),
    coleccion: o.coleccion ?? null,
    materia: o.materia ?? null,
    tribunal: o.tribunal ?? null,
    anio: o.anio ?? null,
  };
}

/**
 * Todos los tokens tienen que aparecer (AND). El match es por SUBCADENA sobre
 * el campo `busqueda`, no por palabra exacta: el abogado escribe "homic" o
 * "prision prev" y espera ver resultados antes de terminar de tipear.
 */
function matcheaTexto(d: DocumentoRepositorio, tokens: string[]): boolean {
  return tokens.every((t) => d.busqueda.includes(t));
}

/** Dimensiones que se pueden excluir al calcular una faceta. */
type Dimension = "coleccion" | "materia" | "tribunal" | "anio";

function pasa(
  d: DocumentoRepositorio,
  f: FiltrosNormalizados,
  excepto: Dimension | null,
): boolean {
  if (f.tokens.length > 0 && !matcheaTexto(d, f.tokens)) return false;
  if (excepto !== "coleccion" && f.coleccion !== null && d.coleccion !== f.coleccion)
    return false;
  if (excepto !== "materia" && f.materia !== null) {
    if (!indice(d).materiasSlug.includes(f.materia)) return false;
  }
  if (excepto !== "tribunal" && f.tribunal !== null && d.tribunal !== f.tribunal)
    return false;
  if (excepto !== "anio" && f.anio !== null && d.anio !== f.anio) return false;
  return true;
}

// ————————————————————————————————————————————————————————————————
// Puntaje
// ————————————————————————————————————————————————————————————————

// Un match en el título vale más que uno en la carátula, que vale más que uno
// en la materia, que vale más que uno en cualquier otro campo. La frase
// completa vale muchísimo más que los tokens sueltos.
const PESO = {
  frase_titulo: 100,
  frase_titulo_inicio: 40,
  frase_nombre: 60,
  token_titulo: 20,
  token_titulo_prefijo: 12,
  token_nombre: 12,
  token_materia: 6,
  token_resto: 2,
} as const;

function puntuar(
  d: DocumentoRepositorio,
  f: FiltrosNormalizados,
): number {
  const ix = indice(d);
  let p = 0;

  if (f.frase.length > 0) {
    if (ix.tituloNorm.includes(f.frase)) {
      p += PESO.frase_titulo;
      if (ix.tituloNorm.startsWith(f.frase)) p += PESO.frase_titulo_inicio;
    }
    if (ix.nombresNorm.includes(f.frase)) p += PESO.frase_nombre;
  }

  for (const t of f.tokens) {
    if (ix.tituloTokens.includes(t)) p += PESO.token_titulo;
    else if (ix.tituloTokens.some((w) => w.startsWith(t)))
      p += PESO.token_titulo_prefijo;
    else if (ix.nombresNorm.includes(t)) p += PESO.token_nombre;
    else if (ix.materiasNorm.includes(t)) p += PESO.token_materia;
    else p += PESO.token_resto;
  }

  // Desempate por jerarquía: entre dos fallos igual de parecidos, primero el
  // del tribunal más alto (un precedente de la CSJN pesa más que uno de un TOC).
  // Máximo +4: nunca alcanza para dar vuelta un match de texto.
  if (d.tribunal !== null) {
    p += Math.max(0, 5 - metaTribunal(d.tribunal).orden);
  }
  return p;
}

// ————————————————————————————————————————————————————————————————
// Orden
// ————————————————————————————————————————————————————————————————

function porTitulo(a: DocumentoRepositorio, b: DocumentoRepositorio): number {
  return a.titulo.localeCompare(b.titulo, "es");
}

function ordenar(
  docs: DocumentoRepositorio[],
  f: FiltrosNormalizados,
  orden: FiltrosRepositorio["orden"],
): DocumentoRepositorio[] {
  // Sin query no hay relevancia que ordenar: se cae a alfabético.
  const efectivo =
    orden === "relevancia" && f.tokens.length === 0 ? "titulo_asc" : orden;

  if (efectivo === "titulo_asc") return [...docs].sort(porTitulo);

  if (efectivo === "anio_desc") {
    return [...docs].sort((a, b) => {
      // Los documentos sin año van al final, no al principio.
      const ay = a.anio ?? -Infinity;
      const by = b.anio ?? -Infinity;
      return by - ay || porTitulo(a, b);
    });
  }

  const puntajes = new Map<string, number>();
  for (const d of docs) puntajes.set(d.id, puntuar(d, f));
  return [...docs].sort(
    (a, b) =>
      (puntajes.get(b.id) ?? 0) - (puntajes.get(a.id) ?? 0) || porTitulo(a, b),
  );
}

// ————————————————————————————————————————————————————————————————
// Facetas
// ————————————————————————————————————————————————————————————————

function contar(
  catalogo: DocumentoRepositorio[],
  f: FiltrosNormalizados,
  dim: Dimension,
): DocumentoRepositorio[] {
  // Cada faceta se cuenta ignorando SU PROPIO filtro: si el abogado ya eligió
  // "CSJN", los otros tribunales tienen que seguir mostrando su número para que
  // pueda cambiar de idea sin resetear la búsqueda.
  return catalogo.filter((d) => pasa(d, f, dim));
}

function facetas(
  catalogo: DocumentoRepositorio[],
  f: FiltrosNormalizados,
): Facetas {
  const porColeccion = contar(catalogo, f, "coleccion");
  const colecciones = COLECCIONES_VALUES.map((c) => ({
    valor: c,
    label: COLECCIONES[c].label,
    cantidad: porColeccion.filter((d) => d.coleccion === c).length,
  })).filter((x) => x.cantidad > 0);

  const porMateria = contar(catalogo, f, "materia");
  const mapaMaterias = new Map<
    string,
    { valor: string; label: string; coleccion: Coleccion; cantidad: number }
  >();
  for (const d of porMateria) {
    for (const label of d.materias) {
      const valor = slugMateria(d.coleccion, label);
      const prev = mapaMaterias.get(valor);
      if (prev) prev.cantidad++;
      else
        mapaMaterias.set(valor, {
          valor,
          label,
          coleccion: d.coleccion,
          cantidad: 1,
        });
    }
  }

  const porTribunal = contar(catalogo, f, "tribunal");
  const mapaTribunales = new Map<string, number>();
  for (const d of porTribunal) {
    if (d.tribunal === null) continue;
    mapaTribunales.set(d.tribunal, (mapaTribunales.get(d.tribunal) ?? 0) + 1);
  }

  // Décadas y años salen del MISMO conjunto para que los conteos cierren: la
  // década es sólo el agrupador que hace legible la lista de años, y el filtro
  // real es el año exacto. Si los años vinieran de otro lado, el panel ofrecería
  // chips que no existen en el resultado.
  const porAnio = contar(catalogo, f, "anio");
  const mapaDecadas = new Map<string, number>();
  const mapaAnios = new Map<number, number>();
  let sinAnio = 0;
  for (const d of porAnio) {
    const dec = indice(d).decada;
    if (dec === null || d.anio === null) sinAnio++;
    else {
      mapaDecadas.set(dec, (mapaDecadas.get(dec) ?? 0) + 1);
      mapaAnios.set(d.anio, (mapaAnios.get(d.anio) ?? 0) + 1);
    }
  }

  return {
    colecciones,
    materias: [...mapaMaterias.values()].sort(
      (a, b) => b.cantidad - a.cantidad || a.label.localeCompare(b.label, "es"),
    ),
    // Por jerarquía, no por cantidad: la lista se lee como el escalafón real.
    tribunales: [...mapaTribunales.entries()]
      .map(([codigo, cantidad]) => ({
        valor: codigo,
        label: metaTribunal(codigo).corto,
        cantidad,
      }))
      .sort(
        (a, b) =>
          metaTribunal(a.valor).orden - metaTribunal(b.valor).orden ||
          b.cantidad - a.cantidad,
      ),
    decadas: [...mapaDecadas.entries()]
      .map(([dec, cantidad]) => ({
        valor: dec,
        label: `${dec}-${Number(dec) + 9}`,
        cantidad,
      }))
      .sort((a, b) => Number(b.valor) - Number(a.valor)),
    anios: [...mapaAnios.entries()]
      .map(([anio, cantidad]) => ({
        valor: String(anio),
        label: String(anio),
        cantidad,
      }))
      .sort((a, b) => Number(b.valor) - Number(a.valor)),
    sin_anio: sinAnio,
  };
}

// ————————————————————————————————————————————————————————————————
// API pública
// ————————————————————————————————————————————————————————————————

/** Documentos que matchean, ya ordenados. Sin paginar. */
export function buscar(
  catalogo: DocumentoRepositorio[],
  opciones: OpcionesBusqueda = {},
): DocumentoRepositorio[] {
  const f = normalizarFiltros(opciones);
  const filtrados = catalogo.filter((d) => pasa(d, f, null));
  return ordenar(filtrados, f, opciones.orden ?? "relevancia");
}

/** Igual que `buscar`, más los conteos para pintar los filtros. */
export function buscarConFacetas(
  catalogo: DocumentoRepositorio[],
  opciones: OpcionesBusqueda = {},
): ResultadoBusqueda {
  const f = normalizarFiltros(opciones);
  const filtrados = catalogo.filter((d) => pasa(d, f, null));
  return {
    documentos: ordenar(filtrados, f, opciones.orden ?? "relevancia"),
    total: filtrados.length,
    facetas: facetas(catalogo, f),
  };
}

/** Página 1-based. */
export function paginar<T>(items: T[], pagina: number, porPagina: number): T[] {
  const desde = (pagina - 1) * porPagina;
  return items.slice(desde, desde + porPagina);
}

// Índice por id, para la ruta que streamea el archivo. Se arma una vez por
// catálogo (el módulo generado es constante en todo el proceso).
const POR_ID = new WeakMap<
  DocumentoRepositorio[],
  Map<string, DocumentoRepositorio>
>();

export function documentoPorId(
  catalogo: DocumentoRepositorio[],
  id: string,
): DocumentoRepositorio | null {
  let mapa = POR_ID.get(catalogo);
  if (!mapa) {
    mapa = new Map(catalogo.map((d) => [d.id, d]));
    POR_ID.set(catalogo, mapa);
  }
  return mapa.get(id) ?? null;
}
