// Re-ingesta del Código Procesal Penal Federal (consolidado Decreto 118/2019, reformas
// hasta 2019) al vector store, desde el HTML de Infoleg (notas-migracion/CPPF.html, windows-1252).
//
// Reemplaza los 370 chunks actuales tipo_documento='codigo_procesal' (que venían del PDF
// Infojus 2014, vía scripts/ingestar-cppf.ts — que se conserva como referencia histórica).
// Sigue el patrón de scripts/ingestar-cp.ts; difiere en el parser (markup distinto):
//   - artículos en texto plano "ARTÍCULO N" (con tilde), SIN <b>, delimitados por <br>.
//   - jerarquía PARTE > LIBRO > TÍTULO > Capítulo (arábigo); PARTE se pliega en el campo libro.
//   - sin nivel Sección, sin sufijos bis/ter.
//   - saltea el preámbulo (decreto aprobatorio con su propio ARTÍCULO 1º-3º) arrancando en "PRIMERA PARTE".
//
// Modos: --dry-run (parse + stats), --validate (read-only), real (embed -> backup -> DELETE -> INSERT).

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// ===================== Config =====================
const HTML_PATH = path.resolve(process.cwd(), "notas-migracion/CPPF.html");
const TIPO_DOCUMENTO = "codigo_procesal"; // ⚠️ reemplaza el CPPF; NUNCA 'codigo' (borraría el CP)
const MAX_CHUNK_CHARS = 1500;
const CHUNK_OVERLAP = 150;
const EMBEDDING_BATCH = 100;
const INSERT_BATCH = 100;
const EMBEDDING_MODEL = "text-embedding-3-small";

const MODE: "ingest" | "dry-run" | "validate" =
  process.argv.includes("--dry-run") ? "dry-run"
  : process.argv.includes("--validate") ? "validate"
  : "ingest";

// ===================== Tipos =====================
type Chunk = {
  contenido: string;
  libro: string | null; // PARTE plegada acá: "PRIMERA PARTE - PARTE GENERAL / LIBRO PRIMERO - ..."
  titulo: string | null;
  capitulo: string | null;
  seccion: string | null; // siempre null (el CPPF no tiene nivel Sección)
  articulo: string;
  pagina: number | null; // siempre null (HTML sin paginación)
  embedding?: number[];
};

// ===================== Limpieza =====================
function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&aacute;/gi, "á").replace(/&eacute;/gi, "é").replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó").replace(/&uacute;/gi, "ú").replace(/&ntilde;/gi, "ñ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t \r\n]+/g, " ")
    .trim();
}

// ===================== Regex de detección (sobre texto plano) =====================
const RE_PARTE = /^(PRIMERA|SEGUNDA|TERCERA|CUARTA)\s+PARTE\b/i;
const RE_LIBRO = /^LIBRO\s+([A-ZÁÉÍÓÚ]+)\b/; // romanos-palabra; cross-refs en minúscula no matchean
const RE_TITULO = /^T[IÍ]TULO\s+([IVXL]+)\b/;
const RE_CAPITULO = /^Cap[íi]tulo\s+(\d+)\b/; // ARÁBIGO Title-case (distinto del CP)
const RE_ARTICULO = /^ART[IÍ]CULO\s+(\d+)(?:\s*\(\s*(\d+)\s*\))?(?:[\s:.–—-]*\b(bis|ter|qu[aá]ter|quinquies)\b)?/i;

function normalizarArticulo(num: string, subidx?: string, suf?: string): string {
  let id = num;
  if (subidx) id += ` (${subidx})`;
  if (suf) id += ` ${suf.toLowerCase()}`;
  return id;
}

// ===================== Chunking (idéntico a ingestar-cp.ts) =====================
function splitLargo(text: string, maxLen: number, overlap: number): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= maxLen) { parts.push(text.slice(start).trim()); break; }
    const end = start + maxLen;
    let cut = text.lastIndexOf(". ", end);
    if (cut <= start + maxLen / 2) cut = text.lastIndexOf("\n", end);
    if (cut <= start + maxLen / 2) cut = end;
    parts.push(text.slice(start, cut).trim());
    start = Math.max(cut - overlap, start + 1);
  }
  return parts.filter((p) => p.length > 0);
}

