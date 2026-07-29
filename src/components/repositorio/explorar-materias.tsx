"use client";
// Vista "Explorar": la biblioteca abierta por temas, para el abogado que no
// llega con una búsqueda armada. Se pinta desde MATERIAS (módulo chico e
// importable desde el cliente), sin esperar a la API.

import {
  DOCUMENTOS_POR_COLECCION,
  MATERIAS,
} from "@/lib/repositorio/catalogo-materias";
import {
  COLECCIONES,
  COLECCIONES_VALUES,
  type Coleccion,
} from "@/lib/repositorio/types";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ICONO_COLECCION } from "./iconos";

// Agrupado y ordenado una sola vez: MATERIAS es un módulo constante.
const POR_COLECCION: Record<Coleccion, typeof MATERIAS> = {
  jurisprudencia: MATERIAS.filter((m) => m.coleccion === "jurisprudencia").sort(
    (a, b) => b.cantidad - a.cantidad || a.label.localeCompare(b.label, "es"),
  ),
  doctrina: MATERIAS.filter((m) => m.coleccion === "doctrina").sort(
    (a, b) => b.cantidad - a.cantidad || a.label.localeCompare(b.label, "es"),
  ),
};

export function ExplorarMaterias({
  onElegir,
}: {
  onElegir: (slug: string, coleccion: Coleccion) => void;
}) {
  return (
    <div className="space-y-8">
      {COLECCIONES_VALUES.map((c) => {
        const meta = COLECCIONES[c];
        const Icono = ICONO_COLECCION[c];
        const materias = POR_COLECCION[c];
        // Documentos únicos, NO la suma de las materias: los que están en varias
        // carpetas de Drive cuentan una vez por materia y esa suma daría más que
        // el total del header de la sección.
        const total = DOCUMENTOS_POR_COLECCION[c];

        return (
          <section key={c} className="space-y-3">
            <header className="space-y-1">
              <h2 className="flex flex-wrap items-center gap-2 font-display text-lg font-semibold text-[var(--el-text)]">
                <Icono className={cn("size-[18px]", meta.text)} aria-hidden />
                {meta.label}
                <span className="text-xs font-normal text-[var(--el-text-muted)]">
                  {fmtNumber(materias.length)} temas ·{" "}
                  {fmtNumber(total)} documentos
                </span>
              </h2>
              {/* La explicación va acá, a la vista: el dueño del producto no
                  tiene por qué saber qué distingue jurisprudencia de doctrina. */}
              <p className="max-w-3xl text-sm leading-relaxed text-[var(--el-text-soft)]">
                {meta.descripcion} {meta.para_que}
              </p>
            </header>

            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {materias.map((m) => (
                <li key={m.slug}>
                  <button
                    type="button"
                    onClick={() => onElegir(m.slug, c)}
                    className="flex w-full items-center gap-2 rounded-lg border border-[var(--el-border-soft)] bg-[var(--el-surface-card)]/60 px-3 py-2.5 text-left transition-colors hover:border-[var(--el-violet)]/45 hover:bg-[var(--el-surface-card)]"
                  >
                    <span
                      className={cn("size-1.5 shrink-0 rounded-full", meta.dot)}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--el-text)]">
                      {m.label}
                    </span>
                    <span className="shrink-0 rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] tabular-nums text-[var(--el-text-muted)]">
                      {fmtNumber(m.cantidad)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
