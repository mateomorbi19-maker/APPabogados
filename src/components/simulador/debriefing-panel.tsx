"use client";
// Informe de desempeño al cierre de la audiencia. Se renderiza al pie del
// transcript, como cierre natural de la sesión.
//
// Sin jurisprudencia por diseño: el corpus no tiene fallos y el guion prohíbe
// citarlos, así que el schema no tiene dónde alojarlos.

import { ClipboardCheck, Lightbulb, Scale, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Debriefing } from "@/lib/simulador/schemas";

// Verde / ámbar / rojo por tramos. Es una nota de práctica, no una
// calificación oficial: el color orienta de un vistazo.
function colorPuntaje(n: number): string {
  if (n >= 7) return "text-emerald-400";
  if (n >= 4) return "text-amber-400";
  return "text-rose-400";
}

function barraPuntaje(n: number): string {
  if (n >= 7) return "bg-emerald-500";
  if (n >= 4) return "bg-amber-500";
  return "bg-rose-500";
}

export function DebriefingPanel({ debriefing: d }: { debriefing: Debriefing }) {
  return (
    <section className="rounded-md border border-primary/30 bg-primary/5 px-4 py-4 space-y-5">
      <header className="flex items-center gap-2">
        <ClipboardCheck className="size-4 text-primary" />
        <h2 className="text-sm font-medium">Informe de la audiencia</h2>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Metrica label="Desempeño general" valor={d.puntuacion_general} />
        <Metrica label="Fidelidad a tu estrategia" valor={d.fidelidad_estrategia} />
      </div>

      {d.dimensiones.length > 0 ? (
        <div className="space-y-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Por dimensión
          </p>
          {d.dimensiones.map((dim, i) => (
            <div
              key={i}
              className="rounded-md border border-border bg-card/40 px-3 py-2.5 space-y-1.5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">{dim.nombre}</p>
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums shrink-0",
                    colorPuntaje(dim.puntaje),
                  )}
                >
                  {dim.puntaje.toFixed(1)}
                </span>
              </div>
              <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full", barraPuntaje(dim.puntaje))}
                  style={{ width: `${Math.max(0, Math.min(10, dim.puntaje)) * 10}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {dim.comentario}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="rounded-md border border-border bg-card/40 px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Scale className="size-3.5 text-muted-foreground" />
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Resultado probable
          </p>
        </div>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {d.resultado_probable}
        </p>
      </div>

      <Lista
        icono={<Target className="size-3.5 text-muted-foreground" />}
        titulo="Momentos clave"
        items={d.momentos_clave}
      />
      <Lista
        icono={<Lightbulb className="size-3.5 text-muted-foreground" />}
        titulo="Oportunidades perdidas"
        items={d.oportunidades_perdidas}
      />
      <Lista
        icono={<ClipboardCheck className="size-3.5 text-muted-foreground" />}
        titulo="Próximos pasos"
        items={d.proximos_pasos}
      />
    </section>
  );
}

function Metrica({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="rounded-md border border-border bg-card/40 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "text-2xl font-semibold tabular-nums mt-0.5",
          colorPuntaje(valor),
        )}
      >
        {valor.toFixed(1)}
        <span className="text-sm text-muted-foreground font-normal"> / 10</span>
      </p>
    </div>
  );
}

function Lista({
  icono,
  titulo,
  items,
}: {
  icono: React.ReactNode;
  titulo: string;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icono}
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {titulo}
        </p>
      </div>
      <ul className="text-sm space-y-1.5 list-disc pl-5 leading-relaxed">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
