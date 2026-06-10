"use client";
import { cn } from "@/lib/utils";
import {
  TIPOS_EVENTO,
  TIPOS_EVENTO_VALUES,
  type CasoOption,
  type TipoEvento,
} from "@/lib/agenda/types";

export type Rango = "hoy" | "semana" | "mes" | "todo";

export type FiltrosUI = {
  tipos: TipoEvento[]; // vacío = todos los tipos
  casoId: string | null; // null = todos los casos
  rango: Rango;
};

const RANGOS: { value: Rango; label: string }[] = [
  { value: "hoy", label: "Hoy" },
  { value: "semana", label: "Esta semana" },
  { value: "mes", label: "Este mes" },
  { value: "todo", label: "Todo" },
];

const SELECT_CLS =
  "h-9 rounded-md border border-input bg-transparent text-foreground px-2 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20";

const CHIP_BASE =
  "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer";
const CHIP_INACTIVO =
  "border-border text-muted-foreground hover:text-foreground hover:bg-muted";

type Props = {
  filtros: FiltrosUI;
  casos: CasoOption[];
  onChange: (f: FiltrosUI) => void;
};

export function AgendaFilters({ filtros, casos, onChange }: Props) {
  const todosTipos = filtros.tipos.length === 0;

  const toggleTipo = (t: TipoEvento) => {
    const has = filtros.tipos.includes(t);
    onChange({
      ...filtros,
      tipos: has
        ? filtros.tipos.filter((x) => x !== t)
        : [...filtros.tipos, t],
    });
  };

  return (
    <div className="space-y-3">
      {/* Tipos (multi-select) */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange({ ...filtros, tipos: [] })}
          className={cn(
            CHIP_BASE,
            todosTipos
              ? "border-primary/30 bg-primary/15 text-primary"
              : CHIP_INACTIVO,
          )}
        >
          Todos
        </button>
        {TIPOS_EVENTO_VALUES.map((t) => {
          const active = filtros.tipos.includes(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleTipo(t)}
              className={cn(CHIP_BASE, active ? TIPOS_EVENTO[t].badge : CHIP_INACTIVO)}
            >
              {TIPOS_EVENTO[t].label}
            </button>
          );
        })}
      </div>

      {/* Caso + rango */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filtros.casoId ?? ""}
          onChange={(e) =>
            onChange({ ...filtros, casoId: e.target.value || null })
          }
          className={cn(SELECT_CLS, "max-w-[16rem]")}
          aria-label="Filtrar por caso"
        >
          <option value="">Todos los casos</option>
          {casos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.titulo}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          {RANGOS.map((r) => {
            const active = filtros.rango === r.value;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => onChange({ ...filtros, rango: r.value })}
                className={cn(
                  "px-2.5 py-1 text-xs rounded transition-colors",
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
