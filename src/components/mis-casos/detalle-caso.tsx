"use client";
import { useState } from "react";
import type { Caso, EventoCaso } from "@/lib/types";
import { HeaderCaso } from "./header-caso";
import { SeccionCasoOriginal } from "./seccion-caso-original";
import { SeccionEstrategiaElegida } from "./seccion-estrategia-elegida";

type Props = {
  caso: Caso;
  eventosIniciales: EventoCaso[];
};

// Orquestador del detalle del caso. Mantiene el estado local de los eventos
// (para que agregar/borrar eventos en FASE 5B se vea reflejado sin refetch
// completo del caso). Por ahora solo expone el array; los modales y el
// timeline llegan en 5B.
export function DetalleCaso({ caso, eventosIniciales }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_eventos, _setEventos] = useState<EventoCaso[]>(eventosIniciales);

  return (
    <div className="space-y-6">
      <HeaderCaso caso={caso} />
      <SeccionCasoOriginal caso={caso} />
      <SeccionEstrategiaElegida caso={caso} />
      {/* FASE 5B: <TimelineProcesal eventos={eventos} casoId={caso.id} ... /> */}
      {/* FASE 5B: <PlaceholderAgenteSugerido /> */}
    </div>
  );
}
