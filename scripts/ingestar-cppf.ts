// Ingesta del Código Procesal Penal Federal (Ley 27.063, Infojus 2014)
// al vector store de Supabase. Específico para ese PDF.
//
// Uso: npx tsx scripts/ingestar-cppf.ts
//
// Idempotente: borra todas las filas con tipo_documento='codigo_procesal'
// antes de insertar. Embeddings via OpenAI text-embedding-3-small en
// batches de 100. Inserción en Supabase con service_role.

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const PDF_PATH = path.resolve(process.cwd(), "notas-migracion/cppf-2014.pdf");
const TIPO_DOCUMENTO = "codigo_procesal";
const MAX_CHUNK_CHARS = 1500;
const EMBEDDING_BATCH = 100;
const INSERT_BATCH = 100;
const EMBEDDING_MODEL = "text-embedding-3-small";

type Chunk = {
  contenido: string;
  libro: string | null;
  titulo: string | null;
  capitulo: string | null;
  seccion: string | null;
  articulo: string;
  pagina: number | null;
  embedding?: number[];
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !OPENAI_API_KEY) {
  throw new Error(
    "Faltan env vars (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY). Revisá .env.local",
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// =============== PDF extraction ===============

// Threshold horizontal en unidades del PDF para decidir si dos items
// consecutivos están "pegados" (mismo word, glifos adjacentes — caso típico
// de versales/small caps en Infojus 2014) o separados por un espacio visible.
// Si entre el final del item anterior y el comienzo del actual hay menos
// que esto, los unimos sin espacio. Default 1; subir si las palabras
// quedan pegadas, bajar si las versales no se reconstruyen.
const GAP_THRESHOLD = 1;

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  hasEOL: boolean;
};

async function extractPdfPages(filePath: string): Promise<string[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(filePath));
  const pdf = await getDocument({
    data,
    useSystemFonts: false,
    disableFontFace: true,
  }).promise;

  const pages: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    let text = "";
    let lastEndX: number | null = null;
    for (const it of textContent.items) {
      if (!("str" in it)) continue;
      const item = it as unknown as PdfTextItem;
      const x = item.transform[4];
      const width = item.width ?? 0;

      if (lastEndX !== null) {
        const gap = x - lastEndX;
        if (gap > GAP_THRESHOLD) text += " ";
        // gap <= GAP_THRESHOLD → items adjacentes (versales o glifos
        // del mismo word). NO insertamos espacio.
      }

      text += item.str;

      if (item.hasEOL) {
        text += "\n";
        lastEndX = null;
      } else {
        lastEndX = x + width;
      }
    }
    pages.push(text);
  }
  return pages;
}

function fixHyphenation(text: string): string {
  return text.replace(/(\w)-\s*\n\s*(\w)/g, "$1$2");
}

function buildLineArray(pages: string[]): {
  lines: string[];
  pageOf: number[];
} {
  const lines: string[] = [];
  const pageOf: number[] = [];
  for (let p = 0; p < pages.length; p++) {
    const fixed = fixHyphenation(pages[p]);
    const pageLines = fixed
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    for (const l of pageLines) {
      lines.push(l);
      pageOf.push(p + 1);
    }
  }
  return { lines, pageOf };
}

// =============== Parsing ===============

// Regex con anchors estrictos `^...$` para evitar matchear texto del TOC
// (ej "LIBRO PRIMERO  . . . . . 5"). Case-insensitive porque el PDF Infojus
// 2014 usa versales que pdfjs reconstruye con capitalización mixta
// (ej "TÍTuLO I", "Capítulo 1", "Sección 3a"). Los anchors siguen protegiendo
// del TOC porque ese texto siempre tiene caracteres adicionales (puntos +
// número de página) que rechazan el `$`.
const RE_LIBRO = /^LIBRO\s+(PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO)$/i;
const RE_TITULO = /^TÍTULO\s+([IVX]+)$/i;
const RE_CAPITULO = /^Capítulo\s+(\d+)$/i;
const RE_SECCION = /^Sección\s+(\d+)[ªa]$/i;
const RE_ARTICULO = /^ARTÍCULO\s+(\d+)/m;

// Marker dual de inicio del cuerpo del CPPF (después de la Ley 27.063
// promulgatoria). En el TOC aparece "Anexo I" pero siempre con puntos
// suspensivos y página. La secuencia exacta de las 2 líneas siguientes
// es robusta.
const MARKER_CUERPO_LINEA_1 = "ANEXO I";
const MARKER_CUERPO_LINEA_2 = "CÓDIGO PROCESAL PENAL DE LA NACIÓN";

function isHeaderLine(line: string): boolean {
  return (
    RE_LIBRO.test(line) ||
    RE_TITULO.test(line) ||
    RE_CAPITULO.test(line) ||
    RE_SECCION.test(line) ||
    RE_ARTICULO.test(line)
  );
}

