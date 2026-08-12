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

// === Renovación del cupo mensual ===
//
// La vista `v_consumo_mensual` agrega el mes EN CURSO en timezone de Argentina,
// así que el cupo se renueva el día 1 del mes siguiente, hora de Argentina. Se
// calcula acá y no en el server para que el medidor del header no necesite otro
// campo del endpoint.

const TZ_AR = "America/Argentina/Buenos_Aires";

// "YYYY-MM-DD" del instante dado, en hora de Argentina.
const CLAVE_DIA_AR = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ_AR,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const MES_LARGO_AR = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ_AR,
  month: "long",
});
const MES_CORTO_AR = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ_AR,
  month: "short",
});

// Primer día del mes siguiente al del instante dado (hora de Argentina). Se
// construye a mediodía UTC = 09:00 ART, así el formateo en TZ AR nunca cae en
// el día anterior por el offset de -3h.
function primeroDelMesSiguiente(ahora: Date): Date {
  const [y, m] = CLAVE_DIA_AR.format(ahora).split("-").map(Number);
  // `m` es 1-based, así que pasarlo como índice 0-based apunta al mes
  // siguiente; Date.UTC resuelve solo el rollover de diciembre a enero.
  return new Date(Date.UTC(y, m, 1, 12));
}

/** "1 de agosto" — para el texto explicativo del tooltip. */
export const fmtRenovacionLarga = (ahora: Date = new Date()): string =>
  `1 de ${MES_LARGO_AR.format(primeroDelMesSiguiente(ahora))}`;

/** "1 ago" — para la etiqueta compacta al lado de la barra. */
export const fmtRenovacionCorta = (ahora: Date = new Date()): string =>
  `1 ${MES_CORTO_AR.format(primeroDelMesSiguiente(ahora)).replace(".", "")}`;

/** Porcentaje en formato es-AR con un decimal: 2.4 → "2,4". */
export const fmtPorcentaje = (pct: number): string =>
  pct.toLocaleString("es-AR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

const TIPOS: Record<string, string> = {
  analizar_caso: "Análisis",
  pre_analisis: "Pre-análisis",
  consulta_caso: "Consulta",
  simular_mapa: "Simulación de mapa",
  simular_audiencia: "Simulación de audiencia",
};

export const fmtTipo = (tipo: string): string => TIPOS[tipo] ?? tipo;

// Decisión de producto: la app NUNCA muestra los nombres oficiales de
// los modelos — se exponen como niveles "Bajo / Medio / Alto" (mapeo en
// src/lib/agent/modelos.ts). Aplica en consumo, historial y admin.
const MODELOS: Record<string, string> = {
  "claude-haiku-4-5-20251001": "Bajo",
  "claude-sonnet-4-5-20250929": "Medio",
  "claude-opus-4-6": "Alto",
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
