"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Caso, EventoCaso } from "@/lib/types";
import { HeaderCaso } from "./header-caso";
import { AnalisisOriginalColapsable } from "./analisis-original-colapsable";
import { TimelineProcesal } from "./timeline-procesal";
import { ConsultarAgenteSheet } from "./consultar-agente-sheet";

type Props = {
  caso: Caso;
  eventosIniciales: EventoCaso[];
};

// Orquestador del detalle del caso. Mantiene el state local de eventos
// para que agregar/borrar/consultar se vea reflejado sin refetch
// completo del caso.
//
// Layout: header → análisis original colapsable (cerrado por default)
// → CTA "Consultar al agente" (botón primary destacado) → timeline.
//
// El placeholder estático "Próximo paso sugerido por el agente" del
// PR2 se removió en este PR3 — la consulta continua al agente lo
// reemplaza con un flujo real.
export function DetalleCaso({ caso, eventosIniciales }: Props) {
  const [eventos, setEventos] = useState<EventoCaso[]>(eventosIniciales);
  const [consultarOpen, setConsultarOpen] = useState(false);

  // Inserta consulta + respuesta en orden cronológico al state local.
  // Lo hacemos como una sola actualización para evitar dos re-renders.
  const onConsultaCompletada = (
    eventoConsulta: EventoCaso,
    eventoRespuesta: EventoCaso,
  ) => {
    setEventos((prev) => {
      const next = [...prev];
      for (const ev of [eventoConsulta, eventoRespuesta]) {
        const i = next.findIndex(
          (e) => new Date(e.ocurrido_en) > new Date(ev.ocurrido_en),
        );
        if (i === -1) next.push(ev);
        else next.splice(i, 0, ev);
      }
      return next;
    });
    setConsultarOpen(false);
  };

  return (
    <div className="space-y-6">
      <HeaderCaso caso={caso} />
      <AnalisisOriginalColapsable caso={caso} />

      <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Sparkles className="size-4 text-primary mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Consultar al agente</p>
            <p className="text-xs text-muted-foreground">
              Hacele una pregunta sobre el estado actual del caso. El agente
              tiene en cuenta el análisis original, la estrategia elegida y
              todo el historial del timeline.
            </p>
          </div>
        </div>
        <Button onClick={() => setConsultarOpen(true)} className="shrink-0">
          <Sparkles className="size-4" />
          Consultar
        </Button>
      </div>

      <TimelineProcesal
        casoId={caso.id}
        eventos={eventos}
        setEventos={setEventos}
      />

      <ConsultarAgenteSheet
        open={consultarOpen}
        casoId={caso.id}
        onClose={() => setConsultarOpen(false)}
        onConsultaCompletada={onConsultaCompletada}
      />
    </div>
  );
}
