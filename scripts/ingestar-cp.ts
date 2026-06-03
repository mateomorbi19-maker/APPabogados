// Ingesta del Código Penal de la Nación (Ley 11.179) al vector store de Supabase,
// desde el HTML de Infoleg (notas-migracion/CP-infoleg.html, charset windows-1252).
//
// Reemplaza el corpus roto tipo_documento='codigo' (590 chunks, ~52 arts, dup ~10x)
// por una ingesta limpia (~385 artículos, art 1-316). Análogo a ingestar-cppf.ts.
//
// Modos:
//   npx tsx scripts/ingestar-cp.ts --dry-run    Parsea e imprime stats. NO toca DB ni OpenAI.
//   npx tsx scripts/ingestar-cp.ts --validate   Read-only: chequeos SQL + smoke de retrieval.
//   npx tsx scripts/ingestar-cp.ts              Ingesta real: embed -> backup -> DELETE -> INSERT.
//
// REUSA tipo_documento='codigo' (delete+insert idempotente en una corrida, vía service_role).
// Embeddings: OpenAI text-embedding-3-small (idéntico al RAG). No transaccional; embed-first
// + backup JSON para minimizar riesgo.

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// ===================== Config =====================
const HTML_PATH = path.resolve(process.cwd(), "notas-migracion/CP-infoleg.html");
const TIPO_DOCUMENTO = "codigo";
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
  libro: string | null;
  titulo: string | null;
  capitulo: string | null;
  seccion: string | null; // siempre null para el CP (no hay nivel Sección)
  articulo: string; // identificador normalizado: "172", "149 bis", "41 quinquies", "268 (2)"
  pagina: number | null; // siempre null (HTML sin paginación)
  embedding?: number[];
};

// ===================== Limpieza de HTML =====================
function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t \r\n]+/g, " ")
    .trim();
}

// ===================== Regex de detección (sobre texto plano) =====================
const RE_LIBRO = /^LIBRO\s+(PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO)\b/i;
const RE_TITULO = /^T[IÍ]TULO\s+([IVXL]+)\b/i;
const RE_CAPITULO = /^Cap[ií]tulo\s+([IVXL]+(?:\s+(?:bis|ter))?)\b/i;
// Cubre <b>ARTICULO N>, span-bold y forma partida (todas se vuelven "ARTICULO N..." tras strip).
// El separador antes del sufijo tolera ":", ".", guiones y espacios (Infoleg usa "148: bis :",
// "213 quáter"); el sufijo acepta "quáter" acentuado además de las variantes del 5º orden.
const RE_ARTICULO = /^ART[IÍ]CULO\s+(\d+)(?:\s*\(\s*(\d+)\s*\))?(?:[\s:.–—-]*\b(bis|ter|qu[aá]ter|quinto|quinque|quinquies)\b)?/i;

function normalizarArticulo(num: string, subidx?: string, suf?: string): string {
  let id = num;
  if (subidx) id += ` (${subidx})`;
  if (suf) id += ` ${suf.toLowerCase()}`;
  return id;
}

