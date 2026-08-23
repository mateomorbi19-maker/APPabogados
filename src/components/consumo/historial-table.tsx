"use client";
import { ChevronRight } from "lucide-react";
import type { EjecucionRow } from "@/lib/hooks/use-consumo";
import {
  fmtCosto,
  fmtFecha,
  fmtModelo,
  fmtNumber,
  fmtTipo,
} from "@/lib/format";

type Props = {
  rows: EjecucionRow[];
  onSeleccionar: (e: EjecucionRow) => void;
};

export function HistorialTable({ rows, onSeleccionar }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border p-8 md:p-12 text-center">
        <p className="text-muted-foreground">
          Todavía no tenés ejecuciones este mes.
        </p>
        <p className="text-sm text-muted-foreground/70 mt-1">
          Cuando hagas un análisis va a aparecer acá.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Móvil: tarjetas, no tabla. Las 5 columnas con whitespace-nowrap daban
          ~550px de min-content contra 328px útiles a 360px de viewport, y
          Costo —la columna que el abogado mira— quedaba fuera de pantalla
          detrás de un swipe lateral escondido DENTRO de un scroller vertical.
          Son 5 campos de una ejecución propia que se leen de un vistazo: no
          hay comparación columna-a-columna que preservar (para eso está el
          panel admin). Sin max-h acá tampoco, así no se anidan dos scrolls:
          son 20 filas como máximo. */}
      <ul className="md:hidden divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onSeleccionar(r)}
              className="flex w-full min-h-11 flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/40"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{fmtTipo(r.tipo)}</span>
                <span className="shrink-0 font-mono text-sm">
                  {fmtCosto(r.costo_usd)}
                </span>
              </span>
              {/* Usamos `ejecutado_en` (columna real de Postgres) y NO
                  `metadata.timestamp` — ese último es un string libre que
                  el modelo emite (a veces con fecha errada como "2025-01-14"
                  cuando el caso es de 2026). R9 de Fase 4. */}
              <span className="text-xs text-muted-foreground">
                {fmtFecha(r.ejecutado_en)} · {fmtModelo(r.modelo)} ·{" "}
                {fmtNumber(r.total_tokens)} tokens
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="hidden md:block md:max-h-96 md:overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted sticky top-0 z-10">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-xs uppercase text-muted-foreground tracking-wider">
                Fecha
              </th>
              <th className="px-4 py-2 text-left font-medium text-xs uppercase text-muted-foreground tracking-wider">
                Tipo
              </th>
              <th className="px-4 py-2 text-left font-medium text-xs uppercase text-muted-foreground tracking-wider">
                Modelo
              </th>
              <th className="px-4 py-2 text-right font-medium text-xs uppercase text-muted-foreground tracking-wider">
                Tokens
              </th>
              <th className="px-4 py-2 text-right font-medium text-xs uppercase text-muted-foreground tracking-wider">
                Costo
              </th>
              <th
                className="w-8"
                aria-hidden="true"
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => onSeleccionar(r)}
                className="cursor-pointer hover:bg-muted/40 transition-colors"
              >
                <td className="px-4 py-2 whitespace-nowrap font-mono text-xs">
                  {fmtFecha(r.ejecutado_en)}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {fmtTipo(r.tipo)}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                  {fmtModelo(r.modelo)}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-right font-mono">
                  {fmtNumber(r.total_tokens)}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-right font-mono">
                  {fmtCosto(r.costo_usd)}
                </td>
                <td className="px-2 py-2 text-right text-muted-foreground">
                  <ChevronRight className="size-4 inline" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
