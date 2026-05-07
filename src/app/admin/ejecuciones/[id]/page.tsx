// Vista alternativa al drill-down lateral: misma data, full-width, deep
// linkeable. La query y la auth pasan por el mismo path que el panel
// principal. Usamos el mismo componente cliente EjecucionDrillDown pero
// embebido dentro de la página (sin Sheet wrapper).

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { getEjecucionDetalle } from "@/lib/admin/queries";
import { Badge } from "@/components/admin/Badge";
import { fmtCosto, fmtFecha, fmtModelo, fmtNumber } from "@/lib/format";

const ESTADO_LABEL = {
  ok: { variant: "ok" as const, label: "OK" },
  degradada: { variant: "warning" as const, label: "Degradada" },
  error: { variant: "error" as const, label: "Error" },
};

const uuidSchema = z.string().uuid();

export default async function AdminEjecucionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();

  // El layout `/admin/layout.tsx` ya verificó admin.
  const ejecucion = await getEjecucionDetalle(id);
  if (!ejecucion) notFound();

  const meta = (ejecucion.metadata ?? {}) as Record<string, unknown>;
  const estado = ESTADO_LABEL[ejecucion.estado];

  return (
    <div className="space-y-3">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Volver al listado
      </Link>

      <header className="rounded-md border border-border bg-card/50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <code className="font-mono text-sm">{ejecucion.id}</code>
          <Badge variant={estado.variant}>{estado.label}</Badge>
          <span className="text-sm text-muted-foreground">
            {ejecucion.usuario_nombre} · {fmtFecha(ejecucion.ejecutado_en)} ·{" "}
            {fmtModelo(ejecucion.modelo)} · tipo: {ejecucion.tipo}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <Stat label="Tokens" value={fmtNumber(ejecucion.total_tokens)} />
          <Stat label="Costo" value={fmtCosto(ejecucion.costo_usd)} />
          <Stat
            label="Latencia"
            value={`${fmtNumber(ejecucion.latencia_ms)} ms`}
          />
          <Stat label="Búsquedas" value={String(ejecucion.cantidad_busquedas)} />
        </div>
      </header>

      <details
        open
        className="rounded-md border border-border bg-card/30 px-4 py-3"
      >
        <summary className="cursor-pointer select-none text-xs font-medium">
          Metadata completa (JSON)
        </summary>
        <pre className="mt-2 text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all max-h-[60vh] overflow-y-auto">
          {JSON.stringify(meta, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
