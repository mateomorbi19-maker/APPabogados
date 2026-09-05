"use client";
import { useState } from "react";
import type { Caso, EventoCaso, ParteCaso } from "@/lib/types";
import type { EscritoGeneradoLista } from "@/lib/escritos/types";
import { HeaderCaso } from "./header-caso";
import { AnalisisOriginalColapsable } from "./analisis-original-colapsable";
import { TimelineProcesal } from "./timeline-procesal";
import { FichaCausa } from "./ficha/ficha-causa";
import { PartesCausa } from "./ficha/partes-causa";
import { AccesosRapidos } from "./ficha/accesos-rapidos";
import { EscritosCausa } from "./escritos/escritos-causa";

type Props = {
  caso: Caso;
  eventosIniciales: EventoCaso[];
  partesIniciales: ParteCaso[];
  escritosIniciales: EscritoGeneradoLista[];
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
//   partes → escritos → análisis original colapsable → timeline procesal.
//
// Los escritos van después de las partes y antes del análisis porque son
// trabajo del abogado sobre la causa (lo que va a presentar), no historia: el
// flujo entero —modelo, datos, redacción, PDF, presentación— vive en ese
// bloque, sin salir de la ficha (pedido textual de Gonzalo).
//
// La ficha va ANTES del análisis y del timeline porque es lo que identifica la
// causa: hasta ahora lo primero que se veía después del título eran tres
// tarjetas-link apiladas que ocupaban media pantalla.
export function DetalleCaso({
  caso: casoInicial,
  eventosIniciales,
  partesIniciales,
  escritosIniciales,
  etapa,
  mapaInicializado,
}: Props) {
  const [caso, setCaso] = useState<Caso>(casoInicial);
  const [eventos, setEventos] = useState<EventoCaso[]>(eventosIniciales);
  const [partes, setPartes] = useState<ParteCaso[]>(partesIniciales);
  const [escritos, setEscritos] =
    useState<EscritoGeneradoLista[]>(escritosIniciales);

  // Re-sembrar cuando el SERVER vuelve a mandar los datos. Pasa con el
  // `router.refresh()` que dispara el dock de LEXIE ante una mutación (ver
  // lexie-dock.tsx): la asistente puede editar la ficha, agregar un imputado o
  // generar un escrito con su ventana flotando sobre esta misma pantalla, y el
  // refresh re-ejecuta la page server-side pero React conserva el estado local
  // de este componente — sin esto, la ficha seguiría mostrando lo de antes.
  //
  // Se compara por identidad: un payload RSC nuevo trae objetos nuevos, y un
  // re-render por estado propio conserva las mismas referencias. Se ajusta
  // DURANTE EL RENDER, no en un efecto (patrón de "ajustar estado cuando
  // cambia una prop", ver ficha-form.tsx).
  const [origen, setOrigen] = useState({
    casoInicial,
    eventosIniciales,
    partesIniciales,
    escritosIniciales,
  });
  if (
    casoInicial !== origen.casoInicial ||
    eventosIniciales !== origen.eventosIniciales ||
    partesIniciales !== origen.partesIniciales ||
    escritosIniciales !== origen.escritosIniciales
  ) {
    setOrigen({ casoInicial, eventosIniciales, partesIniciales, escritosIniciales });
    setCaso(casoInicial);
    setEventos(eventosIniciales);
    setPartes(partesIniciales);
    setEscritos(escritosIniciales);
  }

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

      <EscritosCausa
        caso={caso}
        partes={partes}
        escritos={escritos}
        onEscritosChange={setEscritos}
        onEventoNuevo={(ev) => setEventos((prev) => [...prev, ev])}
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
