// Parseo de mensajes MIME de Gmail y construcción del RFC 2822 de salida.
// Módulo PURO: no hace IO ni toca la red. Corre en Node (usa Buffer), así que
// se importa sólo desde código de servidor.
//
// Todo lo de acá está escrito a mano porque el proyecto no tiene librerías de
// MIME ni de sanitización instaladas y no se agregan dependencias nuevas.

import type { gmail_v1 } from "@googleapis/gmail";
import { ATTR_IMG_BLOQUEADA, RE_EMAIL_LAXO } from "./types";
import type { AdjuntoResumen, DireccionEmail } from "./types";

// === Decodificación de bytes ===

/** Decodifica bytes con el charset del header; cae a UTF-8 si no lo reconoce. */
function decodificarBytes(bytes: Buffer, charset: string): string {
  const etiqueta = charset.trim().toLowerCase();
  try {
    return new TextDecoder(etiqueta).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

function base64ABytes(texto: string): Buffer {
  return Buffer.from(texto.replace(/[\r\n\s]/g, ""), "base64");
}

/**
 * Quoted-printable. En el modo `q` (RFC 2047 encoded-word) el `_` representa
 * un espacio; en el modo body no, y además existe el soft line break `=\r\n`.
 */
function quotedPrintableABytes(texto: string, modoQ: boolean): Buffer {
  const fuente = modoQ
    ? texto.replace(/_/g, " ")
    : texto.replace(/=(?:\r\n|\n|\r)/g, "");
  const out: number[] = [];
  for (let i = 0; i < fuente.length; i++) {
    const c = fuente[i];
    if (c === "=" && i + 2 < fuente.length) {
      const hex = fuente.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    // charCodeAt > 255 no debería pasar en QP; se trunca igual que lo haría
    // un lector estricto en vez de romper.
    out.push(c.charCodeAt(0) & 0xff);
  }
  return Buffer.from(out);
}

/**
 * Decodifica base64url (el encoding que usa Gmail para los body y adjuntos):
 * `-` → `+`, `_` → `/`, y padding a múltiplo de 4.
 */
export function decodificarBase64UrlABytes(
  data?: string | null,
): Buffer | null {
  if (!data) return null;
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const conPadding = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  try {
    return Buffer.from(conPadding, "base64");
  } catch {
    return null;
  }
}

/** Igual que la anterior pero devolviendo texto UTF-8. */
export function decodificarBase64Url(data?: string | null): string | null {
  const bytes = decodificarBase64UrlABytes(data);
  return bytes === null ? null : bytes.toString("utf8");
}

// === RFC 2047 (encoded-words) ===

// Los asuntos y nombres en español llegan casi siempre codificados
// (=?UTF-8?B?...?= o =?UTF-8?Q?...?=) porque tienen tildes y eñes.
const ENCODED_WORD = /=\?([A-Za-z0-9_\-.]+?)(?:\*[A-Za-z0-9-]+)?\?([BbQq])\?([^?]*)\?=/g;

export function decodificarEncodedWords(raw: string): string {
  if (!raw || raw.indexOf("=?") === -1) return raw;
  // RFC 2047 §6.2: el whitespace ENTRE dos encoded-words adyacentes es
  // separador de codificación, no contenido — se colapsa antes de decodificar.
  const colapsado = raw.replace(/\?=[ \t]*(?:\r?\n[ \t]+)?(?==\?)/g, "?=");
  return colapsado.replace(
    ENCODED_WORD,
    (match, charset: string, enc: string, texto: string) => {
      try {
        const bytes =
          enc.toLowerCase() === "b"
            ? base64ABytes(texto)
            : quotedPrintableABytes(texto, true);
        return decodificarBytes(bytes, charset);
      } catch {
        // Encoded-word roto: mejor mostrarlo crudo que perder el header.
        return match;
      }
    },
  );
}

// === Entidades HTML ===

const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  colon: ":",
  tab: "\t",
  newline: "\n",
  sol: "/",
};

/**
 * Decodifica entidades numéricas y las nombradas más comunes. Es necesario
 * ANTES de validar el esquema de una URL: el browser decodifica
 * `&#106;avascript:` a `javascript:`, así que un chequeo sobre el texto crudo
 * se saltea trivialmente.
 */
export function decodificarEntidades(s: string): string {
  if (!s || s.indexOf("&") === -1) return s;
  return s.replace(
    /&(#[xX]?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]{1,9});?/g,
    (match, cuerpo: string) => {
      if (cuerpo[0] === "#") {
        const esHex = cuerpo[1] === "x" || cuerpo[1] === "X";
        const num = parseInt(esHex ? cuerpo.slice(2) : cuerpo.slice(1), esHex ? 16 : 10);
        if (!Number.isFinite(num) || num < 0 || num > 0x10ffff) return match;
        try {
          return String.fromCodePoint(num);
        } catch {
          return match;
        }
      }
      const nombrada = ENTIDADES[cuerpo.toLowerCase()];
      return nombrada === undefined ? match : nombrada;
    },
  );
}

// === Direcciones ===

function quitarComillas(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return t;
}

/**
 * Parsea una dirección sola. Cubre `"Apellido, Nombre" <x@y.com>`,
 * `Nombre <x@y.com>`, `<x@y.com>` y `x@y.com`, con encoded-words en el nombre.
 * Si no hay display name, `nombre` cae al propio email (la UI siempre tiene
 * algo que pintar).
 */
export function parseDireccion(raw: string): DireccionEmail {
  const s = (raw ?? "").trim();
  if (!s) return { nombre: "", email: "" };

  // El último par de angulares es el que manda: el display name puede
  // contener '<' dentro de comillas.
  const abre = s.lastIndexOf("<");
  const cierra = s.lastIndexOf(">");
  if (abre !== -1 && cierra > abre) {
    const email = s.slice(abre + 1, cierra).trim().toLowerCase();
    const nombre = decodificarEncodedWords(
      quitarComillas(s.slice(0, abre)),
    ).trim();
    return { nombre: nombre || email, email };
  }

  const email = s.replace(/[<>]/g, "").trim().toLowerCase();
  return { nombre: email, email };
}

/**
 * Parsea un header con varias direcciones. El split por comas respeta las
 * comas dentro de comillas y dentro de angulares — si no, `"Ruiz, Marcela"
 * <m@x.com>` se parte en dos destinatarios fantasma.
 *
 * Además entiende la sintaxis de GRUPO de RFC 5322 §3.4 (`Nombre: a@x, b@x;`),
 * habitual en los envíos masivos de colegios y en el `undisclosed-recipients:;`
 * de las notificaciones: el `:` cierra el nombre del grupo (que se descarta) y
 * el `;` cierra la lista. Sin esto el nombre del grupo terminaba como un
 * destinatario más y viajaba al CC del "responder a todos", donde `z.email()`
 * lo rechazaba con un 400 sin decir cuál era el chip culpable.
 */
export function parseListaDirecciones(raw: string): DireccionEmail[] {
  if (!raw) return [];
  const partes: string[] = [];
  let actual = "";
  let enComillas = false;
  let enAngulo = false;

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (enComillas && c === "\\") {
      actual += c + (raw[i + 1] ?? "");
      i++;
      continue;
    }
    if (c === '"') {
      enComillas = !enComillas;
      actual += c;
      continue;
    }
    if (!enComillas && c === "<") enAngulo = true;
    else if (!enComillas && c === ">") enAngulo = false;

    if (!enComillas && !enAngulo) {
      // `:` = fin del display name del grupo; lo acumulado es la etiqueta.
      if (c === ":") {
        actual = "";
        continue;
      }
      if (c === "," || c === ";") {
        partes.push(actual);
        actual = "";
        continue;
      }
    }
    actual += c;
  }
  partes.push(actual);

  return partes
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map(parseDireccion)
    .filter((d) => RE_EMAIL_LAXO.test(d.email));
}

// === Headers ===

export function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  nombre: string,
): string | null {
  if (!headers) return null;
  const objetivo = nombre.toLowerCase();
  for (const h of headers) {
    if ((h.name ?? "").toLowerCase() === objetivo) {
      return h.value ?? null;
    }
  }
  return null;
}

// === Cuerpo ===

const PROFUNDIDAD_MAX = 20;

/**
 * Part de texto cuyo body Gmail NO mandó inline: para los cuerpos grandes
 * devuelve `body.attachmentId` sin `body.data`, y los bytes hay que pedirlos
 * aparte con `users.messages.attachments.get`. Como este módulo es puro (no
 * habla con la red), lo delegamos al caller: ver `mensajes.ts`.
 */
export type CuerpoPendiente = {
  tipo: "html" | "texto";
  attachmentId: string;
  /** Charset declarado en el Content-Type del part, para decodificar después. */
  charset: string;
};

export type CuerpoExtraido = {
  html: string | null;
  texto: string | null;
  pendientes: CuerpoPendiente[];
};

/**
 * Recorre el árbol de parts y devuelve el primer text/html y el primer
 * text/plain que no sean adjuntos. Cubre multipart/alternative, /mixed y
 * /related anidados. La prioridad html > texto la decide el consumidor:
 * devolvemos ambos.
 */
export function extraerCuerpo(
  payload: gmail_v1.Schema$MessagePart | undefined,
): CuerpoExtraido {
  let html: string | null = null;
  let texto: string | null = null;
  const pendientes: CuerpoPendiente[] = [];
  // Un slot se "toma" tanto con el contenido resuelto como con un pendiente:
  // si no, el .eml de más abajo del árbol le ganaría el lugar al part propio.
  const tomado = { html: false, texto: false };

  const tomar = (
    part: gmail_v1.Schema$MessagePart,
    tipo: "html" | "texto",
  ): void => {
    const d = decodificarParteTexto(part);
    if (d !== null) {
      if (tipo === "html") html = d;
      else texto = d;
      tomado[tipo] = true;
      return;
    }
    const attachmentId = part.body?.attachmentId;
    if (attachmentId) {
      pendientes.push({ tipo, attachmentId, charset: charsetDe(part) });
      tomado[tipo] = true;
    }
  };

  const visitar = (
    part: gmail_v1.Schema$MessagePart | undefined,
    profundidad: number,
  ): void => {
    if (!part || profundidad > PROFUNDIDAD_MAX) return;
    const mime = (part.mimeType ?? "").toLowerCase();
    const esAdjunto = (part.filename ?? "").length > 0;

    // NO se desciende dentro de un adjunto. Un `message/rfc822` (un mail
    // reenviado como archivo) trae su propio text/html y text/plain, y si los
    // recorriéramos pisarían el cuerpo del mensaje contenedor: el abogado
    // leería el adjunto creyendo que es la notificación, y al responder
    // citaría un texto ajeno.
    if (esAdjunto || mime === "message/rfc822") return;

    if (mime === "text/html" && !tomado.html) tomar(part, "html");
    else if (mime === "text/plain" && !tomado.texto) tomar(part, "texto");

    for (const hijo of part.parts ?? []) visitar(hijo, profundidad + 1);
  };

  visitar(payload, 0);
  return { html, texto, pendientes };
}

function charsetDe(part: gmail_v1.Schema$MessagePart): string {
  const ct = getHeader(part.headers, "Content-Type") ?? "";
  const m = ct.match(/charset\s*=\s*"?([A-Za-z0-9_\-.:]+)"?/);
  return m ? m[1] : "utf-8";
}

/** Decodifica bytes crudos de un part de texto con su charset declarado. */
export function decodificarTextoConCharset(
  bytes: Buffer,
  charset: string,
): string {
  return decodificarBytes(bytes, charset);
}

// Gmail devuelve el body ya en base64url sin importar el
// Content-Transfer-Encoding original, pero el charset del header sí importa
// para los mails viejos en ISO-8859-1.
function decodificarParteTexto(
  part: gmail_v1.Schema$MessagePart,
): string | null {
  const bytes = decodificarBase64UrlABytes(part.body?.data);
  if (bytes === null) return null;
  return decodificarBytes(bytes, charsetDe(part));
}

// === Adjuntos ===

/**
 * Adjuntos reales del mensaje: parts con filename y attachmentId.
 *
 * Una imagen se omite si el HTML del cuerpo la referencia con `cid:` — ahí ya
 * se ve incrustada en el mensaje (`sanitizarHtml` reescribe el `cid:` a la
 * ruta de descarga) y listarla otra vez llenaría de chips basura casi todos
 * los mails, que traen el logo de la firma del remitente. Si NADIE la
 * referencia, en la práctica es un adjunto común y hay que listarla.
 *
 * No se exige `Content-Disposition: inline` porque muchos generadores lo
 * omiten en las partes de un multipart/related; sí se respeta un `attachment`
 * explícito, que es el remitente diciendo que quiere que se pueda bajar.
 */
export function extraerAdjuntos(
  payload: gmail_v1.Schema$MessagePart | undefined,
  htmlCuerpo?: string | null,
): AdjuntoResumen[] {
  const out: AdjuntoResumen[] = [];
  const html = htmlCuerpo ?? "";

  const visitar = (
    part: gmail_v1.Schema$MessagePart | undefined,
    profundidad: number,
  ): void => {
    if (!part || profundidad > PROFUNDIDAD_MAX) return;

    const filename = part.filename ?? "";
    const attachmentId = part.body?.attachmentId ?? null;
    if (filename.length > 0 && attachmentId) {
      const disp = (
        getHeader(part.headers, "Content-Disposition") ?? ""
      ).toLowerCase();
      const cidCrudo = getHeader(part.headers, "Content-ID");
      const cid = cidCrudo ? cidCrudo.replace(/^<|>$/g, "").trim() : null;
      const inlineReferenciado =
        disp.indexOf("attachment") === -1 &&
        cid !== null &&
        html.indexOf(`cid:${cid}`) !== -1;

      if (!inlineReferenciado) {
        out.push({
          id: attachmentId,
          filename: decodificarEncodedWords(filename),
          mime_type: part.mimeType ?? "application/octet-stream",
          size_bytes: part.body?.size ?? 0,
        });
      }
    }
    for (const hijo of part.parts ?? []) visitar(hijo, profundidad + 1);
  };

  visitar(payload, 0);
  return out;
}

/**
 * Mapa Content-ID → attachmentId de las imágenes incrustadas en el cuerpo.
 * Lo consume `sanitizarHtml` para reescribir los `src="cid:..."` a la ruta de
 * descarga del adjunto: sin eso la imagen queda como un `<img>` sin src y,
 * como `extraerAdjuntos` la excluye por estar referenciada, tampoco hay forma
 * de llegar a ella desde la UI.
 */
export function extraerImagenesInline(
  payload: gmail_v1.Schema$MessagePart | undefined,
): Map<string, string> {
  const out = new Map<string, string>();

  const visitar = (
    part: gmail_v1.Schema$MessagePart | undefined,
    profundidad: number,
  ): void => {
    if (!part || profundidad > PROFUNDIDAD_MAX) return;
    const attachmentId = part.body?.attachmentId;
    const cidCrudo = getHeader(part.headers, "Content-ID");
    if (attachmentId && cidCrudo) {
      const cid = cidCrudo.replace(/^<|>$/g, "").trim();
      if (cid.length > 0 && !out.has(cid)) out.set(cid, attachmentId);
    }
    for (const hijo of part.parts ?? []) visitar(hijo, profundidad + 1);
  };

  visitar(payload, 0);
  return out;
}

/**
 * ¿El árbol tiene algún adjunto DE VERDAD? Sirve para el clip del listado, que
 * se arma con format=metadata.
 *
 * El criterio tiene que aproximar el de `extraerAdjuntos` o el clip aparece en
 * filas cuyo detalle no lista nada — el caso más común de todos es el logo de
 * la firma del remitente. Con format=metadata no llegan ni el HTML del cuerpo
 * ni los headers de cada part, así que el único indicio disponible es la
 * ESTRUCTURA: las imágenes incrustadas viajan como `image/*` dentro de un
 * `multipart/related`, mientras que los archivos adjuntos de verdad (los PDF
 * de una cédula) cuelgan de un `multipart/mixed`.
 */
export function tieneAdjuntos(
  payload: gmail_v1.Schema$MessagePart | undefined,
  profundidad = 0,
): boolean {
  const visitar = (
    part: gmail_v1.Schema$MessagePart | undefined,
    prof: number,
    dentroDeRelated: boolean,
  ): boolean => {
    if (!part || prof > PROFUNDIDAD_MAX) return false;
    const mime = (part.mimeType ?? "").toLowerCase();

    if ((part.filename ?? "").length > 0 && !esIncrustada(part, mime, dentroDeRelated)) {
      return true;
    }

    const related = dentroDeRelated || mime === "multipart/related";
    for (const hijo of part.parts ?? []) {
      if (visitar(hijo, prof + 1, related)) return true;
    }
    return false;
  };

  return visitar(payload, profundidad, false);
}

function esIncrustada(
  part: gmail_v1.Schema$MessagePart,
  mime: string,
  dentroDeRelated: boolean,
): boolean {
  const disp = (getHeader(part.headers, "Content-Disposition") ?? "").toLowerCase();
  // Un `attachment` explícito manda sobre cualquier heurística.
  if (disp.indexOf("attachment") !== -1) return false;
  if (dentroDeRelated && mime.startsWith("image/")) return true;
  // Con format=full sí tenemos headers y se puede usar el mismo criterio que
  // `extraerAdjuntos`, salvo la referencia `cid:` del cuerpo, que en el
  // listado no está disponible.
  return getHeader(part.headers, "Content-ID") !== null;
}

// === Sanitización de HTML ===
//
// LIMITACIÓN CONOCIDA, leer antes de tocar esto:
// Este sanitizador es un tokenizador por regex con allowlist, NO un parser
// HTML completo (no hay DOMPurify ni jsdom instalados y no se agregan deps).
// El criterio es "ante la duda, borrar": cualquier `<` que no matchee la forma
// canónica de un tag se escapa a &lt;, las etiquetas fuera de la allowlist se
// descartan conservando su texto, y los atributos fuera de la allowlist se
// tiran enteros.
// DEFENSA EN PROFUNDIDAD OBLIGATORIA EN LA UI: renderizar este HTML dentro de
// un <iframe sandbox> (sin allow-scripts / allow-same-origin) o con una CSP
// que prohíba scripts inline. No confiar sólo en esta función.

// Elementos que se borran CON su contenido (lo de adentro no es texto útil).
const ELEMENTOS_BLOQUEADOS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "applet",
  "form",
  "noscript",
  "svg",
  "math",
  "template",
  "frameset",
  "frame",
  "head",
  "title",
  "xml",
];