// Detecta si una línea tiene versales con capitalización mixta del tipo
// "PRINcIPIOs fuNdAMENTALEs" (cada glifo small-cap mantiene su case
// original tras la reconstrucción). Heurística: ≥1 palabra con una mayúscula
// en posición distinta a la 0. Si matchea, aplica Title Case word-by-word.
// Si la línea ya está en Title Case canónico ("Principios fundamentales"),
// la deja igual.
function normalizarVersales(s: string): string {
  const palabras = s.split(/\s+/);
  const tieneVersales = palabras.some((w) =>
    /[A-ZÁÉÍÓÚÑÜ]/.test(w.slice(1)),
  );
  if (!tieneVersales) return s;
  return palabras
    .map((w) =>
      w.length === 0 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(" ");
}

function consumirNombre(
  lines: string[],
  idx: number,
): { text: string; nuevoIdx: number } | null {
  // Próxima línea no-vacía después de un header. Si es otro header
  // (LIBRO/TÍTULO/Capítulo/Sección/ARTÍCULO), este header no tiene
  // descripción → devolvemos null para no robarle su línea.
  for (let j = idx + 1; j < Math.min(idx + 5, lines.length); j++) {
    const t = lines[j];
    if (t.length > 0) {
      if (isHeaderLine(t)) return null;
      return { text: t, nuevoIdx: j };
    }
  }
  return null;
}

function splitLargo(text: string, maxLen: number): string[] {
  const partes: string[] = [];
  let resto = text;
  while (resto.length > maxLen) {
    let cut = resto.lastIndexOf(". ", maxLen);
    if (cut < maxLen / 2) cut = resto.lastIndexOf("\n", maxLen);
    if (cut < maxLen / 2) cut = maxLen; // hard cut
    partes.push(resto.slice(0, cut + 1).trim());
    resto = resto.slice(cut + 1).trim();
  }
  if (resto.length > 0) partes.push(resto);
  return partes;
}

function parseChunks(lines: string[], pageOf: number[]): Chunk[] {
  let libroActual: string | null = null;
  let tituloActual: string | null = null;
  let capituloActual: string | null = null;
  let seccionActual: string | null = null;

  let articuloEnProceso: string | null = null;
  let articuloLibro: string | null = null;
  let articuloTitulo: string | null = null;
  let articuloCapitulo: string | null = null;
  let articuloSeccion: string | null = null;
  let articuloPagina: number | null = null;
  let articuloContenido: string[] = [];

  const chunks: Chunk[] = [];

  function flushArticulo() {
    if (articuloEnProceso && articuloContenido.length > 0) {
      const contenido = articuloContenido.join("\n").trim();
      if (contenido.length > MAX_CHUNK_CHARS) {
        const partes = splitLargo(contenido, MAX_CHUNK_CHARS);
        partes.forEach((parte, idx) => {
          const seccionParte =
            (articuloSeccion ? articuloSeccion + " " : "") +
            `(parte ${idx + 1})`;
          chunks.push({
            contenido: parte,
            libro: articuloLibro,
            titulo: articuloTitulo,
            capitulo: articuloCapitulo,
            seccion: seccionParte,
            articulo: articuloEnProceso!,
            pagina: articuloPagina,
          });
        });
      } else {
        chunks.push({
          contenido,
          libro: articuloLibro,
          titulo: articuloTitulo,
          capitulo: articuloCapitulo,
          seccion: articuloSeccion,
          articulo: articuloEnProceso!,
          pagina: articuloPagina,
        });
      }
    }
    articuloEnProceso = null;
    articuloContenido = [];
  }

  // Mientras esté en false, el parser ignora todo (TOC, ley promulgatoria).
  // Se enciende al ver la secuencia exacta:
  //   ANEXO I
  //   CÓDIGO PROCESAL PENAL DE LA NACIÓN
  let cuerpoIniciado = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!cuerpoIniciado) {
      if (
        line === MARKER_CUERPO_LINEA_1 &&
        i + 1 < lines.length &&
        lines[i + 1] === MARKER_CUERPO_LINEA_2
      ) {
        cuerpoIniciado = true;
        i++; // saltar también la línea "CÓDIGO PROCESAL PENAL DE LA NACIÓN"
      }
      continue;
    }

    let m: RegExpMatchArray | null;
    if ((m = line.match(RE_LIBRO))) {
      flushArticulo();
      const nombreInfo = consumirNombre(lines, i);
      // LIBRO siempre tiene nombre descriptivo en CPPF. El identificador
      // ("LIBRO PRIMERO") se preserva en uppercase como aparece en el PDF;
      // el descriptor se normaliza por si vino en versales.
      if (nombreInfo) {
        libroActual = `${line.toUpperCase()} - ${normalizarVersales(nombreInfo.text)}`;
        i = nombreInfo.nuevoIdx;
      } else {
        libroActual = line.toUpperCase();
      }
      tituloActual = null;
      capituloActual = null;
      seccionActual = null;
      continue;
    }
    if ((m = line.match(RE_TITULO))) {
      flushArticulo();
      const nombreInfo = consumirNombre(lines, i);
      // TÍTULO siempre tiene nombre descriptivo en CPPF.
      if (nombreInfo) {
        tituloActual = `TÍTULO ${m[1].toUpperCase()} - ${normalizarVersales(nombreInfo.text)}`;
        i = nombreInfo.nuevoIdx;
      } else {
        tituloActual = `TÍTULO ${m[1].toUpperCase()}`;
      }
      capituloActual = null;
      seccionActual = null;
      continue;
    }
    if ((m = line.match(RE_CAPITULO))) {
      flushArticulo();
      // Capítulo: nombre OPCIONAL. Si la línea siguiente es ya un
      // ARTÍCULO/header, se queda solo con "Capítulo N".
      const nombreInfo = consumirNombre(lines, i);
      const idCap = `Capítulo ${m[1]}`;
      if (nombreInfo) {
        capituloActual = `${idCap} - ${normalizarVersales(nombreInfo.text)}`;
        i = nombreInfo.nuevoIdx;
      } else {
        capituloActual = idCap;
      }
      seccionActual = null;
      continue;
    }
    if ((m = line.match(RE_SECCION))) {
      flushArticulo();
      // Sección: nombre OPCIONAL. Misma lógica que Capítulo.
      const nombreInfo = consumirNombre(lines, i);
      const idSec = line.replace(/^sección/i, "Sección");
      if (nombreInfo) {
        seccionActual = `${idSec} - ${normalizarVersales(nombreInfo.text)}`;
        i = nombreInfo.nuevoIdx;
      } else {
        seccionActual = idSec;
      }
      continue;
    }
    if ((m = line.match(RE_ARTICULO))) {
      flushArticulo();
      articuloEnProceso = m[1];
      articuloLibro = libroActual;
      articuloTitulo = tituloActual;
      articuloCapitulo = capituloActual;
      articuloSeccion = seccionActual;
      articuloPagina = pageOf[i] ?? null;
      articuloContenido.push(line);
      continue;
    }

    if (articuloEnProceso) {
      articuloContenido.push(line);
    }
  }

  flushArticulo();
  return chunks;
}

