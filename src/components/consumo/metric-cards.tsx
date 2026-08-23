"use client";
import { Card } from "@/components/ui/card";
import type { ConsumoSummary } from "@/lib/hooks/use-consumo";
import { fmtCosto, fmtNumber } from "@/lib/format";

// Dos columnas desde 0px. Con `grid-cols-1 sm:grid-cols-2` las 4 tarjetas se
// apilaban enteras a 360px: ~106px cada una (p-5 + número text-3xl) + gaps =
// ~472px, así que el historial arrancaba recién a los ~540px, debajo del fold
// en cualquier teléfono. Cuatro números de una línea no justifican una
// pantalla entera. De md para arriba queda todo como estaba.
export function MetricCards({ data }: { data: ConsumoSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
      <Card className="p-3 md:p-5">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">
          Tokens usados
        </p>
        <p className="font-serif text-2xl md:text-3xl mt-2">
          {fmtNumber(data.tokens_usados_mes)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">este mes</p>
      </Card>
      <Card className="p-3 md:p-5">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">
          Gasto
        </p>
        <p className="font-serif text-2xl md:text-3xl mt-2">
          {fmtCosto(data.gasto_usd_mes)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">este mes</p>
      </Card>
      <Card className="p-3 md:p-5">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">
          Ejecuciones
        </p>
        <p className="font-serif text-2xl md:text-3xl mt-2">
          {fmtNumber(data.ejecuciones_mes)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">este mes</p>
      </Card>
      <Card className="p-3 md:p-5">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">
          Tokens restantes
        </p>
        <p className="font-serif text-2xl md:text-3xl mt-2">
          {fmtNumber(data.tokens_restantes)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          de {fmtNumber(data.limite_tokens_mensual)} disponibles
        </p>
      </Card>
    </div>
  );
}
