import { NextRequest } from "next/server";
import { z } from "zod";
import { adjuntoUploadUrlInputSchema } from "@/lib/schemas";
import { validarAdjunto, filenameSeguro } from "@/lib/casos/adjuntos";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";

const uuidSchema = z.string().uuid();

const BUCKET = "eventos-caso-adjuntos";

// === POST /api/casos/[id]/eventos/upload-url ===
//
// Genera una signed URL para que el cliente suba un archivo DIRECTO al
// bucket sin pasar bytes por nuestro server. Patrón: el cliente hace
// PUT al `signed_url` con el body siendo el File/Blob, y luego incluye
// el `storage_path` en el body del POST /eventos.
//
// El path canónico que devolvemos: {usuario_id}/{caso_id}/{ts}_{filename_seguro}
// El POST de evento valida que cualquier storage_path que reciba empiece
// con `{usuario_id}/{caso_id}/` para que un usuario no pueda asociar a
// un evento un adjunto subido bajo otro caso suyo.
export async function POST(
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
  const parsedBody = adjuntoUploadUrlInputSchema.safeParse(bodyJson);
  if (!parsedBody.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsedBody.error.issues },
      400,
    );
  }
  const { filename, mime_type, size_bytes } = parsedBody.data;

  // Validación adicional con la lógica compartida (tamaño-por-mime).
  // Zod ya filtró mime types fuera del allowlist; acá chequeamos el cap.
  const v = validarAdjunto({ filename, mime_type, size_bytes });
  if (!v.ok) {
    return jsonResponse({ ok: false, error: v.error }, 400);
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  const supabase = createServerClient();

  // Caso pertenece al usuario.
  const { data: caso, error: casoErr } = await supabase
    .from("casos")
    .select("id")
    .eq("id", casoId)
    .eq("usuario_id", wl.usuario_id)
    .maybeSingle();
  if (casoErr) {
    console.error("[POST upload-url] error cargando caso:", casoErr);
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

  const ts = Date.now();
  const safe = filenameSeguro(filename);
  const storagePath = `${wl.usuario_id}/${casoId}/${ts}_${safe}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    console.error("[POST upload-url] storage error:", error);
    return jsonResponse(
      {
        ok: false,
        error: "Error creando signed URL",
        ...(isDev() && error ? { detail: error.message } : {}),
      },
      500,
    );
  }

  return jsonResponse(
    {
      ok: true,
      signed_url: data.signedUrl,
      storage_path: data.path,
      // El token por separado por si el cliente prefiere usar
      // supabase-js .uploadToSignedUrl en vez de fetch PUT directo.
      token: data.token,
    },
    200,
  );
}
