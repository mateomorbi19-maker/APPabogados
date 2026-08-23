// Tipos, constantes de presentación y schema de validación del Repositorio:
// la biblioteca de jurisprudencia y doctrina penal del estudio, espejada desde
// la carpeta de Google Drive.
//
// El catálogo NO vive en Supabase: es un módulo TS generado
// (`catalogo.ts`, ver scripts/construir-catalogo-repositorio.ts). 351 documentos
// entran en memoria de sobra y la búsqueda sale instantánea sin red ni DB.
// Lo único que se pide a Google en runtime es el binario del PDF.

import { z } from "zod";
import { slugificar } from "./texto";

// ————————————————————————————————————————————————————————————————
// Colecciones
// ————————————————————————————————————————————————————————————————

export const COLECCIONES_VALUES = ["jurisprudencia", "doctrina"] as const;
export type Coleccion = (typeof COLECCIONES_VALUES)[number];

export type ColeccionMeta = {
  label: string;
  /** Para hablar de UN documento suelto ("un fallo", "un artículo"). */
  singular: string;
  /** Qué ES, en una línea. El usuario no es abogado: no dar por sabido nada. */
  descripcion: string;
  /** Para qué le sirve al abogado. Va como subtítulo/tooltip de la sección. */
  para_que: string;
  /** Nombre del ícono de lucide-react (el UI hace el import). */
  icono: string;
  /** Clases Tailwind COMPLETAS (v4 escanea literales, no las construye). */
  badge: string;
  /** Punto/indicador de color. */
  dot: string;
  /** Color de texto del acento. */
  text: string;
};

export const COLECCIONES: Record<Coleccion, ColeccionMeta> = {
  jurisprudencia: {
    label: "Jurisprudencia",
    singular: "fallo",
    descripcion:
      "Sentencias y fallos dictados por organismos de justicia.",
    para_que:
      "Útiles como precedente para fundar pretensiones y demostrar cómo casos similares fueron resueltos. Cuanto más alto el tribunal, mayor el peso del precedente.",
    icono: "Gavel",
    badge: "bg-violet-500/10 text-violet-300 border-violet-500/20",
    dot: "bg-violet-500",
    text: "text-violet-300",
  },
  doctrina: {
    label: "Doctrina",
    singular: "artículo",
    descripcion:
      "Textos de autores y académicos que interpretan y sistematizan la ley.",
    para_que:
      "Sirven para fundamentar cómo debe interpretarse una norma cuando el texto legal no alcanza o admite más de una lectura.",
    icono: "BookOpen",
    badge: "bg-sky-500/10 text-sky-300 border-sky-500/20",
    dot: "bg-sky-500",
    text: "text-sky-300",
  },
};

// ————————————————————————————————————————————————————————————————
// Documento
// ————————————————————————————————————————————————————————————————

export type DocumentoRepositorio = {
  /** Slug estable derivado del título. Único en todo el catálogo. */
  id: string;
  /** Drive id principal (el que se streamea). */
  drive_id: string;
  /** Todos los drive ids del mismo documento (aparece en varias carpetas). */
  drive_ids: string[];
  /** Título limpio y legible. Es lo que se muestra. */
  titulo: string;
  /** Nombre de archivo crudo en Drive, con extensión. Se usa al descargar. */
  titulo_original: string;
  coleccion: Coleccion;
  /** Labels de TODAS las carpetas donde aparece el documento. Nunca vacío. */
  materias: string[];
  /** Código del tribunal (ver TRIBUNALES). null si no se pudo inferir. */
  tribunal: string | null;
  anio: number | null;
  /** Número de causa/expediente tal cual aparece en el título. */
  causa: string | null;
  /** Número de registro de la sentencia. */
  registro: string | null;
  /** Apellido(s) que encabezan la carátula del fallo. */
  caratula: string | null;
  /** Autor del texto de doctrina. */
  autor: string | null;
  /** El título viene testado / con iniciales / con NN (identidad reservada). */
  anonimizado: boolean;
  mime_type: string;
  /** ISO 8601 (modifiedTime de Drive). */
  modificado_en: string;
  /** Link a Drive. Fallback cuando no hay permiso para streamear. */
  view_url: string;
  /** Texto normalizado precomputado contra el que matchea el buscador. */
  busqueda: string;
};

// ————————————————————————————————————————————————————————————————
// Tipos de archivo
// ————————————————————————————————————————————————————————————————