// Subconjunto cuyo contenido es texto crudo (CSS/JS), no marcado: si el tag
// quedó sin cerrar, lo de adentro no se puede mostrar como texto del mail.
const ELEMENTOS_TEXTO_CRUDO = ["script", "style"];

const ETIQUETAS_PERMITIDAS = new Set([
  "a", "abbr", "address", "article", "aside", "b", "big", "blockquote", "br",
  "caption", "center", "code", "col", "colgroup", "dd", "div", "dl", "dt",
  "em", "figcaption", "figure", "font", "footer", "h1", "h2", "h3", "h4",
  "h5", "h6", "header", "hr", "i", "img", "li", "main", "mark", "ol", "p",
  "pre", "q", "s", "section", "small", "span", "strike", "strong", "sub",
  "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "tt",
  "u", "ul", "wbr",
]);

const ETIQUETAS_VACIAS = new Set(["br", "hr", "img", "col", "wbr"]);

// Atributos de presentación que los mails HTML (tablas de los 2000) usan de
// verdad. No se permiten `id` ni `class`: no aportan nada y colisionan con los
// estilos de la app.
const ATRIBUTOS_PERMITIDOS = new Set([
  "align", "alt", "bgcolor", "border", "cellpadding", "cellspacing", "color",
  "colspan", "dir", "face", "height", "lang", "rowspan", "size", "span",
  "start", "style", "title", "valign", "width",
]);

