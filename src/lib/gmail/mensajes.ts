import "server-only";
import type { gmail_v1 } from "@googleapis/gmail";
import {
  aBase64Url,
  construirMime,
  decodificarBase64UrlABytes,
  decodificarEncodedWords,
  decodificarEntidades,
  decodificarTextoConCharset,
  extraerAdjuntos,
  extraerCuerpo,
  extraerImagenesInline,
  getHeader,
  parseDireccion,
  parseListaDirecciones,
  sanitizarHtml,
  tieneAdjuntos,
} from "./parse";
import type { CuerpoPendiente } from "./parse";
import { BUZON_TODOS } from "./types";
import type {
  Buzon,
  BuzonListado,
  DireccionEmail,
  EnviarMensajeInput,
  HiloCompleto,
  HiloResumen,
  MensajeCompleto,
  ModificarMensajeInput,
} from "./types";

// Operaciones contra la API de Gmail. Nada de acá conoce HTTP ni Next: las
// rutas traducen los errores a status codes.

const USER = "me";
const SIN_ASUNTO = "(sin asunto)";

// Los buzones lógicos de la app mapean 1:1 a system labels de Gmail. El
// virtual BUZON_TODOS no está: se lista SIN labelIds (ver listarHilos).
// (DRAFT tampoco: ver el TODO de BUZONES en types.ts — un borrador sólo es
// operable con users.drafts, que esta capa todavía no usa.)
const LABEL_POR_BUZON: Record<Buzon, string> = {
  INBOX: "INBOX",
  SENT: "SENT",
  STARRED: "STARRED",
  TRASH: "TRASH",
};

// Headers que alcanzan para pintar una fila del listado. Pedir sólo estos
// achica bastante la respuesta de threads.get con format=metadata.
//
// Con format=metadata Gmail devuelve el árbol de parts (mimeType, filename)
// pero sin los bytes del body. De ahí sale `tiene_adjuntos`: si en algún
// escenario Gmail omitiera el árbol, el flag queda en false y lo único que se
// pierde es el clip en la fila — nunca rompe el listado.
const HEADERS_LISTADO = ["From", "To", "Cc", "Subject", "Date"];

/**
 * Pool de concurrencia fija. `threads.list` devuelve sólo ids, así que hay que
 * hacer un `get` por hilo: con Promise.all sobre 25 nos comemos el rate limit
 * de Gmail (250 quota units/seg/usuario) y los 429 en ráfaga.
 */
async function mapConLimite<T, R>(
  items: T[],
  limite: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;

  const trabajador = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };

  const trabajadores = Array.from(
    { length: Math.min(limite, items.length) },
    trabajador,
  );
  await Promise.all(trabajadores);
  return out;
}

const CONCURRENCIA = 5;

