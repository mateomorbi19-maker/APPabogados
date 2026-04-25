"use client";
import { Progress } from "@/components/ui/progress";
import { useConsumo } from "@/lib/hooks/use-consumo";
import { fmtNumber } from "@/lib/format";

export function ConsumoBar() {
  const { state } = useConsumo();

  if (state.status === "loading") {
    return (
      <div className="hidden md:flex items-center gap-2 min-w-0">
        <span className="text-xs text-muted-foreground">Cargando consumo…</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        className="hidden md:flex items-center gap-2 min-w-0"
        title={state.message}
      >
        <span className="text-xs text-destructive">Consumo no disponible</span>
      </div>
    );
  }

  const { tokens_usados_mes, limite_tokens_mensual } = state.data.consumo;
  const pct =
    limite_tokens_mensual > 0
      ? Math.min(100, (tokens_usados_mes / limite_tokens_mensual) * 100)
      : 0;

  return (
    <div className="hidden md:flex items-center gap-3 min-w-0 w-64">
      <Progress value={pct} className="h-2 flex-1" />
      <span className="text-xs text-muted-foreground whitespace-nowrap font-mono">
        {fmtNumber(tokens_usados_mes)}/{fmtNumber(limite_tokens_mensual)}
      </span>
    </div>
  );
}