// Propiedades CSS inline que se dejan pasar. Todo lo demás (position, behavior,
// -moz-binding, @import...) se descarta.
const PROPIEDADES_CSS = new Set([
  "background-color", "border", "border-bottom", "border-collapse",
  "border-color", "border-left", "border-radius", "border-right",
  "border-style", "border-top", "border-width", "color", "direction",
  "display", "font", "font-family", "font-size", "font-style", "font-weight",
  "height", "letter-spacing", "line-height", "list-style", "list-style-type",
  "margin", "margin-bottom", "margin-left", "margin-right", "margin-top",
  "max-width", "min-width", "padding", "padding-bottom", "padding-left",
  "padding-right", "padding-top", "text-align", "text-decoration",
  "text-indent", "text-transform", "vertical-align", "white-space", "width",
  "word-break", "word-wrap",
]);

const ESQUEMAS_HREF = ["http:", "https:", "mailto:", "tel:"];

function escaparTexto(s: string): string {
  // Sólo `<`: escapar `&` rompería las entidades legítimas del cuerpo.
  return s.replace(/</g, "&lt;");
}

function escaparValorAtributo(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Normaliza una URL para chequear su esquema: decodifica entidades y saca los
 * caracteres de control/whitespace que se usan para partir `java\tscript:`.
 */
function normalizarUrl(valor: string): string {
  const decodificada = decodificarEntidades(valor);
  return decodificada.replace(/[\u0000-\u0020\u007F]/g, "").trim();
}

function esHrefSeguro(valor: string): boolean {
  const v = normalizarUrl(valor).toLowerCase();
  if (v.length === 0) return false;
  // Relativas y anclas: inofensivas y sin esquema.
  if (v.startsWith("#") || v.startsWith("/")) return true;
  const i = v.indexOf(":");
  const j = v.indexOf("/");
  // Sin ':' antes del primer '/' → es relativa, no hay esquema que validar.
  if (i === -1 || (j !== -1 && j < i)) return true;
  return ESQUEMAS_HREF.some((e) => v.startsWith(e));
}

function esSrcSeguro(valor: string): boolean {
  const v = normalizarUrl(valor).toLowerCase();
  if (v.length === 0) return false;
  if (v.startsWith("http:") || v.startsWith("https:")) return true;
  // data: sólo para imágenes rasterizadas. svg+xml queda afuera a propósito:
  // puede traer script embebido.
  return /^data:image\/(png|jpe?g|gif|webp|bmp|x-icon);base64,/.test(v);
}

function sanitizarStyle(valor: string): string | null {
  const decl = decodificarEntidades(valor).split(";");
  const out: string[] = [];
  for (const d of decl) {
    const i = d.indexOf(":");
    if (i === -1) continue;
    const prop = d.slice(0, i).trim().toLowerCase();
    const val = d.slice(i + 1).trim();
    if (!PROPIEDADES_CSS.has(prop)) continue;
    // url() carga recursos externos (pixel de tracking); expression() es
    // ejecución en IE viejo; el backslash permite escapes CSS ofuscados.
    if (/url\s*\(|expression\s*\(|[\\<>{}]|javascript:|@import/i.test(val)) {
      continue;
    }
    if (val.length === 0 || val.length > 200) continue;
    out.push(`${prop}: ${val}`);
  }
  return out.length > 0 ? out.join("; ") : null;
}

// El nombre de etiqueta admite `:`, `.` y `-`: Outlook genera `<o:p>` y
// `<v:shape>` en TODO mail escrito desde Word, y MJML genera `<mj-section>`.
// Si el tokenizador no los reconoce como tags, caen al camino de texto y se
// escapan a `&lt;o:p>`, que el iframe pinta como basura literal en cada
// párrafo. Reconocerlos hace que el paso siguiente los evalúe contra la
// allowlist, no los encuentre y los descarte conservando el texto interno.
const RE_TAG =
  /<(\/?)([a-zA-Z][a-zA-Z0-9:._-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]*))?)*)\s*(\/?)>/g;

