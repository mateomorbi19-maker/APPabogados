// Zona horaria de Argentina: UTC-3 FIJO (sin horario de verano). Manejamos la
// "hora de pared" de Argentina de forma EXPLÍCITA, independiente de la TZ del
// navegador del usuario: todas las conversiones usan getters/Date.UTC, nunca los
// métodos locales del browser. Sirve para el selector de fecha/hora del form.
//
// Contrato con el schema: serializamos a ISO con offset "-03:00", que es lo que
// z.string().datetime({ offset: true }) acepta. Al leer un timestamp guardado
// (cualquier offset) lo convertimos a hora de pared ART para poblar el selector.

export const AR_OFFSET = "-03:00";
const AR_OFFSET_MS = 3 * 60 * 60 * 1000; // Argentina = UTC menos 3 horas

// Partes de "hora de pared" ART. `mo` es 0-based (0 = enero), como en Date.
export type PartesFecha = {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
};

const p2 = (n: number) => String(n).padStart(2, "0");

// ISO (cualquier offset) -> partes de hora de pared ART. Tomamos el instante
// absoluto, le restamos 3h y leemos sus campos UTC: eso ES el wall clock ART.
export function isoAPartesAR(iso: string): PartesFecha {
  const art = new Date(new Date(iso).getTime() - AR_OFFSET_MS);
  return {
    y: art.getUTCFullYear(),
    mo: art.getUTCMonth(),
    d: art.getUTCDate(),
    h: art.getUTCHours(),
    mi: art.getUTCMinutes(),
  };
}

// Partes ART -> ISO con offset -03:00 (formato que espera el schema).
export function partesAIsoAR(p: PartesFecha): string {
  return `${p.y}-${p2(p.mo + 1)}-${p2(p.d)}T${p2(p.h)}:${p2(p.mi)}:00${AR_OFFSET}`;
}

export function ahoraPartesAR(): PartesFecha {
  return isoAPartesAR(new Date().toISOString());
}

// Minutos absolutos de un wall clock ART (para diffs y desplazamientos). Como no
// hay DST, tratar las partes como UTC da una diferencia de minutos exacta.
export function partesAMin(p: PartesFecha): number {
  return Math.floor(Date.UTC(p.y, p.mo, p.d, p.h, p.mi) / 60000);
}

// Suma `n` días a unas partes, conservando la hora.
export function sumarDias(p: PartesFecha, n: number): PartesFecha {
  const dt = new Date(Date.UTC(p.y, p.mo, p.d + n, p.h, p.mi));
  return {
    y: dt.getUTCFullYear(),
    mo: dt.getUTCMonth(),
    d: dt.getUTCDate(),
    h: dt.getUTCHours(),
    mi: dt.getUTCMinutes(),
  };
}

// Suma `min` minutos a unas partes (para el desplazamiento del fin).
export function sumarMinutos(p: PartesFecha, min: number): PartesFecha {
  const dt = new Date(Date.UTC(p.y, p.mo, p.d, p.h, p.mi) + min * 60000);
  return {
    y: dt.getUTCFullYear(),
    mo: dt.getUTCMonth(),
    d: dt.getUTCDate(),
    h: dt.getUTCHours(),
    mi: dt.getUTCMinutes(),
  };
}

// === Formato en español argentino ===

export const DIAS_ABBR = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"]; // getUTCDay 0=dom
export const MESES_ABBR = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];
export const MESES_LARGO = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
// Encabezados del calendario, semana arrancando en LUNES.
export const DOW_LUNES = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

// Día de semana (0=dom..6=sáb) de unas partes.
export function dowDe(p: { y: number; mo: number; d: number }): number {
  return new Date(Date.UTC(p.y, p.mo, p.d)).getUTCDay();
}

// "sáb 27 jun"
export function fmtFechaBoton(p: PartesFecha): string {
  return `${DIAS_ABBR[dowDe(p)]} ${p.d} ${MESES_ABBR[p.mo]}`;
}

// "14:30"
export function fmtHora(h: number, mi: number): string {
  return `${p2(h)}:${p2(mi)}`;
}

// Duración legible: "30 min", "1 h", "1 h 30 min". Se asume min >= 0.
export function fmtDuracion(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

// === Calendario ===

export type CeldaCalendario = {
  y: number;
  mo: number;
  d: number;
  otroMes: boolean;
};

// Grilla de 6 semanas (42 celdas) del mes, con LUNES como primer día. Incluye
// días del mes anterior/siguiente para rellenar (marcados con otroMes=true).
export function gridMes(y: number, mo: number): CeldaCalendario[] {
  const dowPrimero = new Date(Date.UTC(y, mo, 1)).getUTCDay(); // 0=dom
  const offset = (dowPrimero + 6) % 7; // posición lunes-first del día 1
  const inicio = Date.UTC(y, mo, 1 - offset);
  const celdas: CeldaCalendario[] = [];
  for (let i = 0; i < 42; i++) {
    const dt = new Date(inicio + i * 86400000);
    celdas.push({
      y: dt.getUTCFullYear(),
      mo: dt.getUTCMonth(),
      d: dt.getUTCDate(),
      otroMes: dt.getUTCMonth() !== mo,
    });
  }
  return celdas;
}

// Franjas cada 15 minutos: 00:00 .. 23:45 (96 slots).
export const SLOTS_HORA: ReadonlyArray<{ h: number; mi: number }> = Array.from(
  { length: 96 },
  (_, i) => ({ h: Math.floor(i / 4), mi: (i % 4) * 15 }),
);
