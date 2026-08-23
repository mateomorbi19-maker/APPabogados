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
      {/* Acá el scroll horizontal se MANTIENE a propósito: son 8 columnas de
          debug que se leen comparando hacia abajo (tokens / costo / búsquedas
          fila contra fila), y en tarjetas se pierde justo eso. Lo que se
          arregla es la densidad: con `py-1.5` las filas medían ~28px y la fila
          entera es el único disparador del drill-down, así que en un dedo se
          abría la ejecución equivocada. El `min-w-[640px]` evita que las
          columnas se compriman a min-content (el scroll se vuelve predecible)
          y la columna Fecha queda fija al deslizar, que es con lo que se
          identifica la fila. */}
      <div className="rounded-md border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/40 max-md:bg-muted">
              <tr>
                <Th sticky>Fecha</Th>
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
                    <Td sticky className="font-mono text-xs whitespace-nowrap">
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
        <p className="md:hidden border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          Deslizá la tabla para ver tokens, costo y búsquedas.
        </p>
      </div>
      <EjecucionDrillDown
        ejecucion={seleccionada}
        onClose={() => setSeleccionada(null)}
      />
    </>
  );
}

// `sticky` fija la celda a la izquierda mientras se desliza la tabla en
// móvil. El fondo tiene que ser OPACO o el contenido de las otras columnas se
// ve pasar por debajo; por eso el thead pasa de bg-muted/40 a bg-muted abajo
// de md.
const STICKY_TH = "max-md:sticky max-md:left-0 max-md:z-20 max-md:bg-muted";
// bg-background y no bg-card: el contenedor de la tabla no pinta fondo, así
// que lo que se ve detrás de las filas es el fondo de la página.
const STICKY_TD = "max-md:sticky max-md:left-0 max-md:z-10 max-md:bg-background";

function Th({
  children,
  align = "left",
  sticky = false,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  sticky?: boolean;
}) {
  return (
    <th
      className={`px-3 py-2 text-${align} font-medium text-[10px] uppercase tracking-wider text-muted-foreground ${sticky ? STICKY_TH : ""}`}
    >
      {children}
    </th>
  );
}

// py-3 en móvil = filas de ~44px, arriba del piso táctil de 40px. Desde md
// vuelve a la densidad de escritorio (py-1.5), que es donde el panel se usa
// para escanear muchas filas de una.
function Td({
  children,
  align = "left",
  className,
  sticky = false,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  sticky?: boolean;
}) {
  return (
    <td
      className={`px-3 py-3 md:py-1.5 text-${align} ${sticky ? STICKY_TD : ""} ${className ?? ""}`}
    >
      {children}
    </td>
  );
}
