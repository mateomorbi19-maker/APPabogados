// Presentación del rol de una causa (defensor / querellante / ambos).
// Vive acá y no dentro de un componente porque lo consumen el dashboard de
// inicio, el buscador global y la lista de casos — el mismo color en los tres
// lugares es lo que hace que el rol se lea de un vistazo.
//
// Las clases de Tailwind van COMPLETAS y literales a propósito: Tailwind v4
// detecta clases escaneando strings del código fuente, así que una construida
// en runtime (`bg-${x}-500/10`) no se generaría nunca.

export const ROL_LABEL: Record<string, string> = {
  defensor: "Defensor",
  querellante: "Querellante",
  ambos: "Ambos",
};

export const ROL_BADGE: Record<string, string> = {
  defensor:
    "bg-[rgba(59,130,246,0.22)] text-blue-800 dark:text-[#A9CDFF] border-transparent",
  querellante:
    "bg-[rgba(245,158,11,0.22)] text-amber-800 dark:text-[#FFE0A3] border-transparent",
  ambos:
    "bg-[rgba(139,92,246,0.22)] text-violet-800 dark:text-[#CDBEFF] border-transparent",
};

const BADGE_FALLBACK =
  "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/20";

export function rolLabel(rol: string): string {
  return ROL_LABEL[rol] ?? rol;
}

export function rolBadge(rol: string): string {
  return ROL_BADGE[rol] ?? BADGE_FALLBACK;
}