const RE_ATRIBUTO =
  /([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

export type OpcionesSanitizado = {
  /** Content-ID → attachmentId, de `extraerImagenesInline`. */
  imagenesInline?: ReadonlyMap<string, string>;
  /** Id del mensaje: completa la ruta de descarga de la imagen incrustada. */
  mensajeId?: string;
};

const SIN_OPCIONES: OpcionesSanitizado = {};

/**
 * Resuelve `cid:<Content-ID>` a la ruta de descarga del adjunto. Devuelve null
 * si el valor no es un `cid:` o si el mensaje no trae esa parte.
 */
function rutaImagenInline(
  valor: string,
  opciones: OpcionesSanitizado,
): string | null {
  if (!/^cid:/i.test(valor)) return null;
  const { mensajeId, imagenesInline } = opciones;
  if (!mensajeId || !imagenesInline) return null;
  const cid = valor.slice(4).replace(/^<|>$/g, "").trim();
  const attachmentId = imagenesInline.get(cid);
  if (!attachmentId) return null;
  // `?inline=1`: la ruta sirve Content-Disposition: inline sólo para imágenes
  // rasterizadas, que es lo que hace falta para que el <img> renderice.
  return `/api/bandeja/adjuntos/${encodeURIComponent(mensajeId)}/${encodeURIComponent(attachmentId)}?inline=1`;
}

function sanitizarAtributos(
  etiqueta: string,
  crudos: string,
  opciones: OpcionesSanitizado,
): string {
  const out: string[] = [];
  let href: string | null = null;
  RE_ATRIBUTO.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = RE_ATRIBUTO.exec(crudos)) !== null) {
    const nombre = m[1].toLowerCase();
    const valor = m[2] ?? m[3] ?? m[4] ?? "";

    // Todos los handlers de evento, sin excepción.
    if (nombre.startsWith("on")) continue;

    if (nombre === "href") {
      if (etiqueta !== "a" || !esHrefSeguro(valor)) continue;
      href = normalizarUrl(valor);
      out.push(`href="${escaparValorAtributo(href)}"`);
      continue;
    }
    if (nombre === "src") {
      if (etiqueta !== "img") continue;
      const url = normalizarUrl(valor);

      // Imagen incrustada del propio mail: se sirve desde nuestra ruta de
      // adjuntos (same-origin, autenticada), no sale a la red del remitente.
      const inline = rutaImagenInline(url, opciones);
      if (inline !== null) {
        out.push(`src="${escaparValorAtributo(inline)}"`);
        continue;
      }

      if (!esSrcSeguro(valor)) continue;
      // Las remotas se guardan bloqueadas: ver ATTR_IMG_BLOQUEADA en types.ts.
      // Las `data:` quedan como src porque no generan ninguna request.
      const remota = /^https?:/i.test(url);
      const attr = remota ? ATTR_IMG_BLOQUEADA : "src";
      out.push(`${attr}="${escaparValorAtributo(url)}"`);
      continue;
    }
    if (nombre === "style") {
      const limpio = sanitizarStyle(valor);
      if (limpio) out.push(`style="${escaparValorAtributo(limpio)}"`);
      continue;
    }
    if (!ATRIBUTOS_PERMITIDOS.has(nombre)) continue;
    if (valor.length > 500) continue;
    out.push(`${nombre}="${escaparValorAtributo(decodificarEntidades(valor))}"`);
  }

  // Todo link sale a pestaña nueva y sin filtrar el referrer ni pasar PageRank.
  if (etiqueta === "a" && href !== null) {
    out.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
  }

  return out.length > 0 ? " " + out.join(" ") : "";
}

