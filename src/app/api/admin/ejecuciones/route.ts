import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminOr404 } from "@/lib/admin/auth";
import { getEjecuciones } from "@/lib/admin/queries";
import { jsonResponse, isDev } from "@/lib/http";

// Endpoint listado de ejecuciones para el panel admin. Filtros opcionales
// + paginación. La page principal `/admin` ya hace la query server-side
// directo con getEjecuciones; este endpoint queda para clientes que
// necesiten refrescar sin recargar (futuro polling) o consumo programático.

const querySchema = z.object({
  usuario: z.string().uuid().optional(),
  estado: z.enum(["ok", "error", "degradada"]).optional(),
  desde: z.string().datetime({ offset: true }).optional(),
  hasta: z.string().datetime({ offset: true }).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const admin = await requireAdminOr404();
  if (!admin.ok) {
    return jsonResponse({ ok: false, error: "Not found" }, 404);
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    usuario: searchParams.get("usuario") ?? undefined,
    estado: searchParams.get("estado") ?? undefined,
    desde: searchParams.get("desde") ?? undefined,
    hasta: searchParams.get("hasta") ?? undefined,
    q: searchParams.get("q") ?? undefined,
    page: searchParams.get("page") ?? undefined,
  });
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Query inválida", issues: parsed.error.issues },
      400,
    );
  }

  try {
    const result = await getEjecuciones(parsed.data);
    return jsonResponse(result, 200);
  } catch (e) {
    console.error("[/api/admin/ejecuciones] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando ejecuciones",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}