// =============== Embeddings ===============

async function embedAll(chunks: Chunk[]): Promise<{ totalTokens: number }> {
  let totalTokens = 0;
  const totalBatches = Math.ceil(chunks.length / EMBEDDING_BATCH);
  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH) {
    const batch = chunks.slice(i, i + EMBEDDING_BATCH);
    const inputs = batch.map((c) => c.contenido);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: inputs,
    });
    for (let j = 0; j < batch.length; j++) {
      batch[j].embedding = response.data[j].embedding;
    }
    totalTokens += response.usage.total_tokens;
    const batchNum = Math.floor(i / EMBEDDING_BATCH) + 1;
    process.stdout.write(`  embedding batch ${batchNum}/${totalBatches}\n`);
  }
  return { totalTokens };
}

// =============== Insert ===============

async function insertChunks(chunks: Chunk[]): Promise<void> {
  const totalBatches = Math.ceil(chunks.length / INSERT_BATCH);
  for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
    const batch = chunks.slice(i, i + INSERT_BATCH);
    const rows = batch.map((c) => ({
      contenido: c.contenido,
      embedding: c.embedding,
      tipo_documento: TIPO_DOCUMENTO,
      libro: c.libro,
      titulo: c.titulo,
      capitulo: c.capitulo,
      seccion: c.seccion,
      articulo: c.articulo,
      pagina: c.pagina,
    }));
    const { error } = await supabase.from("documentos").insert(rows);
    if (error) throw new Error(`Insert batch failed: ${error.message}`);
    const batchNum = Math.floor(i / INSERT_BATCH) + 1;
    process.stdout.write(`  insert batch ${batchNum}/${totalBatches}\n`);
  }
}

// =============== Main ===============

async function runProbe() {
  console.log(`PROBE: extrayendo páginas 9-12 de ${PDF_PATH}`);
  const allPages = await extractPdfPages(PDF_PATH);
  console.log(`  total páginas en PDF: ${allPages.length}`);
  let allLines: string[] = [];
  for (let p = 9; p <= 12 && p <= allPages.length; p++) {
    const fixed = fixHyphenation(allPages[p - 1]);
    const pageLines = fixed
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    allLines = allLines.concat(pageLines);
  }
  console.log(
    `  páginas 9-12: ${allLines.length} líneas no-vacías. Primeras 50:`,
  );
  console.log("");
  for (let i = 0; i < Math.min(50, allLines.length); i++) {
    console.log(`  ${String(i + 1).padStart(2, " ")}: ${allLines[i]}`);
  }
}