/** Techo defensivo: acota el peor caso del tokenizado y del payload al cliente. */
const HTML_MAX = 500_000;

export function sanitizarHtml(
  html: string,
  opciones: OpcionesSanitizado = SIN_OPCIONES,
): string {
  if (!html) return "";

  let s = html.length > HTML_MAX ? html.slice(0, HTML_MAX) : html;

  // 1. Comentarios (incluidos los condicionales de Outlook) y prólogos.
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<!--[\s\S]*$/, "");
  s = s.replace(/<![^>]*>/g, "");
  s = s.replace(/<\?[\s\S]*?\?>/g, "");

  // 2a. Elementos bloqueados que SÍ tienen etiqueta de cierre: se borran con
  // todo su contenido. Se itera porque el borrado puede dejar al descubierto
  // un tag anidado.
  for (const tag of ELEMENTOS_BLOQUEADOS) {
    const par = new RegExp(
      `<\\s*${tag}\\b[\\s\\S]*?<\\s*\\/\\s*${tag}\\s*>`,
      "gi",
    );
    let previo: string;
    let vueltas = 0;
    do {
      previo = s;
      s = s.replace(par, "");
      vueltas++;
    } while (s !== previo && vueltas < 5);
  }

  // 2b. Huérfanos: el tag quedó abierto y no hay cierre en todo el documento.
  // ACÁ HABÍA UN BUG GRAVE: el regex de arriba llevaba una alternativa `|$`,
  // así que un `<style>` o un `<head>` sin cerrar —malformación de rutina en
  // los generadores de mail, y `</head>` es opcional según la propia spec—
  // borraba TODO desde ese punto hasta el final del documento. El mail se veía
  // truncado, o directamente vacío, sin ninguna señal.
  //
  // En `script`/`style` el contenido es código, no texto del mail: se descarta
  // hasta donde vuelve a empezar el marcado. En el resto (head, title, form,
  // svg…) lo de adentro SÍ es texto del abogado y se conserva: se borra sólo
  // la etiqueta, y el paso 3 se encarga de lo que quede.
  for (const tag of ELEMENTOS_TEXTO_CRUDO) {
    s = s.replace(new RegExp(`<\\s*${tag}\\b[^>]*>[^<]*`, "gi"), "");
  }
  for (const tag of ELEMENTOS_BLOQUEADOS) {
    s = s.replace(new RegExp(`<\\s*\\/?\\s*${tag}\\b[^>]*>`, "gi"), "");
  }

  // 3. Tokenizado. Lo que no matchee la forma canónica de un tag se trata como
  // texto y se escapa: eso mata los tags mal formados usados para evadir.
  let out = "";
  let cursor = 0;
  RE_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = RE_TAG.exec(s)) !== null) {
    out += escaparTexto(s.slice(cursor, m.index));
    cursor = RE_TAG.lastIndex;

    const esCierre = m[1] === "/";
    const etiqueta = m[2].toLowerCase();
    const atributos = m[3] ?? "";
    const autoCierre = m[4] === "/";

    // Etiqueta no permitida: se descarta el tag, se conserva el texto interno.
    if (!ETIQUETAS_PERMITIDAS.has(etiqueta)) continue;

    if (esCierre) {
      if (!ETIQUETAS_VACIAS.has(etiqueta)) out += `</${etiqueta}>`;
      continue;
    }

    const attrs = sanitizarAtributos(etiqueta, atributos, opciones);
    const vacia = ETIQUETAS_VACIAS.has(etiqueta) || autoCierre;
    out += `<${etiqueta}${attrs}${vacia ? " /" : ""}>`;
  }
  out += escaparTexto(s.slice(cursor));

  return out;
}

