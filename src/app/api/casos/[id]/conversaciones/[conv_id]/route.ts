import { NextRequest } from "next/server";
import { z } from "zod";
import { renombrarConversacionInputSchema } from "@/lib/schemas";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";

const uuidSchema = z.string().uuid();

// Helper compartido: valida UUIDs, auth, y que la conversación pertenezca
// al caso del usuario. Devuelve el resultado con shape discriminado.
async function validarPropiedad(
  casoId: string,
  convId: string,
): Promise<
  | { ok: true; usuario_id: string }
  | { ok: false; status: number; error: string; detail?: string }
> {
  if (!uuidSchema.safeParse(casoId).success) {
    return { ok: false, status: 400, error: "id de caso inválido" };
  }
  if (!uuidSchema.safeParse(convId).success) {
    return { ok: false, status: 400, error: "id de conversación inválido" };
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return { ok: false, status: wl.status, error: wl.message };
  }

  const supabase = createServerClient();

  // Single round-trip: join implícito al chequear que la conversación
  // existe + pertenece al caso + el caso pertenece al usuario.
  const { data, error } = await supabase
    .from("conversaciones_caso")
    .select("id, casos!inner(id, usuario_id)")
    .eq("id", convId)
    .eq("caso_id", casoId)
    .maybeSingle();

  if (error) {
    console.error("[validarPropiedad] error:", error);
    return {
      ok: false,
      status: 500,
      error: "Error consultando conversación",
      detail: error.message,
    };
  }
  if (!data) {
    return {
      ok: false,
      status: 404,
      error: "Conversación no encontrada",
    };
  }

  // El join devuelve casos como objeto (singular gracias a !inner) pero
  // supabase-js lo tipa como array por seguridad. Tomamos el primero.
  const casos = (data as unknown as { casos: { usuario_id: string } | { usuario_id: string }[] }).casos;
  const usuarioCaso = Array.isArray(casos) ? casos[0]?.usuario_id : casos?.usuario_id;
  if (usuarioCaso !== wl.usuario_id) {
    return { ok: false, status: 404, error: "Conversación no encontrada" };
  }

  return { ok: true, usuario_id: wl.usuario_id };
}

// === GET /api/casos/[id]/conversaciones/[conv_id] ===
//
// Detalle: la conversación + todos sus mensajes ordenados por creado_en
// ASC (cronológicos, los viejos arriba). El cliente del chat los renderea
// en ese orden y auto-scrollea al final.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; conv_id: string }> },
): Promise<Response> {
  const { id: casoId, conv_id: convId } = await params;
  const v = await validarPropiedad(casoId, convId);
  if (!v.ok) {
    return jsonResponse(
      {
        ok: false,
        error: v.error,
        ...(isDev() && v.detail ? { detail: v.detail } : {}),
      },
      v.status,
    );
  }

  const supabase = createServerClient();

  const [convRes, msgRes] = await Promise.all([
    supabase
      .from("conversaciones_caso")
      .select(
        "id, caso_id, titulo, estado, creada_en, actualizada_en, archivada_en",
      )
      .eq("id", convId)
      .single(),
    supabase
      .from("mensajes_conversacion")
      .select(
        "id, conversacion_id, rol, contenido, adjuntos, respuesta_estructurada, ejecucion_id, creado_en",
      )
      .eq("conversacion_id", convId)
      .order("creado_en", { ascending: true }),
  ]);

  if (convRes.error || !convRes.data) {
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando conversación",
        ...(isDev() && convRes.error ? { detail: convRes.error.message } : {}),
      },
      500,
    );
  }
  if (msgRes.error) {
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando mensajes",
        ...(isDev() ? { detail: msgRes.error.message } : {}),
      },
      500,
    );
  }

  return jsonResponse(
    {
      conversacion: convRes.data,
      mensajes: msgRes.data ?? [],
    },
    200,
  );
}

// === PATCH /api/casos/[id]/conversaciones/[conv_id] ===
//
// Renombrar una conversación. Solo cambia `titulo`. No mueve estado.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; conv_id: string }> },
): Promise<Response> {
  const { id: casoId, conv_id: convId } = await params;
  const v = await validarPropiedad(casoId, convId);
  if (!v.ok) {
    return jsonResponse(
      {
        ok: false,
        error: v.error,
        ...(isDev() && v.detail ? { detail: v.detail } : {}),
      },
      v.status,
    );
  }

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = renombrarConversacionInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("conversaciones_caso")
    .update({ titulo: parsed.data.titulo.trim() })
    .eq("id", convId)
    .select(
      "id, caso_id, titulo, estado, creada_en, actualizada_en, archivada_en",
    )
    .single();

  if (error || !data) {
    console.error("[PATCH conversacion] error:", error);
    return jsonResponse(
      {
        ok: false,
        error: "Error renombrando conversación",
        ...(isDev() && error ? { detail: error.message } : {}),
      },
      500,
    );
  }

  return jsonResponse({ ok: true, conversacion: data }, 200);
}
