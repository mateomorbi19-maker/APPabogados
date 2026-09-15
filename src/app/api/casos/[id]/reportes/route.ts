import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { enforceTokenLimit } from "@/lib/auth/enforce-rate";
import { jsonResponse, isDev } from "@/lib/http";
import { generarReporteInputSchema } from "@/lib/schemas";
import {
  generarReporteParaCaso,
  MENSAJE_SIN_MIGRACION_REPORTERIA,
} from "@/lib/reporteria/generar-reporte";
import { listarReportes } from "@/lib/reporteria/queries";

// Un reporte es una llamada corta (single-shot, sin tools, ~10-25 s), pero
// va detrás del mismo proxy que el resto: 60 s de margen.
export const maxDuration = 60;

const uuidSchema = z.string().uuid();

// === GET /api/casos/[id]/reportes — los reportes de la causa ===
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  try {
    // `usuario_id` es columna de la tabla: un caso ajeno devuelve lista vacía.
    const reportes = await listarReportes(id, wl.usuario_id);
    return jsonResponse({ ok: true, reportes }, 200);
  } catch (e) {
    console.error("[GET reportes] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error listando los reportes",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}

// === POST /api/casos/[id]/reportes — generar un reporte nuevo ===
//
// La ruta valida el body, autentica y aplica el cupo mensual; la secuencia
// (sondeo → propiedad → datos → render → modelo → tracking → fila) vive en
// `generarReporteParaCaso`, que es la misma que usa LEXIE. Códigos: 503 sin
// migración ANTES de gastar; 404 caso o parte que no son del abogado; 409
// parte que no es cliente; 400 plantilla/variante inválidas; 502 con `code`
// cuando falló el modelo; 500 el resto.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: casoId } = await params;
  if (!uuidSchema.safeParse(casoId).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = generarReporteInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }
  const b = parsed.data;

  let rate;
  try {
    rate = await enforceTokenLimit(wl.usuario_id);
  } catch (e) {
    console.error("[POST reportes] enforceTokenLimit falló:", e);
    return jsonResponse(
      { ok: false, error: "No pude verificar tu consumo del mes. Probá de nuevo." },
      500,
    );
  }
  if (!rate.ok) {
    return jsonResponse(
      {
        ok: false,
        error: `Alcanzaste el límite mensual de ${rate.limite.toLocaleString("es-AR")} tokens.`,
      },
      429,
    );
  }

  const r = await generarReporteParaCaso({
    casoId,
    usuarioId: wl.usuario_id,
    parteId: b.parte_id,
    plantilla: b.plantilla,
    variante: b.variante ?? null,
    canal: b.canal,
    criterio: b.criterio,
    nivel: b.nivel,
    sinIa: b.sin_ia,
  });

  if (r.ok) {
    return jsonResponse(
      {
        ok: true,
        reporte: r.reporte,
        marcas_pendientes: r.marcas_pendientes,
        metadata: r.metadata,
      },
      201,
    );
  }
  switch (r.motivo) {
    case "sin_migracion":
      return jsonResponse({ ok: false, error: MENSAJE_SIN_MIGRACION_REPORTERIA }, 503);
    case "caso_ajeno":
      return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
    case "parte_inexistente":
      return jsonResponse({ ok: false, error: r.detalle }, 404);
    case "parte_no_cliente":
      return jsonResponse({ ok: false, error: r.detalle }, 409);
    case "plantilla_invalida":
    case "variante_invalida":
      return jsonResponse({ ok: false, error: r.detalle }, 400);
    case "error":
      if (r.code) {
        return jsonResponse({ ok: false, error: r.mensaje, code: r.code }, 502);
      }
      return jsonResponse(
        {
          ok: false,
          error: r.mensaje,
          ...(isDev() && r.detalle ? { detail: r.detalle } : {}),
        },
        500,
      );
  }
}
