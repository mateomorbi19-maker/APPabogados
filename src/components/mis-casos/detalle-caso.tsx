"use client";
import { useState } from "react";
import Link from "next/link";
import { Sparkles, ArrowRight, Network } from "lucide-react";
import type { Caso, EventoCaso } from "@/lib/types";
import { HeaderCaso } from "./header-caso";
import { AnalisisOriginalColapsable } from "./analisis-original-colapsable";
import { TimelineProcesal } from "./timeline-procesal";

type Props = {
  caso: Caso;
  eventosIniciales: EventoCaso[];
};

// Orquestador del detalle del caso. Mantiene state local de eventos
// para que agregar/borrar se vea reflejado sin refetch completo.
//
// Layout: header → análisis original colapsable → CTA "Abrir chat con
// el agente" (link a /chat) → timeline procesal puro.
//
// El chat con el agente vive en su propia sub-ruta (PR4 sub-PR2):
// experiencia separada, persistente, con history. El timeline es
// expediente puro: solo eventos manuales del proceso real.
export function DetalleCaso({ caso, eventosIniciales }: Props) {
  const [eventos, setEventos] = useState<EventoCaso[]>(eventosIniciales);

  return (
    <div className="space-y-6">
      <HeaderCaso caso={caso} />
      <AnalisisOriginalColapsable caso={caso} />

      <Link
        href={`/dashboard/mis-casos/${caso.id}/chat`}
        className="block rounded-md border border-primary/30 bg-primary/5 px-4 py-3 hover:bg-primary/10 transition-colors group"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <Sparkles className="size-4 text-primary mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Chat con el agente</p>
              <p className="text-xs text-muted-foreground">
                Conversación continua con contexto del caso. El agente tiene
                acceso al análisis original, la estrategia elegida y todo el
                historial del timeline.
              </p>
            </div>
          </div>
          <span className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-primary group-hover:translate-x-0.5 transition-transform">
            Abrir chat
            <ArrowRight className="size-4" />
          </span>
        </div>
      </Link>

      <Link
        href={`/dashboard/mapa-procesal/${caso.id}`}
        className="block rounded-md border border-border bg-card px-4 py-3 hover:bg-muted/50 transition-colors group"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <Network className="size-4 text-primary mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Mapa procesal</p>
              <p className="text-xs text-muted-foreground">
                Árbol visual de la progresión del caso y los caminos procesales
                posibles. Agregá, marcá y ramificá etapas.
              </p>
            </div>
          </div>
          <span className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-primary group-hover:translate-x-0.5 transition-transform">
            Abrir mapa
            <ArrowRight className="size-4" />
          </span>
        </div>
      </Link>

      <TimelineProcesal
        casoId={caso.id}
        eventos={eventos}
        setEventos={setEventos}
      />
    </div>
  );
}
