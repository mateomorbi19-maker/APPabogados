// La regla de destinatarios de una respuesta. Módulo PURO y sin `server-only`
// a propósito, igual que types.ts: la usan el compositor de la Bandeja (que
// corre en el browser) y la tool de correo de LEXIE (server), y tiene que ser
// UNA sola regla — si el "responder" del abogado y el de la IA eligieran
// distinto destinatario, la vista previa de LEXIE no serviría para nada.
//
// Lo que sí necesita hablar con Gmail (resolver el mensaje padre, saber la
// casilla propia) vive en mensajes.ts: importarlo desde acá arrastraría
// `server-only` al bundle del cliente.

import type { MensajeCompleto } from "./types";

export type OpcionesRespuesta = {
  /** "Responder a todos": suma los To y Cc originales al Cc de la respuesta. */
  aTodos: boolean;
  /** Casilla del abogado, para no auto-incluirse. Null = no se excluye a nadie. */
  miEmail: string | null;
};

export type DestinatariosRespuesta = {
  para: string[];
  cc: string[];
  /**
   * true cuando la respuesta va al Reply-To y ese Reply-To NO es el From. Es
   * la señal que la vista previa de LEXIE tiene que mostrar: "el mail lo
   * mandó noreply@…, la respuesta va a mesa@…".
   */
  usoReplyTo: boolean;
};

/** Minúsculas, sin repetidos, sin los excluidos, en el orden de llegada. */
function normalizar(emails: string[], excluir: string[]): string[] {
  const fuera = new Set(excluir.map((e) => e.trim().toLowerCase()));
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const e of emails) {
    const k = e.trim().toLowerCase();
    if (k.length === 0 || fuera.has(k) || vistos.has(k)) continue;
    vistos.add(k);
    out.push(k);
  }
  return out;
}

/**
 * A quién va una respuesta a `m`.
 *
 * - `para` es el Reply-To si existe, y si no el From. Los portales judiciales
 *   y las notificaciones mandan desde un `noreply@` con la casilla real en
 *   Reply-To: responderle al From es escribirle a nadie.
 * - Nunca se incluye al propio abogado, en ningún campo.
 * - Con `aTodos`, `cc` suma los To y Cc originales; si la respuesta fue al
 *   Reply-To, también el From (es "a todos": quien escribió tiene que ver la
 *   respuesta). Todo deduplicado sin distinguir mayúsculas.
 *
 * `para` puede quedar vacío: pasa cuando el mensaje lo mandó el propio
 * abogado (responder desde Enviados). El compositor lo deja completar; una
 * tool tiene que tratarlo como error.
 */
export function destinatariosRespuesta(
  m: MensajeCompleto,
  opts: OpcionesRespuesta,
): DestinatariosRespuesta {
  const propio = opts.miEmail ? [opts.miEmail] : [];
  const from = m.de.email.trim().toLowerCase();
  const replyTo = m.reply_to?.email.trim().toLowerCase() ?? "";
  const usoReplyTo = replyTo.length > 0 && replyTo !== from;

  const para = normalizar([usoReplyTo ? replyTo : from], propio);
  const cc = opts.aTodos
    ? normalizar(
        [
          ...(usoReplyTo ? [from] : []),
          ...m.para.map((d) => d.email),
          ...m.cc.map((d) => d.email),
        ],
        [...propio, ...para],
      )
    : [];

  return { para, cc, usoReplyTo };
}
