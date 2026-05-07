// Server component: la query a Supabase corre acá, los componentes
// presentacionales reciben la data como props.
//
// Filtros vía searchParams: el componente cliente EjecucionesFilters
// hace router.push con nuevos params y la page se rerendera con la query
// actualizada — sin necesidad de fetch desde el cliente.

import { z } from "zod";
import {
  getEjecuciones,
  getMetricasGlobales,
  getUsuariosLite,
} from "@/lib/admin/queries";
import { MetricsCards } from "@/components/admin/MetricsCards";
import { EjecucionesFilters } from "@/components/admin/EjecucionesFilters";
import { EjecucionesTable } from "@/components/admin/EjecucionesTable";
import { Pagination } from "@/components/admin/Pagination";
import { PAGE_SIZE } from "@/lib/admin/types";

// Schema laxo para los searchParams: si vienen mal tipados, los ignoramos
// silenciosamente. Esto evita cracks por links externos con `?page=foo`.
const searchSchema = z.object({
  usuario: z.string().uuid().optional(),
  estado: z.enum(["ok", "error", "degradada"]).optional(),
  desde: z.string().datetime({ offset: true }).optional(),
  hasta: z.string().datetime({ offset: true }).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
});

function asString(
  v: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const parsed = searchSchema.safeParse({
    usuario: asString(sp.usuario),
    estado: asString(sp.estado),
    desde: asString(sp.desde),
    hasta: asString(sp.hasta),
    q: asString(sp.q),
    page: asString(sp.page),
  });
  const filtros = parsed.success ? parsed.data : {};

  // Las 3 queries son independientes entre sí.
  const [metricas, ejecucionesPage, usuarios] = await Promise.all([
    getMetricasGlobales(),
    getEjecuciones(filtros),
    getUsuariosLite(),
  ]);

  // buildHref preserva todos los filtros activos al cambiar de página.
  const buildHref = (pageNum: number): string => {
    const usp = new URLSearchParams();
    if (filtros.usuario) usp.set("usuario", filtros.usuario);
    if (filtros.estado) usp.set("estado", filtros.estado);
    if (filtros.desde) usp.set("desde", filtros.desde);
    if (filtros.hasta) usp.set("hasta", filtros.hasta);
    if (filtros.q) usp.set("q", filtros.q);
    if (pageNum > 1) usp.set("page", String(pageNum));
    const qs = usp.toString();
    return qs ? `/admin?${qs}` : "/admin";
  };

  return (
    <div className="space-y-3">
      <MetricsCards data={metricas} />
      <EjecucionesFilters usuarios={usuarios} />
      <EjecucionesTable ejecuciones={ejecucionesPage.ejecuciones} />
      <Pagination
        page={ejecucionesPage.page}
        pageSize={PAGE_SIZE}
        total={ejecucionesPage.total}
        buildHref={buildHref}
      />
    </div>
  );
}
