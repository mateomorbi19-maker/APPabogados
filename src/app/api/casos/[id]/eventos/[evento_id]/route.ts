import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";

const uuidSchema = z.string().uuid();

// === DELETE /api/casos/[id]/eventos/[evento_id] ===
// Borra un evento del timeline. Verifica que el caso es del usuario
// y que el evento pertenece a ese caso.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; evento_id: string }> },
): Promise<Response> {
  const { id: casoId, evento_id: eventoId } = await params;
  if (!uuidSchema.safeParse(casoId).success) {
    return jsonResponse({ ok: false, error: "id de caso inválido" }, 400);
  }
  if (!uuidSchema.safeParse(eventoId).success) {
    return jsonResponse({ ok: false, error: "id de evento inválido" }, 400);
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  const supabase = createServerClient();

  // Validamos que el caso es del usuario.
  const { data: caso, error: casoErr } = await supabase
    .from("casos")
    .select("id")
    .eq("id", casoId)
    .eq("usuario_id", wl.usuario_id)
    .maybeSingle();

  if (casoErr) {
    console.error("[DELETE evento] error cargando caso:", casoErr);
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

  // Borramos con doble filtro: id del evento + caso_id (verifica que el
  // evento pertenece al caso del usuario). Si count=0 → 404.
  const { error, count } = await supabase
    .from("eventos_caso")
    .delete({ count: "exact" })
    .eq("id", eventoId)
    .eq("caso_id", casoId);

  if (error) {
    console.error("[DELETE evento] error:", error);
    return jsonResponse(
      {
        ok: false,
        error: "Error borrando evento",
        ...(isDev() ? { detail: error.message } : {}),
      },
      500,
    );
  }
  if (count === 0) {
    return jsonResponse({ ok: false, error: "Evento no encontrado" }, 404);
  }

  return jsonResponse({ ok: true }, 200);
}
