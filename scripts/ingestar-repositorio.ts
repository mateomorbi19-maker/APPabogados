// Ingesta del Repositorio de jurisprudencia y doctrina al RAG de Supabase.
//
//   Lee    src/lib/repositorio/catalogo.ts  (los 345 documentos ya catalogados)
//   Baja   el binario de cada uno desde Google Drive
//   Emite  repositorio_documentos (ficha + embedding) y repositorio_chunks
//
// Uso:
//   npm run repo:ingesta                 -- corrida completa (incremental)
//   npm run repo:ingesta -- --dry-run    -- no escribe en Supabase ni llama a Claude
//   npm run repo:ingesta -- --limite 5   -- sólo los primeros 5 documentos
//   npm run repo:ingesta -- --solo <id>  -- un documento puntual (slug del catálogo)
//   npm run repo:ingesta -- --forzar     -- re-ingiere aunque el hash no haya cambiado
//   npm run repo:ingesta -- --sin-ficha  -- chunks y embeddings, sin llamar a Claude
//   npm run repo:ingesta -- --coleccion jurisprudencia   -- sólo fallos
//   npm run repo:ingesta -- --coleccion doctrina         -- sólo doctrina
//   npm run repo:ingesta -- --modelo preciso -- usa Sonnet en vez de Haiku (3x más caro)
//   npm run repo:ingesta -- --dry-run --con-ficha --limite 3
//        genera e imprime la ficha de 3 documentos SIN escribir en la base.
//        Es la forma de mirar qué está extrayendo el modelo antes de gastar
//        una corrida completa.
//
// Requiere que la migración 20260807120000_repositorio_rag.sql esté aplicada.
//
// TAMAÑO DE LA CORRIDA COMPLETA (medido en dry-run sobre el corpus real):
//   300 documentos con texto · 45 sin texto (escaneos sin OCR y 3 .doc viejos)
//   ~16.700 chunks → ~100 MB de vectores + ~140 MB de índice HNSW en Postgres.
//   Fichas: ~300 llamadas al modelo. Medido sobre fallos reales: USD 0,011 por
//   documento con el default (Haiku) → **~USD 3,30 la corrida completa**, contra
//   USD 0,043 por documento con `--modelo preciso` (Sonnet) → ~USD 13. Se paga una sola vez:
//   después la ingesta es incremental y cuesta centavos.
//   Embeddings: ~17.000 → menos de USD 0,10 en total.
//   Con `--sin-ficha` la corrida sale prácticamente gratis (sólo embeddings),
//   pero la búsqueda pierde su mejor señal: ver la nota de textoDeMetadata().
// Si el proyecto de Supabase está en el plan Free (500 MB), conviene ingerir
// primero `--coleccion jurisprudencia` (que es lo que motivó la feature) y medir
// antes de sumar la doctrina.
//
// INCREMENTAL: el sha256 del texto extraído se guarda en
// repositorio_documentos.texto_hash. Si no cambió y el estado es 'ok', el
// documento se saltea entero (ni Claude ni OpenAI). Correr el script después de
// que Gonzalo suma diez fallos nuevos procesa esos diez y nada más.
//
// NO ES DESTRUCTIVO como ingestar-cppf.ts: nunca borra el corpus completo. Los
// chunks de un documento se reemplazan sólo cuando ESE documento se re-ingiere.
//
// AUTENTICACIÓN: no hay credenciales nuevas. El token de Drive sale del OAuth de
// Google que administra Clerk, igual que en la app (src/lib/google/token.ts).
// El script prueba con los usuarios de la whitelist hasta encontrar uno que
// tenga el scope `drive.readonly` y acceso a la carpeta del estudio.

import { config } from "dotenv";
config({ path: ".env.local" });

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import { CATALOGO } from "../src/lib/repositorio/catalogo";
import type { DocumentoRepositorio } from "../src/lib/repositorio/types";

// ————————————————————————————————————————————————————————————————
// Config
// ————————————————————————————————————————————————————————————————

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_BATCH = 96;

// Modelo que redacta las fichas. Es UNA TAREA DE EXTRACCIÓN: leer un fallo y
// decir qué resolvió y con qué regla. No hay razonamiento estratégico, no hay
// decisiones — por eso el default es el modelo rápido, que la resuelve igual de
// bien y sale un tercio.
//
// Diferencia medida sobre los mismos dos fallos: Sonnet USD 0,043 por documento
// (~USD 13 la corrida), Haiku USD 0,011 (~USD 3,30), con fichas de calidad
// comparable — mismo holding, mismas normas, misma utilidad por lado. Con
// `--modelo preciso` se fuerza Sonnet si algún día se quiere
// re-generar el fichero con más cuidado (la ingesta es incremental, así que se
// puede correr sólo sobre lo que interese con `--solo` o `--coleccion`).
const MODELOS_FICHA = {
  rapido: {
    id: "claude-haiku-4-5-20251001",
    usdInput: 1.0,
    usdOutput: 5.0,
  },
  preciso: {
    id: "claude-sonnet-4-5-20250929",
    usdInput: 3.0,
    usdOutput: 15.0,
  },
} as const;
type ModoModelo = keyof typeof MODELOS_FICHA;

