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
  /** `true` si el caso ya tiene nodos de mapa procesal: congela el fuero. */
  mapaInicializado: boolean;
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
  mapaInicializado,
}: Props) {
  const [caso, setCaso] = useState<Caso>(casoInicial);
  const [eventos, setEventos] = useState<EventoCaso[]>(eventosIniciales);
  const [partes, setPartes] = useState<ParteCaso[]>(partesIniciales);

  // El movimiento más reciente del expediente. Es lo que muestra la ficha como
  // "última actuación", en vez de `casos.actualizado_en`: esa columna la pisa
  // un trigger en CADA update, así que editar la ficha diría "actualizado hoy"
  // con el expediente quieto hace tres meses.
  //
  // Solo los eventos `sucedido`. Los `pendiente` son cosas AGENDADAS —una
  // audiencia del mes que viene, un vencimiento— y su `ocurrido_en` está en el
  // futuro: sin este filtro, cargar una audiencia para diciembre hacía que la
  // ficha dijera que la última actuación de la causa fue en diciembre.
  const sucedidos = eventos.filter((e) => e.estado === "sucedido");
  const ultimaActuacion =
    sucedidos.length > 0
      ? sucedidos.reduce(
          (max, e) => (e.ocurrido_en > max ? e.ocurrido_en : max),
          sucedidos[0].ocurrido_en,
        )
      : null;

  return (
    <div className="space-y-4">
      <HeaderCaso caso={caso} etapa={etapa} />

      <AccesosRapidos casoId={caso.id} />

      <FichaCausa
        caso={caso}
        etapa={etapa}
        ultimaActuacion={ultimaActuacion}
        mapaInicializado={mapaInicializado}
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
