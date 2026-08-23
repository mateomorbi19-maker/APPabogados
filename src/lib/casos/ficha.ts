// Presentación de la ficha de causa: etiquetas y badges.
//
// Mismo criterio que rol.ts, y por el mismo motivo: los consumen la ficha, la
// lista lateral, el Inicio y el buscador, y el mismo color en los cuatro
// lugares es lo que hace que el dato se lea de un vistazo.
//
// Las clases van COMPLETAS y literales: Tailwind v4 escanea strings del código
// fuente, así que una clase construida en runtime (`bg-${x}-500/10`) no se
// genera nunca.
//
// Y van SIEMPRE en pares claro/oscuro (`text-X-800 dark:text-[#hex]`). El
// molde tentador para copiar acá era el del mapa procesal, que está lleno de
// literales tipo `text-emerald-300` — pero el mapa monta su propio `.dark`
// desde su layout y corre siempre en oscuro. La ficha vive en una pantalla
// que sigue el tema del usuario, y ese mismo verde sobre el fondo blanco del
// tema claro es ilegible.

import type {
  EstadoSeguimiento,
  RolParte,
  SituacionLibertad,
} from "@/lib/types";

// === Estado de seguimiento (el badge "En seguimiento" del mockup) ===
// NO es la etapa procesal. La etapa la deriva el mapa; esto es el estado de la
// causa para el estudio.

export const ESTADO_SEGUIMIENTO_LABEL: Record<EstadoSeguimiento, string> = {
  activa: "Activa",
  en_espera: "En espera",
  archivada: "Archivada",
};

export const ESTADO_SEGUIMIENTO_BADGE: Record<EstadoSeguimiento, string> = {
  activa:
    "bg-[rgba(16,185,129,0.22)] text-emerald-800 dark:text-[#A7F3D0] border-transparent",
  en_espera:
    "bg-[rgba(245,158,11,0.22)] text-amber-800 dark:text-[#FFE0A3] border-transparent",
  archivada:
    "bg-[rgba(113,113,122,0.22)] text-zinc-700 dark:text-zinc-300 border-transparent",
};

export const ESTADOS_SEGUIMIENTO: EstadoSeguimiento[] = [
  "activa",
  "en_espera",
  "archivada",
];

// === Rol procesal de una parte ===

export const ROL_PARTE_LABEL: Record<RolParte, string> = {
  imputado: "Imputado",
  victima: "Víctima",
  querellante: "Querellante",
  denunciante: "Denunciante",
  testigo: "Testigo",
  otro: "Otro",
};

export const ROL_PARTE_BADGE: Record<RolParte, string> = {
  imputado:
    "bg-[rgba(244,63,94,0.20)] text-rose-800 dark:text-[#FFC2CC] border-transparent",
  victima:
    "bg-[rgba(59,130,246,0.22)] text-blue-800 dark:text-[#A9CDFF] border-transparent",
  querellante:
    "bg-[rgba(245,158,11,0.22)] text-amber-800 dark:text-[#FFE0A3] border-transparent",
  denunciante:
    "bg-[rgba(139,92,246,0.22)] text-violet-800 dark:text-[#CDBEFF] border-transparent",
  testigo:
    "bg-[rgba(20,184,166,0.20)] text-teal-800 dark:text-[#9DE8DF] border-transparent",
  otro: "bg-[rgba(113,113,122,0.22)] text-zinc-700 dark:text-zinc-300 border-transparent",
};

export const ROLES_PARTE: RolParte[] = [
  "imputado",
  "victima",
  "querellante",
  "denunciante",
  "testigo",
  "otro",
];

// === Situación de libertad ===
// Solo aplica a imputados. El UI la ofrece siempre, pero la esconde del
// resumen cuando el rol no la vuelve significativa.

export const SITUACION_LIBERTAD_LABEL: Record<SituacionLibertad, string> = {
  libre: "En libertad",
  detenido: "Detenido",
  prision_preventiva: "Prisión preventiva",
  prision_domiciliaria: "Prisión domiciliaria",
  excarcelado: "Excarcelado",
};

// Detenido y prisión preventiva se marcan en rojo a propósito: es el dato que
// cambia la urgencia de todo lo demás en la causa.
export const SITUACION_LIBERTAD_BADGE: Record<SituacionLibertad, string> = {
  libre:
    "bg-[rgba(16,185,129,0.18)] text-emerald-800 dark:text-[#A7F3D0] border-transparent",
  detenido:
    "bg-[rgba(239,68,68,0.22)] text-red-800 dark:text-[#FFB4B4] border-transparent",
  prision_preventiva:
    "bg-[rgba(239,68,68,0.22)] text-red-800 dark:text-[#FFB4B4] border-transparent",
  prision_domiciliaria:
    "bg-[rgba(245,158,11,0.22)] text-amber-800 dark:text-[#FFE0A3] border-transparent",
  excarcelado:
    "bg-[rgba(16,185,129,0.18)] text-emerald-800 dark:text-[#A7F3D0] border-transparent",
};

export const SITUACIONES_LIBERTAD: SituacionLibertad[] = [
  "libre",
  "detenido",
  "prision_preventiva",
  "prision_domiciliaria",
  "excarcelado",
];

export function estadoSeguimientoLabel(e: string): string {
  return ESTADO_SEGUIMIENTO_LABEL[e as EstadoSeguimiento] ?? e;
}

export function rolParteLabel(r: string): string {
  return ROL_PARTE_LABEL[r as RolParte] ?? r;
}

export function situacionLibertadLabel(s: string): string {
  return SITUACION_LIBERTAD_LABEL[s as SituacionLibertad] ?? s;
}
