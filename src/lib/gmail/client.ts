import "server-only";
import { auth, gmail as makeGmail, type gmail_v1 } from "@googleapis/gmail";
import {
  getTokenGoogle,
  SCOPES_GMAIL,
  SCOPE_GMAIL_SEND,
  tieneScope,
} from "@/lib/google/token";

// Paquete individual `@googleapis/gmail` a propósito: el meta-paquete
// `googleapis` arrastra los tipos de TODAS las APIs de Google y revienta el
// heap del type-check de `next build` (mismo motivo documentado en
// src/lib/agenda/google-calendar.ts).

/**
 * Scopes que habilitan ENVIAR. `gmail.modify` ya permite messages.send
 * (cubre todo read/write menos el borrado permanente), así que un usuario con
 * modify no necesita además gmail.send. Aceptamos cualquiera de los tres.
 */
export const SCOPES_ENVIO = [SCOPE_GMAIL_SEND, ...SCOPES_GMAIL] as const;

/** Arma el cliente a partir de un access token ya validado. */
export function gmailDesdeToken(accessToken: string): gmail_v1.Gmail {
  const oauth2Client = new auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return makeGmail({ version: "v1", auth: oauth2Client });
}

/**
 * Cliente de Gmail para leer/modificar. `null` si el usuario no tiene Google
 * vinculado en Clerk o si el scope gmail.modify no está concedido — el caller
 * degrada a modo demo, nunca tira 500.
 */
export async function getGmailClient(
  clerkUserId: string,
): Promise<gmail_v1.Gmail | null> {
  const t = await getTokenGoogle(clerkUserId);
  if (!t || !tieneScope(t.scopes, SCOPES_GMAIL)) return null;
  return gmailDesdeToken(t.token);
}

/** Cliente habilitado para enviar. `null` si falta el scope de envío. */
export async function getGmailClientEnvio(
  clerkUserId: string,
): Promise<gmail_v1.Gmail | null> {
  const t = await getTokenGoogle(clerkUserId);
  if (!t || !tieneScope(t.scopes, SCOPES_ENVIO)) return null;
  return gmailDesdeToken(t.token);
}

/**
 * Mensaje útil de un error de la Google API. El GaxiosError trae el detalle
 * real en response.data.error.message; el `.message` a secas suele ser el
 * genérico "Request failed with status code 403".
 */
export function gmailErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    const resp = (
      e as { response?: { data?: { error?: { message?: unknown } } } }
    ).response;
    const apiMsg = resp?.data?.error?.message;
    if (typeof apiMsg === "string" && apiMsg.length > 0) return apiMsg;
    return e.message;
  }
  return String(e);
}

/** Status HTTP que devolvió Google, si el error lo trae. */
export function gmailErrorStatus(e: unknown): number | null {
  const s = (e as { response?: { status?: unknown }; status?: unknown } | null)
    ?.response?.status;
  if (typeof s === "number") return s;
  const directo = (e as { status?: unknown } | null)?.status;
  return typeof directo === "number" ? directo : null;
}
