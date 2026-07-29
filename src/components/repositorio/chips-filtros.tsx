"use client";
// Chips de los filtros activos, arriba de los resultados. Duplica lo que ya
// está marcado en el panel a propósito: en mobile el panel está colapsado y
// esta fila es la única señal de por qué se está viendo lo que se ve.

import { X } from "lucide-react";
import { MATERIAS } from "@/lib/repositorio/catalogo-materias";
import { COLECCIONES, metaTribunal } from "@/lib/repositorio/types";
import type { FiltrosRepo } from "./api";

// El slug de materia lleva prefijo de colección, así que el índice es global.
const LABEL_MATERIA = new Map(MATERIAS.map((m) => [m.slug, m.label]));

type Chip = { clave: string; texto: string; quitar: Partial<FiltrosRepo> };

function chips(f: FiltrosRepo): Chip[] {
  const out: Chip[] = [];
  if (f.q.trim() !== "") {
    out.push({ clave: "q", texto: `“${f.q.trim()}”`, quitar: { q: "" } });
  }
  if (f.coleccion) {
    out.push({
      clave: "coleccion",
      texto: COLECCIONES[f.coleccion].label,
      quitar: { coleccion: null },
    });
  }
  if (f.materia) {
    out.push({
      clave: "materia",
      texto: LABEL_MATERIA.get(f.materia) ?? f.materia,
      quitar: { materia: null },
    });
  }
  if (f.tribunal) {
    out.push({
      clave: "tribunal",
      texto: metaTribunal(f.tribunal).corto,
      quitar: { tribunal: null },
    });
  }
  if (f.anio !== null) {
    out.push({ clave: "anio", texto: String(f.anio), quitar: { anio: null } });
  }
  return out;
}

export function ChipsFiltros({
  filtros,
  onChange,
  onLimpiar,
}: {
  filtros: FiltrosRepo;
  onChange: (parcial: Partial<FiltrosRepo>) => void;
  onLimpiar: () => void;
}) {
  const activos = chips(filtros);
  if (activos.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {activos.map((c) => (
        <button
          key={c.clave}
          type="button"
          onClick={() => onChange(c.quitar)}
          aria-label={`Quitar filtro ${c.texto}`}
          className="inline-flex max-w-[18rem] items-center gap-1.5 rounded-full border border-[var(--el-violet)]/40 bg-[var(--el-violet)]/12 py-0.5 pr-1.5 pl-2.5 text-xs text-[var(--el-text)] transition-colors hover:border-[var(--el-violet)] hover:bg-[var(--el-violet)]/20"
        >
          <span className="truncate">{c.texto}</span>
          <X className="size-3 shrink-0 text-[var(--el-text-soft)]" aria-hidden />
        </button>
      ))}
      {activos.length > 1 ? (
        <button
          type="button"
          onClick={onLimpiar}
          className="px-1 text-xs text-[var(--el-text-muted)] hover:text-[var(--el-text)] hover:underline"
        >
          Limpiar todo
        </button>
      ) : null}
    </div>
  );
}
