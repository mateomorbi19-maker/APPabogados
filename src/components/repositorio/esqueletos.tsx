// Skeletons de la grilla de resultados y del lector. Un esqueleto con la forma
// de la card evita el salto de layout que produce un spinner centrado.

import { Skeleton } from "@/components/ui/skeleton";

export function EsqueletoCards({ cantidad = 6 }: { cantidad?: number }) {
  return (
    <div
      className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
      aria-hidden
    >
      {Array.from({ length: cantidad }, (_, i) => (
        <div
          key={i}
          className="flex h-full flex-col gap-2.5 rounded-xl border border-[var(--el-border-soft)] bg-[var(--el-surface-card)]/50 p-4"
        >
          <Skeleton className="h-5 w-28 rounded-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-1/2" />
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-20 rounded-md" />
            <Skeleton className="h-5 w-16 rounded-md" />
          </div>
          <div className="mt-1 flex gap-2">
            <Skeleton className="h-7 flex-1 rounded-lg" />
            <Skeleton className="h-7 w-28 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EsqueletoLector() {
  return (
    <div className="space-y-3" aria-hidden>
      {/* dvh y no vh: vh mide contra el viewport grande de iOS, así que el
          esqueleto se pasaba de largo y saltaba al montar el visor. En móvil
          además queda chico a propósito: ahí no se monta el iframe sino la
          tarjeta para abrir el PDF en el visor del teléfono. */}
      <Skeleton className="h-[70dvh] min-h-[420px] w-full rounded-xl max-md:h-52 max-md:min-h-0" />
    </div>
  );
}
