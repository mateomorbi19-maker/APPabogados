import { NextRequest } from "next/server";
import type { gmail_v1 } from "@googleapis/gmail";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import {
  gmailDesdeToken,
  gmailErrorMessage,
  SCOPES_ENVIO,
} from "@/lib/gmail/client";
import { getHeader } from "@/lib/gmail/parse";
import { enviarMensaje } from "@/lib/gmail/mensajes";
import { ERROR_DEMO } from "@/lib/gmail/sesion";
import {
  ADJUNTOS_BASE64_MAX_TOTAL,
  enviarMensajeSchema,
} from "@/lib/gmail/types";
import { getTokenGoogle, SCOPES_GMAIL, tieneScope } from "@/lib/google/token";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Compara Message-ID ignorando los angulares y el espacio alrededor. */
function mismoMessageId(a: string | null, b: string): boolean {
  if (!a) return false;
  const pelar = (s: string) => s.trim().replace(/^<|>$/g, "").trim();
  return pelar(a) === pelar(b);
}

function buscarPorMessageId(
  mensajes: gmail_v1.Schema$Message[],
  messageId: string | undefined,
): gmail_v1.Schema$Message | null {
  if (!messageId) return null;
  for (const m of mensajes) {
    if (mismoMessageId(getHeader(m.payload?.headers, "Message-ID"), messageId)) {
      return m;
    }
  }
  return null;
}

// === POST /api/bandeja/mensajes ===
//
// Envía un mensaje nuevo o una respuesta dentro de un hilo. Es la única ruta
// que exige el scope de envío; el resto de la bandeja funciona con
// gmail.modify. Ver el detalle del MIME en src/lib/gmail/parse.ts.
export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = enviarMensajeSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }
  const input = parsed.data;

  const totalAdjuntos = (input.adjuntos ?? []).reduce(
    (acc, a) => acc + a.contenido_base64.length,
    0,
  );
  if (totalAdjuntos > ADJUNTOS_BASE64_MAX_TOTAL) {
    return jsonResponse(
      { ok: false, error: "Los adjuntos superan el tamaño máximo permitido" },
      413,
    );
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  // Un solo viaje a Clerk: distinguimos "no hay Gmail" (409, modo demo) de
  // "hay Gmail pero sin permiso de envío" (403), que son dos arreglos distintos
  // para el usuario.
  const t = await getTokenGoogle(wl.clerk_user_id);
  const puedeLeer = t !== null && tieneScope(t.scopes, SCOPES_GMAIL);
  const puedeEnviar = t !== null && tieneScope(t.scopes, SCOPES_ENVIO);

  if (!t || (!puedeLeer && !puedeEnviar)) {
    return jsonResponse({ ok: false, error: ERROR_DEMO }, 409);
  }
  if (!puedeEnviar) {
    return jsonResponse(
      {
        ok: false,
        error:
          "Falta el permiso de Google para enviar correos (gmail.send). Volvé a conectar tu cuenta aceptando ese permiso.",
      },
      403,
    );
  }

  const gmail = gmailDesdeToken(t.token);

  // Para que el cliente del otro lado agrupe la respuesta en su propio hilo
  // hacen falta In-Reply-To y References reales. RFC 5322 §3.6.4: References
  // se arma con las del mensaje QUE SE RESPONDE más su Message-ID — no con las
  // del último del hilo. El abogado puede responder a un mensaje del medio
  // (`responde_a_message_id` sale del botón Responder de ESE bloque), y
  // mezclar las dos fuentes deja ids duplicados y descendientes listados como
  // ancestros, con lo que el árbol del destinatario cuelga la respuesta del
  // mensaje equivocado. Si falla, se envía igual (el threadId ya agrupa del
  // lado de Gmail).
  let referencesPrevias: string | null = null;
  let messageIdPrevio: string | null = null;
  if (input.responde_a_thread_id && puedeLeer) {
    try {
      const hilo = await gmail.users.threads.get({
        userId: "me",
        id: input.responde_a_thread_id,
        format: "metadata",
        metadataHeaders: ["Message-ID", "References"],
      });
      const mensajes = hilo.data.messages ?? [];
      const padre =
        buscarPorMessageId(mensajes, input.responde_a_message_id) ??
        mensajes[mensajes.length - 1];
      if (padre) {
        referencesPrevias = getHeader(padre.payload?.headers, "References");
        messageIdPrevio = getHeader(padre.payload?.headers, "Message-ID");
      }
    } catch (e) {
      console.error(
        "[POST /api/bandeja/mensajes] no se pudo leer el hilo para el threading:",
        gmailErrorMessage(e),
      );
    }
  }

  try {
    const r = await enviarMensaje(
      gmail,
      {
        ...input,
        responde_a_message_id: input.responde_a_message_id ?? messageIdPrevio ?? undefined,
      },
      referencesPrevias,
    );
    return jsonResponse({ ok: true, id: r.id, thread_id: r.thread_id }, 201);
  } catch (e) {
    const error = gmailErrorMessage(e);
    console.error("[POST /api/bandeja/mensajes] error:", error);
    return jsonResponse(
      {
        ok: false,
        error: "Gmail rechazó el envío",
        ...(isDev() ? { detail: error } : {}),
      },
      502,
    );
  }
}
