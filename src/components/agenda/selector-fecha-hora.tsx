"use client";
import { useEffect, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  X,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  ahoraPartesAR,
  DOW_LUNES,
  fmtDuracion,
  fmtFechaBoton,
  fmtHora,
  gridMes,
  isoAPartesAR,
  MESES_LARGO,
  partesAIsoAR,
  partesAMin,
  SLOTS_HORA,
  sumarDias,
  sumarMinutos,
  type PartesFecha,
} from "@/lib/agenda/tz-ar";

// Selector de fecha/hora propio (reemplaza los <input datetime-local> nativos).
// Trabaja siempre en hora de pared de Argentina (UTC-3 fijo, ver tz-ar.ts) y
// expone valores como ISO con offset -03:00, que es lo que el schema espera.
// Calcado a un mockup aprobado: calendario mensual (lunes primero, ES), dropdown
// de horas cada 15', "mantener duración" tipo Google Calendar y duración
// relativa en el dropdown del fin.

export type ValorFechaHora = {
  inicioIso: string;
  finIso: string | null;
  todoElDia: boolean;
};

const TRIGGER_CLS =
  "inline-flex h-9 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-xs outline-none transition-colors hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-50";
const POPUP_CLS =
  "z-50 rounded-lg border border-[var(--el-border)] bg-popover p-2 text-popover-foreground shadow-xl outline-none";

const VIOLETA = "var(--el-violet-light)"; // #a78bfa — día/franja seleccionados

// Normaliza la hora a 00:00 cuando es "todo el día".
function aTodoElDia(p: PartesFecha, todoElDia: boolean): PartesFecha {
  return todoElDia ? { ...p, h: 0, mi: 0 } : p;
}

