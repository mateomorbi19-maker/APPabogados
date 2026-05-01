import { NextRequest } from "next/server";
import { z } from "zod";
import { crearEventoInputSchema } from "@/lib/schemas";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";

const uuidSchema = z.string().uuid();

// === POST /api/casos/[id]/eventos ===
// Inserta un evento manual al timeline de un caso del usuario.
// `ocurrido_en` opcional (default = now()).
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
  const parsedBody = crearEventoInputSchema.safeParse(bodyJson);
  if (!parsedBody.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsedBody.error.issues },
      400,
    );
  }
  const { descripcion, ocurrido_en, estado } = parsedBody.data;

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  const supabase = createServerClient();

  // Validamos que el caso es del usuario antes de insertar el evento.
  const { data: caso, error: casoErr } = await supabase
    .from("casos")
    .select("id")
    .eq("id", casoId)
    .eq("usuario_id", wl.usuario_id)
    .maybeSingle();

  if (casoErr) {
    console.error("[POST eventos] error cargando caso:", casoErr);
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

  const ocurridoEnIso = ocurrido_en ?? new Date().toISOString();
  const estadoFinal = estado ?? "sucedido";

  const { data: evento, error: evErr } = await supabase
    .from("eventos_caso")
    .insert({
      caso_id: casoId,
      tipo: "manual",
      descripcion,
      ocurrido_en: ocurridoEnIso,
      estado: estadoFinal,
    })
    .select("id, tipo, descripcion, ocurrido_en, estado, creado_en")
    .single();

  if (evErr || !evento) {
    console.error("[POST eventos] error insertando:", evErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error creando evento",
        ...(isDev() && evErr ? { detail: evErr.message } : {}),
      },
      500,
    );
  }

  return jsonResponse({ ok: true, evento }, 201);
}
