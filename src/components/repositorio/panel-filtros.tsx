"use client";
// Panel de filtros del repositorio. Todos los conteos vienen de las facetas de
// la API, que se calculan ignorando su propio filtro: con "CSJN" ya elegido los
// demás tribunales siguen mostrando su número y el abogado puede cambiar de
// idea sin resetear la búsqueda.

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COLECCIONES,
  COLECCIONES_VALUES,
  metaTribunal,
  type Coleccion,
  type Facetas,
} from "@/lib/repositorio/types";
import { normalizarTexto } from "@/lib/repositorio/texto";
import { fmtNumber } from "@/lib/format";
import { hayFiltros, type FiltrosRepo } from "./api";

type Props = {
  filtros: FiltrosRepo;
  /** null = todavía no llegó la primera respuesta. */
  facetas: Facetas | null;
  onChange: (parcial: Partial<FiltrosRepo>) => void;
  onLimpiar: () => void;
};

const TITULO_CLS =
  "text-[11px] font-medium uppercase tracking-wide text-[var(--el-text-muted)]";
const SECCION_CLS =
  "rounded-lg border border-[var(--el-border-soft)] bg-[var(--el-surface-card)]/60 p-3";

/** Fila seleccionable con conteo a la derecha. */
function Fila({
  label,
  cantidad,
  activo,
  onClick,
  dot,
  titulo,
}: {
  label: string;
  cantidad?: number;
  activo: boolean;
  onClick: () => void;
  /** Clase Tailwind completa del punto de color (colección). */
  dot?: string;
  titulo?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      title={titulo ?? label}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
        activo
          ? "bg-[var(--el-violet)]/18 text-[var(--el-text)]"
          : "text-[var(--el-text-soft)] hover:bg-white/5 hover:text-[var(--el-text)]",
      )}
    >
      {dot ? (
        <span className={cn("size-1.5 shrink-0 rounded-full", dot)} aria-hidden />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {cantidad !== undefined ? (
        <span className="shrink-0 tabular-nums text-[var(--el-text-muted)]">
          {fmtNumber(cantidad)}
        </span>
      ) : null}
    </button>
  );
}