// ===================== Parser =====================
type ParsedArticulo = {
  articulo: string;
  libro: string | null;
  titulo: string | null;
  capitulo: string | null;
  lineas: string[];
};

function parseHtml(): ParsedArticulo[] {
  const raw = new TextDecoder("windows-1252").decode(readFileSync(HTML_PATH));

  // Saltear el preámbulo (decreto aprobatorio con su propio ARTÍCULO 1º-3º): el código
  // real arranca en "PRIMERA PARTE". Sin límite de fin: el boilerplate tras el último
  // artículo es solo tags (img de firma, divs) que clean() descarta a segmentos vacíos.
  const iParte = raw.indexOf("PRIMERA PARTE");
  if (iParte < 0) throw new Error("No se encontró 'PRIMERA PARTE' — no se pudo ubicar el inicio del cuerpo.");
  let body = raw.slice(iParte);

  // El CPPF es <br>-delimitado, pero algunos headers vienen GLUED dentro del mismo
  // segmento que el contenido/nombre anterior:
  //   - art 387 ("...de la Nación. ARTÍCULO 387.- Contenido...") pegado al art 386.
  //   - el Título I del Libro Segundo pegado al nombre del libro ("...SUJETOS PROCESALES TÍTULO I").
  // Inyectamos un <br> antes de esos headers para aislarlos. El patrón de artículo exige el
  // separador ".-" (los cross-refs en el texto NO lo tienen → no generan artículos fantasma);
  // el de título quedó verificado como único caso glued (no hay cross-refs "TÍTULO N" en mayúsc.).
  body = body
    .replace(/(ART[IÍ]CULO\s+\d+\s*\.\s*-)/g, "<br>$1")
    .replace(/(T[IÍ]TULO\s+[IVXL]+)/g, "<br>$1");

  // Split por <br>: cada header queda en su propio segmento.
  const segs = body.split(/<br\s*\/?>/i).map(clean).filter((l) => l.length > 0);

  let parte: string | null = null;
  let libro: string | null = null;
  let titulo: string | null = null;
  let capitulo: string | null = null;
  let pendingName: "parte" | "libro" | "titulo" | "capitulo" | null = null;
  let current: ParsedArticulo | null = null;
  const out: ParsedArticulo[] = [];
  const flush = () => { if (current) out.push(current); current = null; };
  // libro plegado = PARTE + LIBRO
  const libroField = () => [parte, libro].filter(Boolean).join(" / ") || null;

  for (const linea of segs) {
    let m: RegExpMatchArray | null;

    // Headings: capturan número; el resto del segmento (si hay) es el nombre inline.
    if ((m = linea.match(RE_PARTE))) {
      flush();
      parte = `${m[1].toUpperCase()} PARTE`;
      libro = null; titulo = null; capitulo = null;
      const inline = linea.slice(m[0].length).trim();
      if (inline) { parte = `${parte} - ${inline}`; pendingName = null; } else pendingName = "parte";
      continue;
    }
    if ((m = linea.match(RE_LIBRO))) {
      flush();
      libro = `LIBRO ${m[1].toUpperCase()}`;
      titulo = null; capitulo = null;
      const inline = linea.slice(m[0].length).trim();
      if (inline) { libro = `${libro} - ${inline}`; pendingName = null; } else pendingName = "libro";
      continue;
    }
    if ((m = linea.match(RE_TITULO))) {
      flush();
      titulo = `TÍTULO ${m[1].toUpperCase()}`;
      capitulo = null;
      const inline = linea.slice(m[0].length).trim();
      if (inline) { titulo = `${titulo} - ${inline}`; pendingName = null; } else pendingName = "titulo";
      continue;
    }
    if ((m = linea.match(RE_CAPITULO))) {
      flush();
      capitulo = `Capítulo ${m[1]}`;
      const inline = linea.slice(m[0].length).trim();
      if (inline) { capitulo = `${capitulo} - ${inline}`; pendingName = null; } else pendingName = "capitulo";
      continue;
    }
    if ((m = linea.match(RE_ARTICULO))) {
      flush();
      pendingName = null;
      const articulo = normalizarArticulo(m[1], m[2], m[3]);
      current = { articulo, libro: libroField(), titulo, capitulo, lineas: [linea] };
      continue;
    }

    // Nombre de un heading pendiente (cuando vino en segmento aparte). Saltear notas "(...)".
    if (pendingName) {
      if (/^\(/.test(linea)) continue;
      if (pendingName === "parte" && parte) parte = `${parte} - ${linea}`;
      else if (pendingName === "libro" && libro) libro = `${libro} - ${linea}`;
      else if (pendingName === "titulo" && titulo) titulo = `${titulo} - ${linea}`;
      else if (pendingName === "capitulo" && capitulo) capitulo = `${capitulo} - ${linea}`;
      pendingName = null;
      continue;
    }

    if (current) current.lineas.push(linea);
    // else: texto suelto antes del primer artículo -> ignorar
  }
  flush();
  return out;
}

function articulosToChunks(arts: ParsedArticulo[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const a of arts) {
    const full = a.lineas.join("\n").trim();
    const base: Omit<Chunk, "contenido"> = {
      libro: a.libro, titulo: a.titulo, capitulo: a.capitulo, seccion: null, articulo: a.articulo, pagina: null,
    };
    if (full.length <= MAX_CHUNK_CHARS) {
      chunks.push({ ...base, contenido: full });
    } else {
      const partes = splitLargo(full, MAX_CHUNK_CHARS, CHUNK_OVERLAP);
      partes.forEach((p, i) => chunks.push({ ...base, contenido: `[Art. ${a.articulo} — parte ${i + 1}/${partes.length}]\n${p}` }));
    }
  }
  return chunks;
}

// ===================== Clients (lazy) =====================
function getSupabase() {
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local");
  const { createClient } = require("@supabase/supabase-js");
  return createClient(URL, KEY);
}
function getOpenAI() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("Falta OPENAI_API_KEY en .env.local");
  const OpenAI = require("openai").default ?? require("openai");
  return new OpenAI({ apiKey: k });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function embedAll(chunks: Chunk[]): Promise<number> {
  const openai = getOpenAI();
  let totalTokens = 0;
  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH) {
    const batch = chunks.slice(i, i + EMBEDDING_BATCH);
    const inputs = batch.map((c) => c.contenido);
    let attempt = 0;
    for (;;) {
      try {
        const resp = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: inputs });
        resp.data.forEach((d: any, j: number) => (batch[j].embedding = d.embedding));
        totalTokens += resp.usage?.total_tokens ?? 0;
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
        const wait = 2 ** attempt * 1000;
        console.warn(`  [embed] batch ${i / EMBEDDING_BATCH} falló (intento ${attempt + 1}), reintento en ${wait}ms`);
        await sleep(wait); attempt++;
      }
    }
    console.log(`  embeddeados ${Math.min(i + EMBEDDING_BATCH, chunks.length)}/${chunks.length}`);
  }
  return totalTokens;
}

