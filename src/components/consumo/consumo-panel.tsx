"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useConsumo, type EjecucionRow } from "@/lib/hooks/use-consumo";
import { MetricCards } from "./metric-cards";
import { HistorialTable } from "./historial-table";
import { HistorialDetalle } from "./historial-detalle";

export function ConsumoPanel() {
  const { state, revalidate } = useConsumo();
  const isLoading = state.status === "loading";
  const [seleccionada, setSeleccionada] = useState<EjecucionRow | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-serif text-3xl">Mi consumo</h2>
          {state.status === "ready" && state.data.historial.length > 0 ? (
            <p className="text-sm text-muted-foreground mt-1">
              {state.data.historial.length}{" "}
              {state.data.historial.length === 1 ? "ejecución" : "ejecuciones"}{" "}
              este mes
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void revalidate();
          }}
          disabled={isLoading}
        >
          <RefreshCw className={isLoading ? "animate-spin" : ""} />
          Actualizar
        </Button>
      </div>

      {state.status === "loading" ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </>
      ) : null}

      {state.status === "error" ? (
        <Card className="p-6 border-destructive">
          <p className="text-destructive font-medium mb-1">
            Error consultando consumo
          </p>
          <p className="text-sm text-muted-foreground mb-4">{state.message}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void revalidate();
            }}
          >
            Reintentar
          </Button>
        </Card>
      ) : null}

      {state.status === "ready" ? (
        <>
          <MetricCards data={state.data.consumo} />
          <HistorialTable
            rows={state.data.historial}
            onSeleccionar={setSeleccionada}
          />
        </>
      ) : null}

      <HistorialDetalle
        ejecucion={seleccionada}
        onOpenChange={(open) => {
          if (!open) setSeleccionada(null);
        }}
      />
    </div>
  );
}
