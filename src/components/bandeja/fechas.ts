// Formateo de fechas y tamaños de la bandeja. Todo se resuelve en ART: Gmail
// devuelve las fechas en UTC y el estudio razona en hora de Buenos Aires.

const TZ = "America/Argentina/Buenos_Aires";

const FMT_HORA = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TZ,
});

const FMT_DIA_CORTO = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  timeZone: TZ,
});

const FMT_FECHA_CORTA = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  timeZone: TZ,
});

const FMT_COMPLETA = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TZ,
});

// en-CA formatea YYYY-MM-DD, que sirve como clave de día comparable con ===
// sin tener que construir un Date desplazado a mano.
const FMT_CLAVE_DIA = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TZ,
});

function parsear(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Fecha para la fila de la lista, con la misma progresión que usan los
 * clientes de correo: hoy → `14:20`, últimos 7 días → `jue 14:20`,
 * más viejo → `14/03/25`.
 */
export function fechaListado(iso: string): string {
  const d = parsear(iso);
  if (!d) return "";
  const ahora = new Date();
  if (FMT_CLAVE_DIA.format(d) === FMT_CLAVE_DIA.format(ahora)) {
    return FMT_HORA.format(d);
  }
  const dias = (ahora.getTime() - d.getTime()) / 86_400_000;
  if (dias > -1 && dias < 7) {
    // Algunos runtimes devuelven "jue." con punto; lo sacamos para que la
    // columna quede pareja.
    const dia = FMT_DIA_CORTO.format(d).replace(/\.$/, "");
    return `${dia} ${FMT_HORA.format(d)}`;
  }
  return FMT_FECHA_CORTA.format(d);
}

/** Fecha larga del header de cada mensaje abierto. */
export function fechaCompleta(iso: string): string {
  const d = parsear(iso);
  return d ? FMT_COMPLETA.format(d) : "";
}

/** Fecha corta para el header colapsado de un mensaje. */
export function fechaCorta(iso: string): string {
  const d = parsear(iso);
  if (!d) return "";
  return `${FMT_FECHA_CORTA.format(d)} ${FMT_HORA.format(d)}`;
}

export function fmtTamano(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toLocaleString("es-AR", { maximumFractionDigits: 0 })} KB`;
  }
  return `${(kb / 1024).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`;
}
