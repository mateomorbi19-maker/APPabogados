import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import { clientesSinNovedades } from "@/lib/reporteria/pendientes";
import { DIAS_SIN_REPORTE_AVISO } from "@/lib/reporteria/types";

// === GET /api/reportes/pendientes ===
//
// Las causas activas del abogado con cliente cargado a las que hace más de
// 30 días que no se les manda un reporte (o nunca). Es lo que dibuja la
// tarjeta «Clientes sin novedades» del Inicio; el Inicio server-side llama
// a la misma función sin pasar por acá.
export async function GET(): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);
  try {
    const pendientes = await clientesSinNovedades(wl.usuario_id);
    return jsonResponse({ ok: true, dias: DIAS_SIN_REPORTE_AVISO, pendientes }, 200);
  } catch (e) {
    console.error("[GET reportes/pendientes] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "No pude calcular los reportes pendientes",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}
