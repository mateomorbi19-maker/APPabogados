// ¿Quedó algún dato real en los modelos de escritos del estudio?
//
// Los 88 modelos de `scripts/data/modelos-estudio-drive/` son escritos que el
// estudio PRESENTÓ en causas reales. Antes de entrar al repo se les sacaron los
// datos de esas causas, pero eso es un trabajo de lectura y la lectura falla:
// en la primera pasada quedó un archivo con el nombre de una abogada, su CUIT y
// una causa de abuso sexual contra una menor identificable por sus iniciales,
// su fecha de nacimiento y el juzgado. Se descartó, y este script nació de ahí.
//
// NO reemplaza a que un abogado los lea. Detecta lo que una expresión regular
// puede detectar —números, correos, teléfonos, matrículas— y señala lo que
// PARECE un nombre propio para que alguien lo mire. Un nombre escrito con
// naturalidad en medio de un relato no lo encuentra ningún regex: eso es lo que
// pasó la primera vez.
//
// Correrlo cada vez que se agregue o se toque un modelo:
//
//   npx tsx scripts/verificar-anonimizacion.ts            # sólo lo alarmante
//   npx tsx scripts/verificar-anonimizacion.ts --nombres  # + los candidatos a nombre propio
//
// Sale con código 1 si encuentra algo de la primera clase.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "scripts/data/modelos-estudio-drive");
const CON_NOMBRES = process.argv.includes("--nombres");

// ————————————————————————————————————————————————————————————————
// Lo que NUNCA puede estar: identificadores de una persona concreta
// ————————————————————————————————————————————————————————————————

type Regla = {
  nombre: string;
  re: RegExp;
  /** Lo que sí puede aparecer y matchea igual. */
  salvo?: (m: string, linea: string) => boolean;
};

// Los expedientes de la CSJN se citan con números romanos largos ("B. 851.
// XXXI", "S. 502. XXXVII"): son jurisprudencia pública, no datos de nadie.
const ROMANO = /\b[IVXLCDM]{2,}\b/g;

