// Tipos compartidos entre server (queries / API routes) y client (UI).
// Mantenelos puros — nada de "use client" / "server-only" acá.

export type EstadoEjecucion = "ok" | "error" | "degradada";

// Fila enriquecida que se renderiza en la tabla del panel admin.
// Trae el `metadata` jsonb completo para que el drill-down lateral pueda
// inspeccionarlo sin un round-trip extra a /api/admin/ejecuciones/[id].
export type EjecucionAdmin = {
  id: string;
  usuario_id: string;
  usuario_nombre: string;
  tipo: string;
  modelo: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  costo_usd: number;
  latencia_ms: number;
  ejecutado_en: string;
  estado: EstadoEjecucion;
  cantidad_busquedas: number;
  metadata: Record<string, unknown> | null;
};

export type EjecucionesQuery = {
  // usuario_id (UUID) o "todos" / undefined.
  usuario?: string;
  // estado lógico — derivado de metadata.error / metadata.degraded_response.
  estado?: EstadoEjecucion;
  // ISO 8601 con offset. Frontend manda fechas como rango día completo
  // en zona AR; el server las parsea como timestamps UTC contra ejecutado_en.
  desde?: string;
  hasta?: string;
  // ILIKE substring sobre metadata->>'caso'.
  q?: string;
  // 1-indexed.
  page?: number;
};

export type EjecucionesPage = {
  ejecuciones: EjecucionAdmin[];
  total: number;
  page: number;
  pageSize: number;
};

export type MetricasGlobales = {
  total_ejecuciones: number;
  total_tokens: number;
  total_gasto_usd: number;
  // Porcentajes ya calculados (0..100). El cliente los usa directamente
  // sin recalcular para evitar discrepancias.
  tasa_exito_pct: number;
  tasa_degradadas_pct: number;
};

export type UsuarioLite = {
  id: string;
  nombre: string;
};

export const PAGE_SIZE = 50;
