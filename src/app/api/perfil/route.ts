import { NextRequest } from "next/server";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import { perfilProfesionalInputSchema } from "@/lib/schemas";
import {
  actualizarPerfilProfesional,
  getPerfilProfesional,
} from "@/lib/escritos/queries";

// El perfil PROFESIONAL del abogado: cómo firma, matrícula y domicilios. Es lo
// que va en el encabezado de todo escrito y no cambia entre causas.
//
// Sólo el propio: `usuario_id` sale de la sesión, y la ruta no acepta ningún
// id. `nombre` y `email` no se tocan desde acá: son el identificador lógico
// del sistema y los administra el lazy-sync de Clerk (whitelist.ts).

// === GET /api/perfil ===
export async function GET(): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  try {
    const perfil = await getPerfilProfesional(wl.usuario_id);
    return jsonResponse({ ok: true, perfil, nombre: wl.nombre }, 200);
  } catch (e) {
    console.error("[GET perfil] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error leyendo el perfil",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}

// === PATCH /api/perfil ===
export async function PATCH(req: NextRequest): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = perfilProfesionalInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return jsonResponse({ ok: false, error: "No hay nada para actualizar" }, 400);
  }

  try {
    const perfil = await actualizarPerfilProfesional(wl.usuario_id, parsed.data);
    return jsonResponse({ ok: true, perfil }, 200);
  } catch (e) {
    console.error("[PATCH perfil] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error guardando el perfil",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}
