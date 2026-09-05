import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { enforceTokenLimit } from "@/lib/auth/enforce-rate";
import { jsonResponse, isDev } from "@/lib/http";
import { generarEscritoInputSchema } from "@/lib/schemas";
import {
  generarEscritoParaCaso,
  MENSAJE_SIN_MIGRACION_ESCRITOS,
} from "@/lib/escritos/generar-escrito";
import { listarEscritos } from "@/lib/escritos/queries";
import { esModeloDelEstudio, esUuid } from "@/lib/escritos/types";

// Latencia medida del chat del caso con varias búsquedas: 40-90 s. El redactor
// tiene presupuestos más chicos (4 + 3) pero escribe una salida larga: 120 s
// da margen. maxDuration es inerte en Easypanel (el timeout lo pone el proxy).
export const maxDuration = 120;

const uuidSchema = z.string().uuid();

// === GET /api/casos/[id]/escritos — los escritos de la causa ===
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
    // El filtro de propiedad va en la query (usuario_id es columna de la
    // tabla): un caso ajeno devuelve lista vacía, no sus escritos.
    const escritos = await listarEscritos(id, wl.usuario_id);
    return jsonResponse({ ok: true, escritos }, 200);
  } catch (e) {
    console.error("[GET escritos] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error listando los escritos",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}

// === POST /api/casos/[id]/escritos — redactar un escrito nuevo ===
//
// La ruta hace lo que sólo una ruta puede hacer —validar el body, autenticar,
// aplicar el cupo mensual— y delega la secuencia entera (sondeo → carga →
// redactor → tracking → escrito) a `generarEscritoParaCaso`, que es la misma
// que usa la tool de LEXIE. Los códigos de respuesta son los de siempre: 503
// sin migración ANTES de gastar, 404 para caso o modelo que no son del
// abogado, 502 con `code` cuando falló el modelo, 500 para el resto.
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
  const parsed = generarEscritoInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }
  const { modelo_id, nivel } = parsed.data;
  const instrucciones = parsed.data.instrucciones ?? null;
  if (!esModeloDelEstudio(modelo_id) && !esUuid(modelo_id)) {
    return jsonResponse({ ok: false, error: "modelo_id inválido" }, 400);
  }

  let rate;
  try {
    rate = await enforceTokenLimit(wl.usuario_id);
  } catch (e) {
    console.error("[POST escritos] enforceTokenLimit falló:", e);
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

  const r = await generarEscritoParaCaso({
    casoId,
    usuarioId: wl.usuario_id,
    modeloId: modelo_id,
    instrucciones,
    nivel,
  });

  if (r.ok) {
    return jsonResponse(
      { ok: true, escrito: r.escrito, metadata: r.metadata },
      201,
    );
  }
  switch (r.motivo) {
    case "sin_migracion":
      return jsonResponse(
        { ok: false, error: MENSAJE_SIN_MIGRACION_ESCRITOS },
        503,
      );
    case "caso_ajeno":
      // 404 y no 403: un 403 confirmaría que la causa existe.
      return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
    case "modelo_inexistente":
      return jsonResponse({ ok: false, error: "Modelo no encontrado" }, 404);
    case "error":
      if (r.code) {
        return jsonResponse(
          { ok: false, error: r.mensaje, code: r.code },
          502,
        );
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
