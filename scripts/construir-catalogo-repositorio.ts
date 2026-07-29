// Generador del catálogo del Repositorio.
//
//   Lee   scripts/data/drive-catalogo.json   (árbol crudo de la carpeta de Drive)
//   Emite src/lib/repositorio/catalogo.ts    (CATALOGO: DocumentoRepositorio[])
//         src/lib/repositorio/catalogo-materias.ts (MATERIAS: Materia[])
//
// Uso: npx tsx scripts/construir-catalogo-repositorio.ts
//
// Por qué un módulo TS y no una tabla: son ~350 documentos: entran en memoria de
// sobra, la búsqueda sale sin red ni DB, y el catálogo queda versionado en git
// (se ve en el diff qué cambió cuando el estudio toca la carpeta de Drive).
//
// Todo lo que hay acá es heurística sobre NOMBRES DE ARCHIVO: no se abre ningún
// PDF. Los nombres los puso el estudio a mano durante años, así que hay typos,
// mayúsculas gritadas, prefijos de listado y sufijos temáticos pegados con
// guión bajo. Cada regla de limpieza está comentada con el caso real que la
// motivó.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  slugMateria,
  COLECCIONES_VALUES,
  type Coleccion,
  type DocumentoRepositorio,
  type Materia,
} from "../src/lib/repositorio/types";
import { normalizarTexto, slugificar } from "../src/lib/repositorio/texto";

const RAIZ = process.cwd();
const ENTRADA = path.join(RAIZ, "scripts/data/drive-catalogo.json");
const SALIDA_CATALOGO = path.join(RAIZ, "src/lib/repositorio/catalogo.ts");
const SALIDA_MATERIAS = path.join(
  RAIZ,
  "src/lib/repositorio/catalogo-materias.ts",
);

// ————————————————————————————————————————————————————————————————
// Entrada
// ————————————————————————————————————————————————————————————————

type ArchivoDrive = {
  id: string;
  titulo: string;
  parentId: string;
  ruta: string;
  mimeType: string;
  modifiedTime: string;
  viewUrl: string;
};

type ArbolDrive = {
  raiz: string;
  carpetas: { id: string; titulo: string; parentId: string; ruta: string }[];
  archivos: ArchivoDrive[];
};

// Sólo documentos legibles. `desktop.ini` (application/octet-stream) es basura
// que Windows deja en cada carpeta sincronizada con Drive: 20 de los 371.
const MIMES_ACEPTADOS = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
]);

// Carpetas de primer nivel → colección.
const CARPETA_COLECCION: Record<string, Coleccion> = {
  "Fallos penal": "jurisprudencia",
  "Doctrina Penal": "doctrina",
};

// ————————————————————————————————————————————————————————————————
// Materias: correcciones explícitas de los nombres de carpeta
// ————————————————————————————————————————————————————————————————

// Sólo corrige el LABEL VISIBLE. La ruta real de Drive queda intacta (es la que
// permite volver a la carpeta original). Se listan únicamente las carpetas que
// necesitan arreglo: typo, acento faltante o mayúscula de más. El resto pasa
// verbatim, así que agregar una carpeta nueva en Drive no rompe nada.
const MATERIAS_CORRECCIONES: Record<string, string> = {
  // --- typos del original ---
  Oborto: "Aborto", // 'Oborto' con O
  PenalEconom: "Penal económico", // sin espacio y cortado
  "Admin publica": "Administración pública",
  "Homicidio Preteritencional": "Homicidio preterintencional",
  "Indubio pro reo": "In dubio pro reo",
  "Derecho a defensa": "Derecho de defensa",
  "Delito contra la libertad": "Delitos contra la libertad",
  "Simulacion IA Argum Juridica": "Simulación con IA y argumentación jurídica",

  // --- acentos y capitalización ---
  "Armas: tenencia y/o portación": "Armas (tenencia y portación)",
  aborto: "Aborto",
  prueba: "Prueba",
  Omision: "Omisión",
  "Omision y acción": "Omisión y acción",
  Victima: "Víctima",
  Carceles: "Cárceles",
  Defraudacion: "Defraudación",
  "Penal Economico": "Penal económico",
  "Legitima defensa": "Legítima defensa",
  "Autoria y participacion": "Autoría y participación",
  "Autoria y participación": "Autoría y participación",
  "Ejecucion de la pena": "Ejecución de la pena",
  "Imputacion objetiva": "Imputación objetiva",
  "Prision Perpetua": "Prisión perpetua",
  "Prision Domiciliaria": "Prisión domiciliaria",
  "Prision Preventiva": "Prisión preventiva",
  "Regimen Penal Juvenil": "Régimen penal juvenil",
  "Garantias constitucionales": "Garantías constitucionales",
  "Ambito espacial de la ley penal": "Ámbito espacial de la ley penal",
  "Ley penal mas benigna": "Ley penal más benigna",
  "Competencia Penal Federal": "Competencia penal federal",
  "Principio de Inocencia": "Principio de inocencia",
  "Principio Acusatorio": "Principio acusatorio",
  "Lesa Humanidad": "Lesa humanidad",
  "Orden Publico": "Orden público",
  "Derechos Humanos": "Derechos humanos",
  "Medidas de Coerción": "Medidas de coerción",
  "Derecho Penal Internacional": "Derecho penal internacional",
  "Abuso Sexual y violacion": "Abuso sexual y violación",
  "Delitos contra el orden publico": "Delitos contra el orden público",
  "Delitos contra la salud publica": "Delitos contra la salud pública",
  "Delitos contra la fe publica": "Delitos contra la fe pública",
  "Analisis Economico del Derecho Penal (AEDP)":
    "Análisis económico del derecho penal (AEDP)",
  "Penal parte empresa": "Penal de la empresa",

  // --- reescrituras para que el label diga qué hay adentro ---
  "Fallos Penal Ambiental": "Penal ambiental",
  "Bagatela - Principio de insignificancia":
    "Bagatela (principio de insignificancia)",
  "Suspension juicio a prueba - Probation":
    "Suspensión del juicio a prueba (probation)",
  "Pena de muerte - estandares internacionales":
    "Pena de muerte (estándares internacionales)",
  "Acción penal - Querella": "Acción penal — Querella",
  "Accion penal - Fiscalía": "Acción penal — Fiscalía",
  "Bien juridico - derecho penal": "Bien jurídico",
};

