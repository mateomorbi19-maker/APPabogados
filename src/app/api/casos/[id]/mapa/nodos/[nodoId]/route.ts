import { NextRequest } from "next/server";
import { z } from "zod";
import { editarNodoSchema } from "@/lib/mapa-procesal/types";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import { actualizarNodo, eliminarNodo } from "@/lib/mapa-procesal/queries";

const uuidSchema = z.string().uuid();

// === PUT /api/casos/[id]/mapa/nodos/[nodoId] ===
// Edita título/descripción/estado. estado='ocurrido' desbloquea los hijos.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; nodoId: string }> },
): Promise<Response> {
  const { id, nodoId } = await params;
  if (!uuidSchema.safeParse(id).success || !uuidSchema.safeParse(nodoId).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = editarNodoSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }
  const d = parsed.data;
  if (
    d.titulo === undefined &&
    d.descripcion === undefined &&
    d.estado === undefined &&
    d.riesgo_alto === undefined
  ) {
    return jsonResponse({ ok: false, error: "Nada para actualizar" }, 400);
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let nodo;
  try {
    nodo = await actualizarNodo(nodoId, id, wl.usuario_id, {
      titulo: d.titulo,
      descripcion: d.descripcion,
      estado: d.estado,
      riesgo_alto: d.riesgo_alto,
    });
  } catch (e) {
    console.error("[PUT /api/casos/[id]/mapa/nodos/[nodoId]] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error actualizando el nodo",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
  if (!nodo) {
    return jsonResponse({ ok: false, error: "Nodo no encontrado" }, 404);
  }
  return jsonResponse({ ok: true, nodo }, 200);
}

// === DELETE /api/casos/[id]/mapa/nodos/[nodoId] ===
// Elimina el nodo + descendientes (cascade). No permite la raíz.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; nodoId: string }> },
): Promise<Response> {
  const { id, nodoId } = await params;
  if (!uuidSchema.safeParse(id).success || !uuidSchema.safeParse(nodoId).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let result;
  try {
    result = await eliminarNodo(nodoId, id, wl.usuario_id);
  } catch (e) {
    console.error("[DELETE /api/casos/[id]/mapa/nodos/[nodoId]] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error eliminando el nodo",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
  if (result.status === "is_raiz") {
    return jsonResponse(
      { ok: false, error: "No se puede eliminar el nodo raíz" },
      400,
    );
  }
  if (result.status !== "ok") {
    return jsonResponse({ ok: false, error: "Nodo no encontrado" }, 404);
  }
  return new Response(null, { status: 204 });
}
