import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";

const uuidSchema = z.string().uuid();

const BUCKET = "eventos-caso-adjuntos";

// TTL corto: el cliente sigue la URL inmediatamente después de recibirla.
// 60 s da margen para casos de red lenta sin permitir que la URL se
// comparta indefinidamente.
const SIGNED_URL_TTL_SECONDS = 60;

// === GET /api/casos/[id]/adjuntos/download-url?path=... ===
//
// Devuelve una signed URL de READ con TTL corto para que el cliente
// descargue un adjunto. El cliente la sigue con un fetch normal o
// asignándola a `<a href>` con `download`.
//
// Validación clave: el `path` que el cliente pide debe empezar con
// `{usuario_id}/{caso_id}/` y el caso debe pertenecer al usuario.
// Esto evita que un abogado pida adjuntos de otro abogado o de otro
// caso suyo (defense-in-depth, además de la auth por endpoint).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: casoId } = await params;
  if (!uuidSchema.safeParse(casoId).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

  const url = new URL(req.url);
  const rawPath = url.searchParams.get("path");
  if (!rawPath || rawPath.length === 0 || rawPath.length > 500) {
    return jsonResponse({ ok: false, error: "path requerido" }, 400);
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  // El path canónico es {usuario_id}/{caso_id}/{ts}_{filename}.
  // Si el path pedido no empieza con eso, rechazamos sin más.
  const expectedPrefix = `${wl.usuario_id}/${casoId}/`;
  if (!rawPath.startsWith(expectedPrefix)) {
    return jsonResponse(
      { ok: false, error: "Adjunto no pertenece al caso" },
      403,
    );
  }

  const supabase = createServerClient();

  // Caso es del usuario (defense-in-depth además del prefix del path).
  const { data: caso, error: casoErr } = await supabase
    .from("casos")
    .select("id")
    .eq("id", casoId)
    .eq("usuario_id", wl.usuario_id)
    .maybeSingle();
  if (casoErr) {
    console.error("[GET download-url] error cargando caso:", casoErr);
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

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(rawPath, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    console.error("[GET download-url] storage error:", error);
    return jsonResponse(
      {
        ok: false,
        error: "Error creando signed URL de descarga",
        ...(isDev() && error ? { detail: error.message } : {}),
      },
      500,
    );
  }

  return jsonResponse(
    { ok: true, signed_url: data.signedUrl, ttl_seconds: SIGNED_URL_TTL_SECONDS },
    200,
  );
}
