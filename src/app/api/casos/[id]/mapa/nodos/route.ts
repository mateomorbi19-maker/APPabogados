import { NextRequest } from "next/server";
import { z } from "zod";
import { crearNodoSchema, posicionesBatchSchema } from "@/lib/mapa-procesal/types";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import { actualizarPosiciones, crearNodoHijo } from "@/lib/mapa-procesal/queries";

const uuidSchema = z.string().uuid();

// === POST /api/casos/[id]/mapa/nodos ===
// Crea un nodo hijo de un nodo existente del caso.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = crearNodoSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  const { padre_id, titulo, descripcion } = parsed.data;
  let r;
  try {
    r = await crearNodoHijo(id, padre_id, wl.usuario_id, {
      titulo,
      descripcion: descripcion ?? null,
    });
  } catch (e) {
    console.error("[POST /api/casos/[id]/mapa/nodos] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error creando el nodo",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
  if (r.status === "not_found") {
    return jsonResponse(
      { ok: false, error: "Caso o nodo padre no encontrado" },
      404,
    );
  }
  if (r.status === "tope") {
    return jsonResponse(
      {
        ok: false,
        error: `El mapa ya tiene ${r.total} nodos y el máximo es ${r.maximo}. Borrá alguna rama descartada antes de agregar más.`,
      },
      409,
    );
  }
  return jsonResponse({ ok: true, nodo: r.nodo }, 201);
}

// === PATCH /api/casos/[id]/mapa/nodos ===
// Actualiza posiciones en batch (Fase E): siembra de mapas pre-Fase E y botón
// "Reordenar". Body: { posiciones: [{ id, posicion_x, posicion_y }] }.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = posicionesBatchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let ok;
  try {
    ok = await actualizarPosiciones(id, wl.usuario_id, parsed.data.posiciones);
  } catch (e) {
    console.error("[PATCH /api/casos/[id]/mapa/nodos] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error actualizando posiciones",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
  if (!ok) {
    return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
  }
  return jsonResponse({ ok: true }, 200);
}
