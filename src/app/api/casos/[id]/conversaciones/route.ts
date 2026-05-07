import { NextRequest } from "next/server";
import { z } from "zod";
import { crearConversacionInputSchema } from "@/lib/schemas";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";
import type { Conversacion } from "@/lib/types";

const uuidSchema = z.string().uuid();

const FECHA_AR = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires",
});
const HORA_AR = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Buenos_Aires",
});

// === POST /api/casos/[id]/conversaciones ===
//
// Crea una conversación NUEVA del caso. Si ya hay una activa, la
// archiva primero (UPDATE estado→'archivada' + archivada_en) y
// después inserta la nueva con estado='activa'. El partial unique
// index sobre (caso_id) WHERE estado='activa' garantiza ≤1 activa.
//
// Naming auto-generado si no viene `titulo` en el body:
//   "Conversación del DD/MM/YYYY"
// Si ya existe una con ese título base para este caso (segundo chat
// del mismo día), agrega la hora: "Conversación del DD/MM/YYYY HH:MM".
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
    // Body opcional — POST con body vacío crea conversación con título auto.
    bodyJson = {};
  }
  const parsed = crearConversacionInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
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
    console.error("[POST conversaciones] error caso:", casoErr);
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

  // Archivar la activa (si hay).
  const { error: archErr } = await supabase
    .from("conversaciones_caso")
    .update({ estado: "archivada", archivada_en: new Date().toISOString() })
    .eq("caso_id", casoId)
    .eq("estado", "activa");
  if (archErr) {
    console.error("[POST conversaciones] error archivando activa:", archErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error archivando conversación previa",
        ...(isDev() ? { detail: archErr.message } : {}),
      },
      500,
    );
  }

  // Resolver título.
  let titulo = parsed.data.titulo?.trim() ?? "";
  if (!titulo) {
    const ahora = new Date();
    const fechaCorta = FECHA_AR.format(ahora);
    const tituloBase = `Conversación del ${fechaCorta}`;
    const { data: existentes } = await supabase
      .from("conversaciones_caso")
      .select("id")
      .eq("caso_id", casoId)
      .eq("titulo", tituloBase)
      .limit(1);
    if (existentes && existentes.length > 0) {
      // Colisión: ya hay una con el mismo nombre base hoy. Agregamos hora.
      const horaCorta = HORA_AR.format(ahora);
      titulo = `${tituloBase} ${horaCorta}`;
    } else {
      titulo = tituloBase;
    }
  }

  const { data: insertada, error: insErr } = await supabase
    .from("conversaciones_caso")
    .insert({
      caso_id: casoId,
      titulo,
      estado: "activa",
    })
    .select(
      "id, caso_id, titulo, estado, creada_en, actualizada_en, archivada_en",
    )
    .single();

  if (insErr || !insertada) {
    console.error("[POST conversaciones] error insertando:", insErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error creando conversación",
        ...(isDev() && insErr ? { detail: insErr.message } : {}),
      },
      500,
    );
  }

  return jsonResponse(
    { ok: true, conversacion: insertada as Conversacion },
    201,
  );
}

// === GET /api/casos/[id]/conversaciones ===
//
// Lista todas las conversaciones del caso del usuario, sorted desc por
// creada_en (la activa primero, después archivadas más recientes).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: casoId } = await params;
  if (!uuidSchema.safeParse(casoId).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
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
    console.error("[GET conversaciones] error caso:", casoErr);
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

  const { data, error } = await supabase
    .from("conversaciones_caso")
    .select(
      "id, caso_id, titulo, estado, creada_en, actualizada_en, archivada_en",
    )
    .eq("caso_id", casoId)
    // 'activa' < 'archivada' alfabéticamente, queremos la activa primero:
    // ordenamos por estado ASC y después por creada_en DESC para que la
    // activa quede arriba y archivadas más recientes después.
    .order("estado", { ascending: true })
    .order("creada_en", { ascending: false });

  if (error) {
    console.error("[GET conversaciones] error consultando:", error);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando conversaciones",
        ...(isDev() ? { detail: error.message } : {}),
      },
      500,
    );
  }

  return jsonResponse({ conversaciones: data ?? [] }, 200);
}
