"use client";
// Los accesos a las tres herramientas de la causa, en una fila.
//
// Reemplazan tres tarjetas-link APILADAS que ocupaban ~330px verticales antes
// de que apareciera la ficha o el timeline. Cada una repetía dos renglones de
// descripción que se leen una vez en la vida.
//
// Son TRES y no cuatro como el mockup: ahí la cuarta es "Análisis de riesgo",
// que en esta app no existe. Una tarjeta que no lleva a ningún lado es peor
// que una fila de tres.
//
// En móvil se apilan a una columna: a 360px, tres cajas en fila dejan ~105px
// cada una y "Simulador de audiencias" entra en cuatro renglones.
//
// Ago 2026: pasan de tarjeta vertical (ícono / título / dos renglones de
// descripción, ~92px de alto) a fila horizontal con el ícono al costado y la
// descripción truncada a una línea. Son links, no contenido.

import Link from "next/link";
import { Sparkles, Network, Gavel } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Props = { casoId: string };

const ACCESOS: {
  href: (id: string) => string;
  icono: LucideIcon;
  label: string;
  sub: string;
  beta?: boolean;
}[] = [
  {
    href: (id) => `/dashboard/chat/${id}`,
    icono: Sparkles,
    label: "Chat con el agente",
    sub: "Con el análisis, la estrategia y el mapa a la vista",
  },
  {
    href: (id) => `/dashboard/mapa-procesal/${id}`,
    icono: Network,
    label: "Mapa procesal",
    sub: "Dónde está la causa y qué caminos quedan",
  },
  {
    href: (id) => `/dashboard/simulador/${id}`,
    icono: Gavel,
    label: "Simulador",
    sub: "Practicar la audiencia de prisión preventiva",
    beta: true,
  },
];

export function AccesosRapidos({ casoId }: Props) {
  return (
    <nav aria-label="Herramientas de la causa">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {ACCESOS.map((a) => {
          const Icono = a.icono;
          return (
            <li key={a.label}>
              <Link
                href={a.href(casoId)}
                title={a.sub}
                className="flex h-full items-center gap-3 rounded-xl border border-[var(--el-border)] bg-[var(--el-surface-card)] px-3.5 py-2.5 transition-colors hover:border-[var(--el-violet)] hover:bg-[var(--el-glass)]"
              >
                <Icono className="size-5 shrink-0 text-[var(--el-violet-light)]" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[var(--el-text)]">
                    {a.label}
                    {a.beta ? (
                      <span className="ml-2 align-middle rounded-md border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400">
                        Beta
                      </span>
                    ) : null}
                  </span>
                  {/* La descripción se lee una vez en la vida y ocupaba dos
                      renglones fijos en cada una de las tres tarjetas. Queda a
                      una línea truncada, y completa en el `title`. */}
                  <span className="block truncate text-xs leading-snug text-[var(--el-text-muted)]">
                    {a.sub}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