// === Construcción del MIME de salida ===

const CRLF = "\r\n";

/** Un header no puede contener CR/LF: es el vector clásico de header injection. */
function limpiarHeader(valor: string): string {
  return valor.replace(/[\r\n\u0000-\u001F\u007F]/g, " ").trim();
}

function tieneNoAscii(s: string): boolean {
  return /[^\u0000-\u007F]/.test(s);
}

/**
 * Codifica un texto de header en encoded-words base64. Se parte en varias
 * palabras porque RFC 2047 limita cada una a 75 caracteres — un asunto largo
 * con tildes en una sola palabra lo rechazan varios servidores.
 */
function codificarHeaderTexto(valor: string): string {
  const limpio = limpiarHeader(valor);
  if (!tieneNoAscii(limpio)) return limpio;

  const bytes = Buffer.from(limpio, "utf8");
  const partes: string[] = [];
  // 45 bytes → 60 chars de base64; con el envoltorio "=?UTF-8?B??=" (12) da 72,
  // abajo del límite de 75 que fija RFC 2047 §2 por encoded-word.
  const CHUNK = 45;
  let i = 0;
  while (i < bytes.length) {
    let fin = Math.min(i + CHUNK, bytes.length);
    // El corte por bytes puede partir un carácter multibyte al medio (0b10xxxxxx
    // es continuación): se retrocede hasta el inicio del carácter.
    while (fin > i + 1 && fin < bytes.length && (bytes[fin] & 0xc0) === 0x80) {
      fin--;
    }
    partes.push(`=?UTF-8?B?${bytes.subarray(i, fin).toString("base64")}?=`);
    i = fin;
  }
  // El fold es CRLF + espacio: así el header sigue siendo una sola unidad
  // lógica y el whitespace entre encoded-words no cuenta como contenido.
  return partes.join(CRLF + " ");
}

