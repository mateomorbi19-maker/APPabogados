import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminOr404 } from "@/lib/admin/auth";
import { getEjecucionDetalle } from "@/lib/admin/queries";
import { jsonResponse, isDev } from "@/lib/http";

const uuidSchema = z.string().uuid();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const admin = await requireAdminOr404();
  if (!admin.ok) {
    return jsonResponse({ ok: false, error: "Not found" }, 404);
  }

  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

  try {
    const ejecucion = await getEjecucionDetalle(id);
    if (!ejecucion) {
      return jsonResponse({ ok: false, error: "Ejecución no encontrada" }, 404);
    }
    return jsonResponse({ ejecucion }, 200);
  } catch (e) {
    console.error("[/api/admin/ejecuciones/[id]] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando ejecución",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}
