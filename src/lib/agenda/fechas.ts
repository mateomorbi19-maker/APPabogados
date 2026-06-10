// Helpers de fecha de la agenda. La app muestra todo en timezone de Argentina,
// así que la agrupación por día también se hace en esa TZ (un evento a las 23:00
// ART debe caer en su día ART, no en el siguiente UTC).
//
// (Archivo extra, no listado en el spec original: centraliza la lógica de
// agrupación/etiquetas/hora para reusarla entre agenda-view y evento-card en
// vez de duplicarla. Módulo puro, sin "use client" ni "server-only".)

const TZ = "America/Argentina/Buenos_Aires";

// "YYYY-MM-DD" (en-CA da ese formato) en TZ de Argentina. Es la clave de día.
const CLAVE_DIA_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function claveDia(iso: string): string {
  return CLAVE_DIA_FMT.format(new Date(iso));
}

const HORA_FMT = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function fmtHora(iso: string): string {
  return HORA_FMT.format(new Date(iso));
}

const DIA_LARGO_FMT = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
});

function capitalizar(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

// Etiqueta humana de una clave de día "YYYY-MM-DD": "Hoy — Martes, 10 de junio",
// "Mañana — ...", o solo "Martes, 10 de junio" si es otro día.
export function etiquetaDia(clave: string): string {
  const ahora = new Date();
  const hoyKey = claveDia(ahora.toISOString());
  const mananaKey = claveDia(new Date(ahora.getTime() + 86_400_000).toISOString());

  // Parseamos la clave a mediodía UTC para que el formateo en TZ AR no cruce de
  // día por el offset (-3h): mediodía UTC = 09:00 ART, mismo día calendario.
  const fechaLabel = capitalizar(DIA_LARGO_FMT.format(new Date(`${clave}T12:00:00Z`)));

  if (clave === hoyKey) return `Hoy — ${fechaLabel}`;
  if (clave === mananaKey) return `Mañana — ${fechaLabel}`;
  return fechaLabel;
}

const SOLO_DIA_FMT = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  weekday: "long",
});
const DIA_MES_FMT = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  day: "numeric",
  month: "long",
}); // "10 de junio"

// Partes separadas de la etiqueta de día, para los separadores del listado:
// label ("Hoy" | "Mañana" | "Viernes") + fecha ("10 de junio") + flag esHoy.
export function etiquetaDiaPartes(clave: string): {
  label: string;
  esHoy: boolean;
  fecha: string;
} {
  const ahora = new Date();
  const hoyKey = claveDia(ahora.toISOString());
  const mananaKey = claveDia(new Date(ahora.getTime() + 86_400_000).toISOString());
  const d = new Date(`${clave}T12:00:00Z`);
  const fecha = DIA_MES_FMT.format(d);
  if (clave === hoyKey) return { label: "Hoy", esHoy: true, fecha };
  if (clave === mananaKey) return { label: "Mañana", esHoy: false, fecha };
  return { label: capitalizar(SOLO_DIA_FMT.format(d)), esHoy: false, fecha };
}
