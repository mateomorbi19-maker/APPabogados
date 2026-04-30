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
      <div className="rounded-lg border border-border p-12 text-center">
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
      <div className="max-h-96 overflow-y-auto">
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
                {/* Usamos `ejecutado_en` (columna real de Postgres) y NO
                    `metadata.timestamp` — ese último es un string libre que
                    el modelo emite (a veces con fecha errada como "2025-01-14"
                    cuando el caso es de 2026). R9 de Fase 4. */}
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
