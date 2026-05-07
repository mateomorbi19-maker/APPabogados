import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import { PAGE_SIZE } from "@/lib/admin/types";
import type {
  EjecucionAdmin,
  EjecucionesPage,
  EjecucionesQuery,
  EstadoEjecucion,
  MetricasGlobales,
  UsuarioLite,
} from "@/lib/admin/types";

// Deriva el estado lógico (`ok` | `error` | `degradada`) de los flags que
// el endpoint analizar-caso persiste en metadata.
//
// `error_code` y `degraded_response` no existían pre-fix/hard-cap-busquedas:
// las filas viejas (anteriores al merge de ese fix) no los tienen. Tratamos
// la ausencia como "ok puro" excepto cuando hay `metadata.error` (señal de
// que el agente tiró un AgentError, presente en las filas viejas también).
function derivarEstado(meta: Record<string, unknown> | null): EstadoEjecucion {
  if (!meta) return "ok";
  if ("error" in meta && meta.error) return "error";
  if (meta.degraded_response === true) return "degradada";
  return "ok";
}

function cantidadBusquedas(meta: Record<string, unknown> | null): number {
  if (!meta) return 0;
  const b = meta.busquedas;
  if (Array.isArray(b)) return b.length;
  return 0;
}

type RowFromSupabase = {
  id: string;
  usuario_id: string;
  tipo: string;
  modelo: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  costo_usd: number | string;
  latencia_ms: number;
  ejecutado_en: string;
  metadata: Record<string, unknown> | null;
  // Auto-join via FK ejecuciones.usuario_id → usuarios.id.
  usuarios: { nombre: string } | null;
};

function rowToEjecucionAdmin(row: RowFromSupabase): EjecucionAdmin {
  return {
    id: row.id,
    usuario_id: row.usuario_id,
    usuario_nombre: row.usuarios?.nombre ?? "(desconocido)",
    tipo: row.tipo,
    modelo: row.modelo,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    total_tokens: row.total_tokens,
    // Postgres NUMERIC viene como string en supabase-js. Convertimos a number
    // acá para no obligar al cliente a parsear.
    costo_usd: typeof row.costo_usd === "string" ? parseFloat(row.costo_usd) : row.costo_usd,
    latencia_ms: row.latencia_ms,
    ejecutado_en: row.ejecutado_en,
    estado: derivarEstado(row.metadata),
    cantidad_busquedas: cantidadBusquedas(row.metadata),
    metadata: row.metadata,
  };
}

const COLUMNS_LIST =
  "id, usuario_id, tipo, modelo, input_tokens, output_tokens, total_tokens, costo_usd, latencia_ms, ejecutado_en, metadata, usuarios(nombre)";

export async function getEjecuciones(
  q: EjecucionesQuery,
): Promise<EjecucionesPage> {
  const supabase = createServerClient();
  const page = Math.max(1, q.page ?? 1);
  const start = (page - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE - 1;

  let query = supabase
    .from("ejecuciones")
    .select(COLUMNS_LIST, { count: "exact" });

  if (q.usuario) {
    query = query.eq("usuario_id", q.usuario);
  }

  // Filtros de estado sobre el jsonb `metadata`. Importante:
  //   - PostgREST `metadata->>error` devuelve text; comparamos con null o
  //     con strings ("true"/"false") según corresponda.
  //   - Para "ok" excluimos tanto error como degradada.
  if (q.estado === "error") {
    query = query.not("metadata->>error", "is", null);
  } else if (q.estado === "degradada") {
    query = query.eq("metadata->>degraded_response", "true");
  } else if (q.estado === "ok") {
    query = query
      .is("metadata->>error", null)
      .or(
        "metadata->>degraded_response.is.null,metadata->>degraded_response.neq.true",
      );
  }

  if (q.desde) query = query.gte("ejecutado_en", q.desde);
  if (q.hasta) query = query.lte("ejecutado_en", q.hasta);

  if (q.q && q.q.trim().length > 0) {
    // ILIKE sobre metadata->>'caso'. Escapamos % y _ para no permitir
    // wildcards arbitrarios desde el filtro.
    const safe = q.q.replace(/[%_]/g, (m) => `\\${m}`);
    query = query.ilike("metadata->>caso", `%${safe}%`);
  }

  query = query.order("ejecutado_en", { ascending: false }).range(start, end);

  const { data, count, error } = await query;
  if (error) {
    throw new Error(`getEjecuciones supabase error: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as RowFromSupabase[];
  return {
    ejecuciones: rows.map(rowToEjecucionAdmin),
    total: count ?? rows.length,
    page,
    pageSize: PAGE_SIZE,
  };
}

export async function getEjecucionDetalle(
  id: string,
): Promise<EjecucionAdmin | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("ejecuciones")
    .select(COLUMNS_LIST)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`getEjecucionDetalle supabase error: ${error.message}`);
  }
  if (!data) return null;
  return rowToEjecucionAdmin(data as unknown as RowFromSupabase);
}

export async function getMetricasGlobales(): Promise<MetricasGlobales> {
  const supabase = createServerClient();
  // Una query, agregamos en JS. Con 27 filas hoy es trivial; si crece más
  // allá de unos miles de filas, mover a una vista o RPC `metricas_admin`.
  const { data, error } = await supabase
    .from("ejecuciones")
    .select("total_tokens, costo_usd, metadata");

  if (error) {
    throw new Error(`getMetricasGlobales supabase error: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{
    total_tokens: number;
    costo_usd: number | string;
    metadata: Record<string, unknown> | null;
  }>;

  let total_tokens = 0;
  let total_gasto_usd = 0;
  let errores = 0;
  let degradadas = 0;

  for (const r of rows) {
    total_tokens += r.total_tokens ?? 0;
    const costo =
      typeof r.costo_usd === "string" ? parseFloat(r.costo_usd) : r.costo_usd;
    if (Number.isFinite(costo)) total_gasto_usd += costo;
    const estado = derivarEstado(r.metadata);
    if (estado === "error") errores++;
    if (estado === "degradada") degradadas++;
  }

  const total_ejecuciones = rows.length;
  const ok = total_ejecuciones - errores;
  const tasa_exito_pct =
    total_ejecuciones > 0 ? (ok / total_ejecuciones) * 100 : 0;
  const tasa_degradadas_pct = ok > 0 ? (degradadas / ok) * 100 : 0;

  return {
    total_ejecuciones,
    total_tokens,
    total_gasto_usd: Number(total_gasto_usd.toFixed(4)),
    tasa_exito_pct: Number(tasa_exito_pct.toFixed(1)),
    tasa_degradadas_pct: Number(tasa_degradadas_pct.toFixed(1)),
  };
}

export async function getUsuariosLite(): Promise<UsuarioLite[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("usuarios")
    .select("id, nombre")
    .order("nombre", { ascending: true });
  if (error) {
    throw new Error(`getUsuariosLite supabase error: ${error.message}`);
  }
  return (data ?? []) as UsuarioLite[];
}
