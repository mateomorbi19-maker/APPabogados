"use client";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  TIPOS_EVENTO,
  TIPOS_EVENTO_VALUES,
  type CasoOption,
  type TipoEvento,
} from "@/lib/agenda/types";

export type Rango = "hoy" | "semana" | "mes" | "todo";
export type ClaseFiltro = "todos" | "tarea" | "evento";

// `tipos` = tipos que se MUESTRAN (todos tildados por default). Tildar/destildar
// agrega/quita. Lista vacía = no se muestra ningún tipo (lo maneja agenda-view).
export type FiltrosUI = {
  clase: ClaseFiltro;
  tipos: TipoEvento[];
  casoId: string | null;
  rango: Rango;
};

const RANGOS: { value: Rango; label: string }[] = [
  { value: "hoy", label: "Hoy" },
  { value: "semana", label: "Semana" },
  { value: "mes", label: "Mes" },
  { value: "todo", label: "Todo" },
];

const CLASES_FILTRO: { value: ClaseFiltro; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "tarea", label: "Tareas" },
  { value: "evento", label: "Eventos" },
];

// h-9 son 36px: abajo del piso táctil de 40px. `max-md:h-10` lo levanta solo en
// móvil y deja la densidad de escritorio intacta. (El zoom de iOS al enfocar el
// select ya lo resuelve el piso de 16px de globals.css, que aplica a todos los
// <select> nativos de la app.)
const SELECT_CLS =
  "h-9 max-md:h-10 w-full rounded-md border border-input bg-transparent text-foreground px-2 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20";
const TITULO_CLS =
  "text-xs font-medium uppercase tracking-wide text-muted-foreground";
const SECCION_CLS = "rounded-lg bg-secondary/40 p-3";

type Props = {
  filtros: FiltrosUI;
  casos: CasoOption[];
  onChange: (f: FiltrosUI) => void;
};

export function AgendaFilters({ filtros, casos, onChange }: Props) {
  // "Todos" = sin filtro de tipo (tipos vacío). Excluyente con los tipos
  // específicos: al tildar un tipo, tipos deja de estar vacío → "Todos" se
  // apaga. Al destildar el último, vuelve a [] → "Todos" se reactiva.
  const todosActivo = filtros.tipos.length === 0;

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
      {/* Mostrar: tareas / eventos / todos */}
      <div className={cn(SECCION_CLS, "space-y-2")}>
        <p className={TITULO_CLS}>Mostrar</p>
        <div className="grid grid-cols-3 gap-1.5">
          {CLASES_FILTRO.map((c) => {
            const active = filtros.clase === c.value;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => onChange({ ...filtros, clase: c.value })}
                className={cn(
                  // 28px de alto con el pulgar es una ruleta entre las tres
                  // pastillas; en móvil van a 40px.
                  "rounded-md px-2 py-1.5 text-xs transition-colors max-md:py-2.5",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tipo */}
      <div className={cn(SECCION_CLS, "space-y-2.5")}>
        <p className={TITULO_CLS}>Tipo</p>
        <div className="space-y-2">
          {/* py-1.5 en móvil: la fila del checkbox medía ~20px y las 8 filas
              de tipos quedaban a 28px de paso, imposible de acertar con el dedo. */}
          <label className="flex cursor-pointer items-center gap-2 text-sm max-md:py-1.5">
            <Checkbox
              checked={todosActivo}
              onCheckedChange={() => onChange({ ...filtros, tipos: [] })}
            />
            <span
              className="size-2 shrink-0 rounded-full bg-muted-foreground/30"
              aria-hidden
            />
            <span className={cn(!todosActivo && "text-muted-foreground")}>
              Todos
            </span>
          </label>
          {TIPOS_EVENTO_VALUES.map((t) => {
            const meta = TIPOS_EVENTO[t];
            const checked = filtros.tipos.includes(t);
            return (
              <label
                key={t}
                className="flex cursor-pointer items-center gap-2 text-sm max-md:py-1.5"
              >
                <Checkbox checked={checked} onCheckedChange={() => toggleTipo(t)} />
                <span
                  className={cn("size-2 shrink-0 rounded-full", meta.dot)}
                  aria-hidden
                />
                <span className={cn(!checked && "text-muted-foreground")}>
                  {meta.label}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Caso */}
      <div className={cn(SECCION_CLS, "space-y-2")}>
        <p className={TITULO_CLS}>Caso</p>
        <select
          value={filtros.casoId ?? ""}
          onChange={(e) =>
            onChange({ ...filtros, casoId: e.target.value || null })
          }
          className={SELECT_CLS}
          aria-label="Filtrar por caso"
        >
          <option value="">Todos los casos</option>
          {casos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.titulo}
            </option>
          ))}
        </select>
      </div>

      {/* Período */}
      <div className={cn(SECCION_CLS, "space-y-2")}>
        <p className={TITULO_CLS}>Período</p>
        <div className="grid grid-cols-2 gap-1.5">
          {RANGOS.map((r) => {
            const active = filtros.rango === r.value;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => onChange({ ...filtros, rango: r.value })}
                className={cn(
                  // py-1.5 daba pastillas de 28px de alto: con el pulgar se
                  // erra entre "Hoy" y "Semana". En móvil van a 40px.
                  "rounded-md px-2 py-1.5 text-xs transition-colors max-md:py-2.5",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:text-foreground hover:bg-muted",
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