function labelMateria(carpeta: string): string {
  return MATERIAS_CORRECCIONES[carpeta] ?? carpeta;
}

// ————————————————————————————————————————————————————————————————
// Limpieza del título
// ————————————————————————————————————————————————————————————————

const EXTENSIONES = /\.(pdf|docx?|pptx?)$/i;

// Siglas institucionales: tribunales, códigos y organismos. Se usan para dos
// cosas distintas — no capitalizarlas ("Csjn") y descartarlas como iniciales de
// anonimización (un título que arranca con "TOC" no está testado).
const INSTITUCIONALES = new Set([
  "CSJN", "SCJN", "SCJ", "SCJBA", "CIDH", "CPI",
  "CFCP", "CNCP", "CNCCC", "CNCC", "CNCYC", "CNPE", "CPE", "CCCF", "CCC",
  "TOC", "TOF", "TOCF", "TOPE", "TO1", "JNPE", "JNCCF", "PGN", "CFP", "FCR",
  "CP", "CPP", "CPPF", "CABA", "GAFI", "IPP", "AEDP", "IA", "PPT", "SAVE",
  "CBI", "CS", "MCL", "JJO",
]);

// Iniciales con las que el estudio reserva la identidad. Van aparte de las
// institucionales porque acá SÍ son señal de anonimización.
const INICIALES_CONOCIDAS = new Set([
  "NN", "FAL", "LMR", "MPS", "GPL", "NGR", "ACJ", "GME", "MDE", "FV", "OH",
]);

const SIGLAS = new Set([...INSTITUCIONALES, ...INICIALES_CONOCIDAS]);

// Conectores que en un título TODO EN MAYÚSCULAS deben bajar a minúscula.
const CONECTORES = new Set([
  "de", "del", "la", "las", "el", "los", "y", "e", "o", "u", "en", "a", "al",
  "con", "sin", "por", "para", "que", "un", "una", "sus", "su", "contra",
  "sobre", "ante", "entre", "como", "etc",
]);

const ROMANO = /^(?=[MDCLXVI]+$)M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

const PALABRA = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]*/g;

/** ¿El título está GRITADO (escrito todo en mayúsculas)? */
function esGritado(texto: string): boolean {
  const letras = texto.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
  if (letras.length < 4) return false;
  const mays = letras.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, "").length;
  return mays / letras.length >= 0.7;
}

/**
 * Arregla la capitalización palabra por palabra. NO usa toUpperCase/toLowerCase
 * a lo bruto: hay títulos enteros en mayúsculas ("HOMICIDIO-SIMPLE") que hay
 * que bajar a Capitalizado, pero conviviendo con siglas de tribunal (CSJN),
 * números romanos de las clases (CLASE XVII) e iniciales de anonimización (GPL).
 *
 * La decisión clave es por TÍTULO, no por palabra: en un título gritado se
 * reescribe todo (ahí "FE" es la palabra "fe"), y en uno de capitalización
 * normal sólo se tocan las palabras largas en mayúscula (ahí "A.A" son las
 * iniciales de un imputado y hay que dejarlas quietas).
 */
function capitalizar(texto: string): string {
  const gritado = esGritado(texto);
  let primera = true;
  const out = texto.replace(PALABRA, (p) => {
    const esPrimera = primera;
    primera = false;
    const upper = p.toUpperCase();

    // Sigla escrita en minúscula o Capitalizada en el original
    // ("sentencia-toc-bolsafe", "Toc-6-san-isidro"). Se excluyen las mixtas
    // deliberadas, que ya están bien ("CNCyC").
    const suave = p.slice(1) === p.slice(1).toLowerCase();
    if (p.length >= 3 && suave && SIGLAS.has(upper)) return upper;
    // Ya viene con minúsculas o mixta: el autor decidió, no tocamos.
    if (p !== upper) return p;
    if (ROMANO.test(p)) return p;
    if (SIGLAS.has(upper)) return p;
    if (!gritado) {
      // Fuera de un título gritado, lo corto en mayúscula son iniciales o
      // abreviaturas y se respetan ("A.A", "GPL", "S", "Gramajo Marcelo E").
      if (p.length <= 3) return p;
      // Códigos de expediente ("D45XLI"): tienen dígitos, no son palabras.
      if (/\d/.test(p)) return p;
    }
    if (!esPrimera && CONECTORES.has(p.toLowerCase())) return p.toLowerCase();
    // Dentro de un título gritado, sólo lo que no tiene vocales sigue siendo
    // sigla ("ADM", "CPP", "DR").
    if (gritado && !/[AEIOUÁÉÍÓÚ]/.test(p)) return p;
    return p.charAt(0) + p.slice(1).toLowerCase();
  });
  return out.charAt(0).toUpperCase() + out.slice(1);
}

const PLACEHOLDER_FECHA = " F ";

