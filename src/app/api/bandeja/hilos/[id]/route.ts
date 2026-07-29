import { NextRequest } from "next/server";
import { jsonResponse, isDev } from "@/lib/http";
import { gmailErrorMessage, gmailErrorStatus } from "@/lib/gmail/client";
import { esIdDemo, HILOS_COMPLETOS_DEMO } from "@/lib/gmail/demo";
import { modificarMensaje, obtenerHilo } from "@/lib/gmail/mensajes";
import { abrirSesionBandeja, ERROR_DEMO } from "@/lib/gmail/sesion";
import { gmailIdSchema, modificarMensajeSchema } from "@/lib/gmail/types";

export const runtime = "nodejs";
export const maxDuration = 30;

// === GET /api/bandeja/hilos/[id] ===
//
// Detalle del hilo con todos sus mensajes. El HTML de cada mensaje ya viene
// sanitizado por `sanitizarHtml` (ver src/lib/gmail/parse.ts); igual conviene
// renderizarlo en un iframe sandbox como defensa en profundidad.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!gmailIdSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "Id inválido" }, 400);
  }

  const sesion = await abrirSesionBandeja();
  if (sesion.estado === "error") {
    return jsonResponse({ ok: false, error: sesion.error }, sesion.status);
  }

  // Un id demo se resuelve contra las semillas SIEMPRE, no sólo con la sesión
  // en modo demo: cuando la lectura se degrada (401/403 de Google con el scope
  // todavía concedido en Clerk) el listado sirve hilos demo aunque la sesión
  // figure como "conectado", y al abrir uno tiene que aparecer el mismo hilo.
  if (sesion.estado === "demo" || esIdDemo(id)) {
    const hilo = HILOS_COMPLETOS_DEMO.get(id);
    if (!hilo) {
      return jsonResponse({ ok: false, error: "Hilo no encontrado" }, 404);
    }
    return jsonResponse({ hilo, conectado: false, demo: true }, 200);
  }

  try {
    const hilo = await obtenerHilo(sesion.gmail, id);
    if (!hilo) {
      return jsonResponse({ ok: false, error: "Hilo no encontrado" }, 404);
    }
    return jsonResponse({ hilo, conectado: true, demo: false }, 200);
  } catch (e) {
    const error = gmailErrorMessage(e);
    const status = gmailErrorStatus(e);
    if (status === 404) {
      return jsonResponse({ ok: false, error: "Hilo no encontrado" }, 404);
    }
    console.error("[GET /api/bandeja/hilos/[id]] error:", error);
    // Google rechazó el token aunque Clerk siga reportando el scope: el
    // problema es el permiso, no el upstream, y el arreglo es reconectar.
    if (status === 401 || status === 403) {
      return jsonResponse(
        {
          ok: false,
          error:
            "Google rechazó el acceso a tu correo. Volvé a iniciar sesión con Google aceptando el permiso de Gmail.",
          ...(isDev() ? { detail: error } : {}),
        },
        403,
      );
    }
    return jsonResponse(
      {
        ok: false,
        error: "No se pudo abrir el hilo",
        ...(isDev() ? { detail: error } : {}),
      },
      502,
    );
  }
}

// === PATCH /api/bandeja/hilos/[id] ===
//
// Marca leído/no leído, destaca y archiva. Aplica sobre TODO el hilo, que es
// la unidad que muestra la UI.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!gmailIdSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "Id inválido" }, 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = modificarMensajeSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }

  const sesion = await abrirSesionBandeja();
  if (sesion.estado === "error") {
    return jsonResponse({ ok: false, error: sesion.error }, sesion.status);
  }
  // Modo demo: NUNCA se simula una escritura.
  if (sesion.estado === "demo") {
    return jsonResponse({ ok: false, error: ERROR_DEMO }, 409);
  }
  if (esIdDemo(id)) {
    return jsonResponse({ ok: false, error: "Hilo no encontrado" }, 404);
  }

  try {
    await modificarMensaje(sesion.gmail, id, parsed.data);
    return jsonResponse({ ok: true }, 200);
  } catch (e) {
    const error = gmailErrorMessage(e);
    const status = gmailErrorStatus(e);
    if (status === 404) {
      return jsonResponse({ ok: false, error: "Hilo no encontrado" }, 404);
    }
    console.error("[PATCH /api/bandeja/hilos/[id]] error:", error);
    return jsonResponse(
      {
        ok: false,
        error: "No se pudo actualizar el hilo",
        ...(isDev() ? { detail: error } : {}),
      },
      502,
    );
  }
}
