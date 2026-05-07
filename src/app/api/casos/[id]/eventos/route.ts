import { NextRequest } from "next/server";
import { z } from "zod";
import { crearEventoInputSchema } from "@/lib/schemas";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";

const uuidSchema = z.string().uuid();

// === POST /api/casos/[id]/eventos ===
//
// Inserta un evento manual al timeline de un caso del usuario.
// `ocurrido_en` opcional (default = now()). Acepta `categoria` (proc) y
// `adjuntos[]` (jsonb) — los adjuntos vienen ya subidos al bucket vía
// signed URL del endpoint /upload-url.
//
// Validación clave: cada `storage_path` de los adjuntos debe empezar con
// `{usuario_id}/{caso_id}/`. Defensa contra que un abogado asocie
// adjuntos de otro caso suyo (subió correctamente bajo su propio path
// pero apunta al evento equivocado).
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
  const { descripcion, ocurrido_en, estado, categoria, adjuntos } =
    parsedBody.data;

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  // Cada adjunto debe pertenecer a este caso del usuario. Sin esto, un
  // body malicioso podría apuntar a `{otro_caso}/foo.pdf` y "asociarlo"
  // a este evento. Es defensa-en-profundidad además del auth por endpoint.
  const expectedPrefix = `${wl.usuario_id}/${casoId}/`;
  for (const a of adjuntos) {
    if (!a.storage_path.startsWith(expectedPrefix)) {
      return jsonResponse(
        {
          ok: false,
          error: "Algún adjunto no pertenece a este caso",
        },
        400,
      );
    }
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
      categoria,
      descripcion,
      ocurrido_en: ocurridoEnIso,
      estado: estadoFinal,
      adjuntos,
    })
    .select(
      "id, tipo, categoria, descripcion, ocurrido_en, estado, creado_en, adjuntos",
    )
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

// === GET /api/casos/[id]/eventos?desde=<iso>&tipo=<origen> ===
//
// Endpoint de polling para "recovery post-502" del flujo de consulta
// al agente. Si Easypanel/Traefik corta al cliente con 502 mientras
// el server todavía procesa, el cliente hace polling acá para ver
// si llegó a aparecer el evento de respuesta del agente.
//
// `desde` se compara contra `creado_en` (timestamp de inserción del
// evento), no `ocurrido_en` (que es el momento procesal). Eso evita
// devolver eventos viejos cuyo ocurrido_en cae en el rango por
// casualidad. `tipo` opcional filtra por origen.
const querySchema = z.object({
  desde: z.string().datetime({ offset: true }),
  tipo: z.enum(["manual", "sistema", "agente"]).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: casoId } = await params;
  if (!uuidSchema.safeParse(casoId).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    desde: url.searchParams.get("desde"),
    tipo: url.searchParams.get("tipo") ?? undefined,
  });
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Query inválida", issues: parsed.error.issues },
      400,
    );
  }
  const { desde, tipo } = parsed.data;

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  const supabase = createServerClient();

  const { data: caso, error: casoErr } = await supabase
    .from("casos")
    .select("id")
    .eq("id", casoId)
    .eq("usuario_id", wl.usuario_id)
    .maybeSingle();
  if (casoErr) {
    console.error("[GET eventos] error cargando caso:", casoErr);
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

  let q = supabase
    .from("eventos_caso")
    .select(
      "id, tipo, categoria, descripcion, ocurrido_en, estado, creado_en, adjuntos",
    )
    .eq("caso_id", casoId)
    .gte("creado_en", desde)
    .order("creado_en", { ascending: true })
    .limit(20);

  if (tipo) {
    q = q.eq("tipo", tipo);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[GET eventos] error consultando:", error);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando eventos",
        ...(isDev() ? { detail: error.message } : {}),
      },
      500,
    );
  }

  return jsonResponse({ eventos: data ?? [] }, 200);
}
