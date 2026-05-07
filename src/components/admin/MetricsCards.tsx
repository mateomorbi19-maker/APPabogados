// Server-renderable: solo lee props y formatea. Sin "use client".

import { fmtCosto, fmtNumber } from "@/lib/format";
import type { MetricasGlobales } from "@/lib/admin/types";

const CARD =
  "rounded-md border border-border bg-card px-3 py-2 flex flex-col gap-0.5";
const LABEL = "text-[10px] uppercase tracking-wider text-muted-foreground";
const VALUE = "font-mono text-lg leading-tight";

export function MetricsCards({ data }: { data: MetricasGlobales }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
      <div className={CARD}>
        <span className={LABEL}>Total ejecuciones</span>
        <span className={VALUE}>{fmtNumber(data.total_ejecuciones)}</span>
      </div>
      <div className={CARD}>
        <span className={LABEL}>Total tokens</span>
        <span className={VALUE}>{fmtNumber(data.total_tokens)}</span>
      </div>
      <div className={CARD}>
        <span className={LABEL}>Gasto total</span>
        <span className={VALUE}>{fmtCosto(data.total_gasto_usd)}</span>
      </div>
      <div className={CARD}>
        <span className={LABEL}>Tasa de éxito</span>
        <span className={VALUE}>
          {data.tasa_exito_pct.toFixed(1)}
          <span className="text-sm text-muted-foreground">%</span>
        </span>
      </div>
      <div className={CARD}>
        <span className={LABEL}>Tasa degradadas</span>
        <span className={VALUE}>
          {data.tasa_degradadas_pct.toFixed(1)}
          <span className="text-sm text-muted-foreground">%</span>
        </span>
      </div>
    </div>
  );
}
