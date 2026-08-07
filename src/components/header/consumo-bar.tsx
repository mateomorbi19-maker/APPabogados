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
      <Progress
        value={pct}
        className="flex-1 [&_[data-slot=progress-track]]:h-2 [&_[data-slot=progress-track]]:bg-[rgba(18,18,26,0.12)] dark:[&_[data-slot=progress-track]]:bg-[rgba(255,255,255,0.14)] [&_[data-slot=progress-indicator]]:bg-[var(--el-violet)]"
      />
      <span className="font-display text-xs text-[var(--el-text-soft)] whitespace-nowrap">
        {fmtNumber(tokens_usados_mes)}/{fmtNumber(limite_tokens_mensual)}
      </span>
    </div>
  );
}