async function runScanCapitulos() {
  console.log(`SCAN: buscando "capítulo" en el cuerpo del CPPF (post-marker)`);
  const allPages = await extractPdfPages(PDF_PATH);
  const { lines } = buildLineArray(allPages);

  // Buscar después del marker dual (ANEXO I + CÓDIGO PROCESAL PENAL DE LA NACIÓN).
  let cuerpoIniciado = false;
  let startIdx = -1;
  for (let i = 0; i < lines.length - 1; i++) {
    if (
      lines[i] === MARKER_CUERPO_LINEA_1 &&
      lines[i + 1] === MARKER_CUERPO_LINEA_2
    ) {
      cuerpoIniciado = true;
      startIdx = i + 2;
      break;
    }
  }
  if (!cuerpoIniciado) {
    console.log("  NO se detectó el marker — algo raro");
    return;
  }
  console.log(`  cuerpo arranca en línea ${startIdx} de ${lines.length}`);
  console.log("");

  // Buscar líneas que contengan "cap[íi]tulo" en cualquier case.
  const RE_BUSQUEDA = /cap[íi]tulo/i;
  const matches: { idx: number; line: string; matchesRegex: boolean }[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    if (RE_BUSQUEDA.test(lines[i])) {
      matches.push({
        idx: i,
        line: lines[i],
        matchesRegex: RE_CAPITULO.test(lines[i]),
      });
    }
  }

  console.log(`  ${matches.length} líneas con "capítulo" encontradas:`);
  console.log("");
  for (const m of matches) {
    const tag = m.matchesRegex ? "[OK]" : "[NO ]";
    console.log(`  ${tag} L${m.idx}: ${m.line}`);
  }
}

async function main() {
  if (process.argv.includes("--probe")) {
    await runProbe();
    return;
  }
  if (process.argv.includes("--scan-capitulos")) {
    await runScanCapitulos();
    return;
  }

  const t0 = Date.now();

  console.log(`Leyendo PDF: ${PDF_PATH}`);
  const pages = await extractPdfPages(PDF_PATH);
  console.log(`  ${pages.length} páginas extraídas`);

  console.log("Construyendo arreglo de líneas + page map (post-hyphenation)...");
  const { lines, pageOf } = buildLineArray(pages);
  console.log(`  ${lines.length.toLocaleString()} líneas no-vacías`);

  console.log("Parseando artículos...");
  const chunks = parseChunks(lines, pageOf);
  console.log(`  ${chunks.length} chunks generados`);

  if (chunks.length === 0) {
    console.error(
      "No se generaron chunks. Posible problema con el regex de ARTÍCULO o con la extracción del PDF.",
    );
    process.exit(1);
  }

  console.log(`Borrando rows previas de tipo_documento='${TIPO_DOCUMENTO}'...`);
  const { count: deleteCount, error: deleteError } = await supabase
    .from("documentos")
    .delete({ count: "exact" })
    .eq("tipo_documento", TIPO_DOCUMENTO);
  if (deleteError) throw new Error(`Delete failed: ${deleteError.message}`);
  console.log(`  ${deleteCount ?? 0} rows borradas`);

  console.log(
    `Embedding ${chunks.length} chunks (batches de ${EMBEDDING_BATCH})...`,
  );
  const { totalTokens } = await embedAll(chunks);

  console.log(`Insertando en Supabase (batches de ${INSERT_BATCH})...`);
  await insertChunks(chunks);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const cost = (totalTokens / 1_000_000) * 0.02; // $0.02 / 1M tokens

  console.log("");
  console.log("=== INGESTA COMPLETA ===");
  console.log(`  Chunks generados:   ${chunks.length}`);
  console.log(`  Chunks insertados:  ${chunks.length}`);
  console.log(`  Tokens embedded:    ${totalTokens.toLocaleString()}`);
  console.log(`  Costo estimado:     USD $${cost.toFixed(4)}`);
  console.log(`  Tiempo total:       ${elapsed}s`);
  console.log("");
  console.log("Primeros 3 chunks (sanity check):");
  for (let i = 0; i < Math.min(3, chunks.length); i++) {
    const c = chunks[i];
    console.log(`  [${i + 1}] artículo ${c.articulo} | pág ${c.pagina}`);
    console.log(`      libro:    ${c.libro}`);
    console.log(`      título:   ${c.titulo}`);
    console.log(`      capítulo: ${c.capitulo}`);
    console.log(`      sección:  ${c.seccion}`);
    console.log(
      `      preview:  ${c.contenido.slice(0, 150).replace(/\s+/g, " ")}...`,
    );
    console.log("");
  }
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
