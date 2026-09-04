import "server-only";
import { PDFDocument, PDFFont, StandardFonts, rgb, type PDFPage } from "pdf-lib";

// Render de un escrito (markdown liviano) a PDF.
//
// === Por qué pdf-lib y un layout escrito a mano ===
//
// El repo no tenía ninguna librería de PDF. pdf-lib es JS puro, sin fuentes en
// disco ni binarios nativos —importa en el Dockerfile de Easypanel, que ya se
// comió el problema del SWC nativo con Turbopack—, y las fuentes estándar
// (Times) cubren el español completo en WinAnsi. Lo que NO trae es corte de
// líneas ni justificado, así que están acá: ~150 líneas de medir palabras y
// repartir el espacio sobrante, que es exactamente lo que un escrito necesita
// y nada más.
//
// === Qué interpreta del texto ===
//
// Es el subconjunto que el redactor tiene permitido emitir (ver prompt.ts):
//   `# TÍTULO`      la suma: mayúsculas, negrita, centrada.
//   `## I. OBJETO`  título de sección: negrita, con aire arriba.
//   línea suelta    un párrafo: justificado, con sangría de primera línea.
//   `1. ...`        ítem numerado (petitorio): sin sangría, con margen.
//   `**negrita**`   negrita inline.
//   `[COMPLETAR: x]` y `[VERIFICAR: x]` se imprimen en negrita, tal cual:
//                   el hueco tiene que verse en el papel, no sólo en pantalla.
// Cualquier otra cosa se imprime literal.

const A4 = { ancho: 595.28, alto: 841.89 } as const;

// Márgenes de estilo forense: 3,5 cm a la izquierda para el cosido/foliado,
// 2 cm a la derecha, 2,5 arriba y abajo. En puntos (1 cm = 28,35 pt).
const MARGEN = { izq: 99, der: 57, sup: 71, inf: 71 } as const;

const CUERPO_PT = 12;
const INTERLINEADO = 1.5;
const ALTO_LINEA = CUERPO_PT * INTERLINEADO;
const SANGRIA = 35;
const ESPACIO_PARRAFO = 6;
const ESPACIO_ANTES_TITULO = 12;

type Estilo = "normal" | "negrita";
type Run = { texto: string; estilo: Estilo };
type Palabra = { runs: Run[]; ancho: number };

type Bloque =
  | { tipo: "suma"; texto: string }
  | { tipo: "seccion"; texto: string }
  | { tipo: "parrafo"; texto: string; sangria: boolean }
  | { tipo: "item"; texto: string }
  | { tipo: "centrado"; texto: string }
  | { tipo: "firma"; texto: string };

// ————————————————————————————————————————————————————————————————
// Parseo del markdown liviano
// ————————————————————————————————————————————————————————————————

const CIERRES = new Set([
  "proveer de conformidad,",
  "proveer de conformidad",
  "será justicia.",
  "sera justicia.",
  "será justicia",
]);

function parsear(contenido: string): Bloque[] {
  const bloques: Bloque[] = [];
  let despuesDelCierre = false;

  for (const cruda of contenido.replace(/\r\n/g, "\n").split("\n")) {
    const linea = cruda.trim();
    if (linea.length === 0) continue;

    if (linea.startsWith("# ")) {
      bloques.push({ tipo: "suma", texto: linea.slice(2).trim() });
      continue;
    }
    if (linea.startsWith("## ")) {
      bloques.push({ tipo: "seccion", texto: linea.slice(3).trim() });
      continue;
    }
    // "### " no está en el formato, pero si el modelo lo emite se trata como
    // sección menor en vez de imprimir los numerales.
    if (linea.startsWith("### ")) {
      bloques.push({ tipo: "seccion", texto: linea.slice(4).trim() });
      continue;
    }

    const sinNegrita = linea.replace(/\*\*/g, "");
    if (CIERRES.has(sinNegrita.toLowerCase())) {
      bloques.push({ tipo: "centrado", texto: sinNegrita });
      if (sinNegrita.toLowerCase().startsWith("ser")) despuesDelCierre = true;
      continue;
    }
    // Lo que viene después de "SERÁ JUSTICIA." es la firma: nombre y
    // matrícula, alineados a la derecha.
    if (despuesDelCierre) {
      bloques.push({ tipo: "firma", texto: sinNegrita });
      continue;
    }

    if (/^\d{1,2}[.)]\s/.test(linea)) {
      bloques.push({ tipo: "item", texto: linea });
      continue;
    }
    // Viñetas: el formato las prohíbe, pero si aparecen se imprimen como ítem.
    if (/^[-*•]\s/.test(linea)) {
      bloques.push({ tipo: "item", texto: linea.replace(/^[-*•]\s/, "– ") });
      continue;
    }

    // El saludo ("Señor Juez:") y las líneas cortas terminadas en dos puntos
    // van sin sangría.
    const esSaludo = /:$/.test(sinNegrita) && sinNegrita.length < 60;
    bloques.push({ tipo: "parrafo", texto: linea, sangria: !esSaludo });
  }
  return bloques;
}

