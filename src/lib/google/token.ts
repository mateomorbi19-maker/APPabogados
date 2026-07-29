import "server-only";
import { clerkClient } from "@clerk/nextjs/server";

/**
 * Acceso genérico al access token de Google OAuth del usuario, gestionado por
 * Clerk. Es la generalización de `getGoogleAccessToken` de
 * [src/lib/agenda/google-calendar.ts](../agenda/google-calendar.ts), que quedó
 * como está para no tocar la agenda: este módulo es el que usan las features
 * nuevas (Bandeja de entrada / Gmail y Repositorio / Drive).
 *
 * Método verificado contra @clerk/backend@3.3.0:
 * - `clerkClient` es factory async en @clerk/nextjs v7 → `await clerkClient()`.
 * - provider 'google' (bare). El prefijo 'oauth_google' está @deprecated.
 * - retorno { data: OauthAccessToken[] } → leer data[0].token.
 * - `scopes` es string[] | undefined → guard.
 *
 * Clerk auto-refresca el token, por eso se pide fresco en cada request (no se
 * cachea). Requiere credenciales OAuth custom de Google en Clerk con los scopes
 * correspondientes concedidos (las shared de dev no alcanzan).
 */

export const SCOPE_GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";
export const SCOPE_GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
export const SCOPE_DRIVE_READONLY =
  "https://www.googleapis.com/auth/drive.readonly";

/** Prefijos aceptados por feature. Basta con que UNO matchee por prefijo. */
export const SCOPES_GMAIL = [
  SCOPE_GMAIL_MODIFY,
  "https://mail.google.com/",
] as const;

export const SCOPES_DRIVE = [
  SCOPE_DRIVE_READONLY,
  "https://www.googleapis.com/auth/drive",
] as const;

export type TokenGoogle = {
  token: string;
  scopes: string[];
};

/**
 * Devuelve el token crudo + los scopes concedidos, sin filtrar. `null` si el
 * usuario no tiene Google vinculado o si la Backend API de Clerk falla.
 */
export async function getTokenGoogle(
  clerkUserId: string,
): Promise<TokenGoogle | null> {
  try {
    const client = await clerkClient();
    const response = await client.users.getUserOauthAccessToken(
      clerkUserId,
      "google",
    );
    const entry = response.data[0];
    if (!entry?.token) return null;
    return { token: entry.token, scopes: entry.scopes ?? [] };
  } catch {
    // Usuario sin Google vinculado, error de la Backend API, red, etc.
    return null;
  }
}

/** ¿Alguno de los scopes concedidos empieza con alguno de los requeridos? */
export function tieneScope(
  concedidos: string[],
  requeridos: readonly string[],
): boolean {
  return concedidos.some((s) => requeridos.some((r) => s.startsWith(r)));
}

/**
 * Token válido para un conjunto de scopes, o `null` si falta el permiso.
 * El caller distingue "sin Google" de "sin scope" con `getTokenGoogle`.
 */
export async function getTokenConScope(
  clerkUserId: string,
  requeridos: readonly string[],
): Promise<string | null> {
  const t = await getTokenGoogle(clerkUserId);
  if (!t) return null;
  if (!tieneScope(t.scopes, requeridos)) return null;
  return t.token;
}

export type EstadoConexionGoogle = {
  /** Hay cuenta de Google vinculada en Clerk. */
  vinculado: boolean;
  /** Además, el scope requerido está concedido. */
  habilitado: boolean;
};

/** Estado para pintar el banner de conexión en la UI. */
export async function getEstadoConexion(
  clerkUserId: string,
  requeridos: readonly string[],
): Promise<EstadoConexionGoogle> {
  const t = await getTokenGoogle(clerkUserId);
  if (!t) return { vinculado: false, habilitado: false };
  return { vinculado: true, habilitado: tieneScope(t.scopes, requeridos) };
}