// ===================== Chunking =====================
function splitLargo(text: string, maxLen: number, overlap: number): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= maxLen) {
      parts.push(text.slice(start).trim());
      break;
    }
    const end = start + maxLen;
    let cut = text.lastIndexOf(". ", end);
    if (cut <= start + maxLen / 2) cut = text.lastIndexOf("\n", end);
    if (cut <= start + maxLen / 2) cut = end; // hard cut
    parts.push(text.slice(start, cut).trim());
    start = Math.max(cut - overlap, start + 1); // overlap, garantizando avance
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

  // Cuerpo: desde la 2da 'LIBRO PRIMERO' (la 1ra es el índice) hasta 'Antecedentes Normativos'.
  const firstLP = raw.indexOf("LIBRO PRIMERO");
  const idxBody = raw.indexOf("LIBRO PRIMERO", firstLP + 1);
  const idxAnt = raw.lastIndexOf("Antecedentes Normativos");
  if (idxBody < 0 || idxAnt < 0 || idxAnt <= idxBody) {
    throw new Error(`No se pudo delimitar el cuerpo (idxBody=${idxBody}, idxAnt=${idxAnt})`);
  }
  let body = raw.slice(idxBody, idxAnt);

  // Forzar un límite de bloque ANTES de cada header en el markup crudo. Necesario
  // porque varios artículos (308, 310, 311, 313 del bloque 306-313) y nombres de
  // título vienen GLUED dentro del mismo <p> que la nota anterior, separados solo
  // por <br>. Inyectamos </p> antes de cada forma de header para aislarlos.
  body = body
    .replace(/(<b>\s*ART[IÍ]CULO)/gi, "</p>$1")
    .replace(/(<span[^>]*font-weight:\s*bold[^>]*>\s*ART[IÍ]CULO)/gi, "</p>$1")
    .replace(/(<p[^>]*align="center"[^>]*>)/gi, "</p>$1");

  // Pre-split por párrafo: cada </p> cierra un bloque lógico. El strip de tags por
  // bloque elimina los <b> colgantes (L1364-1368) sin afectar la separación.
  const bloques = body.split(/<\/p>/i).map(clean).filter((l) => l.length > 0);

  let libro: string | null = null;
  let titulo: string | null = null;
  let capitulo: string | null = null;
  let pendingName: "libro" | "titulo" | "capitulo" | null = null;
  let current: ParsedArticulo | null = null;
  const out: ParsedArticulo[] = [];

  const flush = () => {
    if (current) out.push(current);
    current = null;
  };

  for (const linea of bloques) {
    let m: RegExpMatchArray | null;

    if ((m = linea.match(RE_LIBRO))) {
      flush();
      libro = `LIBRO ${m[1].toUpperCase()}`;
      titulo = null;
      capitulo = null;
      pendingName = "libro";
      continue;
    }
    if ((m = linea.match(RE_TITULO))) {
      flush();
      titulo = `TITULO ${m[1].toUpperCase()}`;
      capitulo = null;
      pendingName = "titulo";
      continue;
    }
    if ((m = linea.match(RE_CAPITULO))) {
      flush();
      capitulo = `Capítulo ${m[1]}`;
      pendingName = "capitulo";
      continue;
    }
    if ((m = linea.match(RE_ARTICULO))) {
      flush();
      pendingName = null;
      const articulo = normalizarArticulo(m[1], m[2], m[3]);
      current = { articulo, libro, titulo, capitulo, lineas: [linea] };
      continue;
    }

    // Nombre de un heading pendiente. Saltear notas de reforma que se cuelan entre
    // el número y el nombre (ej. Título XIII trae "(Título incorporado por...)").
    if (pendingName) {
      if (/^\(|incorporad|sustituid|derogad|renumerad|denominaci|B\.O\./i.test(linea)) {
        continue; // es una nota, no el nombre; mantenemos pendingName para el próximo bloque
      }
      if (pendingName === "libro" && libro) libro = `${libro} - ${linea}`;
      else if (pendingName === "titulo" && titulo) titulo = `${titulo} - ${linea}`;
      else if (pendingName === "capitulo" && capitulo) capitulo = `${capitulo} - ${linea}`;
      pendingName = null;
      continue;
    }

    // Título huérfano: nombre en MAYÚSCULAS sin línea "TITULO N" previa (caso real:
    // el Título X del Libro II no trae el rótulo "TITULO X", solo el nombre).
    if (
      /^[A-ZÁÉÍÓÚÑÜ0-9 .,º°()'-]{12,}$/.test(linea) &&
      !/[a-záéíóúñü]/.test(linea) &&
      linea.split(/\s+/).length >= 2
    ) {
      flush();
      titulo = linea; // sin romano (la fuente lo omite)
      capitulo = null;
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
      libro: a.libro,
      titulo: a.titulo,
      capitulo: a.capitulo,
      seccion: null,
      articulo: a.articulo,
      pagina: null,
    };
    if (full.length <= MAX_CHUNK_CHARS) {
      chunks.push({ ...base, contenido: full });
    } else {
      const partes = splitLargo(full, MAX_CHUNK_CHARS, CHUNK_OVERLAP);
      partes.forEach((p, i) => {
        // Marca de parte en CONTENIDO (no en seccion).
        chunks.push({ ...base, contenido: `[Art. ${a.articulo} — parte ${i + 1}/${partes.length}]\n${p}` });
      });
    }
  }
  return chunks;
}

// ===================== Clients (lazy) =====================
function getSupabase() {
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local");
  // import dinámico para no exigir el paquete en --dry-run
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
        console.warn(`  [embed] batch ${i / EMBEDDING_BATCH} falló (intento ${attempt + 1}), reintento en ${wait}ms: ${e instanceof Error ? e.message : e}`);
        await sleep(wait);
        attempt++;
      }
    }
    console.log(`  embeddeados ${Math.min(i + EMBEDDING_BATCH, chunks.length)}/${chunks.length}`);
  }
  return totalTokens;
}

