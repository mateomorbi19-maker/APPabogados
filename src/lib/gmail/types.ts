// Tipos, constantes de presentación y schemas de validación de la feature
// Bandeja de entrada (Gmail). Mismo criterio que `src/lib/agenda/types.ts`:
// todo lo compartible entre server y cliente vive acá, sin `server-only`, para
// que los componentes puedan tipar contra los mismos shapes que devuelve la API.

import { z } from "zod";

// === Modelo de dominio ===

/** Par nombre/email ya decodificado (los headers vienen en RFC 2047). */
export type DireccionEmail = {
  /** Nombre para mostrar. Si el header no traía uno, es el propio email. */
  nombre: string;
  /** Siempre en minúsculas. */
  email: string;
};

export type AdjuntoResumen = {
  /** attachmentId de Gmail. Se usa en GET /api/bandeja/adjuntos/[mensaje_id]/[adjunto_id]. */
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
};

/** Fila de la lista de la bandeja: un hilo colapsado en una sola línea. */
export type HiloResumen = {
  /** Igual a `thread_id`. Existe aparte para usarlo como key en el render. */
  id: string;
  thread_id: string;
  /** Remitente del ÚLTIMO mensaje del hilo (lo que muestran los clientes de mail). */
  remitente: DireccionEmail;
  /** Emails de To + Cc del último mensaje. */
  destinatarios: string[];
  /** Asunto del primer mensaje del hilo, o "(sin asunto)". */
  asunto: string;
  /** Snippet del último mensaje, con entidades HTML ya decodificadas. */
  fragmento: string;
  /** ISO 8601 de la fecha del último mensaje. */
  fecha: string;
  /** false si CUALQUIER mensaje del hilo tiene la label UNREAD. */
  leido: boolean;
  /** true si CUALQUIER mensaje del hilo tiene la label STARRED. */
  destacado: boolean;
  tiene_adjuntos: boolean;
  cantidad_mensajes: number;
  /** labelIds crudos de Gmail (unión de todos los mensajes), ordenados. */
  etiquetas: string[];
};

export type MensajeCompleto = {
  id: string;
  thread_id: string;
  de: DireccionEmail;
  para: DireccionEmail[];
  cc: DireccionEmail[];
  asunto: string;
  /** ISO 8601. */
  fecha: string;
  /** HTML YA SANITIZADO por `sanitizarHtml`. Nunca es el HTML crudo del remitente. */
  cuerpo_html: string | null;
  cuerpo_texto: string | null;
  adjuntos: AdjuntoResumen[];
  leido: boolean;
  destacado: boolean;
  etiquetas: string[];
  /** Header Message-ID; lo necesita el compositor para armar la respuesta. */
  message_id_header: string | null;
  /** Header References; se propaga al responder. */
  references_header: string | null;
};

export type HiloCompleto = {
  id: string;
  asunto: string;
  mensajes: MensajeCompleto[];
};

/**
 * Atributo donde `sanitizarHtml` guarda el `src` de las imágenes REMOTAS en
 * vez de emitirlo como `src`. Cargarlas sin pedir permiso es un acuse de
 * lectura: el remitente —que acá puede ser la contraparte o la fiscalía— se
 * entera de cuándo se abrió el mail, desde qué IP y de qué causa se trata (el
 * identificador suele ir en la query string del pixel). La UI restituye el
 * `src` sólo cuando el abogado aprieta "Mostrar imágenes", y por mensaje.
 *
 * No está en la allowlist de atributos, así que un mail que lo traiga escrito
 * a mano lo pierde en la sanitización: sólo lo emite el propio sanitizador.
 */
export const ATTR_IMG_BLOQUEADA = "data-el-img-remota";

/**
 * Validación laxa de una dirección: no es RFC 5322, sólo descarta basura
 * evidente (sintaxis de grupo, `undisclosed-recipients:;`, direcciones con
 * espacios). La estricta la hace `z.email()` en el borde de la API. Se usa
 * tanto al PARSEAR headers entrantes como al tipear chips en el compositor,
 * para que no se pueda cargar en el borrador algo que después el server
 * rechace con 400.
 */
export const RE_EMAIL_LAXO = /^[^\s@,;:]+@[^\s@,;:]+\.[^\s@,;:]{2,}$/;

// === Buzones lógicos ===

