import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";
import { COLS_PARTE } from "@/lib/casos/columnas";
import { editarParteInputSchema } from "@/lib/schemas";

const uuidSchema = z.string().uuid();

// Propiedad en dos filtros y no en dos queries: el UPDATE y el DELETE llevan
// SIEMPRE `caso_id` además del `id` de la parte, y antes se verifica que el
// caso sea del usuario. `partes_caso` no tiene `usuario_id` propio y el server
// bypassa RLS con service_role, así que sin esto alcanza con adivinar dos
// UUIDs para tocar la causa de otro abogado.
async function casoPropio(
  casoId: string,
  usuarioId: string,
): Promise<boolean> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("casos")
    .select("id")
    .eq("id", casoId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  return Boolean(data);
}

type Ctx = { params: Promise<{ id: string; parte_id: string }> };

async function validar(ctx: Ctx) {
  const { id, parte_id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return { ok: false as const, status: 400, error: "id inválido" };
  }
  if (!uuidSchema.safeParse(parte_id).success) {
    return { ok: false as const, status: 400, error: "parte_id inválido" };
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return { ok: false as const, status: wl.status, error: wl.message };
  }
  if (!(await casoPropio(id, wl.usuario_id))) {
    return { ok: false as const, status: 404, error: "Caso no encontrado" };
  }
  return { ok: true as const, casoId: id, parteId: parte_id };
}

// === PATCH /api/casos/[id]/partes/[parte_id] ===
export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const v = await validar(ctx);
  if (!v.ok) return jsonResponse({ ok: false, error: v.error }, v.status);

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = editarParteInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }

  // Lista blanca, igual que en el PATCH del caso: nunca se derrama
  // `parsed.data`, o un campo de más en el schema pasaría a poder mover
  // `caso_id`.
  const d = parsed.data;
  const cols: Record<string, unknown> = {};
  if (d.nombre !== undefined) cols.nombre = d.nombre.trim();
  if (d.rol !== undefined) cols.rol = d.rol;
  if (d.es_cliente !== undefined) cols.es_cliente = d.es_cliente;
  if (d.situacion_libertad !== undefined)
    cols.situacion_libertad = d.situacion_libertad;
  if (d.documento !== undefined) cols.documento = d.documento;

  if (Object.keys(cols).length === 0) {
    return jsonResponse({ ok: false, error: "No hay nada para actualizar" }, 400);
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("partes_caso")
    .update(cols)
    .eq("id", v.parteId)
    .eq("caso_id", v.casoId)
    .select(COLS_PARTE)
    .maybeSingle();

  if (error) {
    console.error("[PATCH parte] error:", error);
    return jsonResponse(
      {
        ok: false,
        error: "Error actualizando la parte",
        ...(isDev() ? { detail: error.message } : {}),
      },
      500,
    );
  }
  if (!data) {
    return jsonResponse({ ok: false, error: "Parte no encontrada" }, 404);
  }

  return jsonResponse({ ok: true, parte: data }, 200);
}

// === DELETE /api/casos/[id]/partes/[parte_id] ===
export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const v = await validar(ctx);
  if (!v.ok) return jsonResponse({ ok: false, error: v.error }, v.status);

  const supabase = createServerClient();
  const { error, count } = await supabase
    .from("partes_caso")
    .delete({ count: "exact" })
    .eq("id", v.parteId)
    .eq("caso_id", v.casoId);

  if (error) {
    console.error("[DELETE parte] error:", error);
    return jsonResponse(
      {
        ok: false,
        error: "Error borrando la parte",
        ...(isDev() ? { detail: error.message } : {}),
      },
      500,
    );
  }
  if (count === 0) {
    return jsonResponse({ ok: false, error: "Parte no encontrada" }, 404);
  }

  return jsonResponse({ ok: true }, 200);
}
