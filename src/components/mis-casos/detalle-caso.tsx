"use client";
import { useState } from "react";
import type { Caso, EventoCaso, ParteCaso } from "@/lib/types";
import { HeaderCaso } from "./header-caso";
import { AnalisisOriginalColapsable } from "./analisis-original-colapsable";
import { TimelineProcesal } from "./timeline-procesal";
import { FichaCausa } from "./ficha/ficha-causa";
import { PartesCausa } from "./ficha/partes-causa";
import { AccesosRapidos } from "./ficha/accesos-rapidos";

type Props = {
  caso: Caso;
  eventosIniciales: EventoCaso[];
  partesIniciales: ParteCaso[];
  /** Etapa procesal derivada del mapa en el server. */
  etapa: { label: string; nodoTitulo: string } | null;
};

// Orquestador del detalle del caso. Mantiene state local de eventos y de
// partes para que agregar/borrar se vea reflejado sin refetch completo, y del
// caso porque editar la ficha cambia el header y la ficha a la vez.
//
// Orden de la pantalla, de arriba abajo:
//   header (nombre + badges) → accesos a las tres herramientas → ficha →
//   partes → análisis original colapsable → timeline procesal.
//
// La ficha va ANTES del análisis y del timeline porque es lo que identifica la
// causa: hasta ahora lo primero que se veía después del título eran tres
// tarjetas-link apiladas que ocupaban media pantalla.
export function DetalleCaso({
  caso: casoInicial,
  eventosIniciales,
  partesIniciales,
  etapa,
}: Props) {
  const [caso, setCaso] = useState<Caso>(casoInicial);
  const [eventos, setEventos] = useState<EventoCaso[]>(eventosIniciales);
  const [partes, setPartes] = useState<ParteCaso[]>(partesIniciales);

  // El movimiento más reciente del expediente. Es lo que muestra la ficha como
  // "última actuación", en vez de `casos.actualizado_en`: esa columna la pisa
  // un trigger en CADA update, así que editar la ficha diría "actualizado hoy"
  // con el expediente quieto hace tres meses.
  const ultimaActuacion =
    eventos.length > 0
      ? eventos.reduce(
          (max, e) => (e.ocurrido_en > max ? e.ocurrido_en : max),
          eventos[0].ocurrido_en,
        )
      : null;

  return (
    <div className="space-y-6">
      <HeaderCaso caso={caso} etapa={etapa} />

      <AccesosRapidos casoId={caso.id} />

      <FichaCausa
        caso={caso}
        etapa={etapa}
        ultimaActuacion={ultimaActuacion}
        onCasoChange={setCaso}
      />

      <PartesCausa
        casoId={caso.id}
        partes={partes}
        onPartesChange={setPartes}
      />

      <AnalisisOriginalColapsable caso={caso} />

      <TimelineProcesal
        casoId={caso.id}
        eventos={eventos}
        setEventos={setEventos}
      />
    </div>
  );
}