// Ventana de años plausibles. El piso es 1850 y no 1900 porque la CSJN dicta
// desde 1863 y el corpus tiene leading cases decimonónicos que se citan en
// doctrina ("Charles Hermanos", Fallos 9:278, de 1891). El ruido numérico de
// causas, registros, leyes y artículos ya se borra antes de buscar el año, así
// que bajar el piso no abre la puerta a falsos positivos.
// Espejo en runtime: `filtrosRepositorioSchema.anio` (src/lib/repositorio/types.ts)
// y el hidratado de la URL en src/app/dashboard/repositorio/page.tsx.
const ANIO_MINIMO = 1850;
const ANIO_MAXIMO = 2030;

type FechaDetectada = { texto: string; anio: number; formateada: string };

/**
 * Fecha embebida en el nombre ("CSJN-23-10-2007-Fallo-Palero"). Se busca ANTES
 * de convertir los guiones en espacios, porque después es indistinguible de
 * números sueltos. Primero el patrón con año de 4 dígitos: si no, "TOPE-2-07-07-2015"
 * matchearía "2-07-07" y daría 2007 en vez de 2015.
 */
function detectarFecha(base: string): FechaDetectada | null {
  const patrones: { re: RegExp; corto: boolean }[] = [
    { re: /(?<!\d)(\d{1,2})[-./](\d{1,2})[-./](\d{4})(?!\d)/, corto: false },
    { re: /(?<!\d)(\d{1,2})[-./](\d{1,2})[-./](\d{2})(?!\d)/, corto: true },
  ];
  for (const { re, corto } of patrones) {
    const m = re.exec(base);
    if (!m) continue;
    const d = Number(m[1]);
    const mes = Number(m[2]);
    if (d < 1 || d > 31 || mes < 1 || mes > 12) continue;
    const bruto = Number(m[3]);
    // Dos dígitos: >30 es siglo XX (98 → 1998), si no siglo XXI (18 → 2018).
    const anio = corto ? (bruto > 30 ? 1900 + bruto : 2000 + bruto) : bruto;
    if (anio < ANIO_MINIMO || anio > ANIO_MAXIMO) continue;
    const dd = String(d).padStart(2, "0");
    const mm = String(mes).padStart(2, "0");
    return { texto: m[0], anio, formateada: `${dd}/${mm}/${anio}` };
  }
  return null;
}

// Números de causa / registro / ley / artículo. Se extraen como metadata y
// además se BORRAN antes de buscar el año: "reg. Nº 1976" y "reg. Nº 2020" son
// números de registro, no años, y si no se sacan se cuelan como anio.
const RE_CAUSA = /causa\s*(?:n[°ºo.]*\s*)?([0-9][0-9./-]*[a-z]?)/i;
const RE_REGISTRO = /\breg\.?\s*n?[°ºo.]*\s*([0-9][0-9./-]*)/i;
const RE_RUIDO_NUMERICO =
  /(causa\s*n?[°ºo.]*\s*[0-9][0-9./-]*[a-z]?)|(\breg\.?\s*n?[°ºo.]*\s*[0-9][0-9./-]*)|(\bleyes?\s*n?[°ºo.]*\s*[0-9][0-9.]*)|(\barts?\.?\s*[0-9]+)/gi;

/** Año del título, si hay uno plausible. */
function detectarAnio(base: string, fecha: FechaDetectada | null): number | null {
  if (fecha) return fecha.anio;
  const limpio = base.replace(RE_RUIDO_NUMERICO, " ");
  const re = /(?<!\d)(\d{4})(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(limpio)) !== null) {
    const n = Number(m[1]);
    if (n >= ANIO_MINIMO && n <= ANIO_MAXIMO) return n;
  }
  return null;
}

/**
 * Nombre de archivo → título legible. Devuelve también la base intermedia (con
 * los separadores crudos) porque las regex de metadata trabajan sobre esa.
 */
