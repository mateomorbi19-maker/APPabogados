import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonResponse, isDev } from "@/lib/http";
import { gmailErrorMessage, gmailErrorStatus } from "@/lib/gmail/client";
import { esIdDemo } from "@/lib/gmail/demo";
import { moverAPapelera, restaurarDePapelera } from "@/lib/gmail/mensajes";
import { abrirSesionBandeja, ERROR_DEMO } from "@/lib/gmail/sesion";
import { gmailIdSchema } from "@/lib/gmail/types";

export const runtime = "nodejs";
export const maxDuration = 30;

// === POST /api/bandeja/hilos/[id]/papelera ===
// === DELETE /api/bandeja/hilos/[id]/papelera ===
//
// DECISIÓN EXPLÍCITA: ambos verbos mandan el hilo a la PAPELERA de Gmail
// (threads.trash), que es reversible. La app no expone `threads.delete` en
// ningún endpoint: el borrado permanente es irreversible y en un estudio
// jurídico la correspondencia puede ser prueba. El DELETE existe sólo porque
// es el verbo que un cliente REST espera para "borrar", pero se comporta como
// el POST.
//
// Para restaurar: POST con body `{ "restaurar": true }` (threads.untrash).

const bodySchema = z.object({ restaurar: z.boolean().optional() });

async function aPapelera(
  id: string,
  restaurar: boolean,
): Promise<Response> {
  if (!gmailIdSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "Id inválido" }, 400);
  }

  const sesion = await abrirSesionBandeja();
  if (sesion.estado === "error") {
    return jsonResponse({ ok: false, error: sesion.error }, sesion.status);
  }
  if (sesion.estado === "demo") {
    return jsonResponse({ ok: false, error: ERROR_DEMO }, 409);
  }
  if (esIdDemo(id)) {
    return jsonResponse({ ok: false, error: "Hilo no encontrado" }, 404);
  }

  try {
    if (restaurar) await restaurarDePapelera(sesion.gmail, id);
    else await moverAPapelera(sesion.gmail, id);
    return jsonResponse({ ok: true, restaurado: restaurar }, 200);
  } catch (e) {
    const error = gmailErrorMessage(e);
    const status = gmailErrorStatus(e);
    if (status === 404) {
      return jsonResponse({ ok: false, error: "Hilo no encontrado" }, 404);
    }
    console.error("[POST /api/bandeja/hilos/[id]/papelera] error:", error);
    return jsonResponse(
      {
        ok: false,
        error: restaurar
          ? "No se pudo restaurar el hilo"
          : "No se pudo mover el hilo a la papelera",
        ...(isDev() ? { detail: error } : {}),
      },
      502,
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  // El body es opcional: sin body, la acción es mandar a papelera.
  let restaurar = false;
  try {
    const crudo: unknown = await req.json();
    const parsed = bodySchema.safeParse(crudo);
    if (!parsed.success) {
      return jsonResponse(
        { ok: false, error: "Body inválido", issues: parsed.error.issues },
        400,
      );
    }
    restaurar = parsed.data.restaurar === true;
  } catch {
    restaurar = false;
  }

  return aPapelera(id, restaurar);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return aPapelera(id, false);
}
