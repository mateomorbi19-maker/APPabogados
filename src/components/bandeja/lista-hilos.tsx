"use client";
// Panel izquierdo: la lista de hilos con sus tres estados (cargando / vacío /
// error) y el botón de paginado. El fetch lo hace bandeja-view; acá sólo se
// renderiza lo que llega.

import { Inbox, MailX, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Buzon, HiloResumen } from "@/lib/gmail/types";
import { BUZONES_LABEL } from "@/lib/gmail/types";
import { ItemHilo } from "./item-hilo";

export type EstadoLista =
  | { status: "loading" }
  | {
      status: "ready";
      hilos: HiloResumen[];
      nextPageToken: string | null;
      demo: boolean;
    }
  | { status: "error"; message: string };

type Props = {
  estado: EstadoLista;
  buzon: Buzon;
  busqueda: string;
  seleccionado: string | null;
  puedeModificar: boolean;
  cargandoMas: boolean;
  onAbrir: (h: HiloResumen) => void;
  onToggleDestacado: (h: HiloResumen) => void;
  onReintentar: () => void;
  onCargarMas: () => void;
  onRedactar: () => void;
  onLimpiarBusqueda: () => void;
};

function FilaSkeleton() {
  return (
    <div className="flex gap-2 px-3 py-2.5">
      <span className="w-2 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-32" />
          <div className="flex-1" />
          <Skeleton className="h-3 w-10" />
        </div>
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </div>
  );
}

export function ListaHilos({
  estado,
  buzon,
  busqueda,
  seleccionado,
  puedeModificar,
  cargandoMas,
  onAbrir,
  onToggleDestacado,
  onReintentar,
  onCargarMas,
  onRedactar,
  onLimpiarBusqueda,
}: Props) {
  if (estado.status === "loading") {
    return (
      <div
        aria-busy="true"
        aria-label="Cargando mensajes"
        className="flex-1 divide-y divide-[var(--el-border-soft)] overflow-y-auto"
      >
        {Array.from({ length: 7 }, (_, i) => (
          <FilaSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (estado.status === "error") {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <div className="rounded-xl border border-[rgba(248,113,113,0.35)] bg-[rgba(248,113,113,0.08)] p-4">
          <p className="text-sm font-medium text-[#fca5a5]">
            No se pudieron cargar los mensajes
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--el-text-soft)]">
            {estado.message}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={onReintentar}
          >
            <RefreshCw className="size-3.5" /> Reintentar
          </Button>
        </div>
      </div>
    );
  }

  if (estado.hilos.length === 0) {
    const buscando = busqueda.trim().length > 0;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-6 text-center">
        {buscando ? (
          <Search className="size-8 text-[var(--el-text-muted)]" />
        ) : (
          <MailX className="size-8 text-[var(--el-text-muted)]" />
        )}
        <p className="text-sm text-[var(--el-text-soft)]">
          {buscando
            ? `Ningún mensaje coincide con “${busqueda.trim()}”.`
            : `No hay mensajes en ${BUZONES_LABEL[buzon]}.`}
        </p>
        {buscando ? (
          <Button variant="outline" size="sm" onClick={onLimpiarBusqueda}>
            Limpiar la búsqueda
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={onRedactar}>
            <Inbox className="size-3.5" /> Redactar un mensaje
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <ul
        role="list"
        className="divide-y divide-[var(--el-border-soft)]"
        aria-label={`Mensajes en ${BUZONES_LABEL[buzon]}`}
      >
        {estado.hilos.map((h) => (
          <ItemHilo
            key={h.id}
            hilo={h}
            seleccionado={h.id === seleccionado}
            demo={estado.demo}
            puedeModificar={puedeModificar}
            onAbrir={onAbrir}
            onToggleDestacado={onToggleDestacado}
          />
        ))}
      </ul>

      {estado.nextPageToken ? (
        <div className="p-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={cargandoMas}
            onClick={onCargarMas}
          >
            {cargandoMas ? "Cargando…" : "Cargar más"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
