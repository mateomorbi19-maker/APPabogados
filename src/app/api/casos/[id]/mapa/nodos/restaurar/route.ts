import { NextRequest } from "next/server";
import { z } from "zod";
import { restaurarNodosSchema } from "@/lib/mapa-procesal/types";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import { restaurarNodos } from "@/lib/mapa-procesal/queries";

const uuidSchema = z.string().uuid();

// === POST /api/casos/[id]/mapa/nodos/restaurar ===
// Deshacer borrado: re-inserta el subárbol capturado por el cliente antes del
// DELETE, con los MISMOS ids (vuelve idéntico: jerarquía, estados, posiciones).
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
  const parsed = restaurarNodosSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let result;
  try {
    result = await restaurarNodos(id, wl.usuario_id, parsed.data.nodos);
  } catch (e) {
    console.error("[POST /mapa/nodos/restaurar] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error restaurando nodos",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
  if (result.status === "not_owned") {
    return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
  }
  if (result.status === "padre_faltante") {
    return jsonResponse(
      {
        ok: false,
        error:
          "No se pudo deshacer: el nodo padre ya no existe en el mapa",
      },
      409,
    );
  }
  return jsonResponse({ ok: true, nodos: result.nodos }, 201);
}