async function fetchCodigoRows(supabase: any, cols: string): Promise<any[]> {
  const out: any[] = [];
  let from = 0;
  const page = 1000;
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

// ===================== Reportes =====================
function statsDryRun(chunks: Chunk[], arts: ParsedArticulo[]) {
  const distintos = new Set(chunks.map((c) => c.articulo));
  const clave = ["172", "173", "210", "292", "149 bis"];
  const claveOk = clave.every((k) => distintos.has(k));
  const conSufijo = [...distintos].filter((a) => /(bis|ter|quater|quinto|quinque|quinquies)/.test(a));
  const spanBlock = ["41 quinquies", "85 bis", "306", "307", "308", "309", "310", "311", "312", "313"];
  const splitForm = ["209 bis", "238 bis", "238 ter", "240 bis", "249 bis", "268 (2)", "268 (3)", "303", "304", "305"];

  console.log("=".repeat(66));
  console.log("DRY-RUN — parse del Código Penal (sin tocar DB ni OpenAI)");
  console.log("=".repeat(66));
  console.log(`\nArtículos parseados: ${arts.length}`);
  console.log(`Chunks generados:    ${chunks.length}`);
  console.log(`Artículos DISTINTOS: ${distintos.size}`);
  console.log(`Con sufijo bis/ter/...: ${conSufijo.length}`);

  console.log(`\n--- GATE ---`);
  console.log(`Distintos >= 350?           ${distintos.size >= 350 ? "SÍ" : "NO"} (${distintos.size})`);
  console.log(`172/173/210/292/149 bis?    ${claveOk ? "SÍ (los 5)" : "NO"}`);
  for (const k of clave) {
    const ch = chunks.find((c) => c.articulo === k);
    console.log(`   ${k.padEnd(9)} -> ${ch ? '"' + ch.contenido.slice(0, 70).replace(/\n/g, " ") + '..."' : "AUSENTE"}`);
  }
  console.log(`\nGATE GLOBAL: ${distintos.size >= 350 && claveOk ? "PASS ✅" : "FAIL ❌"}`);

  console.log(`\n--- Forma partida (deben estar los 10) ---`);
  console.log("  " + splitForm.map((s) => `${s}:${distintos.has(s) ? "✓" : "✗"}`).join("  "));
  console.log(`--- Bloque span-bold (deben estar los 10) ---`);
  console.log("  " + spanBlock.map((s) => `${s}:${distintos.has(s) ? "✓" : "✗"}`).join("  "));
  console.log(`  142 quater (debe faltar): ${distintos.has("142 quater") ? "PRESENTE ⚠️" : "ausente ✓"}`);

  // Jerarquía de artículos de muestra
  console.log(`\n--- Jerarquía (muestra) ---`);
  for (const k of ["1", "79", "172", "210", "226", "236", "306"]) {
    const ch = chunks.find((c) => c.articulo === k);
    if (ch) console.log(`  art ${k.padEnd(4)} | libro="${ch.libro}" | titulo="${ch.titulo}" | capitulo="${ch.capitulo}"`);
    else console.log(`  art ${k.padEnd(4)} | (no encontrado)`);
  }

  // Longitudes
  const lens = chunks.map((c) => c.contenido.length).sort((a, b) => a - b);
  const avg = Math.round(lens.reduce((s, x) => s + x, 0) / lens.length);
  const multiparte = chunks.filter((c) => /parte \d+\//.test(c.contenido)).length;
  console.log(`\n--- Longitudes ---`);
  console.log(`  min=${lens[0]} max=${lens[lens.length - 1]} avg=${avg} | chunks multi-parte=${multiparte} | >1530 chars=${lens.filter((x) => x > 1530).length}`);

  // Top-5 artículos más largos (suma de su contenido)
  const porArt: Record<string, number> = {};
  for (const c of chunks) porArt[c.articulo] = (porArt[c.articulo] ?? 0) + c.contenido.length;
  const top = Object.entries(porArt).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  Top-5 artículos más largos: ${top.map(([a, l]) => `${a}(${l})`).join(", ")}`);

  return distintos.size >= 350 && claveOk;
}

// ===================== Modo INGEST =====================
async function ingest() {
  console.log("Parseando HTML...");
  const arts = parseHtml();
  const chunks = articulosToChunks(arts);
  console.log(`Artículos: ${arts.length} | Chunks: ${chunks.length} | distintos: ${new Set(chunks.map((c) => c.articulo)).size}`);
  if (chunks.length === 0) throw new Error("0 chunks — abortando (parser no encontró artículos).");
  if (new Set(chunks.map((c) => c.articulo)).size < 350) {
    throw new Error("Menos de 350 artículos distintos — abortando por seguridad (gate del plan).");
  }

  const supabase = getSupabase();

  // 1. EMBED PRIMERO (si OpenAI falla, la tabla queda intacta).
  console.log("Embeddeando (embed-first)...");
  const totalTokens = await embedAll(chunks);

  // 2. BACKUP del corpus 'codigo' actual a JSON (sin embedding, para registro/rollback).
  console.log("Backup del 'codigo' actual...");
  const prev = await fetchCodigoRows(supabase, "id, contenido, libro, titulo, capitulo, seccion, articulo, pagina, tipo_documento");
  const stamp = new Date().toISOString().slice(0, 10);
  const backupPath = path.resolve(process.cwd(), `notas-migracion/backup-codigo-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(prev, null, 2), "utf8");
  console.log(`  ${prev.length} filas respaldadas en ${backupPath} (gitignored)`);

  // 3. DELETE del corpus roto (FK-safe; filtrado por tipo_documento).
  console.log("DELETE tipo_documento='codigo'...");
  const { count: deleted, error: delErr } = await supabase
    .from("documentos").delete({ count: "exact" }).eq("tipo_documento", TIPO_DOCUMENTO);
  if (delErr) throw new Error(`DELETE falló: ${delErr.message}`);
  console.log(`  ${deleted} filas borradas`);

  // 4. INSERT batched.
  console.log("INSERT...");
  for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
    const rows = chunks.slice(i, i + INSERT_BATCH).map((c) => ({
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
    if (error) throw new Error(`INSERT batch ${i / INSERT_BATCH} falló: ${error.message}`);
    console.log(`  insertados ${Math.min(i + INSERT_BATCH, chunks.length)}/${chunks.length}`);
  }

  const costo = (totalTokens / 1_000_000) * 0.02;
  console.log(`\nLISTO. ${chunks.length} chunks insertados. Tokens embedding: ${totalTokens} (~USD ${costo.toFixed(4)}).`);
}

// ===================== Modo VALIDATE (read-only) =====================
async function validate() {
  const supabase = getSupabase();
  console.log("=".repeat(66));
  console.log("VALIDATE — chequeos post-carga (read-only)");
  console.log("=".repeat(66));

  const rows = await fetchCodigoRows(supabase, "articulo, contenido");
  const distintos = new Set(rows.map((r) => r.articulo).filter(Boolean));
  console.log(`\nCobertura: chunks=${rows.length} | artículos distintos=${distintos.size}`);
  const clave = ["172", "173", "210", "292", "149 bis"];
  console.log(`Clave presentes: ${clave.map((k) => `${k}:${distintos.has(k) ? "✓" : "✗"}`).join("  ")}`);

  // Anti-duplicados: artículos SIN parte deben tener exactamente 1 chunk.
  const porArt: Record<string, number> = {};
  for (const r of rows) porArt[r.articulo] = (porArt[r.articulo] ?? 0) + 1;
  const multiparte = new Set(rows.filter((r) => /parte \d+\//.test(r.contenido)).map((r) => r.articulo));
  const dupSospechosos = Object.entries(porArt).filter(([a, n]) => n > 1 && !multiparte.has(a));
  console.log(`\nAnti-dup: artículos no-particionados con >1 chunk (deberían ser 0): ${dupSospechosos.length}`);
  if (dupSospechosos.length) console.log("  " + dupSospechosos.slice(0, 20).map(([a, n]) => `${a}×${n}`).join(", "));

  // Longitudes
  const lens = rows.map((r) => (r.contenido as string).length).sort((a, b) => a - b);
  console.log(`\nLongitudes: min=${lens[0]} max=${lens[lens.length - 1]} avg=${Math.round(lens.reduce((s, x) => s + x, 0) / lens.length)} | >1530=${lens.filter((x) => x > 1530).length}`);

  // Smoke de retrieval (embed + match_documents top 5)
  console.log(`\n--- Smoke de retrieval (match_documents top 5) ---`);
  const openai = getOpenAI();
  const queries: { q: string; esperado: string }[] = [
    { q: "estafa art 172 código penal", esperado: "172" },
    { q: "defraudación art 173 inciso 7 administración fraudulenta", esperado: "173" },
    { q: "asociación ilícita art 210", esperado: "210" },
    { q: "lavado de activos financiamiento", esperado: "306" },
    { q: "femicidio homicidio agravado art 80", esperado: "80" },
  ];
  for (const { q, esperado } of queries) {
    const emb = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: q });
    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: emb.data[0].embedding, match_count: 5, filter: {},
    });
    if (error) { console.log(`  "${q}" -> ERROR ${error.message}`); continue; }
    const arts = (data ?? []).map((d: any) => `${d.metadata?.articulo}(${Number(d.similarity).toFixed(3)})`);
    const hit = (data ?? []).some((d: any) => String(d.metadata?.articulo).startsWith(esperado));
    console.log(`  "${q}"\n     top5: ${arts.join(", ")}  -> esperado art ${esperado}: ${hit ? "✅" : "❌"}`);
  }
}

// ===================== Main =====================
async function main() {
  if (MODE === "dry-run") {
    const arts = parseHtml();
    const chunks = articulosToChunks(arts);
    statsDryRun(chunks, arts);
    return;
  }
  if (MODE === "validate") {
    await validate();
    return;
  }
  await ingest();
}

main().catch((e) => { console.error("FALLO:", e); process.exit(1); });