/** Parte una línea en runs normal/negrita según los `**`. Las marcas de completar van en negrita. */
function aRuns(texto: string): Run[] {
  const runs: Run[] = [];
  const partes = texto.split("**");
  partes.forEach((p, i) => {
    if (p.length === 0) return;
    const estilo: Estilo = i % 2 === 1 ? "negrita" : "normal";
    // Dentro de cada parte, las marcas [COMPLETAR: ...] / [VERIFICAR: ...]
    // se resaltan aunque el modelo no las haya puesto en negrita.
    const trozos = p.split(/(\[(?:COMPLETAR|VERIFICAR):[^\]]*\])/);
    for (const t of trozos) {
      if (t.length === 0) continue;
      const esMarca = /^\[(?:COMPLETAR|VERIFICAR):/.test(t);
      runs.push({ texto: t, estilo: esMarca ? "negrita" : estilo });
    }
  });
  return runs;
}

// ————————————————————————————————————————————————————————————————
// Texto → WinAnsi
// ————————————————————————————————————————————————————————————————

// Las fuentes estándar sólo codifican WinAnsi. Cubre el español entero
// (tildes, ñ, º, °, «», comillas tipográficas, guiones largos, €), pero no
// flechas ni símbolos matemáticos. Se reemplazan por un equivalente legible en
// vez de dejar que pdf-lib tire: un escrito que no se puede bajar por un "→"
// que el modelo puso en una cita es un fallo desproporcionado.
const REEMPLAZOS: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "⇒": "=>",
  "≠": "<>",
  "≤": "<=",
  "≥": ">=",
  "−": "-",
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "―": "—",
  "\u00a0": " ",
  "\u202f": " ",
  "\u2009": " ",
  "′": "'",
  "″": '"',
  "⁄": "/",
  "∙": "·",
  "✓": "v",
  "★": "*",
};

