import { NextRequest } from "next/server";
import { z } from "zod";
import { crearNodoSchema } from "@/lib/mapa-procesal/types";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import { crearNodoHijo } from "@/lib/mapa-procesal/queries";

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
  let nodo;
  try {
    nodo = await crearNodoHijo(id, padre_id, wl.usuario_id, {
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
  if (!nodo) {
    return jsonResponse(
      { ok: false, error: "Caso o nodo padre no encontrado" },
      404,
    );
  }
  return jsonResponse({ ok: true, nodo }, 201);
}
