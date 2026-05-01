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

// Formato relativo "hace N tiempo". Se usa en la lista de casos para indicar
// hace cuánto se creó/actualizó cada caso. Hasta 30 días, devuelve frase
// relativa con `Intl.RelativeTimeFormat` en es-AR (numeric: "auto" da
// "hace un día" en vez de "hace 1 día"). Más de 30 días → fecha absoluta
// corta tipo "28 abr".
const REL_FORMATTER = new Intl.RelativeTimeFormat("es-AR", { numeric: "auto" });
const FECHA_CORTA_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

export const fmtRelativo = (iso: string): string => {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  const diffH = Math.round(diffMs / 3_600_000);
  const diffD = Math.round(diffMs / 86_400_000);
  if (diffMin < 1) return "hace un momento";
  if (diffMin < 60) return REL_FORMATTER.format(-diffMin, "minute");
  if (diffH < 24) return REL_FORMATTER.format(-diffH, "hour");
  if (diffD < 30) return REL_FORMATTER.format(-diffD, "day");
  return FECHA_CORTA_FORMATTER.format(date);
};
