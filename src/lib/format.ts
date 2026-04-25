// Helpers de formato compartidos entre header y panel de consumo.
// Sin "use client" / "server-only" — módulo puro reusable en ambos lados.

export const fmtNumber = (n: number): string => n.toLocaleString("es-AR");

// 4 decimales para que se vean los costos chicos (~$0.0829 por análisis).
export const fmtCosto = (n: number): string => `$${n.toFixed(4)}`;

const FECHA_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Buenos_Aires",
});

export const fmtFecha = (iso: string): string =>
  FECHA_FORMATTER.format(new Date(iso));

const TIPOS: Record<string, string> = {
  analizar_caso: "Análisis",
  pre_analisis: "Pre-análisis",
};

export const fmtTipo = (tipo: string): string => TIPOS[tipo] ?? tipo;

const MODELOS: Record<string, string> = {
  "claude-sonnet-4-5-20250929": "Sonnet 4.5",
};

export const fmtModelo = (modelo: string): string => MODELOS[modelo] ?? modelo;
