"use client";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/admin/Badge";
import { EjecucionDrillDown } from "@/components/admin/EjecucionDrillDown";
import { fmtCosto, fmtFecha, fmtModelo, fmtNumber } from "@/lib/format";
import type { EjecucionAdmin, EstadoEjecucion } from "@/lib/admin/types";

const ESTADO_VARIANT: Record<
  EstadoEjecucion,
  { variant: "ok" | "warning" | "error"; label: string }
> = {
  ok: { variant: "ok", label: "OK" },
  degradada: { variant: "warning", label: "Degradada" },
  error: { variant: "error", label: "Error" },
};

export function EjecucionesTable({
  ejecuciones,
}: {
  ejecuciones: EjecucionAdmin[];
}) {
  const [seleccionada, setSeleccionada] = useState<EjecucionAdmin | null>(null);

  if (ejecuciones.length === 0) {
    return (
      <div className="rounded-md border border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No hay ejecuciones que coincidan con los filtros aplicados.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <Th>Fecha</Th>
                <Th>Usuario</Th>
                <Th>Estado</Th>
                <Th align="right">Tokens</Th>
                <Th align="right">Costo</Th>
                <Th align="right">Búsq.</Th>
                <Th>Modelo</Th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ejecuciones.map((e) => {
                const est = ESTADO_VARIANT[e.estado];
                return (
                  <tr
                    key={e.id}
                    onClick={() => setSeleccionada(e)}
                    className="cursor-pointer hover:bg-muted/30 transition-colors"
                  >
                    <Td className="font-mono text-xs whitespace-nowrap">
                      {fmtFecha(e.ejecutado_en)}
                    </Td>
                    <Td className="whitespace-nowrap">{e.usuario_nombre}</Td>
                    <Td>
                      <Badge variant={est.variant}>{est.label}</Badge>
                    </Td>
                    <Td align="right" className="font-mono whitespace-nowrap">
                      {fmtNumber(e.total_tokens)}
                    </Td>
                    <Td align="right" className="font-mono whitespace-nowrap">
                      {fmtCosto(e.costo_usd)}
                    </Td>
                    <Td align="right" className="font-mono whitespace-nowrap">
                      {e.cantidad_busquedas}
                    </Td>
                    <Td className="text-muted-foreground whitespace-nowrap">
                      {fmtModelo(e.modelo)}
                    </Td>
                    <td className="px-2 text-right text-muted-foreground">
                      <ChevronRight className="size-4 inline" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <EjecucionDrillDown
        ejecucion={seleccionada}
        onClose={() => setSeleccionada(null)}
      />
    </>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-3 py-2 text-${align} font-medium text-[10px] uppercase tracking-wider text-muted-foreground`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td className={`px-3 py-1.5 text-${align} ${className ?? ""}`}>
      {children}
    </td>
  );
}