// Son un subconjunto de las system labels de Gmail. La UI no expone
// CATEGORY_*, SPAM ni IMPORTANT: para un estudio de 3 abogados alcanza con
// estos cuatro.
//
// TODO — Borradores: la label DRAFT se lista bien con threads.list, pero un
// borrador sólo es operable a través de `users.drafts` (list/get/update/send/
// delete), que es la única API que expone el `draftId`. Sin eso el buzón
// mostraba el hilo con el asunto y el remitente del ORIGINAL, con el borrador
// mezclado como un mensaje más y sin forma de continuarlo, enviarlo ni
// descartarlo. Para reponerlo hace falta: (1) listar con users.drafts.list +
// drafts.get en vez de threads.list, (2) agregar `draft_id` a HiloResumen /
// MensajeCompleto, (3) rutas de continuar / enviar / descartar. Hasta
// entonces preferimos no ofrecer una pestaña que no hace nada.
export const BUZONES = ["INBOX", "SENT", "STARRED", "TRASH"] as const;
export type Buzon = (typeof BUZONES)[number];

export const BUZONES_LABEL: Record<Buzon, string> = {
  INBOX: "Recibidos",
  SENT: "Enviados",
  STARRED: "Destacados",
  TRASH: "Papelera",
};

/** Orden de presentación en el sidebar. */
export const BUZONES_ORDEN: readonly Buzon[] = [
  "INBOX",
  "STARRED",
  "SENT",
  "TRASH",
];

export function buzonLabel(buzon: string): string {
  return (BUZONES_LABEL as Record<string, string>)[buzon] ?? buzon;
}

// === Validación de input (zod en el borde de las API routes) ===

export const buzonSchema = z.enum(BUZONES);

/**
 * Id de hilo o de mensaje de Gmail: hex corto. Acepta también los ids demo
 * (`demo-1`), que entran en el mismo alfabeto.
 */
export const gmailIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, "Id inválido");

/** Los attachmentId son base64url largos (cientos de caracteres). */
export const adjuntoIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_=-]{1,2048}$/, "Id de adjunto inválido");

export const listarHilosQuerySchema = z.object({
  buzon: buzonSchema.default("INBOX"),
  /** Sintaxis de búsqueda de Gmail (`from:`, `has:attachment`, texto libre). */
  q: z.string().trim().max(200).optional(),
  pageToken: z.string().max(500).optional(),
  limite: z.coerce.number().int().min(1).max(50).default(25),
});
export type ListarHilosQuery = z.infer<typeof listarHilosQuerySchema>;

// z.email() es la forma nativa de Zod 4 (el viejo z.string().email() quedó
// deprecado). 320 = largo máximo real de una dirección (64 local + @ + 255).
const emailSchema = z.email("Dirección de email inválida").max(320);

export const adjuntoEnvioSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mime_type: z.string().trim().min(1).max(150),
  /** Contenido en base64 estándar (no base64url). ~7MB de base64 ≈ 5MB de archivo. */
  contenido_base64: z
    .string()
    .max(7_000_000)
    .regex(/^[A-Za-z0-9+/=\s]*$/, "El contenido no es base64 válido"),
});

/** Tope del total de adjuntos por mensaje (en caracteres de base64, ≈6MB reales). */
export const ADJUNTOS_BASE64_MAX_TOTAL = 8_000_000;

export const enviarMensajeSchema = z.object({
  para: z.array(emailSchema).min(1, "Falta el destinatario").max(20),
  cc: z.array(emailSchema).max(20).optional(),
  cco: z.array(emailSchema).max(20).optional(),
  asunto: z.string().max(300),
  cuerpo: z.string().max(100_000),
  /** threadId de Gmail: hace que la respuesta quede dentro del hilo. */
  responde_a_thread_id: z.string().max(200).optional(),
  /** Message-ID del mensaje respondido; alimenta In-Reply-To / References. */
  responde_a_message_id: z.string().max(500).optional(),
  adjuntos: z.array(adjuntoEnvioSchema).max(5).optional(),
});
export type EnviarMensajeInput = z.infer<typeof enviarMensajeSchema>;

export const modificarMensajeSchema = z
  .object({
    /** true = marcar leído (quita UNREAD); false = marcar no leído. */
    leido: z.boolean().optional(),
    destacado: z.boolean().optional(),
    /** true = archivar (quita INBOX); false = devolver a Recibidos. */
    archivar: z.boolean().optional(),
  })
  .refine(
    (d) =>
      d.leido !== undefined ||
      d.destacado !== undefined ||
      d.archivar !== undefined,
    { message: "Mandá al menos uno de: leido, destacado, archivar" },
  );
export type ModificarMensajeInput = z.infer<typeof modificarMensajeSchema>;
