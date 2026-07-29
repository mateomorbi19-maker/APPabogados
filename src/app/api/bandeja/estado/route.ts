import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { isDev, jsonResponse } from "@/lib/http";
import { gmailDesdeToken, gmailErrorMessage, SCOPES_ENVIO } from "@/lib/gmail/client";
import { getTokenGoogle, SCOPES_GMAIL, tieneScope } from "@/lib/google/token";

export const runtime = "nodejs";
export const maxDuration = 30;

// === GET /api/bandeja/estado ===
//
// Estado de la conexión con Gmail. NUNCA tira 500 por falta de permisos: si el
// scope no está concedido devuelve conectado:false y la UI muestra el banner
// de "conectá tu Gmail" con los datos demo abajo.
export async function GET(): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  // Un solo viaje a Clerk para las tres preguntas (vinculado / lee / envía).
  const t = await getTokenGoogle(wl.clerk_user_id);
  const vinculado = t !== null;
  const habilitado = t !== null && tieneScope(t.scopes, SCOPES_GMAIL);
  const puede_enviar = t !== null && tieneScope(t.scopes, SCOPES_ENVIO);

  if (!t || !habilitado) {
    return jsonResponse(
      {
        conectado: false,
        vinculado,
        email: null,
        puede_enviar: false,
        demo: true,
      },
      200,
    );
  }

  // El scope puede estar concedido y el token igual estar revocado del lado de
  // Google: recién getProfile confirma que la conexión sirve.
  let email: string | null = null;
  let error: string | null = null;
  try {
    const gmail = gmailDesdeToken(t.token);
    const perfil = await gmail.users.getProfile({ userId: "me" });
    email = perfil.data.emailAddress ?? null;
  } catch (e) {
    error = gmailErrorMessage(e);
    console.error("[GET /api/bandeja/estado] getProfile falló:", error);
  }

  const conectado = email !== null;
  return jsonResponse(
    {
      conectado,
      vinculado,
      email,
      puede_enviar: conectado && puede_enviar,
      demo: !conectado,
      // El mensaje crudo de la Google API puede traer el número de proyecto de
      // GCP, el client_id o detalles de cuota: sólo sale en dev, igual que en
      // el resto de las rutas. En producción queda el console.error de arriba.
      ...(isDev() && error ? { detail: error } : {}),
    },
    200,
  );
}