async function fetchProcesalRows(supabase: any, cols: string): Promise<any[]> {
  const out: any[] = [];
  let from = 0; const page = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("documentos").select(cols).eq("tipo_documento", TIPO_DOCUMENTO)
      .order("id", { ascending: true }).range(from, from + page - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < page) break;
    from += page;
  }
  return out;
}

// ===================== Dry-run =====================
function statsDryRun(chunks: Chunk[], arts: ParsedArticulo[]): boolean {
  const distintos = new Set(chunks.map((c) => c.articulo));
  const art135 = chunks.find((c) => c.articulo === "135");
  const art135ok = !!art135 && /Reglas sobre la prueba/i.test(art135.contenido);

  console.log("=".repeat(66));
  console.log("DRY-RUN — parse del CPPF (sin tocar DB ni OpenAI)");
  console.log("=".repeat(66));
  console.log(`\nArtículos parseados: ${arts.length} | Chunks: ${chunks.length} | DISTINTOS: ${distintos.size}`);
  const ints = [...distintos].map((a) => parseInt(a)).filter((n) => !isNaN(n)).sort((a, b) => a - b);
  console.log(`Rango: ${ints[0]}..${ints[ints.length - 1]}`);
  const present = new Set(ints); const gaps: number[] = [];
  for (let i = ints[0]; i <= ints[ints.length - 1]; i++) if (!present.has(i)) gaps.push(i);
  console.log(`Huecos: ${gaps.length} -> ${gaps.join(", ") || "(ninguno)"}`);
  console.log(`Con sufijo: ${[...distintos].filter((a) => / /.test(a)).join(", ") || "(ninguno)"}`);

  console.log(`\n--- GATE ---`);
  console.log(`Distintos >= 380?  ${distintos.size >= 380 ? "SÍ" : "NO"} (${distintos.size})`);
  console.log(`art 135 presente + "Reglas sobre la prueba"?  ${art135ok ? "SÍ" : "NO"}`);
  if (art135) console.log(`   135 -> "${art135.contenido.slice(0, 90).replace(/\n/g, " ")}..."`);
  const pass = distintos.size >= 380 && art135ok;
  console.log(`\nGATE GLOBAL: ${pass ? "PASS ✅" : "FAIL ❌"}`);

  console.log(`\n--- Jerarquía (muestra) ---`);
  for (const k of ["1", "50", "135", "279", "397"]) {
    const ch = chunks.find((c) => c.articulo === k);
    if (ch) console.log(`  art ${k.padEnd(4)} | libro="${ch.libro}" | titulo="${ch.titulo}" | cap="${ch.capitulo}"`);
    else console.log(`  art ${k.padEnd(4)} | (no encontrado)`);
  }

  const lens = chunks.map((c) => c.contenido.length).sort((a, b) => a - b);
  const avg = Math.round(lens.reduce((s, x) => s + x, 0) / lens.length);
  const multiparte = chunks.filter((c) => /parte \d+\//.test(c.contenido)).length;
  console.log(`\n--- Longitudes ---`);
  console.log(`  min=${lens[0]} max=${lens[lens.length - 1]} avg=${avg} | multi-parte=${multiparte} | >1530=${lens.filter((x) => x > 1530).length}`);
  const porArt: Record<string, number> = {};
  for (const c of chunks) porArt[c.articulo] = (porArt[c.articulo] ?? 0) + c.contenido.length;
  console.log(`  Top-5 más largos: ${Object.entries(porArt).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a, l]) => `${a}(${l})`).join(", ")}`);

  // Diagnóstico del único hueco esperado (387): ¿existe en el HTML crudo?
  const rawBody = new TextDecoder("windows-1252").decode(readFileSync(HTML_PATH));
  console.log(`\n--- Hueco art 387 en HTML crudo ---`);
  console.log(`  'ARTÍCULO 387' en el archivo: ${/ARTÍCULO\s+387\b/.test(rawBody) ? "EXISTE (parser lo perdió ⚠️)" : "no existe (renumeración real, ok)"}`);
  return pass;
}

// ===================== Validate =====================
async function validate() {
  const supabase = getSupabase();
  console.log("=".repeat(66));
  console.log("VALIDATE — chequeos post-carga (read-only) — codigo_procesal");
  console.log("=".repeat(66));
  const rows = await fetchProcesalRows(supabase, "articulo, contenido");
  const distintos = new Set(rows.map((r) => r.articulo).filter(Boolean));
  console.log(`\nCobertura: chunks=${rows.length} | artículos distintos=${distintos.size}`);
  console.log(`art 135 presente: ${distintos.has("135") ? "✓" : "✗"}`);

  const porArt: Record<string, number> = {};
  for (const r of rows) porArt[r.articulo] = (porArt[r.articulo] ?? 0) + 1;
  const multiparte = new Set(rows.filter((r) => /parte \d+\//.test(r.contenido)).map((r) => r.articulo));
  const dup = Object.entries(porArt).filter(([a, n]) => n > 1 && !multiparte.has(a));
  console.log(`Anti-dup (no-particionados con >1 chunk, deberían ser 0): ${dup.length}${dup.length ? " -> " + dup.slice(0, 20).map(([a, n]) => `${a}×${n}`).join(", ") : ""}`);

  const lens = rows.map((r) => (r.contenido as string).length).sort((a, b) => a - b);
  console.log(`Longitudes: min=${lens[0]} max=${lens[lens.length - 1]} avg=${Math.round(lens.reduce((s, x) => s + x, 0) / lens.length)} | >1530=${lens.filter((x) => x > 1530).length}`);

  console.log(`\n--- Smoke de retrieval (match_documents top 5) ---`);
  const openai = getOpenAI();
  for (const q of ["reglas sobre la prueba art 135", "control de la detención", "suspensión del juicio a prueba"]) {
    const emb = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: q });
    const { data, error } = await supabase.rpc("match_documents", { query_embedding: emb.data[0].embedding, match_count: 5, filter: {} });
    if (error) { console.log(`  "${q}" -> ERROR ${error.message}`); continue; }
    const top = (data ?? []).map((d: any) => `${d.metadata?.tipo_documento === "codigo_procesal" ? "" : "[" + d.metadata?.tipo_documento + "]"}art ${d.metadata?.articulo}(${Number(d.similarity).toFixed(3)})`);
    console.log(`  "${q}"\n     top5: ${top.join(", ") || "(vacío)"}`);
  }
}

// ===================== Ingest =====================
async function ingest() {
  console.log("Parseando HTML...");
  const arts = parseHtml();
  const chunks = articulosToChunks(arts);
  const distintos = new Set(chunks.map((c) => c.articulo)).size;
  console.log(`Artículos: ${arts.length} | Chunks: ${chunks.length} | distintos: ${distintos}`);
  if (chunks.length === 0) throw new Error("0 chunks — abortando.");
  if (distintos < 380) throw new Error(`Menos de 380 artículos distintos (${distintos}) — abortando por seguridad (gate).`);

  const supabase = getSupabase();

  console.log("Embeddeando (embed-first)...");
  const totalTokens = await embedAll(chunks);

  console.log("Backup del 'codigo_procesal' actual...");
  const prev = await fetchProcesalRows(supabase, "id, contenido, libro, titulo, capitulo, seccion, articulo, pagina, tipo_documento");
  const stamp = new Date().toISOString().slice(0, 10);
  const backupPath = path.resolve(process.cwd(), `notas-migracion/backup-codigo_procesal-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(prev, null, 2), "utf8");
  console.log(`  ${prev.length} filas respaldadas en ${backupPath} (gitignored)`);

  console.log(`DELETE tipo_documento='${TIPO_DOCUMENTO}'...`);
  const { count: deleted, error: delErr } = await supabase
    .from("documentos").delete({ count: "exact" }).eq("tipo_documento", TIPO_DOCUMENTO);
  if (delErr) throw new Error(`DELETE falló: ${delErr.message}`);
  console.log(`  ${deleted} filas borradas`);

  console.log("INSERT...");
  for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
    const rows = chunks.slice(i, i + INSERT_BATCH).map((c) => ({
      contenido: c.contenido, embedding: c.embedding, tipo_documento: TIPO_DOCUMENTO,
      libro: c.libro, titulo: c.titulo, capitulo: c.capitulo, seccion: c.seccion, articulo: c.articulo, pagina: c.pagina,
    }));
    const { error } = await supabase.from("documentos").insert(rows);
    if (error) throw new Error(`INSERT batch ${i / INSERT_BATCH} falló: ${error.message}`);
    console.log(`  insertados ${Math.min(i + INSERT_BATCH, chunks.length)}/${chunks.length}`);
  }
  const costo = (totalTokens / 1_000_000) * 0.02;
  console.log(`\nLISTO. ${chunks.length} chunks insertados. Tokens embedding: ${totalTokens} (~USD ${costo.toFixed(4)}).`);
}

async function main() {
  if (MODE === "dry-run") { const arts = parseHtml(); statsDryRun(articulosToChunks(arts), arts); return; }
  if (MODE === "validate") { await validate(); return; }
  await ingest();
}
main().catch((e) => { console.error("FALLO:", e); process.exit(1); });
