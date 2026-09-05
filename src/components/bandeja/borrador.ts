// Armado del borrador que abre el compositor cuando se responde o reenvía.
// Es lógica pura: la usa bandeja-view antes de montar <ComposerModal/>.

import { destinatariosRespuesta } from "@/lib/gmail/respuesta";
import type { MensajeCompleto } from "@/lib/gmail/types";
import { fechaCompleta } from "./fechas";
import { nombreDe } from "./presentacion";

export type Borrador = {
  para: string[];
  cc: string[];
  asunto: string;
  cuerpo: string;
  responde_a_thread_id?: string;
  responde_a_message_id?: string;
  /** Sólo para el título del modal. */
  titulo: string;
};

const RE_PREFIJO_RESPUESTA = /^\s*(re|rv)\s*:/i;
const RE_PREFIJO_REENVIO = /^\s*(fwd|fw|rv)\s*:/i;

export function asuntoRespuesta(asunto: string): string {
  return RE_PREFIJO_RESPUESTA.test(asunto) ? asunto : `Re: ${asunto}`;
}

export function asuntoReenvio(asunto: string): string {
  return RE_PREFIJO_REENVIO.test(asunto) ? asunto : `Fwd: ${asunto}`;
}

/**
 * Texto plano del mensaje para citarlo. Preferimos `cuerpo_texto`; si el mail
 * era sólo HTML, lo aplanamos con regex. Alcanza para una cita: el HTML que
 * llega ya está sanitizado y el resultado va como texto, no se re-inyecta.
 */
function cuerpoPlano(m: MensajeCompleto): string {
  if (m.cuerpo_texto && m.cuerpo_texto.trim().length > 0) {
    return m.cuerpo_texto.trim();
  }
  if (!m.cuerpo_html) return "";
  return m.cuerpo_html
    .replace(/<\s*(br|hr)\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|tr|li|h[1-6]|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Bloque citado al pie, estilo `> ` de toda la vida. */
export function citar(m: MensajeCompleto): string {
  const cabecera = `El ${fechaCompleta(m.fecha)}, ${nombreDe(m.de)} <${m.de.email}> escribió:`;
  const cuerpo = cuerpoPlano(m)
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return `\n\n${cabecera}\n${cuerpo}\n`;
}

export function borradorRespuesta(
  m: MensajeCompleto,
  aTodos: boolean,
  miEmail: string | null,
): Borrador {
  // La regla de a quién se responde (Reply-To sobre From, nunca uno mismo,
  // sin repetidos) vive en src/lib/gmail/respuesta.ts, compartida con la tool
  // de correo de LEXIE: el compositor y la IA tienen que elegir lo mismo.
  const { para, cc } = destinatariosRespuesta(m, { aTodos, miEmail });
  return {
    para,
    cc,
    asunto: asuntoRespuesta(m.asunto),
    cuerpo: citar(m),
    responde_a_thread_id: m.thread_id,
    responde_a_message_id: m.message_id_header ?? undefined,
    titulo: aTodos ? "Responder a todos" : "Responder",
  };
}

export function borradorReenvio(m: MensajeCompleto): Borrador {
  const encabezado = [
    "---------- Mensaje reenviado ----------",
    `De: ${nombreDe(m.de)} <${m.de.email}>`,
    `Fecha: ${fechaCompleta(m.fecha)}`,
    `Asunto: ${m.asunto}`,
    `Para: ${m.para.map((d) => d.email).join(", ")}`,
  ].join("\n");
  return {
    para: [],
    cc: [],
    asunto: asuntoReenvio(m.asunto),
    // El reenvío NO arrastra los adjuntos: la API de envío recibe base64 y
    // acá no tenemos los bytes. Se avisa en el cuerpo si el original traía.
    cuerpo: `\n\n${encabezado}\n\n${cuerpoPlano(m)}\n${
      m.adjuntos.length > 0
        ? `\n[El mensaje original tenía ${m.adjuntos.length} adjunto(s) que no se reenvían automáticamente.]\n`
        : ""
    }`,
    titulo: "Reenviar",
  };
}

export function borradorVacio(): Borrador {
  return {
    para: [],
    cc: [],
    asunto: "",
    cuerpo: "",
    titulo: "Mensaje nuevo",
  };
}