// Chunking. 1.800 caracteres ≈ 450 tokens: entra un considerando entero de un
// fallo sin partirlo al medio. El solape de 220 evita que una cita quede cortada
// justo en el borde entre dos chunks. El tamaño se eligió mirando el corpus
// real: con 1.400 el corpus daba ~22.000 chunks (≈135 MB sólo de vectores);
// 1.800 lo baja a un tercio menos sin perder granularidad útil, porque lo que
// el agente cita es un considerando entero y no una oración suelta.
const CHUNK_CHARS = 1800;
const CHUNK_OVERLAP = 220;
const MIN_CHUNK_CHARS = 140;

// Tope de chunks por documento. Los manuales de doctrina del corpus llegan a
// 300+ páginas y un solo libro podría generar más chunks que todos los fallos
// juntos, desbalanceando la recuperación. 300 chunks ≈ 540.000 caracteres, más
// que suficiente para cualquier fallo y para la parte útil de un manual.
const MAX_CHUNKS_POR_DOCUMENTO = 300;

// Texto que se le manda a Claude para que redacte la ficha. Se toma cabeza +
// cola y no los primeros N caracteres: en una sentencia el holding vive en el
// "RESUELVE" del final, y truncar por el principio dejaría afuera justamente lo
// único que hay que extraer.
// 11.000 + 7.000 = 18.000 caracteres ≈ 4.500 tokens por documento. Se recortó
// desde 23.000 mirando el corpus real: en un fallo, todo lo que hace falta para
// la ficha está en la carátula/objeto (arriba) y en los considerandos finales +
// el RESUELVE (abajo). Lo del medio suele ser transcripción de los agravios.
const FICHA_CHARS_CABEZA = 11000;
const FICHA_CHARS_COLA = 7000;

// Debajo de esto se asume que el PDF es un escaneo sin capa de texto (o que la
// extracción falló) y el documento queda en estado 'sin_texto'.
const MIN_CARACTERES_UTILES = 400;

// Concurrencia. El cuello de botella real es Drive + Anthropic; 4 en paralelo
// mantiene la corrida en ~15 min sin acercarse a los rate limits.
const CONCURRENCIA = 4;

// El access token de Google vive ~1h. Una corrida completa puede durar más, así
// que se renueva por tiempo además de reactivamente ante un 401.
const TOKEN_TTL_MS = 25 * 60 * 1000;

// ————————————————————————————————————————————————————————————————
// Env
// ————————————————————————————————————————————————————————————————

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

function requerido(nombre: string, valor: string | undefined): string {
  if (!valor) {
    throw new Error(`Falta ${nombre} en .env.local`);
  }
  return valor;
}

