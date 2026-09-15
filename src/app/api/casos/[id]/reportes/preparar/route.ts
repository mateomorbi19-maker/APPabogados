import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import {
  MENSAJE_SIN_MIGRACION_REPORTERIA,
  prevueloReporte,
} from "@/lib/reporteria/generar-reporte";

const uuidSchema = z.string().uuid();

// === GET /api/casos/[id]/reportes/preparar?parte_id=… ===
//
// El pre-vuelo GRATIS del diálogo «Nuevo reporte»: qué sabe el sistema de la
// causa (etapa, último movimiento, agenda, firma), a quién se le puede
// escribir (las partes marcadas como cliente), qué plantilla sugiere y por
// qué, y qué va a faltar en cada una. No llama al modelo ni escribe nada.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }
  const parteId = req.nextUrl.searchParams.get("parte_id");
  if (parteId && !uuidSchema.safeParse(parteId).success) {
    return jsonResponse({ ok: false, error: "parte_id inválido" }, 400);
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  try {
    const r = await prevueloReporte({
      casoId: id,
      usuarioId: wl.usuario_id,
      parteId: parteId ?? null,
    });
    if (r.ok) return jsonResponse(r, 200);
    switch (r.motivo) {
      case "sin_migracion":
        return jsonResponse({ ok: false, error: MENSAJE_SIN_MIGRACION_REPORTERIA }, 503);
      case "caso_ajeno":
        return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
    }
  } catch (e) {
    console.error("[GET reportes/preparar] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "No pude preparar el reporte",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}
