import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";
import { COLS_PARTE } from "@/lib/casos/columnas";
import { crearParteInputSchema } from "@/lib/schemas";

const uuidSchema = z.string().uuid();

// Cuántas personas puede tener una causa. No hay caso penal con 80 partes
// cargadas a mano; el tope existe para que un bucle del cliente no llene la
// tabla, no porque 40 sea un número procesalmente significativo.
const MAX_PARTES = 40;

// El guard de propiedad de TODAS las rutas de partes.
//
// `partes_caso` no tiene `usuario_id` (la propiedad se hereda del caso vía la
// FK), y el server entra con service_role, que bypassa RLS. O sea: si esta
// función no corre, cualquier abogado lee y escribe las partes de la causa de
// otro con solo cambiar el UUID de la URL. Y acá los datos son nombres reales
// de clientes e imputados: una fuga cruzada no es un bug de UX, es secreto
// profesional roto.
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

// === GET /api/casos/[id]/partes ===
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
  if (!(await casoPropio(id, wl.usuario_id))) {
    return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("partes_caso")
    .select(COLS_PARTE)
    .eq("caso_id", id)
    .order("creado_en", { ascending: true });

  if (error) {
    console.error("[GET partes] error:", error);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando partes",
        ...(isDev() ? { detail: error.message } : {}),
      },
      500,
    );
  }

  // Las lecturas del repo no llevan `ok` (ver GET /api/casos y /eventos).
  return jsonResponse({ partes: data ?? [] }, 200);
}

// === POST /api/casos/[id]/partes ===
export async function POST(
  req: NextRequest,
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
  if (!(await casoPropio(id, wl.usuario_id))) {
    return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
  }

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = crearParteInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }

  const supabase = createServerClient();

  const { count } = await supabase
    .from("partes_caso")
    .select("id", { count: "exact", head: true })
    .eq("caso_id", id);
  if ((count ?? 0) >= MAX_PARTES) {
    return jsonResponse(
      { ok: false, error: `Una causa admite hasta ${MAX_PARTES} partes` },
      400,
    );
  }

  // Lista blanca explícita: `caso_id` sale del path, nunca del body. Si viniera
  // del body, un abogado podría cargar una parte en la causa de otro.
  const { data, error } = await supabase
    .from("partes_caso")
    .insert({
      caso_id: id,
      nombre: parsed.data.nombre.trim(),
      rol: parsed.data.rol,
      es_cliente: parsed.data.es_cliente,
      situacion_libertad: parsed.data.situacion_libertad ?? null,
    })
    .select(COLS_PARTE)
    .single();

  if (error || !data) {
    console.error("[POST partes] error:", error);
    return jsonResponse(
      {
        ok: false,
        error: "Error creando la parte",
        ...(isDev() && error ? { detail: error.message } : {}),
      },
      500,
    );
  }

  return jsonResponse({ ok: true, parte: data }, 201);
}