// Clientes a nivel de módulo, igual que scripts/ingestar-cppf.ts. Pasarlos por
// parámetro obligaría a tipar `SupabaseClient` con sus genéricos, que sin tipos
// generados de la base colapsan a `never` y hacen fallar cada insert.
const supabase = createClient(
  requerido("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL),
  requerido("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_KEY),
);
const openai = new OpenAI({
  apiKey: requerido("OPENAI_API_KEY", OPENAI_API_KEY),
});
const anthropic = new Anthropic({
  apiKey: requerido("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY),
});

// ————————————————————————————————————————————————————————————————
// Argumentos
// ————————————————————————————————————————————————————————————————

type Opciones = {
  dryRun: boolean;
  /** Con --dry-run: genera la ficha igual y la imprime, para inspeccionarla. */
  conFicha: boolean;
  forzar: boolean;
  sinFicha: boolean;
  limite: number | null;
  solo: string | null;
  coleccion: "jurisprudencia" | "doctrina" | null;
  modelo: ModoModelo;
};

function parsearArgs(argv: string[]): Opciones {
  const o: Opciones = {
    dryRun: argv.includes("--dry-run"),
    conFicha: argv.includes("--con-ficha"),
    forzar: argv.includes("--forzar"),
    sinFicha: argv.includes("--sin-ficha"),
    limite: null,
    solo: null,
    coleccion: null,
    modelo: "rapido",
  };
  const iLimite = argv.indexOf("--limite");
  if (iLimite !== -1 && argv[iLimite + 1]) {
    const n = Number(argv[iLimite + 1]);
    if (Number.isFinite(n) && n > 0) o.limite = Math.floor(n);
  }
  const iSolo = argv.indexOf("--solo");
  if (iSolo !== -1 && argv[iSolo + 1]) o.solo = argv[iSolo + 1];
  const iCol = argv.indexOf("--coleccion");
  const col = iCol !== -1 ? argv[iCol + 1] : undefined;
  if (col === "jurisprudencia" || col === "doctrina") o.coleccion = col;
  const iMod = argv.indexOf("--modelo");
  const mod = iMod !== -1 ? argv[iMod + 1] : undefined;
  if (mod === "preciso" || mod === "rapido") o.modelo = mod;
  return o;
}

// ————————————————————————————————————————————————————————————————
// Token de Google (vía Clerk, igual que la app)
// ————————————————————————————————————————————————————————————————

const SCOPE_DRIVE = "https://www.googleapis.com/auth/drive";

type CuentaGoogle = { nombre: string; clerkUserId: string };

async function usuariosConGoogle(): Promise<CuentaGoogle[]> {
  const { data, error } = await supabase
    .from("usuarios")
    .select("nombre, clerk_user_id")
    .not("clerk_user_id", "is", null);
  if (error) throw new Error(`No se pudo leer usuarios: ${error.message}`);
  const filas = (data ?? []) as unknown as {
    nombre: string;
    clerk_user_id: string;
  }[];
  return filas.map((u) => ({
    nombre: u.nombre,
    clerkUserId: u.clerk_user_id,
  }));
}

async function tokenDeUsuario(clerkUserId: string): Promise<string | null> {
  const r = await fetch(
    `https://api.clerk.com/v1/users/${clerkUserId}/oauth_access_tokens/google`,
    { headers: { Authorization: `Bearer ${requerido("CLERK_SECRET_KEY", CLERK_SECRET_KEY)}` } },
  );
  if (!r.ok) return null;
  const body = (await r.json()) as unknown;
  // La Backend API devolvió históricamente un array pelado y hoy {data:[...]}.
  // Se toleran las dos formas para que el script no dependa de la versión.
  const lista = Array.isArray(body)
    ? body
    : ((body as { data?: unknown[] }).data ?? []);
  const entry = lista[0] as { token?: string; scopes?: string[] } | undefined;
  if (!entry?.token) return null;
  const scopes = entry.scopes ?? [];
  if (!scopes.some((s) => s.startsWith(SCOPE_DRIVE))) return null;
  return entry.token;
}

/**
 * Sesión de Drive: se queda con la primera cuenta de la whitelist que tenga el
 * scope Y acceso real a la carpeta, y renueva el token cuando vence.
 */
class SesionDrive {
  private token: string | null = null;
  private obtenidoEn = 0;
  private cuenta: CuentaGoogle | null = null;

  constructor(private cuentas: CuentaGoogle[]) {}

  async elegirCuenta(driveIdPrueba: string): Promise<CuentaGoogle> {
    for (const c of this.cuentas) {
      const token = await tokenDeUsuario(c.clerkUserId);
      if (!token) continue;
      const r = await fetch(
        `https://www.googleapis.com/drive/v3/files/${driveIdPrueba}?fields=id&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (r.ok) {
        this.cuenta = c;
        this.token = token;
        this.obtenidoEn = Date.now();
        return c;
      }
    }
    throw new Error(
      "Ninguna cuenta de la whitelist puede leer la carpeta del repositorio en Drive. " +
        "Revisá el scope drive.readonly en Clerk y que la carpeta esté compartida (ver SETUP_GOOGLE_BANDEJA_REPOSITORIO.md).",
    );
  }

  async obtener(refrescar = false): Promise<string> {
    const vencido = Date.now() - this.obtenidoEn > TOKEN_TTL_MS;
    if (this.token && !refrescar && !vencido) return this.token;
    if (!this.cuenta) throw new Error("SesionDrive sin cuenta elegida");
    const token = await tokenDeUsuario(this.cuenta.clerkUserId);
    if (!token) {
      throw new Error(
        `Se perdió el token de Google de ${this.cuenta.nombre}. Que vuelva a entrar a la app con Google y reintentá.`,
      );
    }
    this.token = token;
    this.obtenidoEn = Date.now();
    return token;
  }
}

async function descargarDeDrive(
  sesion: SesionDrive,
  driveId: string,
): Promise<Buffer> {
  for (let intento = 0; intento < 3; intento++) {
    const token = await sesion.obtener(intento > 0);
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveId}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    // 401 = token vencido → se renueva y se reintenta. 403/429/5xx = backoff.
    if (r.status === 404) throw new Error("no existe en Drive (404)");
    if (r.status === 403 && intento === 2) {
      throw new Error("sin permiso sobre el archivo (403)");
    }
    await esperar(800 * (intento + 1));
  }
  throw new Error("Drive no respondió después de 3 intentos");
}

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ————————————————————————————————————————————————————————————————
// Extracción de texto
// ————————————————————————————————————————————————————————————————

type PaginaTexto = { pagina: number; texto: string };

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  hasEOL: boolean;
};

// Mismo criterio de reconstrucción que scripts/ingestar-cppf.ts: pdfjs entrega
// items sueltos y hay que decidir dónde va un espacio mirando la distancia
// horizontal, si no las versales quedan separadas letra por letra.
const GAP_THRESHOLD = 1;

async function extraerPdf(buffer: Buffer): Promise<PaginaTexto[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    disableFontFace: true,
    // Los PDF del estudio son escaneos y descargas de portales judiciales:
    // muchos traen fuentes raras o estructura sucia. Silenciamos el ruido para
    // que el log del script sea legible.
    verbosity: 0,
  }).promise;

  const paginas: PaginaTexto[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let texto = "";
    let lastEndX: number | null = null;
    for (const it of content.items) {
      if (!("str" in it)) continue;
      const item = it as unknown as PdfTextItem;
      const x = item.transform[4];
      if (lastEndX !== null && x - lastEndX > GAP_THRESHOLD) texto += " ";
      texto += item.str;
      if (item.hasEOL) {
        texto += "\n";
        lastEndX = null;
      } else {
        lastEndX = x + (item.width ?? 0);
      }
    }
    paginas.push({ pagina: n, texto: limpiar(texto) });
    page.cleanup();
  }
  await pdf.destroy();
  return paginas;
}

async function extraerDocx(buffer: Buffer): Promise<PaginaTexto[]> {
  const { value } = await mammoth.extractRawText({ buffer });
  // DOCX no tiene paginado accesible: todo el documento es "página null".
  return [{ pagina: 0, texto: limpiar(value) }];
}

function limpiar(s: string): string {
  return s
    // Ligaduras y comillas tipográficas que ensucian el matching.
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/­/g, "")
    // Guion de corte de línea: "responsabi-\nlidad" → "responsabilidad".
    .replace(/(\p{Ll})-\n(\p{Ll})/gu, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MIMES_PDF = "application/pdf";
const MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function extraerTexto(
  doc: DocumentoRepositorio,
  buffer: Buffer,
): Promise<{ paginas: PaginaTexto[] } | { motivo: string }> {
  if (doc.mime_type === MIMES_PDF) {
    try {
      return { paginas: await extraerPdf(buffer) };
    } catch (e) {
      return { motivo: `pdfjs falló: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if (doc.mime_type === MIME_DOCX) {
    try {
      return { paginas: await extraerDocx(buffer) };
    } catch (e) {
      return { motivo: `mammoth falló: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  // .doc viejo y .ppt/.pptx: son 4 archivos en todo el corpus y no hay lector
  // en el stack. Quedan registrados con estado 'sin_texto' para que se vea en la
  // tabla que existen y por qué no entraron, en vez de desaparecer en silencio.
  return { motivo: `formato no soportado por la ingesta (${doc.mime_type})` };
}

// ————————————————————————————————————————————————————————————————
// Chunking
// ————————————————————————————————————————————————————————————————

type Chunk = { chunk_index: number; pagina: number | null; contenido: string };

/**
 * Chunkea respetando páginas: un chunk nunca cruza el borde de una página, así
 * que su número de página siempre es exacto y la cita del agente ("p. 14") es
 * verificable en el visor. El corte interno busca hacia atrás un fin de párrafo
 * o de oración para no partir una frase al medio.
 */
function chunkear(paginas: PaginaTexto[]): Chunk[] {
  const chunks: Chunk[] = [];
  let indice = 0;

  for (const p of paginas) {
    const texto = p.texto;
    if (texto.length < MIN_CHUNK_CHARS) continue;
    let desde = 0;
    while (desde < texto.length) {
      if (chunks.length >= MAX_CHUNKS_POR_DOCUMENTO) return chunks;
      let hasta = Math.min(desde + CHUNK_CHARS, texto.length);
      if (hasta < texto.length) {
        const ventana = texto.slice(desde, hasta);
        const corteParrafo = ventana.lastIndexOf("\n\n");
        const corteOracion = ventana.lastIndexOf(". ");
        const corte = Math.max(corteParrafo, corteOracion);
        // Sólo se acepta el corte "lindo" si no achica el chunk a menos de la
        // mitad: en textos sin puntuación (tablas, listados) es mejor cortar
        // duro que emitir chunks de 100 caracteres.
        if (corte > CHUNK_CHARS / 2) hasta = desde + corte + 1;
      }
      const contenido = texto.slice(desde, hasta).trim();
      if (contenido.length >= MIN_CHUNK_CHARS) {
        chunks.push({
          chunk_index: indice++,
          pagina: p.pagina > 0 ? p.pagina : null,
          contenido,
        });
      }
      if (hasta >= texto.length) break;
      desde = Math.max(hasta - CHUNK_OVERLAP, desde + 1);
    }
  }
  return chunks;
}

// ————————————————————————————————————————————————————————————————
// Ficha (Claude)
// ————————————————————————————————————————————————————————————————

type Ficha = {
  holding: string;
  sumario: string;
  temas: string[];
  normas: string[];
  utilidad_defensa: string;
  utilidad_acusacion: string;
};

const FICHA_TOOL: Anthropic.Tool = {
  name: "registrar_ficha",
  description: "Registra la ficha del documento leído.",
  input_schema: {
    type: "object",
    properties: {
      holding: {
        type: "string",
        description:
          "La REGLA que el documento sienta, en 1-2 oraciones, redactada como principio aplicable a otros casos y no como crónica de éste. Ej.: 'La declaración prestada sin defensor presente es nula aunque el imputado haya consentido, porque la asistencia técnica no es renunciable en sede policial'. En doctrina: la tesis central del autor.",
      },
      sumario: {
        type: "string",
        description:
          "2-4 oraciones: qué se discutía, qué resolvió el tribunal y con qué argumento. En doctrina: qué problema aborda el texto y cómo lo resuelve.",
      },
      temas: {
        type: "array",
        items: { type: "string" },
        description:
          "Entre 3 y 8 conceptos jurídicos precisos del documento ('nulidad de la declaración indagatoria', 'peligro de fuga', 'dolo eventual'). No categorías genéricas como 'derecho penal'.",
      },
      normas: {
        type: "array",
        items: { type: "string" },
        description:
          "Artículos y leyes efectivamente citados en el texto, como aparecen ('art. 80 inc. 1 CP', 'art. 18 CN', 'Ley 27.063'). Array vacío si el texto no cita normativa.",
      },
      utilidad_defensa: {
        type: "string",
        description:
          "Una oración: para qué le sirve a una defensa. 'No es útil para la defensa' es una respuesta válida y esperable en muchos fallos.",
      },
      utilidad_acusacion: {
        type: "string",
        description:
          "Una oración: para qué le sirve a una acusación (fiscal o querella). 'No es útil para la acusación' es válido.",
      },
    },
    required: [
      "holding",
      "sumario",
      "temas",
      "normas",
      "utilidad_defensa",
      "utilidad_acusacion",
    ],
  },
};

const FICHA_SYSTEM =
  "Sos un abogado penalista argentino armando el fichero interno de un estudio. " +
  "Recibís el texto (posiblemente parcial) de un fallo o de un texto de doctrina y tenés que extraer su ficha. " +
  "Reglas: (1) Escribí SOLO lo que el texto dice; si un dato no está, no lo completes con lo que recordás del caso o del autor. " +
  "(2) El holding es la REGLA, no el resumen de los hechos: tiene que servirle a un abogado que busca un precedente para un caso distinto. " +
  "(3) Si el texto está incompleto o es ilegible y no alcanzás a determinar qué se resolvió, decilo explícitamente en el sumario en vez de inventar. " +
  "(4) Español rioplatense, sin adornos. Nada de 'este importante fallo'.";

function textoParaFicha(paginas: PaginaTexto[]): string {
  const completo = paginas
    .map((p) => (p.pagina > 0 ? `[p. ${p.pagina}]\n${p.texto}` : p.texto))
    .join("\n\n");
  if (completo.length <= FICHA_CHARS_CABEZA + FICHA_CHARS_COLA) return completo;
  return (
    completo.slice(0, FICHA_CHARS_CABEZA) +
    "\n\n[... fragmento intermedio omitido por longitud ...]\n\n" +
    completo.slice(-FICHA_CHARS_COLA)
  );
}

type UsoFicha = { input: number; output: number };

async function generarFicha(
  doc: DocumentoRepositorio,
  paginas: PaginaTexto[],
  modelo: ModoModelo,
): Promise<{ ficha: Ficha; uso: UsoFicha }> {
  const encabezado = [
    `Título del archivo: ${doc.titulo}`,
    `Colección: ${doc.coleccion === "jurisprudencia" ? "jurisprudencia (un fallo)" : "doctrina (un texto de autor)"}`,
    doc.tribunal ? `Tribunal detectado en el nombre: ${doc.tribunal}` : null,
    doc.anio ? `Año detectado en el nombre: ${doc.anio}` : null,
    doc.caratula ? `Carátula detectada: ${doc.caratula}` : null,
    doc.autor ? `Autor detectado: ${doc.autor}` : null,
    `Carpetas temáticas de Drive: ${doc.materias.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  // La metadata del catálogo sale de HEURÍSTICAS sobre el nombre de archivo y a
  // veces está mal. Se la damos como pista, pero el texto manda.
  const prompt =
    `${encabezado}\n\n` +
    `Los datos de arriba se infirieron del NOMBRE DEL ARCHIVO y pueden estar equivocados: si el texto los contradice, mandá el texto.\n\n` +
    `--- TEXTO DEL DOCUMENTO ---\n\n${textoParaFicha(paginas)}`;

  const res = await conReintento(() =>
    anthropic.messages.create({
      model: MODELOS_FICHA[modelo].id,
      max_tokens: 1500,
      system: FICHA_SYSTEM,
      tools: [FICHA_TOOL],
      tool_choice: { type: "tool", name: FICHA_TOOL.name },
      messages: [{ role: "user", content: prompt }],
    }),
  );

  const bloque = res.content.find((b) => b.type === "tool_use");
  if (!bloque || bloque.type !== "tool_use") {
    throw new Error("el modelo no devolvió la ficha");
  }
  const raw = bloque.input as Partial<Ficha>;
  return {
    ficha: {
      holding: String(raw.holding ?? "").trim(),
      sumario: String(raw.sumario ?? "").trim(),
      temas: Array.isArray(raw.temas) ? raw.temas.map(String) : [],
      normas: Array.isArray(raw.normas) ? raw.normas.map(String) : [],
      utilidad_defensa: String(raw.utilidad_defensa ?? "").trim(),
      utilidad_acusacion: String(raw.utilidad_acusacion ?? "").trim(),
    },
    uso: {
      input: res.usage.input_tokens,
      output: res.usage.output_tokens,
    },
  };
}

/** Reintento con backoff para 429 / 5xx / red. */
async function conReintento<T>(fn: () => Promise<T>, intentos = 4): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (e) {
      ultimo = e;
      const status = (e as { status?: number }).status;
      const recuperable =
        status === undefined || status === 429 || (status >= 500 && status < 600);
      if (!recuperable || i === intentos - 1) throw e;
      await esperar(1500 * Math.pow(2, i));
    }
  }
  throw ultimo;
}

// ————————————————————————————————————————————————————————————————
// Embeddings
// ————————————————————————————————————————————————————————————————

async function embeddear(textos: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < textos.length; i += EMBEDDING_BATCH) {
    const lote = textos.slice(i, i + EMBEDDING_BATCH);
    const res = await conReintento(() =>
      openai.embeddings.create({ model: EMBEDDING_MODEL, input: lote }),
    );
    // La API garantiza el orden, pero lo reordenamos por `index` igual: un
    // desalineamiento acá asociaría cada embedding al chunk equivocado y el
    // síntoma sería "el RAG devuelve cosas raras", casi imposible de rastrear.
    const ordenados = [...res.data].sort((a, b) => a.index - b.index);
    out.push(...ordenados.map((d) => d.embedding));
  }
  return out;
}

/** Texto que se embeddea para representar al documento entero. */
function textoDeFicha(doc: DocumentoRepositorio, f: Ficha): string {
  return [
    doc.titulo,
    doc.coleccion === "jurisprudencia" ? "Fallo" : "Doctrina",
    doc.tribunal ?? "",
    doc.caratula ?? doc.autor ?? "",
    doc.materias.join(", "),
    f.holding,
    f.sumario,
    f.temas.join(", "),
    f.normas.join(", "),
    f.utilidad_defensa,
    f.utilidad_acusacion,
  ]
    .filter((s) => s && s.length > 0)
    .join("\n");
}

/**
 * Fallback cuando no hay ficha (--sin-ficha, o el documento no tiene texto):
 * se embeddea la metadata del catálogo. Es peor que la ficha, pero deja al
 * documento recuperable en vez de invisible.
 */
function textoDeMetadata(doc: DocumentoRepositorio, muestra: string): string {
  return [
    doc.titulo,
    doc.coleccion,
    doc.tribunal ?? "",
    doc.caratula ?? doc.autor ?? "",
    doc.materias.join(", "),
    muestra.slice(0, 2000),
  ]
    .filter((s) => s && s.length > 0)
    .join("\n");
}

// ————————————————————————————————————————————————————————————————
// Corrida
// ————————————————————————————————————————————————————————————————

type Resultado = {
  documento_id: string;
  estado: "ok" | "sin_texto" | "error" | "salteado";
  chunks: number;
  detalle?: string;
};

type EstadoPrevio = { texto_hash: string | null; estado: string };

async function main(): Promise<void> {
  const opciones = parsearArgs(process.argv.slice(2));

  let objetivo = CATALOGO;
  if (opciones.coleccion) {
    objetivo = objetivo.filter((d) => d.coleccion === opciones.coleccion);
  }
  if (opciones.solo) {
    objetivo = CATALOGO.filter((d) => d.id === opciones.solo);
    if (objetivo.length === 0) {
      throw new Error(`No hay ningún documento con id "${opciones.solo}"`);
    }
  }
  if (opciones.limite) objetivo = objetivo.slice(0, opciones.limite);

  console.log(
    `Repositorio: ${CATALOGO.length} documentos en el catálogo, ${objetivo.length} en esta corrida.`,
  );
  if (opciones.dryRun) {
    console.log("MODO DRY-RUN: no se escribe en Supabase ni se generan fichas.");
  }

  // --- estado previo (para la ingesta incremental) ---
  const previos = new Map<string, EstadoPrevio>();
  if (!opciones.dryRun) {
    const { data, error } = await supabase
      .from("repositorio_documentos")
      .select("documento_id, texto_hash, estado");
    if (error) {
      if (error.code === "PGRST205" || /schema cache/i.test(error.message)) {
        throw new Error(
          "Las tablas del RAG del repositorio no existen todavía. Aplicá primero " +
            "supabase/migrations/20260807120000_repositorio_rag.sql en el SQL Editor de Supabase.",
        );
      }
      throw new Error(`No se pudo leer el estado previo: ${error.message}`);
    }
    for (const r of data ?? []) {
      previos.set(String(r.documento_id), {
        texto_hash: r.texto_hash === null ? null : String(r.texto_hash),
        estado: String(r.estado),
      });
    }
    console.log(`Ya ingeridos: ${previos.size}.`);
  }

  // --- sesión de Drive ---
  const cuentas = await usuariosConGoogle();
  const sesion = new SesionDrive(cuentas);
  const cuenta = await sesion.elegirCuenta(objetivo[0].drive_id);
  console.log(`Drive: leyendo con la cuenta de ${cuenta.nombre}.`);

  const resultados: Resultado[] = [];
  const uso: UsoFicha = { input: 0, output: 0 };
  let embeddingsGenerados = 0;
  let procesados = 0;

  async function procesar(doc: DocumentoRepositorio): Promise<void> {
    const n = ++procesados;
    const etiqueta = `[${String(n).padStart(3)}/${objetivo.length}] ${doc.titulo.slice(0, 58)}`;
    try {
      const buffer = await descargarDeDrive(sesion, doc.drive_id);
      const extraido = await extraerTexto(doc, buffer);

      if ("motivo" in extraido) {
        console.log(`${etiqueta} — SIN TEXTO (${extraido.motivo})`);
        resultados.push({
          documento_id: doc.id,
          estado: "sin_texto",
          chunks: 0,
          detalle: extraido.motivo,
        });
        if (!opciones.dryRun) await guardarSinTexto(doc, extraido.motivo);
        return;
      }

      const paginas = extraido.paginas;
      const caracteres = paginas.reduce((a, p) => a + p.texto.length, 0);
      if (caracteres < MIN_CARACTERES_UTILES) {
        const motivo = `el PDF no tiene capa de texto (${caracteres} caracteres extraídos en ${paginas.length} páginas) — probablemente sea un escaneo`;
        console.log(`${etiqueta} — SIN TEXTO (escaneo)`);
        resultados.push({
          documento_id: doc.id,
          estado: "sin_texto",
          chunks: 0,
          detalle: motivo,
        });
        if (!opciones.dryRun) await guardarSinTexto(doc, motivo);
        return;
      }

      const hash = createHash("sha256")
        .update(paginas.map((p) => p.texto).join("\n"))
        .digest("hex");
      const previo = previos.get(doc.id);
      if (
        !opciones.forzar &&
        previo &&
        previo.estado === "ok" &&
        previo.texto_hash === hash
      ) {
        console.log(`${etiqueta} — sin cambios, salteado`);
        resultados.push({ documento_id: doc.id, estado: "salteado", chunks: 0 });
        return;
      }

      const chunks = chunkear(paginas);

      if (opciones.dryRun) {
        console.log(
          `${etiqueta} — ${paginas.length} pág · ${caracteres} car · ${chunks.length} chunks`,
        );
        if (opciones.conFicha) {
          const r = await generarFicha(doc, paginas, opciones.modelo);
          uso.input += r.uso.input;
          uso.output += r.uso.output;
          console.log(
            `      holding : ${r.ficha.holding}
` +
              `      sumario : ${r.ficha.sumario}
` +
              `      temas   : ${r.ficha.temas.join(" · ")}
` +
              `      normas  : ${r.ficha.normas.join(" · ") || "(ninguna)"}
` +
              `      defensa : ${r.ficha.utilidad_defensa}
` +
              `      acusac. : ${r.ficha.utilidad_acusacion}
`,
          );
        }
        resultados.push({
          documento_id: doc.id,
          estado: "ok",
          chunks: chunks.length,
        });
        return;
      }

      let ficha: Ficha | null = null;
      if (!opciones.sinFicha) {
        const r = await generarFicha(doc, paginas, opciones.modelo);
        ficha = r.ficha;
        uso.input += r.uso.input;
        uso.output += r.uso.output;
      }

      const textoDocumento = ficha
        ? textoDeFicha(doc, ficha)
        : textoDeMetadata(doc, paginas[0]?.texto ?? "");

      const vectores = await embeddear([
        textoDocumento,
        ...chunks.map((c) => c.contenido),
      ]);
      embeddingsGenerados += vectores.length;

      await guardarDocumento(doc, {
        ficha,
        embedding: vectores[0],
        chunks: chunks.map((c, i) => ({ ...c, embedding: vectores[i + 1] })),
        paginas: paginas.length,
        caracteres,
        hash,
        modeloFicha: ficha ? MODELOS_FICHA[opciones.modelo].id : null,
      });

      console.log(
        `${etiqueta} — OK · ${chunks.length} chunks${ficha ? "" : " (sin ficha)"}`,
      );
      resultados.push({
        documento_id: doc.id,
        estado: "ok",
        chunks: chunks.length,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`${etiqueta} — ERROR: ${msg}`);
      resultados.push({
        documento_id: doc.id,
        estado: "error",
        chunks: 0,
        detalle: msg,
      });
      if (!opciones.dryRun) {
        // Best-effort: si ni el registro del error se puede escribir, seguimos.
        try {
          await guardarError(doc, msg);
        } catch {
          /* noop */
        }
      }
    }
  }

  // Pool de concurrencia fija: los workers se reparten la cola.
  const cola = [...objetivo];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCIA, cola.length) }, async () => {
      for (;;) {
        const doc = cola.shift();
        if (!doc) return;
        await procesar(doc);
      }
    }),
  );

  reporte(resultados, uso, embeddingsGenerados, opciones);
}

// ————————————————————————————————————————————————————————————————
// Escritura
// ————————————————————————————————————————————————————————————————

function filaBase(doc: DocumentoRepositorio) {
  return {
    documento_id: doc.id,
    drive_id: doc.drive_id,
    coleccion: doc.coleccion,
    titulo: doc.titulo,
    tribunal: doc.tribunal,
    anio: doc.anio,
    caratula: doc.caratula,
    autor: doc.autor,
    materias: doc.materias,
    ingestado_en: new Date().toISOString(),
  };
}

async function guardarSinTexto(
  doc: DocumentoRepositorio,
  motivo: string,
): Promise<void> {
  const { error } = await supabase.from("repositorio_documentos").upsert(
    {
      ...filaBase(doc),
      estado: "sin_texto",
      error_detalle: motivo,
      embedding: null,
      texto_hash: null,
    },
    { onConflict: "documento_id" },
  );
  if (error) throw new Error(`upsert sin_texto: ${error.message}`);
}

async function guardarError(
  doc: DocumentoRepositorio,
  motivo: string,
): Promise<void> {
  const { error } = await supabase.from("repositorio_documentos").upsert(
    { ...filaBase(doc), estado: "error", error_detalle: motivo.slice(0, 1000) },
    { onConflict: "documento_id" },
  );
  if (error) throw new Error(`upsert error: ${error.message}`);
}

async function guardarDocumento(
  doc: DocumentoRepositorio,
  datos: {
    ficha: Ficha | null;
    embedding: number[];
    chunks: (Chunk & { embedding: number[] })[];
    paginas: number;
    caracteres: number;
    hash: string;
    modeloFicha: string | null;
  },
): Promise<void> {
  const { error: errDoc } = await supabase.from("repositorio_documentos").upsert(
    {
      ...filaBase(doc),
      holding: datos.ficha?.holding ?? null,
      sumario: datos.ficha?.sumario ?? null,
      temas: datos.ficha?.temas ?? [],
      normas: datos.ficha?.normas ?? [],
      utilidad_defensa: datos.ficha?.utilidad_defensa ?? null,
      utilidad_acusacion: datos.ficha?.utilidad_acusacion ?? null,
      embedding: datos.embedding,
      estado: "ok",
      error_detalle: null,
      paginas: datos.paginas,
      caracteres: datos.caracteres,
      texto_hash: datos.hash,
      modelo_ficha: datos.ficha ? datos.modeloFicha : null,
    },
    { onConflict: "documento_id" },
  );
  if (errDoc) throw new Error(`upsert documento: ${errDoc.message}`);

  // Reemplazo total de los chunks de ESTE documento (no del corpus): el
  // chunking puede haber cambiado de tamaño y dejar huérfanos los índices
  // viejos si sólo se hiciera upsert.
  const { error: errDel } = await supabase
    .from("repositorio_chunks")
    .delete()
    .eq("documento_id", doc.id);
  if (errDel) throw new Error(`delete chunks: ${errDel.message}`);

  const filas = datos.chunks.map((c) => ({
    documento_id: doc.id,
    chunk_index: c.chunk_index,
    pagina: c.pagina,
    contenido: c.contenido,
    embedding: c.embedding,
  }));
  for (let i = 0; i < filas.length; i += 50) {
    const { error } = await supabase
      .from("repositorio_chunks")
      .insert(filas.slice(i, i + 50));
    if (error) throw new Error(`insert chunks: ${error.message}`);
  }
}

// ————————————————————————————————————————————————————————————————
// Reporte
// ————————————————————————————————————————————————————————————————

function reporte(
  resultados: Resultado[],
  uso: UsoFicha,
  embeddings: number,
  opciones: Opciones,
): void {
  const cuenta = (e: Resultado["estado"]): number =>
    resultados.filter((r) => r.estado === e).length;
  const chunks = resultados.reduce((a, r) => a + r.chunks, 0);

  console.log("\n" + "=".repeat(64));
  console.log(`ok            : ${cuenta("ok")}`);
  console.log(`salteados     : ${cuenta("salteado")} (sin cambios desde la última ingesta)`);
  console.log(`sin texto     : ${cuenta("sin_texto")}`);
  console.log(`errores       : ${cuenta("error")}`);
  console.log(`chunks        : ${chunks}`);
  console.log(`embeddings    : ${embeddings}`);
  // Costo real de la corrida, con el precio del modelo que se usó, para no
  // tener que ir a la consola de Anthropic a ver cuánto salió.
  if (uso.input > 0) {
    const precio = MODELOS_FICHA[opciones.modelo];
    const costo =
      (uso.input / 1_000_000) * precio.usdInput +
      (uso.output / 1_000_000) * precio.usdOutput;
    console.log(
      `fichas        : ${uso.input} tok in / ${uso.output} tok out ≈ USD ${costo.toFixed(2)} (modelo ${opciones.modelo})`,
    );
  }

  const problemas = resultados.filter(
    (r) => r.estado === "sin_texto" || r.estado === "error",
  );
  if (problemas.length > 0) {
    console.log("\nDocumentos que no entraron al índice:");
    for (const p of problemas) {
      console.log(`  · [${p.estado}] ${p.documento_id} — ${p.detalle ?? ""}`);
    }
    console.log(
      "\nLos 'sin_texto' suelen ser escaneos sin OCR: siguen visibles y descargables en el\n" +
        "Repositorio, pero el agente no los puede citar. Pasarlos por OCR y volver a subirlos\n" +
        "a Drive los incorpora en la próxima corrida.",
    );
  }
  if (opciones.dryRun) {
    console.log("\n(dry-run: no se escribió nada)");
  }
  console.log("=".repeat(64));
}

main().catch((e) => {
  console.error("\nLa ingesta falló:", e instanceof Error ? e.message : e);
  process.exit(1);
});
