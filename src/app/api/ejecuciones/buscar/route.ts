import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";

// Endpoint auxiliar para "recuperar" un análisis cuando el cliente recibió
// un 502 del proxy pero el server alcanzó a persistir el resultado en DB.
// Usado por /api/analizar-caso → cliente: ante 502, hace polling acá.
//
// Filtra por usuario actual + tipo + ejecutadas a partir de `desde` (ISO).
// El cliente compara metadata.caso/metadata.rol localmente para identificar
// la suya entre las recientes (esperamos 0–2 filas en la ventana habitual).
const querySchema = z.object({
  tipo: z.enum(["analizar_caso", "pre_analisis"]),
  desde: z.string().datetime({ offset: true }),
});

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    tipo: searchParams.get("tipo"),
    desde: searchParams.get("desde"),
  });
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Query inválida", issues: parsed.error.issues },
      400,
    );
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("ejecuciones")
    .select("id, tipo, ejecutado_en, metadata")
    .eq("usuario_id", wl.usuario_id)
    .eq("tipo", parsed.data.tipo)
    .gte("ejecutado_en", parsed.data.desde)
    .order("ejecutado_en", { ascending: false })
    .limit(10);

  if (error) {
    console.error("[GET /api/ejecuciones/buscar] error:", error);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando ejecuciones",
        ...(isDev() ? { detail: error.message } : {}),
      },
      500,
    );
  }

  return jsonResponse({ ejecuciones: data ?? [] }, 200);
}
