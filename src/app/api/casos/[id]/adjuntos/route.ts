import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";

const uuidSchema = z.string().uuid();

const BUCKET = "eventos-caso-adjuntos";

const deleteBodySchema = z.object({
  storage_path: z.string().min(1).max(500),
});

// === DELETE /api/casos/[id]/adjuntos ===
//
// Borra un objeto del bucket eventos-caso-adjuntos. Pensado para que el
// uploader del cliente limpie cuando el abogado clickea "Quitar" sobre
// un archivo que YA subió pero todavía no asoció a un evento (no se
// guardó el form). Evita el huérfano para los archivos que el usuario
// explícitamente decidió descartar.
//
// Validación clave: el `storage_path` debe empezar con
// `{usuario_id}/{caso_id}/`. Sin esto, un body malicioso podría borrar
// adjuntos de otros usuarios o de eventos ya creados de este mismo
// usuario en otro caso.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: casoId } = await params;
  if (!uuidSchema.safeParse(casoId).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = deleteBodySchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }
  const { storage_path } = parsed.data;

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  const expectedPrefix = `${wl.usuario_id}/${casoId}/`;
  if (!storage_path.startsWith(expectedPrefix)) {
    return jsonResponse(
      { ok: false, error: "Adjunto no pertenece al caso" },
      403,
    );
  }

  const supabase = createServerClient();

  // Caso es del usuario.
  const { data: caso, error: casoErr } = await supabase
    .from("casos")
    .select("id")
    .eq("id", casoId)
    .eq("usuario_id", wl.usuario_id)
    .maybeSingle();
  if (casoErr) {
    console.error("[DELETE adjunto] error cargando caso:", casoErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando caso",
        ...(isDev() ? { detail: casoErr.message } : {}),
      },
      500,
    );
  }
  if (!caso) {
    return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
  }

  const { error: storageErr } = await supabase.storage
    .from(BUCKET)
    .remove([storage_path]);

  if (storageErr) {
    console.error("[DELETE adjunto] storage error:", storageErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error borrando archivo",
        ...(isDev() ? { detail: storageErr.message } : {}),
      },
      500,
    );
  }

  return jsonResponse({ ok: true }, 200);
}