function limpiarTitulo(original: string): {
  titulo: string;
  base: string;
  fecha: FechaDetectada | null;
} {
  let base = original.replace(EXTENSIONES, "");
  // Extensión embebida: "16-DISPOSITIVA-LAVADO.pdf-carbon.pdf".
  base = base.replace(/\.(pdf|docx?|pptx?)(?=[\s\-_])/gi, " ");
  // Marcador de copia de Drive/Windows: "... (causa N° 59300) (1)", "...-(2)-(1)".
  base = base.replace(/(?:[\s\-_]*\(\d\))+\s*$/g, "");
  // Sufijo temático que el estudio pega con guión bajo:
  // "Castillo (causa N° 2450)_princip_inocencia" → fuera "_princip_inocencia".
  // Sólo cuando el guión bajo NO es el separador principal del nombre, si no
  // destrozaría "Medidas_de_coerción_procesal_penal".
  if (/[\s-]/.test(base)) base = base.replace(/_[A-Za-z][A-Za-z_]*$/, "");
  // Prefijo de listado: "21-Belizan", "23. Mambrín", "02--PRCTICA". Hasta 3
  // dígitos: "118272_CACERES" es un número de expediente, no un prefijo.
  base = base.replace(/^\s*\d{1,3}\s*[-–—.]+\s*/, "");

  const fecha = detectarFecha(base);
  let titulo = fecha ? base.replace(fecha.texto, PLACEHOLDER_FECHA) : base;

  titulo = titulo
    .replace(/[_]+/g, " ")
    .replace(/-+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // "Clase-hurto-PDF.pdf" deja un "PDF" suelto al final.
    .replace(/\s+(pdf|docx?|pptx?)$/i, "");

  titulo = capitalizar(titulo);
  if (fecha) titulo = titulo.replace(PLACEHOLDER_FECHA, fecha.formateada);

  return { titulo: titulo.trim(), base, fecha };
}

// ————————————————————————————————————————————————————————————————
// Tribunal
// ————————————————————————————————————————————————————————————————

// Orden = prioridad: gana el primero que matchea, así que van de más específico
// a más genérico. Los patrones corren sobre el título normalizado (minúsculas,
// sin acentos), por eso están escritos sin tildes.
const TRIBUNAL_PATRONES: { codigo: string; patrones: RegExp[] }[] = [
  // 'SCJN' en el original es un typo de CSJN (Nápoli es un fallo de la Corte
  // Suprema nacional). Se normaliza para no partir la faceta en dos.
  {
    codigo: "CSJN",
    patrones: [
      /\bcsjn\b/,
      /\bscjn\b/,
      /corte\s+suprema\s+de\s+justicia\s+de\s+la\s+nacion/,
    ],
  },
  {
    codigo: "SCJT",
    patrones: [
      /\bscj\s+tucuman\b/,
      /corte\s+suprema\s+de\s+justicia\s+de\s+la\s+provincia\s+de\s+tucuman/,
    ],
  },
  {
    codigo: "CIDH",
    patrones: [
      /\bcidh\b/,
      /corte\s+interamericana/,
      /\bvs?\s+(argentina|venezuela|costa\s+rica|peru|chile|colombia|mexico)\b/,
    ],
  },
  { codigo: "SCJBA", patrones: [/\bscjba\b/, /suprema\s+corte\s+de\s+justicia\s+de\s+buenos\s+aires/] },
  { codigo: "CFCP", patrones: [/\bcfcp\b/, /camara\s+federal\s+de\s+casacion/] },
  { codigo: "CNCCC", patrones: [/\bcnccc\b/] },
  {
    codigo: "CNCP",
    patrones: [/\bcncp\b/, /camara\s+(nacional\s+)?de\s+casacion\s+penal/],
  },
  { codigo: "CCCF", patrones: [/\bcccf\b/] },
  {
    codigo: "CNCC",
    patrones: [
      /\bcncc\b/,
      /\bcncyc\b/,
      /camara\s+nacional\s+de\s+apelaciones\s+en\s+lo\s+criminal/,
    ],
  },
  { codigo: "CNPE", patrones: [/\bcnpe\b/, /\bcpe\b/] },
  { codigo: "TOCF", patrones: [/\btocf\b/, /tribunal\s+criminal\s+oral\s+federal/] },
  { codigo: "TOPE", patrones: [/\btope\b/] },
  { codigo: "TOF", patrones: [/\btof\b/] },
  { codigo: "TOC", patrones: [/\btoc\b/] },
  { codigo: "JNCCF", patrones: [/\bjnccf\b/] },
  { codigo: "JNPE", patrones: [/\bjnpe\b/] },
  { codigo: "PGN", patrones: [/\bpgn\b/] },
];

function detectarTribunal(titulo: string): string | null {
  const n = normalizarTexto(titulo);
  for (const { codigo, patrones } of TRIBUNAL_PATRONES) {
    if (patrones.some((p) => p.test(n))) return codigo;
  }
  return null;
}

// ————————————————————————————————————————————————————————————————
// Anonimización
// ————————————————————————————————————————————————————————————————

// Siglas que NO son iniciales de una persona (son tribunales u organismos).
const NO_SON_INICIALES = new Set([
  ...INSTITUCIONALES,
  "FALLO", "CLASE", "DOCTRINA", "PDF",
]);

/**
 * ¿El título esconde la identidad? Tres marcas en el corpus real:
 * "Belizan - Testado", "NN (Causa N° 4577)" y las iniciales sueltas
 * ("GPL (causa N° 23568)", "T, OH", "H AO", "A.A", "Fallo-LMR").
 */
function detectarAnonimizado(titulo: string, coleccion: Coleccion): boolean {
  if (/\b(testad[oa]s?|ttado)\b/i.test(titulo)) return true;
  if (/\bN\.?\s?N\.?\b/.test(titulo)) return true;
  // Sólo en fallos: en doctrina "DOLO" o "PPT" no son iniciales de nadie.
  if (coleccion !== "jurisprudencia") return false;
  // "Autoincriminacion Fallo LMR", "Retroactividad ... Fallo MPS".
  const tras = /\b(?:fallo|caso)\s+([A-ZÁÉÍÓÚÑ]{2,4})\b/.exec(titulo);
  if (tras && !NO_SON_INICIALES.has(tras[1])) return true;
  // Iniciales encabezando el título, o justo después de "Fallo"/"Caso".
  let cuerpo = titulo.replace(/^(fallo|caso)\s+/i, "");
  // Dos pasadas: la primera puede tropezar con la sigla del tribunal
  // ("TOC 7 FV y otros"), así que si la cabeza es institucional se reintenta
  // sin ella.
  for (let i = 0; i < 2; i++) {
    const m = /^([A-ZÁÉÍÓÚÑ]\.?[\s,]*){1,2}([A-ZÁÉÍÓÚÑ]{1,3})?\b/.exec(cuerpo);
    if (!m) return false;
    const cabeza = m[0].replace(/[^A-ZÁÉÍÓÚÑ]/g, "");
    if (cabeza.length < 2 || cabeza.length > 4) return false;
    if (NO_SON_INICIALES.has(cabeza)) {
      cuerpo = cuerpo.slice(m[0].length).replace(/^[\s.,:-]*\d*\s*/, "");
      continue;
    }
    // Debe cortar ahí: "GPL (causa..." sí, "ROMERO, NATALIA..." no.
    const resto = cuerpo.slice(m[0].length);
    return /^[\s(,._-]/.test(resto) || resto.length === 0;
  }
  return false;
}

// ————————————————————————————————————————————————————————————————
// Carátula (jurisprudencia)
// ————————————————————————————————————————————————————————————————

// Palabras que delatan que el título es un TEMA y no la carátula de un fallo.
const TEMAS_NO_CARATULA = new Set([
  "homicidio", "lesiones", "hurto", "robo", "sentencia", "jurisprudencia",
  "clase", "doctrina", "fallo", "fallos", "dispositiva", "boletin", "penal",
  "prueba", "aborto", "probation", "competencia", "autoincriminacion",
  "determinacion", "cuantificacion", "ambito", "retroactividad", "bien",
  "evasion", "lavado", "guia", "manual", "tipologias", "medidas", "orden",
  "derechos", "reglas", "practica", "anexo", "art", "arts", "causa",
  "tenencia", "abuso", "intermediacion", "condena", "dictamen", "corte",
  "camara", "tribunal", "plenario", "asesor", "cuadro", "teoria", "teorias",
  "crisis", "nexo", "imputacion", "responsabilidad", "simulaciones",
  "simulacion", "control", "juicio", "recurso", "nulidades", "flagrancia",
  "transferencia", "falsificacion", "estatuto", "indicaciones", "copia",
  "evolucion", "aportes", "libertad", "dolo", "culpa", "amenazas", "delitos",
  "delito", "principio", "sobre", "acerca", "cuestiones",
  "asociacion", "esquema", "sistema", "pena", "prision", "regimen",
  "derecho", "articulo", "casacion", "interpretacion", "constitucionalidad",
  "confirmacion", "salidas", "concepto", "fundamentos", "participacion",
  "plenario", "homic", "ttado", "veredicto", "legajo", "incidente",
  "procesamiento", "sobreseimiento", "nulidad", "revocacion", "noticia",
  "cuadernillo", "tipologias", "estandares", "bolilla", "presentacion",
  "ejecucion", "determinacion", "ley", "leyes", "retroactividad", "acuerdo",
  "completa", "sustitucion", "evasion", "medidas", "reglas",
  // "JNPE 2 22/09/2016 Antonini Wilson Decomiso anticipado",
  // "Menéndez Cartel de Juarez 2016 CABA", "CSJN Tejerina Culpabilidadpd"
  // (el "pd" pegado es un resto de la extensión en el nombre original),
  // "CFCP Orona BruzzoneAutoria y participacion Art 47".
  "decomiso", "cartel", "culpabilidad", "culpabilidadpd", "autoria",
]);

// Lugares: quedan al frente cuando el tribunal trae sede ("TOF Mar del Plata").
const LUGARES = new Set([
  "mar del plata", "bahia blanca", "la plata", "san isidro", "san martin",
  "corrientes", "mendoza", "tucuman", "caba", "buenos aires", "cordoba",
  "salta", "rosario", "comodoro py",
]);

/**
 * ¿La palabra es un tema pegado a otra cosa sin separador ("BruzzoneAutoria")?
 * La mayúscula interna es el único límite que quedó. Se exige que lo que sigue
 * a esa mayúscula sea una palabra de tema conocida: hay apellidos reales con
 * mayúscula interna ("DelOlio") que no hay que tocar.
 */
function temaFusionado(palabra: string): boolean {
  const m = /[a-záéíóúñ]([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúüñ]*)$/.exec(palabra);
  return m !== null && TEMAS_NO_CARATULA.has(normalizarTexto(m[1]));
}

function extraerCaratula(titulo: string, tribunal: string | null): string | null {
  const directa = caratulaDirecta(titulo, tribunal);
  if (directa) return directa;
  // Fallback: "Ambito espacial de la ley penal Fallo Moralejo" — el nombre va
  // al final, detrás de la palabra "Fallo"/"Caso".
  const m = /\b(?:fallo|caso)\s+([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\b/i.exec(titulo);
  return m ? validarCaratula(m[1]) : null;
}

function caratulaDirecta(titulo: string, tribunal: string | null): string | null {
  let t = titulo;

  // Fecha o número de expediente al frente: "CSJN 12/09/2023 Salidas...",
  // "118272 Caceres agravante". Se saca antes que la sala para que el "23" de
  // "23/10/2007" no se coma como si fuera una nominación de tribunal.
  const quitarNumerosIniciales = (s: string): string =>
    s
      .replace(/^\d{1,2}\/\d{1,2}\/\d{2,4}[\s.,:-]*/, "")
      .replace(/^\d+\s+/, "");

  // Fuera el tribunal cuando encabeza o cierra, con su sala/nominación.
  if (tribunal) {
    t = t.replace(new RegExp(`^${tribunal}\\b[\\s.,:-]*`, "i"), "");
    t = quitarNumerosIniciales(t);
    t = t.replace(/^(sala\s+[ivxlc]+|n[°º]?\s*\d+)[\s.,:-]*/i, "");
    // "Alvarado, Julio CSJN" → la sigla al final no es parte de la carátula.
    t = t.replace(new RegExp(`[\\s.,:-]*\\b${tribunal}\\b.*$`, "i"), "");
  }
  t = quitarNumerosIniciales(t);
  // Fuera los encabezados genéricos.
  t = t.replace(
    /^(fallo|caso|sentencia|dictamen|boletin|bolet[íi]n|copia\s+de|condena|competencia)\s+(de\s+|del\s+)?/i,
    "",
  );
  t = quitarNumerosIniciales(t);
  // Fuera la marca de anonimización: no es parte del nombre.
  t = t.replace(/[\s-]*\b(testado|ttado)\b[\s-]*/gi, " ");
  // Corta en el paréntesis (causa/registro/sala) y en el sufijo procesal.
  t = t.split("(")[0];
  t = t.split(/\s[—–]\s/)[0];
  t = t.replace(/\s+s[\s./-]+.*$/i, "");
  t = t.replace(/\s+(sobre|segun|seg[úu]n)\s+.*$/i, "");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length === 0) return null;

  let palabras = t.split(" ").slice(0, 6);

  // Sede del tribunal delante del nombre: "Toc 6 san isidro Carrascosa".
  // Se descartan sólo si después queda algún nombre propio.
  while (
    palabras.length > 1 &&
    palabras[0] === palabras[0].toLowerCase() &&
    palabras.slice(1).some((p) => p !== p.toLowerCase())
  ) {
    palabras = palabras.slice(1);
  }

  // Corta en la primera palabra que ya no puede ser parte de un nombre: un
  // número ("Diaz Bessone Plenario 13 2008"), una sigla ("Vattuone CPE Sala B"),
  // el "v." de los casos de la CIDH, o una palabra de tema
  // ("Real de Azúa Asociación ilícita" → "Real de Azúa").
  const corte = palabras.findIndex((p, i) => {
    const n = normalizarTexto(p);
    if (n.length === 0) return false;
    if (/^\d/.test(n)) return true;
    if (SIGLAS.has(p.toUpperCase())) return true;
    if (i > 0 && (n === "v" || n === "vs")) return true;
    if (TEMAS_NO_CARATULA.has(n)) return true;
    return temaFusionado(p);
  });
  if (corte === 0) return null;
  if (corte > 0) palabras = palabras.slice(0, corte);

  // Las palabras finales en minúscula son el tema pegado al nombre
  // ("Romero, Natalia Johana R casac", "Schlaen extradición denegada").
  while (palabras.length > 1) {
    const ult = palabras[palabras.length - 1];
    if (ult !== ult.toLowerCase()) break;
    palabras = palabras.slice(0, -1);
  }
  if (palabras.length === 0) return null;
  return validarCaratula(palabras.join(" "));
}

/** Filtra los candidatos que son un TEMA y no el nombre de una parte. */
function validarCaratula(candidato: string): string | null {
  const cand = candidato.replace(/[,;:.\s-]+$/, "");
  const norm = normalizarTexto(cand);
  if (norm.length < 3 || norm.length > 60) return null;
  if (LUGARES.has(norm)) return null;
  if (SIGLAS.has(cand.toUpperCase())) return null;
  if (TEMAS_NO_CARATULA.has(norm.split(" ")[0])) return null;
  // Un nombre propio arranca con mayúscula; si todo está en minúscula es tema.
  if (cand === cand.toLowerCase()) {
    const uno = cand.split(" ")[0];
    if (uno.length < 4 || TEMAS_NO_CARATULA.has(uno)) return null;
    return uno.charAt(0).toUpperCase() + uno.slice(1);
  }
  return cand;
}

// ————————————————————————————————————————————————————————————————
// Autor (doctrina)
// ————————————————————————————————————————————————————————————————

// Apellidos que en el corpus sólo aparecen al frente y sin separador `---`
// ("Frister-Teorias-de-la-pena"), donde ninguna regla estructural los detecta.
const AUTORES_CONOCIDOS = [
  "Frister", "Bacigalupo", "Goldman", "Donna", "Munoz Damian", "Di Corleto",
  "Roxin", "Jakobs", "Ziffer", "Bruzzone", "Storchi", "Falcone",
];

/** Autor cuando el nombre ya perdió el separador `---` en la limpieza. */
function autorDesdeTituloLimpio(titulo: string): string | null {
  // "Falcone, Roberto A, Derecho Penal y trafico de drogas" → hasta la 2da coma.
  const comas = titulo.split(",");
  if (comas.length >= 2 && /^[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+$/.test(comas[0].trim())) {
    const segundo = comas[1].trim();
    // "Apellido, Nombre A, ..." (el 2do trozo es nombre propio corto).
    if (comas.length >= 3 && /^[A-ZÁÉÍÓÚÑ][\wáéíóúñ.]*( [A-ZÁÉÍÓÚÑ]\.?)?$/.test(segundo)) {
      return `${comas[0].trim()}, ${segundo}`;
    }
    return comas[0].trim();
  }
  // "Bien juridico Articulo Roxin 2" / "... Articulo MCL" → autor al final.
  const art = /\barticulo\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñ]*(?:\s+y\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ]*)?)\s*\d*$/i.exec(titulo);
  if (art) return art[1].trim();
  // Apellido conocido encabezando.
  for (const a of AUTORES_CONOCIDOS) {
    if (new RegExp(`^${a}\\b`, "i").test(titulo)) return a;
  }
  return null;
}

/**
 * Autor de un texto de doctrina. La señal más fuerte es el separador `---` del
 * nombre CRUDO ("Cancio-Melia---Aproximacion-a-la-teoria..."), que la limpieza
 * del título disuelve en espacios; por eso se mira el original.
 */
function detectarAutor(tituloOriginal: string, tituloLimpio: string): string | null {
  const base = tituloOriginal.replace(EXTENSIONES, "");
  const tri = /^(.{2,60}?)\s*-{3,}\s*/.exec(base);
  if (tri) {
    const autor = capitalizar(tri[1].replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim());
    if (autor.length >= 3) return autor;
  }
  return autorDesdeTituloLimpio(tituloLimpio);
}

// ————————————————————————————————————————————————————————————————
// Construcción
// ————————————————————————————————————————————————————————————————

type Parcial = Omit<DocumentoRepositorio, "id" | "drive_ids" | "materias" | "busqueda"> & {
  materia: string;
  clave: string;
};

function construirParcial(a: ArchivoDrive, coleccion: Coleccion, materia: string): Parcial {
  const { titulo, base, fecha } = limpiarTitulo(a.titulo);
  const tribunal = detectarTribunal(titulo);
  const anio = detectarAnio(base, fecha);

  const mCausa = RE_CAUSA.exec(base);
  const mReg = RE_REGISTRO.exec(base);

  const esFallo = coleccion === "jurisprudencia";

  return {
    drive_id: a.id,
    titulo,
    titulo_original: a.titulo,
    coleccion,
    materia,
    tribunal,
    anio,
    causa: mCausa ? mCausa[1].replace(/[.\-/]+$/, "") : null,
    registro: mReg ? mReg[1].replace(/[.\-/]+$/, "") : null,
    caratula: esFallo ? extraerCaratula(titulo, tribunal) : null,
    autor: esFallo ? null : detectarAutor(a.titulo, titulo),
    anonimizado: detectarAnonimizado(titulo, coleccion),
    mime_type: a.mimeType,
    modificado_en: a.modifiedTime,
    view_url: a.viewUrl,
    // Agrupa duplicados: el mismo fallo está en varias carpetas temáticas
    // ("Fallo-Salvini.pdf" en Robo, Iter criminis y Lesiones).
    clave: `${coleccion}|${normalizarTexto(titulo)}`,
  };
}

function main(): void {
  const arbol = JSON.parse(readFileSync(ENTRADA, "utf8")) as ArbolDrive;

  // La ubicación se resuelve por parentId, NO partiendo `ruta` por "/": hay
  // carpetas cuyo nombre lleva una barra ("Armas: tenencia y/o portación") y
  // partir la ruta las corta al medio.
  const carpetas = new Map(arbol.carpetas.map((c) => [c.id, c]));

  const parciales: Parcial[] = [];
  let descartados = 0;

  for (const a of arbol.archivos) {
    if (!MIMES_ACEPTADOS.has(a.mimeType)) {
      descartados++;
      continue;
    }
    const carpeta = carpetas.get(a.parentId);
    if (!carpeta) {
      descartados++;
      continue;
    }
    // Profundidad máxima 2: raíz de colección + carpeta temática. Un archivo
    // suelto en la raíz de la colección queda en la materia "General".
    const esRaizColeccion = carpeta.parentId === arbol.raiz;
    const padre = esRaizColeccion ? carpeta : carpetas.get(carpeta.parentId);
    const coleccion = padre ? CARPETA_COLECCION[padre.titulo] : undefined;
    if (!coleccion) {
      descartados++;
      continue;
    }
    const materia = esRaizColeccion ? "General" : carpeta.titulo;
    parciales.push(construirParcial(a, coleccion, labelMateria(materia)));
  }

  // --- agrupado de duplicados ---
  const grupos = new Map<string, Parcial[]>();
  for (const p of parciales) {
    const g = grupos.get(p.clave);
    if (g) g.push(p);
    else grupos.set(p.clave, [p]);
  }

  type SinId = { slugBase: string; doc: Omit<DocumentoRepositorio, "id"> };
  const sinId: SinId[] = [];

  for (const [, grupo] of grupos) {
    // Orden estable por drive_id: el "principal" no depende del orden del JSON.
    const ordenado = [...grupo].sort((x, y) => x.drive_id.localeCompare(y.drive_id));
    const cabeza = ordenado[0];
    const materias = [...new Set(ordenado.map((p) => p.materia))].sort((a, b) =>
      a.localeCompare(b, "es"),
    );
    // Metadata: gana el primer valor no nulo del grupo (todos son el mismo doc).
    const primero = <K extends keyof Parcial>(k: K): Parcial[K] | null => {
      for (const p of ordenado) if (p[k] !== null) return p[k];
      return null;
    };

    const busqueda = normalizarTexto(
      [
        cabeza.titulo,
        ...materias,
        primero("tribunal") ?? "",
        primero("caratula") ?? "",
        primero("autor") ?? "",
        cabeza.coleccion,
        primero("anio") ?? "",
        primero("causa") ?? "",
      ].join(" "),
    );

    sinId.push({
      slugBase: slugificar(cabeza.titulo),
      doc: {
        drive_id: cabeza.drive_id,
        drive_ids: ordenado.map((p) => p.drive_id),
        titulo: cabeza.titulo,
        titulo_original: cabeza.titulo_original,
        coleccion: cabeza.coleccion,
        materias,
        tribunal: primero("tribunal"),
        anio: primero("anio"),
        causa: primero("causa"),
        registro: primero("registro"),
        caratula: primero("caratula"),
        autor: primero("autor"),
        anonimizado: ordenado.some((p) => p.anonimizado),
        mime_type: cabeza.mime_type,
        modificado_en: ordenado
          .map((p) => p.modificado_en)
          .sort()
          .reverse()[0],
        view_url: cabeza.view_url,
        busqueda,
      },
    });
  }

  // --- ids únicos y estables ---
  const porSlug = new Map<string, SinId[]>();
  for (const s of sinId) {
    const g = porSlug.get(s.slugBase);
    if (g) g.push(s);
    else porSlug.set(s.slugBase, [s]);
  }
  const documentos: DocumentoRepositorio[] = [];
  for (const [slug, grupo] of porSlug) {
    // Desempate por drive_id (no por orden de iteración) para que el id de un
    // documento no cambie si mañana se agrega otro archivo con título parecido.
    const ordenado = [...grupo].sort((a, b) =>
      a.doc.drive_id.localeCompare(b.doc.drive_id),
    );
    ordenado.forEach((s, i) => {
      documentos.push({ id: i === 0 ? slug : `${slug}-${i + 1}`, ...s.doc });
    });
  }

  documentos.sort(
    (a, b) =>
      a.coleccion.localeCompare(b.coleccion) ||
      a.titulo.localeCompare(b.titulo, "es"),
  );

  // --- materias con conteo ---
  const conteo = new Map<string, Materia>();
  for (const d of documentos) {
    for (const label of d.materias) {
      const slug = slugMateria(d.coleccion, label);
      const prev = conteo.get(slug);
      if (prev) prev.cantidad++;
      else conteo.set(slug, { slug, label, coleccion: d.coleccion, cantidad: 1 });
    }
  }
  const materias = [...conteo.values()].sort(
    (a, b) =>
      a.coleccion.localeCompare(b.coleccion) || a.label.localeCompare(b.label, "es"),
  );

  escribirCatalogo(documentos);
  escribirMaterias(materias, documentos);
  reporte(arbol, documentos, materias, descartados);
}

// ————————————————————————————————————————————————————————————————
// Emisión
// ————————————————————————————————————————————————————————————————

const CABECERA = `// ARCHIVO GENERADO — NO EDITAR A MANO.
// Regenerar con:  npx tsx scripts/construir-catalogo-repositorio.ts
// Fuente: scripts/data/drive-catalogo.json (árbol de la carpeta de Drive del estudio).
`;

function lit(v: string | number | boolean | null): string {
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}

function litArray(v: string[]): string {
  return `[${v.map((s) => JSON.stringify(s)).join(", ")}]`;
}

function escribirCatalogo(docs: DocumentoRepositorio[]): void {
  const filas = docs
    .map(
      (d) => `  {
    id: ${lit(d.id)},
    drive_id: ${lit(d.drive_id)},
    drive_ids: ${litArray(d.drive_ids)},
    titulo: ${lit(d.titulo)},
    titulo_original: ${lit(d.titulo_original)},
    coleccion: ${lit(d.coleccion)},
    materias: ${litArray(d.materias)},
    tribunal: ${lit(d.tribunal)},
    anio: ${lit(d.anio)},
    causa: ${lit(d.causa)},
    registro: ${lit(d.registro)},
    caratula: ${lit(d.caratula)},
    autor: ${lit(d.autor)},
    anonimizado: ${lit(d.anonimizado)},
    mime_type: ${lit(d.mime_type)},
    modificado_en: ${lit(d.modificado_en)},
    view_url: ${lit(d.view_url)},
    busqueda: ${lit(d.busqueda)},
  },`,
    )
    .join("\n");

  const contenido = `${CABECERA}//
// ${docs.length} documentos únicos. \`server-only\`: son ~200 KB de datos que no
// deben viajar al browser — la UI consume /api/repositorio/documentos.

import "server-only";
import type { DocumentoRepositorio } from "./types";

export const CATALOGO: DocumentoRepositorio[] = [
${filas}
];
`;
  writeFileSync(SALIDA_CATALOGO, contenido, "utf8");
}

function escribirMaterias(
  materias: Materia[],
  docs: DocumentoRepositorio[],
): void {
  const filas = materias
    .map(
      (m) =>
        `  { slug: ${lit(m.slug)}, label: ${lit(m.label)}, coleccion: ${lit(m.coleccion)}, cantidad: ${m.cantidad} },`,
    )
    .join("\n");

  const totales = COLECCIONES_VALUES.map(
    (c) => `  ${c}: ${docs.filter((d) => d.coleccion === c).length},`,
  ).join("\n");

  const contenido = `${CABECERA}//
// Índice temático liviano (${materias.length} materias). A diferencia de catalogo.ts NO es
// server-only: es chico y la UI lo puede importar para pintar el árbol de la
// biblioteca sin esperar a la API.

import type { Coleccion, Materia } from "./types";

export const MATERIAS: Materia[] = [
${filas}
];

// Documentos ÚNICOS por colección. NO se puede derivar sumando \`cantidad\` de
// MATERIAS: un documento que vive en varias carpetas de Drive cuenta una vez por
// materia, así que esa suma da de más y contradice el total del header.
export const DOCUMENTOS_POR_COLECCION: Record<Coleccion, number> = {
${totales}
};
`;
  writeFileSync(SALIDA_MATERIAS, contenido, "utf8");
}

// ————————————————————————————————————————————————————————————————
// Reporte
// ————————————————————————————————————————————————————————————————

function reporte(
  arbol: ArbolDrive,
  docs: DocumentoRepositorio[],
  materias: Materia[],
  descartados: number,
): void {
  const porColeccion = (c: Coleccion): number =>
    docs.filter((d) => d.coleccion === c).length;
  const conTribunal = docs.filter((d) => d.tribunal !== null).length;
  const conAnio = docs.filter((d) => d.anio !== null).length;
  const conCaratula = docs.filter((d) => d.caratula !== null).length;
  const conAutor = docs.filter((d) => d.autor !== null).length;
  const anonimos = docs.filter((d) => d.anonimizado).length;
  const dups = docs.filter((d) => d.drive_ids.length > 1);

  console.log(`archivos en Drive        : ${arbol.archivos.length}`);
  console.log(`descartados (no legibles): ${descartados}`);
  console.log(`documentos únicos        : ${docs.length}`);
  console.log(`  jurisprudencia         : ${porColeccion("jurisprudencia")}`);
  console.log(`  doctrina               : ${porColeccion("doctrina")}`);
  console.log(`materias                 : ${materias.length}`);
  console.log(`con tribunal             : ${conTribunal}`);
  console.log(`con año                  : ${conAnio}`);
  console.log(`con carátula             : ${conCaratula}`);
  console.log(`con autor                : ${conAutor}`);
  console.log(`anonimizados             : ${anonimos}`);
  console.log(`agrupados (multi-carpeta): ${dups.length}`);
  for (const d of dups) {
    console.log(`   · ${d.titulo}  →  ${d.materias.join(" / ")}`);
  }

  if (process.env.DETALLE === "1") {
    console.log("\n--- muestra ---");
    for (const d of docs) {
      console.log(
        [
          d.coleccion.slice(0, 3),
          d.titulo.padEnd(62).slice(0, 62),
          (d.tribunal ?? "-").padEnd(6),
          String(d.anio ?? "----"),
          (d.caratula ?? d.autor ?? "-").padEnd(28).slice(0, 28),
          d.anonimizado ? "ANON" : "",
        ].join(" | "),
      );
    }
  }
}

main();