/** RFC 5322 §2.1.1: ninguna línea puede pasar de 998 octetos. Apuntamos a 78. */
const LARGO_LINEA = 78;

/**
 * Emite un header largo plegado en varias líneas. El fold es CRLF + espacio
 * (folding whitespace de RFC 5322 §2.2.3): el header sigue siendo una sola
 * unidad lógica. Sin esto, un `References` de un intercambio de 15 idas y
 * vueltas cruza los 998 octetos y el relay lo trunca o rechaza el envío, y con
 * él se rompe el threading del lado del destinatario.
 */
function plegarHeader(
  nombre: string,
  partes: string[],
  separador: string,
): string {
  const lineas: string[] = [];
  const inicio = `${nombre}:`;
  let linea = inicio;

  partes.forEach((p, i) => {
    const pieza = i === partes.length - 1 ? p : p + separador;
    if (linea !== inicio && linea.length + 1 + pieza.length > LARGO_LINEA) {
      lineas.push(linea);
      linea = " " + pieza;
      return;
    }
    linea += " " + pieza;
  });

  lineas.push(linea);
  return lineas.join(CRLF);
}

/**
 * Codifica un nombre de archivo como parámetro RFC 2231 (`filename*=UTF-8''…`).
 * RFC 2047 §5 PROHÍBE los encoded-words dentro de un quoted-string, así que
 * meter `=?UTF-8?B?…?=` adentro de `filename="…"` produce un header inválido
 * que el destinatario ve literal — y peor si el nombre es largo, porque el
 * fold del encoded-word queda adentro de las comillas y su espacio pasa a ser
 * contenido. Mismo criterio que la ruta de descarga de adjuntos.
 */