// ===========================================================================
// Calendario (popover con grilla mensual navegable + atajos Hoy/Mañana)
// ===========================================================================
function SelectorFecha({
  valor,
  onPick,
  disabled,
  ariaLabel,
}: {
  valor: PartesFecha;
  onPick: (y: number, mo: number, d: number) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [visY, setVisY] = useState(valor.y);
  const [visMo, setVisMo] = useState(valor.mo);

  const celdas = gridMes(visY, visMo);
  const hoy = ahoraPartesAR();

  const irMes = (delta: number) => {
    const m = visMo + delta;
    const y = visY + Math.floor(m / 12);
    setVisMo(((m % 12) + 12) % 12);
    setVisY(y);
  };

  const elegir = (y: number, mo: number, d: number) => {
    onPick(y, mo, d);
    setOpen(false);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // Al abrir, posicionar el mes visible sobre el valor actual (en el
        // handler, NO en un effect → evita set-state-in-effect).
        if (o) {
          setVisY(valor.y);
          setVisMo(valor.mo);
        }
      }}
    >
      <Popover.Trigger
        className={TRIGGER_CLS}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        <CalendarDays className="size-4 text-muted-foreground" />
        {fmtFechaBoton(valor)}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="isolate z-50">
          <Popover.Popup className={cn(POPUP_CLS, "w-[17.5rem]")}>
            <div className="mb-1 flex items-center justify-between px-1">
              <button
                type="button"
                onClick={() => irMes(-1)}
                className="grid size-7 place-items-center rounded-md hover:bg-accent"
                aria-label="Mes anterior"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-sm font-medium">
                {MESES_LARGO[visMo].charAt(0).toUpperCase() + MESES_LARGO[visMo].slice(1)} {visY}
              </span>
              <button
                type="button"
                onClick={() => irMes(1)}
                className="grid size-7 place-items-center rounded-md hover:bg-accent"
                aria-label="Mes siguiente"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 px-1 text-center text-[11px] text-muted-foreground">
              {DOW_LUNES.map((d) => (
                <span key={d} className="py-1">
                  {d}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5 p-1">
              {celdas.map((c) => {
                const sel =
                  c.y === valor.y && c.mo === valor.mo && c.d === valor.d;
                const esHoy = c.y === hoy.y && c.mo === hoy.mo && c.d === hoy.d;
                return (
                  <button
                    key={`${c.y}-${c.mo}-${c.d}`}
                    type="button"
                    onClick={() => elegir(c.y, c.mo, c.d)}
                    className={cn(
                      "grid size-8 place-items-center rounded-md text-sm tabular-nums transition-colors",
                      c.otroMes ? "text-muted-foreground/50" : "text-foreground",
                      !sel && "hover:bg-accent",
                      esHoy && !sel && "ring-1 ring-[var(--el-violet-light)]/50",
                    )}
                    style={
                      sel
                        ? { background: VIOLETA, color: "#1a1024", fontWeight: 600 }
                        : undefined
                    }
                  >
                    {c.d}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-1.5 px-1 pt-1">
              <button
                type="button"
                onClick={() => elegir(hoy.y, hoy.mo, hoy.d)}
                className="flex-1 rounded-md border border-[var(--el-border)] py-1 text-xs hover:bg-accent"
              >
                Hoy
              </button>
              <button
                type="button"
                onClick={() => {
                  const m = sumarDias(hoy, 1);
                  elegir(m.y, m.mo, m.d);
                }}
                className="flex-1 rounded-md border border-[var(--el-border)] py-1 text-xs hover:bg-accent"
              >
                Mañana
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ===========================================================================
// Hora (popover con franjas cada 15', scroll a la seleccionada, duración rel.)
// ===========================================================================
function SelectorHora({
  h,
  mi,
  onPick,
  disabled,
  ariaLabel,
  duracionDeSlot,
}: {
  h: number;
  mi: number;
  onPick: (h: number, mi: number) => void;
  disabled?: boolean;
  ariaLabel: string;
  // Para el fin: minutos de duración desde el inicio si se eligiera este slot.
  duracionDeSlot?: (h: number, mi: number) => number;
}) {
  const [open, setOpen] = useState(false);
  const selRef = useRef<HTMLButtonElement | null>(null);
  // Índice de la franja a la que scrollear: la más cercana a la hora actual
  // (redondeada a 15'), tolerando horas no alineadas a la grilla.
  const idxScroll = Math.min(95, Math.max(0, Math.round((h * 60 + mi) / 15)));

  // Scroll a la franja seleccionada al abrir. Solo efecto DOM (sin setState).
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      selRef.current?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={TRIGGER_CLS}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        <Clock className="size-4 text-muted-foreground" />
        {fmtHora(h, mi)}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="isolate z-50">
          <Popover.Popup className={cn(POPUP_CLS, "max-h-64 w-40 overflow-y-auto p-1")}>
            {SLOTS_HORA.map((s, i) => {
              const sel = s.h === h && s.mi === mi;
              // Si la hora actual no cae justo en una franja de 15' (ej. 14:07 de
              // un evento de Google), igual scrolleamos a la franja MÁS CERCANA
              // sin tocar el valor: el resaltado se reserva a la coincidencia
              // exacta, así no mentimos sobre la hora guardada.
              const esObjetivoScroll = i === idxScroll;
              const dur = duracionDeSlot?.(s.h, s.mi);
              return (
                <button
                  key={`${s.h}-${s.mi}`}
                  ref={esObjetivoScroll ? selRef : undefined}
                  type="button"
                  onClick={() => {
                    onPick(s.h, s.mi);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm tabular-nums transition-colors",
                    !sel && "hover:bg-accent",
                  )}
                  style={
                    sel ? { background: VIOLETA, color: "#1a1024", fontWeight: 600 } : undefined
                  }
                >
                  <span>{fmtHora(s.h, s.mi)}</span>
                  {dur !== undefined && dur > 0 ? (
                    <span
                      className={cn(
                        "text-xs",
                        sel ? "text-[#1a1024]/70" : "text-muted-foreground",
                      )}
                    >
                      +{fmtDuracion(dur)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ===========================================================================
// Orquestador
// ===========================================================================
type Props = {
  value: ValorFechaHora;
  onChange: (v: ValorFechaHora) => void;
  disabled?: boolean;
};

export function SelectorFechaHora({ value, onChange, disabled }: Props) {
  const { todoElDia } = value;
  const inicio = isoAPartesAR(value.inicioIso);
  const fin = value.finIso ? isoAPartesAR(value.finIso) : null;

  const emit = (
    nInicio: PartesFecha,
    nFin: PartesFecha | null,
    nTodo: boolean,
  ) => {
    onChange({
      inicioIso: partesAIsoAR(aTodoElDia(nInicio, nTodo)),
      finIso: nFin ? partesAIsoAR(aTodoElDia(nFin, nTodo)) : null,
      todoElDia: nTodo,
    });
  };

  // Cambiar inicio: mantener la duración desplazando el fin (cita con fin).
  const cambiarInicio = (nInicio: PartesFecha) => {
    if (!todoElDia && fin) {
      const delta = partesAMin(nInicio) - partesAMin(inicio);
      emit(nInicio, sumarMinutos(fin, delta), todoElDia);
    } else {
      emit(nInicio, fin, todoElDia);
    }
  };

  const toggleTodoElDia = (v: boolean) => {
    if (v) {
      emit(inicio, fin, true);
      return;
    }
    // Volver a "cita": si venía de todo-el-día (00:00), poner una hora razonable.
    const ni =
      inicio.h === 0 && inicio.mi === 0 ? { ...inicio, h: 9, mi: 0 } : inicio;
    let nf = fin;
    if (fin && fin.h === 0 && fin.mi === 0) {
      const mismoDia =
        fin.y === inicio.y && fin.mo === inicio.mo && fin.d === inicio.d;
      // Multi-día: conservar la FECHA del fin (solo poner hora). Mismo día:
      // default inicio + 1 h.
      nf = mismoDia ? sumarMinutos(ni, 60) : { ...fin, h: 10, mi: 0 };
    }
    emit(ni, nf, false);
  };

  // Duración inicio→fin para el indicador del label.
  const durMin = fin ? partesAMin(fin) - partesAMin(inicio) : null;

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={todoElDia}
          onCheckedChange={(v) => toggleTodoElDia(v === true)}
          disabled={disabled}
        />
        Todo el día
      </label>

      {/* Inicio */}
      <div className="space-y-1.5">
        <span className="text-sm text-muted-foreground">Inicio</span>
        <div className="flex flex-wrap gap-2">
          <SelectorFecha
            valor={inicio}
            disabled={disabled}
            ariaLabel="Fecha de inicio"
            onPick={(y, mo, d) => cambiarInicio({ ...inicio, y, mo, d })}
          />
          {!todoElDia ? (
            <SelectorHora
              h={inicio.h}
              mi={inicio.mi}
              disabled={disabled}
              ariaLabel="Hora de inicio"
              onPick={(h, mi) => cambiarInicio({ ...inicio, h, mi })}
            />
          ) : null}
        </div>
      </div>

      {/* Fin */}
      <div className="space-y-1.5">
        <span className="text-sm text-muted-foreground">
          Fin (opcional)
          {fin && durMin !== null ? (
            durMin < 0 ? (
              <span className="text-destructive"> · el fin es anterior</span>
            ) : (
              <span> · {fmtDuracion(durMin)}</span>
            )
          ) : null}
        </span>

        {fin ? (
          <div className="flex flex-wrap items-center gap-2">
            <SelectorFecha
              valor={fin}
              disabled={disabled}
              ariaLabel="Fecha de fin"
              onPick={(y, mo, d) => emit(inicio, { ...fin, y, mo, d }, todoElDia)}
            />
            {!todoElDia ? (
              <SelectorHora
                h={fin.h}
                mi={fin.mi}
                disabled={disabled}
                ariaLabel="Hora de fin"
                onPick={(h, mi) => emit(inicio, { ...fin, h, mi }, todoElDia)}
                duracionDeSlot={(h, mi) =>
                  partesAMin({ ...fin, h, mi }) - partesAMin(inicio)
                }
              />
            ) : null}
            <button
              type="button"
              onClick={() => emit(inicio, null, todoElDia)}
              disabled={disabled}
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              aria-label="Quitar fin"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() =>
              emit(
                inicio,
                todoElDia ? { ...inicio } : sumarMinutos(inicio, 60),
                todoElDia,
              )
            }
            disabled={disabled}
            className="rounded-md border border-dashed border-[var(--el-border)] px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            + Agregar fin
          </button>
        )}
      </div>
    </div>
  );
}
