import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import { editarReporteInputSchema } from "@/lib/schemas";
import {
  borrarReporte,
  editarReporte,
  obtenerReporte,
} from "@/lib/reporteria/queries";

const uuidSchema = z.string().uuid();

type Ctx = { params: Promise<{ id: string; reporte_id: string }> };

// Propiedad: `reportes_cliente` tiene `usuario_id` propio y las tres
// operaciones lo llevan como predicado junto con `caso_id` y `id`.
async function validar(ctx: Ctx) {
  const { id, reporte_id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return { ok: false as const, status: 400, error: "id inválido" };
  }
  if (!uuidSchema.safeParse(reporte_id).success) {
    return { ok: false as const, status: 400, error: "reporte_id inválido" };
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return { ok: false as const, status: wl.status, error: wl.message };
  }
  return { ok: true as const, casoId: id, reporteId: reporte_id, usuarioId: wl.usuario_id };
}

function error500(donde: string, e: unknown, mensaje: string): Response {
  console.error(`[${donde}] error:`, e);
  return jsonResponse(
    {
      ok: false,
      error: mensaje,
      ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
    },
    500,
  );
}

// === GET — el reporte con sus textos ===
export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const v = await validar(ctx);
  if (!v.ok) return jsonResponse({ ok: false, error: v.error }, v.status);
  try {
    const reporte = await obtenerReporte(v.reporteId, v.casoId, v.usuarioId);
    if (!reporte) return jsonResponse({ ok: false, error: "Reporte no encontrado" }, 404);
    return jsonResponse({ ok: true, reporte }, 200);
  } catch (e) {
    return error500("GET reporte", e, "Error leyendo el reporte");
  }
}

// === PATCH — el abogado corrige el texto, el asunto o el canal; o lo descarta ===
// Un reporte enviado es inmutable: 409.
export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const v = await validar(ctx);
  if (!v.ok) return jsonResponse({ ok: false, error: v.error }, v.status);

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = editarReporteInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }
  if (Object.values(parsed.data).every((x) => x === undefined)) {
    return jsonResponse({ ok: false, error: "No hay nada para actualizar" }, 400);
  }

  try {
    const reporte = await editarReporte(v.reporteId, v.casoId, v.usuarioId, parsed.data);
    if (reporte) return jsonResponse({ ok: true, reporte }, 200);
    // Null: o no existe, o ya no es un borrador. Se distingue para el 409.
    const actual = await obtenerReporte(v.reporteId, v.casoId, v.usuarioId);
    if (!actual) return jsonResponse({ ok: false, error: "Reporte no encontrado" }, 404);
    return jsonResponse(
      {
        ok: false,
        error:
          actual.estado === "enviado"
            ? "Este reporte ya se envió y no se puede modificar."
            : "Este reporte está descartado.",
      },
      409,
    );
  } catch (e) {
    return error500("PATCH reporte", e, "Error guardando el reporte");
  }
}

// === DELETE — sólo lo que no se envió ===
export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const v = await validar(ctx);
  if (!v.ok) return jsonResponse({ ok: false, error: v.error }, v.status);
  try {
    const ok = await borrarReporte(v.reporteId, v.casoId, v.usuarioId);
    if (ok) return jsonResponse({ ok: true }, 200);
    const actual = await obtenerReporte(v.reporteId, v.casoId, v.usuarioId);
    if (!actual) return jsonResponse({ ok: false, error: "Reporte no encontrado" }, 404);
    return jsonResponse(
      { ok: false, error: "Un reporte enviado no se borra: es el registro de lo que se le dijo al cliente." },
      409,
    );
  } catch (e) {
    return error500("DELETE reporte", e, "Error borrando el reporte");
  }
}