/** internalDate (ms epoch en string) → ISO. Cae al header Date y después a now. */
function fechaDeMensaje(m: gmail_v1.Schema$Message): string {
  const interna = m.internalDate;
  if (interna) {
    const ms = Number(interna);
    if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
  }
  const header = getHeader(m.payload?.headers, "Date");
  if (header) {
    const d = new Date(header);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function etiquetasDe(m: gmail_v1.Schema$Message): string[] {
  return (m.labelIds ?? []).filter((l): l is string => typeof l === "string");
}

function asuntoDe(m: gmail_v1.Schema$Message | undefined): string {
  const crudo = getHeader(m?.payload?.headers, "Subject");
  const limpio = crudo ? decodificarEncodedWords(crudo).trim() : "";
  return limpio.length > 0 ? limpio : SIN_ASUNTO;
}

/**
 * Reply-To, o null si no viene o si trae basura. Se toma la PRIMERA dirección
 * válida: el header admite una lista (RFC 5322 §3.6.2), pero un "responder"
 * con dos destinatarios que el abogado no eligió es peor que responder a uno.
 */
function replyToDe(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
): DireccionEmail | null {
  const crudo = getHeader(headers, "Reply-To");
  if (!crudo) return null;
  return parseListaDirecciones(crudo)[0] ?? null;
}

function hiloAResumen(hilo: gmail_v1.Schema$Thread): HiloResumen | null {
  const threadId = hilo.id;
  const mensajes = hilo.messages ?? [];
  if (!threadId || mensajes.length === 0) return null;

  const primero = mensajes[0];
  const ultimo = mensajes[mensajes.length - 1];

  const etiquetas = new Set<string>();
  let leido = true;
  let destacado = false;
  let conAdjuntos = false;

  for (const m of mensajes) {
    const labels = etiquetasDe(m);
    for (const l of labels) etiquetas.add(l);
    if (labels.includes("UNREAD")) leido = false;
    if (labels.includes("STARRED")) destacado = true;
    if (!conAdjuntos && tieneAdjuntos(m.payload)) conAdjuntos = true;
  }

  const headers = ultimo.payload?.headers;
  const destinatarios = [
    ...parseListaDirecciones(getHeader(headers, "To") ?? ""),
    ...parseListaDirecciones(getHeader(headers, "Cc") ?? ""),
  ].map((d) => d.email);

  return {
    id: threadId,
    thread_id: threadId,
    remitente: parseDireccion(getHeader(headers, "From") ?? ""),
    destinatarios: Array.from(new Set(destinatarios)),
    // El asunto del hilo es el del primer mensaje: los "Re:" del resto son ruido.
    asunto: asuntoDe(primero),
    // El snippet de Gmail viene con entidades HTML (&#39;, &amp;) sin decodificar.
    fragmento: decodificarEntidades(ultimo.snippet ?? hilo.snippet ?? ""),
    fecha: fechaDeMensaje(ultimo),
    leido,
    destacado,
    tiene_adjuntos: conAdjuntos,
    cantidad_mensajes: mensajes.length,
    etiquetas: Array.from(etiquetas).sort(),
  };
}

export type ListarHilosOpts = {
  buzon: BuzonListado;
  q?: string;
  pageToken?: string;
  limite: number;
};

export async function listarHilos(
  gmail: gmail_v1.Gmail,
  opts: ListarHilosOpts,
): Promise<{ hilos: HiloResumen[]; nextPageToken: string | null }> {
  const lista = await gmail.users.threads.list({
    userId: USER,
    // Sin labelIds Gmail busca en TODO el correo (lo archivado incluido);
    // spam y papelera siguen afuera porque includeSpamTrash queda en false.
    labelIds:
      opts.buzon === BUZON_TODOS ? undefined : [LABEL_POR_BUZON[opts.buzon]],
    maxResults: opts.limite,
    pageToken: opts.pageToken,
    q: opts.q && opts.q.length > 0 ? opts.q : undefined,
    // Sin esto la papelera vuelve vacía: TRASH está excluida por defecto.
    includeSpamTrash: opts.buzon === "TRASH",
  });

  const ids = (lista.data.threads ?? [])
    .map((t) => t.id)
    .filter((id): id is string => typeof id === "string");

  const resultados = await mapConLimite(ids, CONCURRENCIA, async (id) => {
    try {
      const r = await gmail.users.threads.get({
        userId: USER,
        id,
        format: "metadata",
        metadataHeaders: HEADERS_LISTADO,
      });
      return hiloAResumen(r.data);
    } catch (e) {
      // Un hilo que falla (borrado entre el list y el get, 404) no puede
      // tumbar la bandeja entera: se omite esa fila.
      console.error("[gmail] threads.get falló para", id, e);
      return null;
    }
  });

  return {
    hilos: resultados.filter((h): h is HiloResumen => h !== null),
    nextPageToken: lista.data.nextPageToken ?? null,
  };
}

/**
 * Resuelve los parts de texto que Gmail sirvió como adjunto en vez de inline
 * (pasa con los cuerpos grandes: `body.attachmentId` sin `body.data`). Sin
 * esto el mensaje llegaba con html y texto en null y la UI pintaba "(Este
 * mensaje no tiene cuerpo de texto)" sobre un dictamen entero.
 */
async function resolverCuerpoDiferido(
  gmail: gmail_v1.Gmail,
  messageId: string,
  cuerpo: { html: string | null; texto: string | null; pendientes: CuerpoPendiente[] },
): Promise<{ html: string | null; texto: string | null }> {
  let { html, texto } = cuerpo;

  for (const p of cuerpo.pendientes) {
    if (p.tipo === "html" ? html !== null : texto !== null) continue;
    try {
      const r = await gmail.users.messages.attachments.get({
        userId: USER,
        messageId,
        id: p.attachmentId,
      });
      const bytes = decodificarBase64UrlABytes(r.data.data);
      if (bytes === null) continue;
      const contenido = decodificarTextoConCharset(bytes, p.charset);
      if (p.tipo === "html") html = contenido;
      else texto = contenido;
    } catch (e) {
      // Un cuerpo que no se pudo traer no puede tumbar el hilo entero: el
      // mensaje se muestra con lo que haya (el otro formato, o el aviso de
      // cuerpo vacío).
      console.error("[gmail] no se pudo traer el cuerpo diferido:", e);
    }
  }

  return { html, texto };
}

async function mensajeACompleto(
  gmail: gmail_v1.Gmail,
  m: gmail_v1.Schema$Message,
  threadId: string,
): Promise<MensajeCompleto> {
  const headers = m.payload?.headers;
  const mensajeId = m.id ?? "";
  const extraido = extraerCuerpo(m.payload);
  const { html, texto } =
    extraido.pendientes.length > 0 && mensajeId.length > 0
      ? await resolverCuerpoDiferido(gmail, mensajeId, extraido)
      : extraido;
  const labels = etiquetasDe(m);

  return {
    id: mensajeId,
    thread_id: m.threadId ?? threadId,
    de: parseDireccion(getHeader(headers, "From") ?? ""),
    para: parseListaDirecciones(getHeader(headers, "To") ?? ""),
    cc: parseListaDirecciones(getHeader(headers, "Cc") ?? ""),
    reply_to: replyToDe(headers),
    asunto: asuntoDe(m),
    fecha: fechaDeMensaje(m),
    // El HTML se sanitiza acá, en el borde de salida: lo que sale del módulo
    // NUNCA es el HTML crudo de un tercero. Las imágenes incrustadas del
    // propio mail (`cid:`) se reescriben a nuestra ruta de adjuntos.
    cuerpo_html:
      html === null
        ? null
        : sanitizarHtml(html, {
            imagenesInline: extraerImagenesInline(m.payload),
            mensajeId,
          }),
    cuerpo_texto: texto,
    adjuntos: extraerAdjuntos(m.payload, html),
    leido: !labels.includes("UNREAD"),
    destacado: labels.includes("STARRED"),
    etiquetas: labels,
    message_id_header: getHeader(headers, "Message-ID"),
    references_header: getHeader(headers, "References"),
  };
}

export async function obtenerHilo(
  gmail: gmail_v1.Gmail,
  threadId: string,
): Promise<HiloCompleto | null> {
  const r = await gmail.users.threads.get({
    userId: USER,
    id: threadId,
    format: "full",
  });

  const id = r.data.id;
  const mensajes = r.data.messages ?? [];
  if (!id || mensajes.length === 0) return null;

  return {
    id,
    asunto: asuntoDe(mensajes[0]),
    // Con pool en vez de Promise.all: casi todos los mensajes se resuelven sin
    // IO, pero los que tienen cuerpo diferido hacen un attachments.get cada
    // uno y un hilo largo dispararía una ráfaga contra el rate limit.
    mensajes: await mapConLimite(mensajes, CONCURRENCIA, (m) =>
      mensajeACompleto(gmail, m, id),
    ),
  };
}

/**
 * Casilla del abogado (users.getProfile), en minúsculas, o null si Google no
 * contesta. Sirve para no auto-incluirse al "responder a todos"; con null la
 * regla de destinatarios simplemente no excluye a nadie.
 */
export async function miEmail(gmail: gmail_v1.Gmail): Promise<string | null> {
  try {
    const perfil = await gmail.users.getProfile({ userId: USER });
    const email = perfil.data.emailAddress?.trim().toLowerCase();
    return email && email.length > 0 ? email : null;
  } catch (e) {
    console.error("[gmail] getProfile falló:", e);
    return null;
  }
}

/** Compara Message-ID ignorando los angulares y el espacio alrededor. */
function mismoMessageId(a: string | null, b: string): boolean {
  if (!a) return false;
  const pelar = (s: string) => s.trim().replace(/^<|>$/g, "").trim();
  return pelar(a) === pelar(b);
}

/**
 * El mensaje que se va a responder y su cadena de References.
 *
 * RFC 5322 §3.6.4: References se arma con las del mensaje QUE SE RESPONDE más
 * su Message-ID — no con las del último del hilo. El abogado puede responder
 * a un mensaje del medio, y mezclar las dos fuentes deja ids duplicados y
 * descendientes listados como ancestros, con lo que el árbol del destinatario
 * cuelga la respuesta del mensaje equivocado.
 *
 * `messageId` acepta las DOS identidades de un mensaje: el `id` de Gmail
 * (que es lo único que ve LEXIE, porque `hiloParaModelo` nunca expone el
 * Message-ID) y el header Message-ID (que es lo que manda el botón Responder
 * de la Bandeja). Sin `messageId`, o si no está en el hilo, se responde al
 * último. Null si el hilo no existe o está vacío; si Gmail falla, tira: el
 * caller decide si envía igual sin threading.
 */
export async function resolverPadreParaRespuesta(
  gmail: gmail_v1.Gmail,
  threadId: string,
  messageId?: string | null,
): Promise<{ padre: MensajeCompleto; references: string[] } | null> {
  const hilo = await obtenerHilo(gmail, threadId);
  if (!hilo) return null;

  const buscado = messageId?.trim() ?? "";
  const padre =
    (buscado.length > 0
      ? hilo.mensajes.find(
          (m) => m.id === buscado || mismoMessageId(m.message_id_header, buscado),
        )
      : undefined) ?? hilo.mensajes[hilo.mensajes.length - 1];

  const references = (padre.references_header ?? "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return { padre, references };
}

export async function enviarMensaje(
  gmail: gmail_v1.Gmail,
  input: EnviarMensajeInput,
  /** References del mensaje respondido, si el caller lo tiene a mano. */
  referencesPrevias?: string | null,
): Promise<{ id: string; thread_id: string }> {
  const mime = construirMime({
    para: input.para,
    cc: input.cc,
    cco: input.cco,
    asunto: input.asunto,
    cuerpo: input.cuerpo,
    inReplyTo: input.responde_a_message_id ?? null,
    references: referencesPrevias ?? null,
    adjuntos: input.adjuntos,
  });

  const r = await gmail.users.messages.send({
    userId: USER,
    requestBody: {
      raw: aBase64Url(mime),
      // threadId es lo que hace que Gmail agrupe la respuesta del lado nuestro;
      // In-Reply-To/References (ya en el MIME) hacen lo propio del otro lado.
      threadId: input.responde_a_thread_id,
    },
  });

  return {
    id: r.data.id ?? "",
    thread_id: r.data.threadId ?? input.responde_a_thread_id ?? "",
  };
}

/**
 * Aplica flags sobre TODO el hilo (que es la unidad que muestra la UI).
 * Devuelve false si no había nada para cambiar.
 */
export async function modificarMensaje(
  gmail: gmail_v1.Gmail,
  threadId: string,
  cambios: ModificarMensajeInput,
): Promise<boolean> {
  const addLabelIds: string[] = [];
  const removeLabelIds: string[] = [];

  if (cambios.leido !== undefined) {
    if (cambios.leido) removeLabelIds.push("UNREAD");
    else addLabelIds.push("UNREAD");
  }
  if (cambios.destacado !== undefined) {
    if (cambios.destacado) addLabelIds.push("STARRED");
    else removeLabelIds.push("STARRED");
  }
  if (cambios.archivar !== undefined) {
    // Archivar en Gmail es simplemente sacar la label INBOX.
    if (cambios.archivar) removeLabelIds.push("INBOX");
    else addLabelIds.push("INBOX");
  }

  if (addLabelIds.length === 0 && removeLabelIds.length === 0) return false;

  await gmail.users.threads.modify({
    userId: USER,
    id: threadId,
    requestBody: { addLabelIds, removeLabelIds },
  });
  return true;
}

/**
 * Papelera, NUNCA borrado permanente. La app no expone `threads.delete` a
 * propósito: es irreversible y no hay ningún caso de uso que lo justifique en
 * un estudio jurídico (donde la correspondencia es prueba).
 */
export async function moverAPapelera(
  gmail: gmail_v1.Gmail,
  threadId: string,
): Promise<void> {
  await gmail.users.threads.trash({ userId: USER, id: threadId });
}

export async function restaurarDePapelera(
  gmail: gmail_v1.Gmail,
  threadId: string,
): Promise<void> {
  await gmail.users.threads.untrash({ userId: USER, id: threadId });
}

export type AdjuntoDescarga = {
  data: Buffer;
  filename: string;
  mime_type: string;
  size_bytes: number;
};

/**
 * Baja un adjunto. Hace dos llamadas porque `attachments.get` sólo devuelve
 * bytes: el filename y el mime-type viven en el part del mensaje, y NO se
 * toman del cliente para que la URL no pueda dictar el Content-Type servido.
 */
export async function obtenerAdjunto(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string,
): Promise<AdjuntoDescarga | null> {
  const msg = await gmail.users.messages.get({
    userId: USER,
    id: messageId,
    format: "full",
  });

  // Sin htmlCuerpo: acá SÍ queremos ver también las imágenes inline, porque el
  // usuario puede pedir explícitamente descargar una.
  const meta = extraerAdjuntos(msg.data.payload, null).find(
    (a) => a.id === attachmentId,
  );
  if (!meta) return null;

  const r = await gmail.users.messages.attachments.get({
    userId: USER,
    messageId,
    id: attachmentId,
  });

  const bytes = decodificarBase64UrlABytes(r.data.data);
  if (bytes === null) return null;

  return {
    data: bytes,
    filename: meta.filename,
    mime_type: meta.mime_type,
    size_bytes: r.data.size ?? bytes.length,
  };
}
