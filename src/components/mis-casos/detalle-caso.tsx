"use client";
import { useState } from "react";
import type { Caso, EventoCaso } from "@/lib/types";
import { HeaderCaso } from "./header-caso";
import { AnalisisOriginalColapsable } from "./analisis-original-colapsable";
import { TimelineProcesal } from "./timeline-procesal";
import { PlaceholderAgenteSugerido } from "./placeholder-agente-sugerido";

type Props = {
  caso: Caso;
  eventosIniciales: EventoCaso[];
};

// Orquestador del detalle del caso. Mantiene el state local de eventos
// para que agregar/borrar se vea reflejado sin refetch completo del caso.
//
// Layout: header → análisis original colapsable (cerrado por default) →
// timeline → placeholder de consulta al agente (PR3 lo reemplaza con
// el flujo real).
export function DetalleCaso({ caso, eventosIniciales }: Props) {
  const [eventos, setEventos] = useState<EventoCaso[]>(eventosIniciales);

  return (
    <div className="space-y-6">
      <HeaderCaso caso={caso} />
      <AnalisisOriginalColapsable caso={caso} />
      <TimelineProcesal
        casoId={caso.id}
        eventos={eventos}
        setEventos={setEventos}
      />
      <PlaceholderAgenteSugerido />
    </div>
  );
}