const DURAS: Regla[] = [
  {
    nombre: "DNI o número de 7-8 dígitos",
    re: /\b\d{7,8}\b/g,
    // Los años y los números de ley se escriben distinto; 7-8 dígitos seguidos
    // en un escrito penal es un documento o un CUIT casi siempre.
    salvo: (m) => /^(19|20)\d{2}$/.test(m),
  },
  { nombre: "DNI con puntos", re: /\b\d{1,2}\.\d{3}\.\d{3}\b/g },
  { nombre: "CUIT o CUIL", re: /\b\d{2}-?\d{8}-?\d\b/g },
  { nombre: "correo electrónico", re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { nombre: "teléfono", re: /\b(?:\+54\s?)?(?:11|15|0?\d{3})[\s-]?\d{4}[\s-]?\d{4}\b/g },
  {
    nombre: "matrícula con valor (Tº … Fº …)",
    re: /\bT[°ºo]?\.?\s*[IVXLCDM\d]+\s*,?\s*F[°ºo]?\.?\s*\d+/gi,
  },
  {
    nombre: "blanco sin reemplazar",
    re: /[xX]{3,}|…|\.{4,}|_{2,}/g,
  },
];

// Las fechas van APARTE, y no en la lista dura, por una razón concreta: en
// estos escritos la enorme mayoría son fechas de FALLOS citados («CSJN,
// 10/12/93»), que son públicas y son justamente el valor del modelo. Una fecha
// sola no identifica a nadie; lo que identifica es una fecha PEGADA a una
// persona (un nacimiento, una detención), y eso lo decide quien lee, no un
// regex. Se listan para mirar, no para bloquear.
const RE_FECHA = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;

// ————————————————————————————————————————————————————————————————
// Lo que hay que MIRAR: candidatos a nombre propio
// ————————————————————————————————————————————————————————————————
//
// Mayúsculas y capitalizaciones que no son vocabulario forense. La lista de
// permitidos es larga a propósito: un escrito está lleno de mayúsculas que no
// son nombres, y un verificador que grita en cada una no se usa.

const VOCABULARIO = new Set(
  [
    // Estructura del escrito
    "OBJETO", "HECHOS", "ANTECEDENTES", "FUNDAMENTOS", "DERECHO", "PRUEBA",
    "PETITORIO", "RESERVA", "RESERVAS", "PROCEDENCIA", "ADMISIBILIDAD",
    "AGRAVIOS", "SERA", "SERÁ", "JUSTICIA", "DIGO", "VISTOS", "CONSIDERANDO",
    "SUMA", "PROVEER", "CONFORMIDAD", "SOLICITA", "SOLICITO", "INTERPONE",
    "PLANTEA", "FORMULA", "PROMUEVE", "APELA", "CONTESTA", "AMPLIA", "AMPLÍA",
    "INSTA", "OFRECE", "DENUNCIA", "QUERELLA", "RECURSO", "NULIDAD",
    // Actores e instituciones
    "JUEZ", "JUEZA", "FISCAL", "TRIBUNAL", "CAMARA", "CÁMARA", "JUZGADO",
    "SECRETARIA", "SECRETARÍA", "DEFENSOR", "DEFENSORA", "QUERELLANTE",
    "IMPUTADO", "IMPUTADA", "VICTIMA", "VÍCTIMA", "TESTIGO", "PERITO",
    "MINISTERIO", "PUBLICO", "PÚBLICO", "SENOR", "SEÑOR", "SEÑORA", "EXCMO",
    "EXCMA", "USIA", "VS", "VE", "VI", "SD", "CORTE", "SUPREMA", "NACION",
    "NACIÓN", "PROVINCIA", "BUENOS", "AIRES", "FEDERAL", "PENAL", "CRIMINAL",
    "CORRECCIONAL", "GARANTIAS", "GARANTÍAS", "INSTRUCCION", "INSTRUCCIÓN",
    "CASACION", "CASACIÓN", "EJECUCION", "EJECUCIÓN", "APELACIONES",
    // Normas y siglas
    "CN", "CP", "CPP", "CPPN", "CPPF", "CPPBA", "CPACF", "CASI", "CADH",
    "PIDCP", "PIDESC", "DUDH", "DADDH", "CSJN", "CNCP", "CFCP", "SCBA",
    "IPP", "UFI", "CENAVID", "OVD", "DNI", "CUIT", "CUIL", "ART", "ARTS",
    "LEY", "DECRETO", "ACORDADA", "INC", "BIS", "TER",
    // Lo que el propio corpus usa
    "COMPLETAR", "DATO", "REDACTAR", "FALTA", "VERIFICAR",
  ].map((s) => s.toUpperCase()),
);

// Palabras que un título de sección tiene y un nombre propio no. Si la
// secuencia en mayúsculas contiene alguna, es un encabezado ("RESERVA DEL CASO
// FEDERAL"), no una persona. Sin esto el 60% de los modelos se marca y el
// listado deja de servir.
const CONECTORES = new Set([
  "DEL", "DE", "LA", "LAS", "EL", "LOS", "UN", "UNA", "UNOS", "UNAS", "Y", "O",
  "QUE", "QUE?", "POR", "CON", "SIN", "PARA", "EN", "AL", "A", "SU", "SUS",
  "SE", "NO", "SI", "ES", "SON", "FUE", "FUERON", "SER", "HA", "HAN", "LE",
  "LO", "MI", "ME", "NOS", "CUAL", "CUALES", "CUANDO", "COMO", "DONDE", "ESTE",
  "ESTA", "ESTOS", "ESTAS", "ESE", "ESA", "TODO", "TODA", "TODOS", "TODAS",
  "MAS", "MÁS", "MUY", "ENTRE", "SOBRE", "DESDE", "HASTA", "ANTE", "BAJO",
  "TRAS", "PUEDE", "PUEDEN", "DEBE", "DEBEN", "HACE", "HACER", "TIENE",
]);

/**
 * Lo que podría ser el nombre de una persona. Devuelve dos listas porque el
 * riesgo es distinto: los tratados con «Dr.» o «Sr.» suelen ser doctrina
 * citada (Maier, Devis Echandía) y son legítimos; las mayúsculas sueltas, si
 * no son un encabezado, son partes del caso.
 */
function candidatosNombre(texto: string): string[] {
  const out = new Set<string>();
  // Secuencias de 2+ palabras en mayúsculas: "ANDREA V. QUARANTA".
  for (const m of texto.matchAll(
    /\b[A-ZÁÉÍÓÚÑÜ]{3,}(?:\s+[A-ZÁÉÍÓÚÑÜ]\.?)?(?:\s+[A-ZÁÉÍÓÚÑÜ]{3,})+\b/g,
  )) {
    const palabras = m[0].split(/\s+/).map((p) => p.replace(/\.$/, ""));
    if (palabras.some((p) => CONECTORES.has(p))) continue;
    if (palabras.every((p) => VOCABULARIO.has(p) || p.length <= 2)) continue;
    // Tres o más palabras largas seguidas sin conectores es casi siempre un
    // encabezado en mayúsculas, no un nombre (los nombres son dos o tres y ya
    // los cubre el caso de abajo).
    if (palabras.filter((p) => p.length >= 3).length > 3) continue;
    out.add(m[0].trim());
  }
  // "Dr. Nombre Apellido" / "Sr. Nombre Apellido" con capitalización normal.
  for (const m of texto.matchAll(
    /\b(?:Dr|Dra|Sr|Sra|Srta|Lic|Cdor)\.?\s+(?!\{\{)([A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,}(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,})+)/g,
  )) {
    out.add(m[0].trim());
  }
  return [...out];
}

// ————————————————————————————————————————————————————————————————

function cuerpoDe(crudo: string): string {
  const m = crudo.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return m ? m[1] : crudo;
}

function main() {
  const archivos = readdirSync(DIR).filter((f) => f.endsWith(".md")).sort();
  let duros = 0;
  let conNombres = 0;
  let conFechas = 0;
  const resumenNombres: Array<[string, string[]]> = [];

  for (const archivo of archivos) {
    const texto = cuerpoDe(readFileSync(path.join(DIR, archivo), "utf8"));
    // Los números de registro de los fallos se sacan antes de buscar.
    const sinRomanos = texto.replace(ROMANO, " ");

    const hallazgos: string[] = [];
    for (const r of DURAS) {
      for (const m of sinRomanos.matchAll(r.re)) {
        const valor = m[0];
        if (r.salvo?.(valor, texto)) continue;
        hallazgos.push(`${r.nombre}: ${valor}`);
      }
    }
    if (hallazgos.length > 0) {
      duros += hallazgos.length;
      console.log(`\n❌ ${archivo}`);
      for (const h of [...new Set(hallazgos)].slice(0, 12)) console.log(`     ${h}`);
    }

    const nombres = candidatosNombre(texto);
    if (nombres.length > 0) {
      conNombres++;
      resumenNombres.push([archivo, nombres]);
    }
    if (RE_FECHA.test(sinRomanos)) conFechas++;
    RE_FECHA.lastIndex = 0;
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`${archivos.length} modelos revisados`);
  console.log(
    duros === 0
      ? "✅ Sin identificadores (documentos, CUIT, correos, teléfonos, matrículas, fechas ni blancos)"
      : `❌ ${duros} identificadores encontrados — hay que sacarlos antes de commitear`,
  );
  console.log(
    conNombres === 0
      ? "✅ Sin candidatos a nombre propio"
      : `⚠️  ${conNombres} modelos con algo que parece un nombre propio (correr con --nombres para verlos)`,
  );
  console.log(
    conFechas === 0
      ? "✅ Sin fechas con día, mes y año"
      : `⚠️  ${conFechas} modelos con fechas dd/mm/aa — en general son de fallos citados, pero una fecha pegada a una persona sí identifica`,
  );

  if (CON_NOMBRES) {
    for (const [archivo, nombres] of resumenNombres) {
      console.log(`\n   ${archivo}`);
      for (const n of nombres.slice(0, 15)) console.log(`     · ${n}`);
    }
  }

  console.log(
    "\nEsto NO reemplaza la lectura de un abogado: un nombre escrito con\n" +
      "naturalidad en medio de un relato no lo encuentra ninguna expresión regular.",
  );
  process.exit(duros === 0 ? 0 : 1);
}

main();