/**
 * MIME que el visor del navegador renderiza sin ejecutar nada de la página.
 * Todo lo que no esté acá se sirve como `attachment` (ver la ruta del archivo):
 * un `text/html` o un `image/svg+xml` servido `inline` correría con el origen
 * de la app.
 */
export const MIMES_INLINE: readonly string[] = [
  "application/pdf",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

export function esInlineSeguro(mime: string): boolean {
  return MIMES_INLINE.includes(mime);
}

// Los MIME del catálogo, dichos como los diría una persona. El abogado no tiene
// por qué leer "application/vnd.openxmlformats-officedocument…" en pantalla.
const ETIQUETA_MIME: Record<string, string> = {
  "application/pdf": "un PDF",
  "application/msword": "un documento de Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "un documento de Word",
  "application/vnd.ms-powerpoint": "una presentación de PowerPoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "una presentación de PowerPoint",
  "application/vnd.ms-excel": "una planilla de Excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "una planilla de Excel",
  "text/plain": "un archivo de texto",
};

/** Nombre legible del tipo de archivo, con artículo ("un documento de Word"). */
export function etiquetaTipoArchivo(mime: string): string {
  return ETIQUETA_MIME[mime] ?? "un archivo que el navegador no sabe mostrar";
}

// ————————————————————————————————————————————————————————————————
// Materias (las carpetas temáticas de Drive)
// ————————————————————————————————————————————————————————————————

export type Materia = {
  /**
   * Slug único GLOBAL: lleva prefijo de colección (`jur-` / `doc-`) porque hay
   * temas que existen en las dos (Lesiones, Hurto, Estupefacientes...) y el
   * filtro de la API toma un solo valor.
   */
  slug: string;
  label: string;
  coleccion: Coleccion;
  /** Documentos únicos en esa materia. */
  cantidad: number;
};

/** Prefijo del slug de materia por colección. */
export const PREFIJO_MATERIA: Record<Coleccion, string> = {
  jurisprudencia: "jur",
  doctrina: "doc",
};

/** Slug de materia a partir de la colección y el label. Determinista. */
export function slugMateria(coleccion: Coleccion, label: string): string {
  return `${PREFIJO_MATERIA[coleccion]}-${slugificar(label)}`;
}

// ————————————————————————————————————————————————————————————————
// Tribunales
// ————————————————————————————————————————————————————————————————

export type TribunalMeta = {
  /** Nombre completo, para tooltip. */
  label: string;
  /** Nombre corto para el chip del filtro. */
  corto: string;
  /**
   * Jerarquía: 1 = máxima instancia. Ordena las facetas y desempata la
   * relevancia — para el abogado un fallo de la CSJN pesa más que uno de un
   * tribunal oral.
   */
  orden: number;
};

export const TRIBUNALES: Record<string, TribunalMeta> = {
  CSJN: {
    label: "Corte Suprema de Justicia de la Nación",
    corto: "CSJN",
    orden: 1,
  },
  CIDH: {
    label: "Corte Interamericana de Derechos Humanos",
    corto: "CIDH",
    orden: 2,
  },
  SCJBA: {
    label: "Suprema Corte de Justicia de la Provincia de Buenos Aires",
    corto: "SCJBA",
    orden: 3,
  },
  SCJT: {
    label: "Corte Suprema de Justicia de Tucumán",
    corto: "SCJ Tucumán",
    orden: 4,
  },
  CFCP: {
    label: "Cámara Federal de Casación Penal",
    corto: "Casación Federal",
    orden: 5,
  },
  CNCCC: {
    label: "Cámara Nacional de Casación en lo Criminal y Correccional",
    corto: "Casación Nacional",
    orden: 6,
  },
  CNCP: {
    label: "Cámara Nacional de Casación Penal",
    corto: "Casación Penal",
    orden: 7,
  },
  CNCC: {
    label: "Cámara Nacional de Apelaciones en lo Criminal y Correccional",
    corto: "Cámara del Crimen",
    orden: 8,
  },
  CCCF: {
    label: "Cámara Nacional de Apelaciones en lo Criminal y Correccional Federal",
    corto: "Cámara Federal",
    orden: 9,
  },
  CNPE: {
    label: "Cámara Nacional de Apelaciones en lo Penal Económico",
    corto: "Cámara Penal Económico",
    orden: 10,
  },
  TOCF: {
    label: "Tribunal Oral en lo Criminal Federal",
    corto: "TOCF",
    orden: 11,
  },
  TOF: { label: "Tribunal Oral Federal", corto: "TOF", orden: 12 },
  TOPE: {
    label: "Tribunal Oral en lo Penal Económico",
    corto: "TOPE",
    orden: 13,
  },
  TOC: { label: "Tribunal Oral en lo Criminal", corto: "TOC", orden: 14 },
  JNCCF: {
    label: "Juzgado Nacional en lo Criminal y Correccional Federal",
    corto: "Juzgado Federal",
    orden: 15,
  },
  JNPE: {
    label: "Juzgado Nacional en lo Penal Económico",
    corto: "Juzgado Penal Económico",
    orden: 16,
  },
  PGN: {
    label: "Procuración General de la Nación (dictamen)",
    corto: "PGN",
    orden: 17,
  },
};

/** Meta de un tribunal, con fallback si el código no está catalogado. */
export function metaTribunal(codigo: string): TribunalMeta {
  return (
    TRIBUNALES[codigo] ?? { label: codigo, corto: codigo, orden: 99 }
  );
}

// ————————————————————————————————————————————————————————————————
// Orden y paginado
// ————————————————————————————————————————————————————————————————

export const ORDENES_VALUES = ["relevancia", "anio_desc", "titulo_asc"] as const;
export type Orden = (typeof ORDENES_VALUES)[number];

export const ORDENES: Record<Orden, { label: string }> = {
  relevancia: { label: "Más relevantes" },
  anio_desc: { label: "Más recientes" },
  titulo_asc: { label: "Título (A-Z)" },
};

export const POR_PAGINA = 30;

// ————————————————————————————————————————————————————————————————
// Filtros de búsqueda
// ————————————————————————————————————————————————————————————————

export type FiltrosRepositorio = {
  q: string;
  coleccion: Coleccion | null;
  /** Slug global de materia (`jur-homicidio`). */
  materia: string | null;
  /** Código de tribunal (`CSJN`). */
  tribunal: string | null;
  anio: number | null;
  orden: Orden;
};

/**
 * Zod del borde de `GET /api/repositorio/documentos`. Todo opcional: sin
 * filtros devuelve el catálogo entero paginado. Los vacíos se colapsan a null
 * para que `?coleccion=` (string vacío, típico de un `<select>` reseteado) no
 * filtre por nada.
 */
const vacioANull = (v: unknown): unknown =>
  typeof v === "string" && v.trim() === "" ? null : v;

export const filtrosRepositorioSchema = z.object({
  q: z.preprocess(
    (v) => (typeof v === "string" ? v.slice(0, 120) : ""),
    z.string(),
  ),
  coleccion: z.preprocess(vacioANull, z.enum(COLECCIONES_VALUES).nullable()),
  materia: z.preprocess(
    vacioANull,
    z
      .string()
      .max(80)
      .regex(/^[a-z0-9-]+$/, "slug de materia inválido")
      .nullable(),
  ),
  tribunal: z.preprocess(
    vacioANull,
    z
      .string()
      .max(12)
      .regex(/^[A-Z]+$/, "código de tribunal inválido")
      .nullable(),
  ),
  // El piso es 1850, no 1900: hay leading cases de la CSJN del siglo XIX en el
  // catálogo (Fallos 9:278, 1891). Tiene que aceptar todo lo que el generador
  // pueda detectar (ANIO_MINIMO en scripts/construir-catalogo-repositorio.ts),
  // si no el chip del año existe pero el filtro devuelve 400.
  anio: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : null),
    z.number().int().min(1850).max(2100).nullable(),
  ),
  orden: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v : "relevancia"),
    z.enum(ORDENES_VALUES),
  ),
  pagina: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : 1),
    z.number().int().min(1).max(1000),
  ),
});

// ————————————————————————————————————————————————————————————————
// Facetas (los conteos que pintan los filtros)
// ————————————————————————————————————————————————————————————————

export type FacetaValor = {
  valor: string;
  label: string;
  cantidad: number;
};

export type Facetas = {
  colecciones: FacetaValor[];
  /** Incluye `coleccion` para agrupar el sidebar por biblioteca. */
  materias: (FacetaValor & { coleccion: Coleccion })[];
  tribunales: FacetaValor[];
  /** Década como string ("2020" = 2020-2029), descendente. */
  decadas: FacetaValor[];
  /**
   * Años exactos presentes en el resultado, descendente. El filtro real es el
   * año, no la década: los chips salen de acá para que ninguno lleve a cero
   * resultados. `sum(anios de una década) === cantidad de esa década`.
   */
  anios: FacetaValor[];
  /** Documentos del resultado sin año detectado. */
  sin_anio: number;
};

export type ResultadoBusqueda = {
  documentos: DocumentoRepositorio[];
  total: number;
  facetas: Facetas;
};