export function PanelFiltros({
  filtros,
  facetas,
  onChange,
  onLimpiar,
}: Props) {
  const [qMateria, setQMateria] = useState("");

  const materias = useMemo(() => {
    if (!facetas) return [];
    const q = normalizarTexto(qMateria);
    if (q === "") return facetas.materias;
    return facetas.materias.filter((m) => normalizarTexto(m.label).includes(q));
  }, [facetas, qMateria]);

  // Una materia puede seguir elegida aunque no esté en las facetas visibles
  // (pasa si además hay una `q` que ningún documento de esa materia matchea).
  // Sin esto el chip activo desaparecería de la lista y no habría cómo sacarlo.
  const materiaFueraDeLista =
    filtros.materia !== null &&
    facetas !== null &&
    !facetas.materias.some((m) => m.valor === filtros.materia);

  const cantidadColeccion = (c: Coleccion): number | undefined =>
    facetas?.colecciones.find((x) => x.valor === c)?.cantidad;

  // Décadas presentes con los años concretos que caen adentro. El filtro real
  // de la API es el AÑO exacto: la década es sólo el agrupador que hace legible
  // una lista de años sueltos. Los dos conteos salen de la MISMA faceta, así que
  // ningún chip de año lleva a cero resultados y la suma de los años de una
  // década da el número que se muestra al lado del título de esa década.
  const decadas = useMemo(() => {
    if (!facetas) return [];
    const anios = facetas.anios.map((a) => Number(a.valor));
    return facetas.decadas.map((d) => ({
      ...d,
      anios: anios.filter(
        (a) => a >= Number(d.valor) && a <= Number(d.valor) + 9,
      ),
    }));
  }, [facetas]);

  return (
    <div className="space-y-3">
      {hayFiltros(filtros) ? (
        <button
          type="button"
          onClick={onLimpiar}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--el-violet-light)] hover:underline"
        >
          <X className="size-3" aria-hidden />
          Limpiar filtros
        </button>
      ) : null}

      {/* Colección */}
      <section className={cn(SECCION_CLS, "space-y-1.5")}>
        <h3 className={TITULO_CLS}>Biblioteca</h3>
        <div className="space-y-0.5">
          <Fila
            label="Todo"
            activo={filtros.coleccion === null}
            onClick={() => onChange({ coleccion: null })}
          />
          {COLECCIONES_VALUES.map((c) => (
            <Fila
              key={c}
              label={COLECCIONES[c].label}
              titulo={COLECCIONES[c].descripcion}
              dot={COLECCIONES[c].dot}
              cantidad={cantidadColeccion(c)}
              activo={filtros.coleccion === c}
              onClick={() =>
                onChange({ coleccion: filtros.coleccion === c ? null : c })
              }
            />
          ))}
        </div>
      </section>

      {/* Materia — 100 carpetas: buscable adentro del propio filtro */}
      <section className={cn(SECCION_CLS, "space-y-2")}>
        <h3 className={TITULO_CLS}>Materia</h3>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[var(--el-text-muted)]"
            aria-hidden
          />
          <input
            type="search"
            value={qMateria}
            onChange={(e) => setQMateria(e.target.value)}
            placeholder="Filtrar materias…"
            aria-label="Filtrar la lista de materias"
            className="h-8 w-full rounded-md border border-[var(--el-border-soft)] bg-transparent pr-2 pl-7 text-xs text-[var(--el-text)] outline-none placeholder:text-[var(--el-text-muted)] focus-visible:border-[var(--el-violet)]/60 focus-visible:ring-2 focus-visible:ring-[var(--el-violet)]/25"
          />
        </div>
        <div className="max-h-64 space-y-0.5 overflow-y-auto pr-0.5">
          <Fila
            label="Todas"
            activo={filtros.materia === null}
            onClick={() => onChange({ materia: null })}
          />
          {materiaFueraDeLista ? (
            <Fila
              label="Materia elegida (0 en esta búsqueda)"
              activo
              onClick={() => onChange({ materia: null })}
            />
          ) : null}
          {materias.map((m) => (
            <Fila
              key={m.valor}
              label={m.label}
              titulo={`${m.label} — ${COLECCIONES[m.coleccion].label}`}
              dot={COLECCIONES[m.coleccion].dot}
              cantidad={m.cantidad}
              activo={filtros.materia === m.valor}
              onClick={() =>
                onChange({
                  materia: filtros.materia === m.valor ? null : m.valor,
                })
              }
            />
          ))}
          {facetas !== null && materias.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-[var(--el-text-muted)]">
              Ninguna materia coincide con “{qMateria}”.
            </p>
          ) : null}
        </div>
      </section>

      {/* Tribunal — ordenado por jerarquía, no por cantidad */}
      {facetas === null || facetas.tribunales.length > 0 ? (
        <section className={cn(SECCION_CLS, "space-y-1.5")}>
          <h3 className={TITULO_CLS}>Tribunal</h3>
          <div className="max-h-56 space-y-0.5 overflow-y-auto pr-0.5">
            <Fila
              label="Todos"
              activo={filtros.tribunal === null}
              onClick={() => onChange({ tribunal: null })}
            />
            {(facetas?.tribunales ?? []).map((t) => (
              <Fila
                key={t.valor}
                label={t.label}
                titulo={metaTribunal(t.valor).label}
                cantidad={t.cantidad}
                activo={filtros.tribunal === t.valor}
                onClick={() =>
                  onChange({
                    tribunal: filtros.tribunal === t.valor ? null : t.valor,
                  })
                }
              />
            ))}
          </div>
          <p className="px-2 text-[11px] leading-tight text-[var(--el-text-muted)]">
            Sólo se detecta el tribunal cuando figura en el nombre del archivo.
          </p>
        </section>
      ) : null}

      {/* Época / año */}
      {decadas.length > 0 ? (
        <section className={cn(SECCION_CLS, "space-y-2")}>
          <h3 className={TITULO_CLS}>Época</h3>
          <div className="space-y-0.5">
            <Fila
              label="Cualquier año"
              activo={filtros.anio === null}
              onClick={() => onChange({ anio: null })}
            />
          </div>
          {decadas.map((d) => (
            <div key={d.valor} className="space-y-1">
              <p className="flex items-center gap-2 px-2 text-[11px] text-[var(--el-text-soft)]">
                <span className="min-w-0 flex-1 truncate">{d.label}</span>
                <span className="tabular-nums text-[var(--el-text-muted)]">
                  {fmtNumber(d.cantidad)}
                </span>
              </p>
              <div className="flex flex-wrap gap-1 px-2">
                {d.anios.map((a) => (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={filtros.anio === a}
                    onClick={() =>
                      onChange({ anio: filtros.anio === a ? null : a })
                    }
                    className={cn(
                      "rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums transition-colors",
                      filtros.anio === a
                        ? "border-[var(--el-violet)] bg-[var(--el-violet)]/20 text-[var(--el-text)]"
                        : "border-[var(--el-border-soft)] text-[var(--el-text-soft)] hover:border-[var(--el-violet)]/45 hover:text-[var(--el-text)]",
                    )}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {facetas && facetas.sin_anio > 0 ? (
            <p className="px-2 text-[11px] leading-tight text-[var(--el-text-muted)]">
              {fmtNumber(facetas.sin_anio)} documentos sin año detectado — quedan
              fuera al filtrar por época.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