export function codificarFilenameRfc2231(nombre: string): string {
  // encodeURIComponent deja pasar ' ( ) * ! ~, que en RFC 2231 no son
  // attribute-char; se escapan a mano.
  return encodeURIComponent(nombre).replace(
    /['()*!~]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Fallback ASCII para clientes que no entienden RFC 2231. */
function filenameAscii(nombre: string): string {
  return nombre.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "_");
}

/**
 * Recorta el nombre a 200 BYTES antes de percent-encodearlo: cada carácter
 * multibyte puede ocupar hasta 9 caracteres en el parámetro RFC 2231, y la
 * línea del header tiene un techo de 998 octetos.
 */
function nombreParaHeader(nombre: string): string {
  const bytes = Buffer.from(nombre, "utf8");
  if (bytes.length <= 200) return nombre;
  let fin = 200;
  // No cortar un carácter multibyte al medio (0b10xxxxxx es continuación).
  while (fin > 0 && (bytes[fin] & 0xc0) === 0x80) fin--;
  return bytes.subarray(0, fin).toString("utf8");
}

function envolverBase64(b64: string): string {
  const limpio = b64.replace(/\s/g, "");
  const lineas: string[] = [];
  for (let i = 0; i < limpio.length; i += 76) {
    lineas.push(limpio.slice(i, i + 76));
  }
  return lineas.join(CRLF);
}

/** Nombre de archivo apto para un header: sin rutas, comillas ni control. */
export function sanitizarNombreArchivo(nombre: string): string {
  const base = (nombre ?? "")
    .replace(/[\r\n\u0000-\u001F\u007F]/g, "")
    .replace(/[\\/]/g, "_")
    .replace(/["<>|:*?]/g, "_")
    .trim();
  const recortado = base.slice(0, 200);
  return recortado.length > 0 ? recortado : "adjunto";
}

export type AdjuntoMime = {
  filename: string;
  mime_type: string;
  /** base64 estándar. */
  contenido_base64: string;
};

export type ConstruirMimeInput = {
  para: string[];
  cc?: string[];
  cco?: string[];
  asunto: string;
  cuerpo: string;
  /** Message-ID del mensaje respondido (con o sin angulares). */
  inReplyTo?: string | null;
  /** Header References del mensaje respondido. */
  references?: string | null;
  adjuntos?: AdjuntoMime[];
};

function normalizarMessageId(id: string): string {
  const limpio = limpiarHeader(id);
  if (!limpio) return "";
  return limpio.startsWith("<") ? limpio : `<${limpio}>`;
}

/** Tope de ids en References. RFC 5322 §3.6.4 habilita a recortar la cadena. */
const REFERENCES_MAX = 21;

/**
 * Cadena de References: los ancestros del mensaje respondido + el Message-ID
 * de ese mismo mensaje al final (que es lo que los clientes leen como padre).
 * Se deduplica —un id repetido deja al mensaje como ancestro de sí mismo— y se
 * recorta a los primeros + los últimos ids cuando el hilo es muy largo.
 */
function cadenaReferences(previas: string | null | undefined, inReplyTo: string): string[] {
  const ids = (previas ? limpiarHeader(previas) : "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== inReplyTo);

  const vistos = new Set<string>();
  const unicos = ids.filter((id) => {
    if (vistos.has(id)) return false;
    vistos.add(id);
    return true;
  });
  unicos.push(inReplyTo);

  if (unicos.length <= REFERENCES_MAX) return unicos;
  // Se conserva la raíz del hilo (que es lo que agrupa) y la cola reciente.
  return [unicos[0], ...unicos.slice(unicos.length - (REFERENCES_MAX - 1))];
}

/**
 * Arma el RFC 2822 completo. NO setea `From`: Gmail lo completa con la cuenta
 * autenticada, y mandarlo a mano puede hacer que rechace el envío.
 * Devuelve el string crudo; el encoding base64url para la API lo hace el caller.
 */
export function construirMime(input: ConstruirMimeInput): string {
  const headers: string[] = [];

  const to = input.para.map(limpiarHeader).filter(Boolean);
  const cc = (input.cc ?? []).map(limpiarHeader).filter(Boolean);
  const bcc = (input.cco ?? []).map(limpiarHeader).filter(Boolean);

  headers.push(plegarHeader("To", to, ","));
  if (cc.length > 0) headers.push(plegarHeader("Cc", cc, ","));
  if (bcc.length > 0) headers.push(plegarHeader("Bcc", bcc, ","));
  headers.push(`Subject: ${codificarHeaderTexto(input.asunto)}`);

  // In-Reply-To + References son lo que hace que el cliente del OTRO lado
  // agrupe la respuesta en el hilo (el threadId sólo agrupa del lado de Gmail).
  const inReplyTo = input.inReplyTo ? normalizarMessageId(input.inReplyTo) : "";
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
    headers.push(plegarHeader("References", cadenaReferences(input.references, inReplyTo), ""));
  }

  headers.push("MIME-Version: 1.0");

  const cuerpoB64 = envolverBase64(
    Buffer.from(input.cuerpo, "utf8").toString("base64"),
  );
  const adjuntos = input.adjuntos ?? [];

  if (adjuntos.length === 0) {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push("Content-Transfer-Encoding: base64");
    return headers.join(CRLF) + CRLF + CRLF + cuerpoB64 + CRLF;
  }

  const boundary = `=_el_${crypto.randomUUID()}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  const partes: string[] = [];
  partes.push(
    `--${boundary}${CRLF}` +
      `Content-Type: text/plain; charset="UTF-8"${CRLF}` +
      `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
      cuerpoB64,
  );

  for (const a of adjuntos) {
    const nombre = nombreParaHeader(sanitizarNombreArchivo(a.filename));
    const ascii = filenameAscii(nombre);
    const ext = codificarFilenameRfc2231(nombre);
    const mime = limpiarHeader(a.mime_type) || "application/octet-stream";
    partes.push(
      `--${boundary}${CRLF}` +
        `Content-Type: ${mime}; name="${ascii}"; name*=UTF-8''${ext}${CRLF}` +
        `Content-Disposition: attachment; filename="${ascii}"; filename*=UTF-8''${ext}${CRLF}` +
        `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
        envolverBase64(a.contenido_base64),
    );
  }

  return (
    headers.join(CRLF) +
    CRLF +
    CRLF +
    partes.join(CRLF) +
    CRLF +
    `--${boundary}--${CRLF}`
  );
}

/** base64url sin padding, que es lo que espera el campo `raw` de la API. */
export function aBase64Url(texto: string): string {
  return Buffer.from(texto, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
