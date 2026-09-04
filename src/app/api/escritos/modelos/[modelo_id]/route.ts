import { NextRequest } from "next/server";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import { editarModeloEscritoInputSchema } from "@/lib/schemas";
import {
  archivarModelo,
  editarModelo,
  obtenerModelo,
} from "@/lib/escritos/queries";
import { esModeloDelEstudio, esUuid } from "@/lib/escritos/types";

type Ctx = { params: Promise<{ modelo_id: string }> };

// El id es un slug (catálogo del estudio) o un UUID (modelo propio). Cualquier
// otra cosa es 400 antes de tocar la base.
function idValido(id: string): boolean {
  return esModeloDelEstudio(id) || esUuid(id);
}

// === GET /api/escritos/modelos/[modelo_id] — el modelo completo, con cuerpo ===
export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const { modelo_id } = await ctx.params;
  if (!idValido(modelo_id)) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  try {
    const modelo = await obtenerModelo(modelo_id, wl.usuario_id);
    if (!modelo) {
      return jsonResponse({ ok: false, error: "Modelo no encontrado" }, 404);
    }
    return jsonResponse({ ok: true, modelo }, 200);
  } catch (e) {
    console.error("[GET escritos/modelos/[id]] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error leyendo el modelo",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}

// === PATCH — sólo modelos propios ===
// Un modelo del estudio no se edita desde la app: se corrige el .md y se
// regenera el catálogo. Si el abogado quiere una variante, la carga como
// modelo propio (el diálogo ofrece "Duplicar como propio").
export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { modelo_id } = await ctx.params;
  if (!idValido(modelo_id)) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }
  if (esModeloDelEstudio(modelo_id)) {
    return jsonResponse(
      {
        ok: false,
        error:
          "Los modelos del estudio no se editan desde la app. Duplicalo como modelo propio para adaptarlo.",
      },
      409,
    );
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = editarModeloEscritoInputSchema.safeParse(bodyJson);
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
    const modelo = await editarModelo(modelo_id, wl.usuario_id, parsed.data);
    if (!modelo) {
      return jsonResponse({ ok: false, error: "Modelo no encontrado" }, 404);
    }
    return jsonResponse({ ok: true, modelo }, 200);
  } catch (e) {
    console.error("[PATCH escritos/modelos/[id]] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error actualizando el modelo",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}

// === DELETE — archiva (no borra) un modelo propio ===
export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const { modelo_id } = await ctx.params;
  if (!idValido(modelo_id)) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }
  if (esModeloDelEstudio(modelo_id)) {
    return jsonResponse(
      { ok: false, error: "Los modelos del estudio no se pueden borrar." },
      409,
    );
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  try {
    const ok = await archivarModelo(modelo_id, wl.usuario_id);
    if (!ok) {
      return jsonResponse({ ok: false, error: "Modelo no encontrado" }, 404);
    }
    return jsonResponse({ ok: true }, 200);
  } catch (e) {
    console.error("[DELETE escritos/modelos/[id]] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error archivando el modelo",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}