function sanear(texto: string, fuente: PDFFont): string {
  let out = "";
  for (const ch of texto) {
    const r = REEMPLAZOS[ch];
    if (r !== undefined) {
      out += r;
      continue;
    }
    try {
      fuente.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

// ————————————————————————————————————————————————————————————————
// Layout
// ————————————————————————————————————————————————————————————————

type Fuentes = { normal: PDFFont; negrita: PDFFont };

function fuenteDe(f: Fuentes, e: Estilo): PDFFont {
  return e === "negrita" ? f.negrita : f.normal;
}

/** Corta los runs en palabras (por espacios), conservando el estilo de cada trozo. */
function aPalabras(runs: Run[], f: Fuentes, pt: number): Palabra[] {
  const palabras: Palabra[] = [];
  let actual: Run[] = [];
  const cerrar = () => {
    if (actual.length === 0) return;
    const ancho = actual.reduce(
      (acc, r) => acc + fuenteDe(f, r.estilo).widthOfTextAtSize(r.texto, pt),
      0,
    );
    palabras.push({ runs: actual, ancho });
    actual = [];
  };
  for (const run of runs) {
    const texto = sanear(run.texto, fuenteDe(f, run.estilo));
    const trozos = texto.split(" ");
    trozos.forEach((t, i) => {
      if (i > 0) cerrar();
      if (t.length > 0) actual.push({ texto: t, estilo: run.estilo });
    });
  }
  cerrar();
  return palabras;
}

type Linea = { palabras: Palabra[]; ultima: boolean };

function cortarLineas(
  palabras: Palabra[],
  anchoPrimera: number,
  anchoResto: number,
  espacio: number,
): Linea[] {
  const lineas: Linea[] = [];
  let actual: Palabra[] = [];
  let anchoActual = 0;
  let limite = anchoPrimera;
  for (const p of palabras) {
    const conEspacio = actual.length > 0 ? espacio : 0;
    if (actual.length > 0 && anchoActual + conEspacio + p.ancho > limite) {
      lineas.push({ palabras: actual, ultima: false });
      actual = [];
      anchoActual = 0;
      limite = anchoResto;
    }
    actual.push(p);
    anchoActual += (actual.length > 1 ? espacio : 0) + p.ancho;
  }
  if (actual.length > 0) lineas.push({ palabras: actual, ultima: true });
  return lineas;
}

class Lienzo {
  doc: PDFDocument;
  f: Fuentes;
  pagina!: PDFPage;
  y = 0;
  paginas: PDFPage[] = [];

  constructor(doc: PDFDocument, f: Fuentes) {
    this.doc = doc;
    this.f = f;
    this.nuevaPagina();
  }

  nuevaPagina() {
    this.pagina = this.doc.addPage([A4.ancho, A4.alto]);
    this.paginas.push(this.pagina);
    this.y = A4.alto - MARGEN.sup;
  }

  /** Baja `alto` puntos; si no entra en la página, pasa a la siguiente. */
  reservar(alto: number) {
    if (this.y - alto < MARGEN.inf) this.nuevaPagina();
  }

  get anchoUtil() {
    return A4.ancho - MARGEN.izq - MARGEN.der;
  }

  dibujarLinea(
    linea: Linea,
    x0: number,
    ancho: number,
    pt: number,
    modo: "justificado" | "izquierda" | "centrado" | "derecha",
  ) {
    this.reservar(ALTO_LINEA);
    const espacioBase = this.f.normal.widthOfTextAtSize(" ", pt);
    const anchoTexto = linea.palabras.reduce((a, p) => a + p.ancho, 0);
    const huecos = linea.palabras.length - 1;
    let espacio = espacioBase;
    let x = x0;
    if (modo === "justificado" && !linea.ultima && huecos > 0) {
      espacio = (ancho - anchoTexto) / huecos;
    } else if (modo === "centrado") {
      x = x0 + (ancho - anchoTexto - huecos * espacioBase) / 2;
    } else if (modo === "derecha") {
      x = x0 + ancho - anchoTexto - huecos * espacioBase;
    }
    // La línea base queda a un tercio del interlineado por debajo del tope de
    // la línea, para que el texto no pise el título de arriba.
    const yBase = this.y - CUERPO_PT;
    for (const p of linea.palabras) {
      for (const r of p.runs) {
        const fuente = fuenteDe(this.f, r.estilo);
        this.pagina.drawText(r.texto, {
          x,
          y: yBase,
          size: pt,
          font: fuente,
          color: rgb(0, 0, 0),
        });
        x += fuente.widthOfTextAtSize(r.texto, pt);
      }
      x += espacio;
    }
    this.y -= ALTO_LINEA;
  }

  bloque(b: Bloque) {
    const pt = CUERPO_PT;
    const espacio = this.f.normal.widthOfTextAtSize(" ", pt);
    switch (b.tipo) {
      case "suma": {
        const runs: Run[] = [{ texto: b.texto.toUpperCase(), estilo: "negrita" }];
        const palabras = aPalabras(runs, this.f, pt);
        for (const l of cortarLineas(palabras, this.anchoUtil, this.anchoUtil, espacio)) {
          this.dibujarLinea(l, MARGEN.izq, this.anchoUtil, pt, "centrado");
        }
        this.y -= ESPACIO_PARRAFO * 2;
        return;
      }
      case "seccion": {
        this.reservar(ESPACIO_ANTES_TITULO + ALTO_LINEA * 2);
        this.y -= ESPACIO_ANTES_TITULO;
        const runs: Run[] = [{ texto: b.texto, estilo: "negrita" }];
        const palabras = aPalabras(runs, this.f, pt);
        for (const l of cortarLineas(palabras, this.anchoUtil, this.anchoUtil, espacio)) {
          this.dibujarLinea(l, MARGEN.izq, this.anchoUtil, pt, "izquierda");
        }
        this.y -= ESPACIO_PARRAFO / 2;
        return;
      }
      case "parrafo": {
        const palabras = aPalabras(aRuns(b.texto), this.f, pt);
        const sangria = b.sangria ? SANGRIA : 0;
        const lineas = cortarLineas(
          palabras,
          this.anchoUtil - sangria,
          this.anchoUtil,
          espacio,
        );
        lineas.forEach((l, i) => {
          const x0 = MARGEN.izq + (i === 0 ? sangria : 0);
          const ancho = this.anchoUtil - (i === 0 ? sangria : 0);
          this.dibujarLinea(l, x0, ancho, pt, "justificado");
        });
        this.y -= ESPACIO_PARRAFO;
        return;
      }
      case "item": {
        // Ítem numerado: el número al margen, el texto con sangría francesa.
        const palabras = aPalabras(aRuns(b.texto), this.f, pt);
        const colgado = 24;
        const lineas = cortarLineas(
          palabras,
          this.anchoUtil - SANGRIA,
          this.anchoUtil - SANGRIA - colgado,
          espacio,
        );
        lineas.forEach((l, i) => {
          const x0 = MARGEN.izq + SANGRIA + (i === 0 ? 0 : colgado);
          const ancho = this.anchoUtil - SANGRIA - (i === 0 ? 0 : colgado);
          this.dibujarLinea(l, x0, ancho, pt, "justificado");
        });
        this.y -= ESPACIO_PARRAFO / 2;
        return;
      }
      case "centrado": {
        const palabras = aPalabras(aRuns(b.texto), this.f, pt);
        for (const l of cortarLineas(palabras, this.anchoUtil, this.anchoUtil, espacio)) {
          this.dibujarLinea(l, MARGEN.izq, this.anchoUtil, pt, "centrado");
        }
        return;
      }
      case "firma": {
        const palabras = aPalabras(aRuns(b.texto), this.f, pt);
        for (const l of cortarLineas(palabras, this.anchoUtil, this.anchoUtil, espacio)) {
          this.dibujarLinea(l, MARGEN.izq, this.anchoUtil, pt, "derecha");
        }
        return;
      }
    }
  }

  /** "Página N de M" al pie, centrado. Se dibuja al final, cuando M ya se sabe. */
  numerar() {
    const total = this.paginas.length;
    const pt = 9;
    this.paginas.forEach((p, i) => {
      const texto = `Página ${i + 1} de ${total}`;
      const ancho = this.f.normal.widthOfTextAtSize(texto, pt);
      p.drawText(texto, {
        x: (A4.ancho - ancho) / 2,
        y: MARGEN.inf / 2,
        size: pt,
        font: this.f.normal,
        color: rgb(0.35, 0.35, 0.35),
      });
    });
  }
}

export type RenderPdfInput = {
  contenido: string;
  /** Metadatos del PDF. No se imprimen. */
  titulo: string;
  autor: string | null;
};

export async function renderEscritoPdf(input: RenderPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(input.titulo);
  if (input.autor) doc.setAuthor(input.autor);
  doc.setCreator("LexStrategy");
  doc.setLanguage("es-AR");

  const f: Fuentes = {
    normal: await doc.embedFont(StandardFonts.TimesRoman),
    negrita: await doc.embedFont(StandardFonts.TimesRomanBold),
  };

  const lienzo = new Lienzo(doc, f);
  const bloques = parsear(input.contenido);
  if (bloques.length === 0) {
    lienzo.bloque({ tipo: "parrafo", texto: "(escrito vacío)", sangria: false });
  }
  // Separación entre la firma y el resto: un renglón y medio en blanco antes
  // de la primera línea de firma.
  let firmaSeparada = false;
  for (const b of bloques) {
    if (b.tipo === "firma" && !firmaSeparada) {
      lienzo.reservar(ALTO_LINEA * 3);
      lienzo.y -= ALTO_LINEA * 1.5;
      firmaSeparada = true;
    }
    lienzo.bloque(b);
  }
  lienzo.numerar();
  return doc.save();
}

/** Nombre de archivo seguro para la descarga: sin tildes ni caracteres raros. */
export function nombreArchivoPdf(titulo: string, expediente: string | null): string {
  const base = [titulo, expediente]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(" - ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 _-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  return `${base || "escrito"}.pdf`;
}
