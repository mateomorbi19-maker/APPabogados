import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";

const uuidSchema = z.string().uuid();

// === GET /api/casos/[id] ===
// Detalle de un caso del usuario + eventos ordenados por ocurrido_en ASC.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  const supabase = createServerClient();

  const { data: caso, error: casoErr } = await supabase
    .from("casos")
    .select(
      "id, usuario_id, titulo, caso_descripcion, contexto, rol, ejecucion_origen_id, estrategia_seleccionada_rol, estrategia_seleccionada_idx, estrategia_snapshot, creado_en, actualizado_en",
    )
    .eq("id", id)
    .eq("usuario_id", wl.usuario_id)
    .maybeSingle();

  if (casoErr) {
    console.error("[GET /api/casos/[id]] error:", casoErr);
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

  const { data: eventos, error: evErr } = await supabase
    .from("eventos_caso")
    .select("id, tipo, descripcion, ocurrido_en, estado, creado_en")
    .eq("caso_id", id)
    .order("ocurrido_en", { ascending: true });

  if (evErr) {
    console.error("[GET /api/casos/[id]] error eventos:", evErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando eventos",
        ...(isDev() ? { detail: evErr.message } : {}),
      },
      500,
    );
  }

  return jsonResponse({ ...caso, eventos: eventos ?? [] }, 200);
}

// === DELETE /api/casos/[id] ===
// Cascade borra los eventos del caso (FK ON DELETE CASCADE).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  const supabase = createServerClient();

  // Borramos directamente con doble filtro (id + usuario_id). Si la fila
  // existía pero era de otro usuario o no existía, count = 0 → 404.
  const { error, count } = await supabase
    .from("casos")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("usuario_id", wl.usuario_id);

  if (error) {
    console.error("[DELETE /api/casos/[id]] error:", error);
    return jsonResponse(
      {
        ok: false,
        error: "Error borrando caso",
        ...(isDev() ? { detail: error.message } : {}),
      },
      500,
    );
  }
  if (count === 0) {
    return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
  }

  return jsonResponse({ ok: true }, 200);
}
