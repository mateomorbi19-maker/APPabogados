import { NextRequest } from "next/server";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import {
  gmailDesdeToken,
  gmailErrorMessage,
  SCOPES_ENVIO,
} from "@/lib/gmail/client";
import {
  enviarMensaje,
  resolverPadreParaRespuesta,
} from "@/lib/gmail/mensajes";
import { ERROR_DEMO } from "@/lib/gmail/sesion";
import {
  ADJUNTOS_BASE64_MAX_TOTAL,
  enviarMensajeSchema,
} from "@/lib/gmail/types";
import { getTokenGoogle, SCOPES_GMAIL, tieneScope } from "@/lib/google/token";

export const runtime = "nodejs";
export const maxDuration = 30;

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
  // hacen falta In-Reply-To y References reales, y salen del mensaje QUE SE
  // RESPONDE (`responde_a_message_id` viene del botón Responder de ESE
  // bloque): ver resolverPadreParaRespuesta, compartida con la tool de correo
  // de LEXIE. Si falla, se envía igual (el threadId ya agrupa del lado de
  // Gmail).
  let referencesPrevias: string | null = null;
  let messageIdPrevio: string | null = null;
  if (input.responde_a_thread_id && puedeLeer) {
    try {
      const r = await resolverPadreParaRespuesta(
        gmail,
        input.responde_a_thread_id,
        input.responde_a_message_id,
      );
      if (r) {
        referencesPrevias = r.references.length > 0 ? r.references.join(" ") : null;
        messageIdPrevio = r.padre.message_id_header;
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
