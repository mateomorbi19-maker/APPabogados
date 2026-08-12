"use client";
import { useMemo } from "react";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useConsumo } from "@/lib/hooks/use-consumo";
import {
  fmtNumber,
  fmtPorcentaje,
  fmtRenovacionCorta,
  fmtRenovacionLarga,
} from "@/lib/format";
import { cn } from "@/lib/utils";

// Medidor de créditos del header.
//
// Antes mostraba el contador crudo ("24.591/1.000.000"), que no le dice nada a
// nadie: un abogado no tiene cómo saber si 24.591 tokens es mucho o poco. Ahora
// la información primaria es la PROPORCIÓN (barra con color por umbral) y el
// ANCLA TEMPORAL (cuándo se renueva). Los números absolutos siguen estando,
// pero en el tooltip, que es donde importan cuando alguien va a buscarlos.

type Umbral = { barra: string; texto: string };

// Verde mientras sobra, ámbar cuando conviene mirarlo, rojo cuando el cupo está
// por cortarle un análisis a mitad de camino.
//
// Las clases del indicador van con el selector de descendiente COMPLETO y
// literal. Dos razones: Tailwind v4 detecta clases escaneando strings, así que
// una armada por interpolación nunca se generaría; y el selector compuesto le
// gana en especificidad al `bg-primary` que el primitivo trae de fábrica.
const UMBRALES: Array<{ hasta: number; estilo: Umbral }> = [
  {
    hasta: 60,
    estilo: {
      barra:
        "[&_[data-slot=progress-indicator]]:bg-emerald-600 dark:[&_[data-slot=progress-indicator]]:bg-emerald-500",
      texto: "text-[var(--el-text-soft)]",
    },
  },
  {
    hasta: 85,
    estilo: {
      barra:
        "[&_[data-slot=progress-indicator]]:bg-amber-500 dark:[&_[data-slot=progress-indicator]]:bg-amber-400",
      texto: "text-amber-700 dark:text-amber-300",
    },
  },
  {
    hasta: Infinity,
    estilo: {
      barra:
        "[&_[data-slot=progress-indicator]]:bg-rose-600 dark:[&_[data-slot=progress-indicator]]:bg-rose-500",
      texto: "text-rose-700 dark:text-rose-300",
    },
  },
];

function estiloDe(pct: number): Umbral {
  // El array está ordenado por umbral creciente y el último es Infinity, así
  // que siempre hay match; el `??` es sólo para que TypeScript lo sepa.
  return (UMBRALES.find((u) => pct < u.hasta) ?? UMBRALES[UMBRALES.length - 1])
    .estilo;
}

export function ConsumoBar() {
  const { state } = useConsumo();

  // Las fechas de renovación no cambian dentro de una sesión de trabajo, así
  // que no vale la pena recalcularlas en cada render del provider.
  const renovacion = useMemo(
    () => ({ corta: fmtRenovacionCorta(), larga: fmtRenovacionLarga() }),
    [],
  );

  if (state.status === "loading") {
    return (
      <div className="hidden min-w-0 items-center gap-2 md:flex">
        <span className="text-xs text-muted-foreground">Cargando consumo…</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        className="hidden min-w-0 items-center gap-2 md:flex"
        title={state.message}
      >
        <span className="text-xs text-destructive">Consumo no disponible</span>
      </div>
    );
  }

  const { tokens_usados_mes, limite_tokens_mensual, ejecuciones_mes } =
    state.data.consumo;
  const pctReal =
    limite_tokens_mensual > 0
      ? (tokens_usados_mes / limite_tokens_mensual) * 100
      : 0;
  // La barra se topea en 100 (no puede pasarse del track); el texto muestra el
  // valor real, porque si alguien está en 103 % quiere enterarse.
  const pctBarra = Math.min(100, pctReal);
  const estilo = estiloDe(pctReal);

  return (
    <TooltipProvider>
      <Tooltip>
        {/* Botón y no div: el tooltip también tiene que abrirse con foco de
            teclado, y un div suelto no es alcanzable con Tab. No navega a
            ningún lado — el detalle completo vive en "Mi consumo". */}
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Detalle del cupo mensual"
              className="hidden w-64 min-w-0 cursor-default items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--el-violet)]/50 md:flex"
            />
          }
        >
          <Progress
            value={pctBarra}
            className={cn(
              "flex-1 [&_[data-slot=progress-track]]:h-2 [&_[data-slot=progress-track]]:bg-[rgba(18,18,26,0.12)] dark:[&_[data-slot=progress-track]]:bg-[rgba(255,255,255,0.14)]",
              estilo.barra,
            )}
          />
          <span
            className={cn(
              "whitespace-nowrap font-display text-xs",
              estilo.texto,
            )}
          >
            {fmtPorcentaje(pctReal)} % · renueva {renovacion.corta}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            Usaste el {fmtPorcentaje(pctReal)} % de tu cupo este mes. Se renueva
            el {renovacion.larga}.
          </p>
          <p className="mt-1.5 text-[var(--el-text-muted)]">
            {fmtNumber(tokens_usados_mes)} de {fmtNumber(limite_tokens_mensual)}{" "}
            tokens · {fmtNumber(ejecuciones_mes)}{" "}
            {ejecuciones_mes === 1 ? "consulta" : "consultas"}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
