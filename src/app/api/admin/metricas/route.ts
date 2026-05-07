import { requireAdminOr404 } from "@/lib/admin/auth";
import { getMetricasGlobales } from "@/lib/admin/queries";
import { jsonResponse, isDev } from "@/lib/http";

export async function GET(): Promise<Response> {
  const admin = await requireAdminOr404();
  if (!admin.ok) {
    return jsonResponse({ ok: false, error: "Not found" }, 404);
  }

  try {
    const metricas = await getMetricasGlobales();
    return jsonResponse(metricas, 200);
  } catch (e) {
    console.error("[/api/admin/metricas] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando métricas",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}
