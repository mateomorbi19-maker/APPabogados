import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import { editarEscritoInputSchema } from "@/lib/schemas";
import {
  borrarEscrito,
  editarEscrito,
  obtenerEscrito,
} from "@/lib/escritos/queries";

const uuidSchema = z.string().uuid();

type Ctx = { params: Promise<{ id: string; escrito_id: string }> };

// Propiedad: `escritos_generados` tiene `usuario_id` propio, y las tres
// operaciones lo llevan como predicado junto con `caso_id` y `id`. Con
// service_role (que bypassa RLS) ese predicado es el único control real.
async function validar(ctx: Ctx) {
  const { id, escrito_id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return { ok: false as const, status: 400, error: "id inválido" };
  }
  if (!uuidSchema.safeParse(escrito_id).success) {
    return { ok: false as const, status: 400, error: "escrito_id inválido" };
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return { ok: false as const, status: wl.status, error: wl.message };
  }
  return { ok: true as const, casoId: id, escritoId: escrito_id, usuarioId: wl.usuario_id };
}

// === GET /api/casos/[id]/escritos/[escrito_id] — el escrito con su texto ===
export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const v = await validar(ctx);
  if (!v.ok) return jsonResponse({ ok: false, error: v.error }, v.status);

  try {
    const escrito = await obtenerEscrito(v.escritoId, v.casoId, v.usuarioId);
    if (!escrito) {
      return jsonResponse({ ok: false, error: "Escrito no encontrado" }, 404);
    }
    return jsonResponse({ ok: true, escrito }, 200);
  } catch (e) {
    console.error("[GET escrito] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error leyendo el escrito",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}

// === PATCH — el abogado corrige el texto o el título ===
// El estado NO se cambia por acá: presentar tiene su propia ruta porque
// además sube el PDF y registra el evento en el timeline.
export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const v = await validar(ctx);
  if (!v.ok) return jsonResponse({ ok: false, error: v.error }, v.status);

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = editarEscritoInputSchema.safeParse(bodyJson);
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
    const escrito = await editarEscrito(
      v.escritoId,
      v.casoId,
      v.usuarioId,
      parsed.data,
    );
    if (!escrito) {
      return jsonResponse({ ok: false, error: "Escrito no encontrado" }, 404);
    }
    return jsonResponse({ ok: true, escrito }, 200);
  } catch (e) {
    console.error("[PATCH escrito] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error guardando el escrito",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}

// === DELETE ===
export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const v = await validar(ctx);
  if (!v.ok) return jsonResponse({ ok: false, error: v.error }, v.status);

  try {
    const ok = await borrarEscrito(v.escritoId, v.casoId, v.usuarioId);
    if (!ok) {
      return jsonResponse({ ok: false, error: "Escrito no encontrado" }, 404);
    }
    return jsonResponse({ ok: true }, 200);
  } catch (e) {
    console.error("[DELETE escrito] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error borrando el escrito",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}
