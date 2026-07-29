import "server-only";
import type { gmail_v1 } from "@googleapis/gmail";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { getGmailClient } from "./client";

// Preludio común de todas las rutas de /api/bandeja: whitelist + cliente de
// Gmail, con la degradación a modo demo resuelta en un solo lugar.
//
// El contrato con las rutas es: `error` se responde tal cual, `demo` sirve
// datos de ejemplo en las lecturas y 409 en las escrituras, `conectado` opera
// contra Gmail de verdad.

export type SesionBandeja =
  | { estado: "error"; status: number; error: string }
  | { estado: "demo"; clerkUserId: string }
  | { estado: "conectado"; clerkUserId: string; gmail: gmail_v1.Gmail };

export async function abrirSesionBandeja(): Promise<SesionBandeja> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return { estado: "error", status: wl.status, error: wl.message };
  }

  // getGmailClient devuelve null tanto si no hay Google vinculado como si
  // falta el scope: para la bandeja ambos casos son lo mismo (modo demo).
  const gmail = await getGmailClient(wl.clerk_user_id);
  if (!gmail) return { estado: "demo", clerkUserId: wl.clerk_user_id };

  return { estado: "conectado", clerkUserId: wl.clerk_user_id, gmail };
}

/** Mensaje único para las escrituras bloqueadas por falta de conexión (409). */
export const ERROR_DEMO =
  "Gmail no está conectado. Esta sección está mostrando datos de ejemplo: no se puede escribir hasta habilitar los permisos de Google.";
