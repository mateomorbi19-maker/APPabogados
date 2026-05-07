"use client";
import { useState, type Dispatch, type SetStateAction } from "react";
import { Plus, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtFecha } from "@/lib/format";
import { CATEGORIA_LABEL } from "@/lib/casos/categorias";
import type { EventoCaso, TipoEvento } from "@/lib/types";
import { AgregarEventoSheet } from "./agregar-evento-sheet";
import { EliminarEventoModal } from "./eliminar-evento-modal";
import { AdjuntosRender } from "./adjuntos-render";
import { RespuestaAgenteEvento } from "./respuesta-agente-evento";

type Props = {
  casoId: string;
  eventos: EventoCaso[];
  setEventos: Dispatch<SetStateAction<EventoCaso[]>>;
};

// Timeline procesal con distinción visual por origen del evento (`tipo`):
//   - manual: borde lateral neutro, bullet emerald/amber según estado.
//     Si la categoría es 'consulta_agente' (la pregunta que el abogado
//     le hizo al agente), se renderiza en formato chiquito identificado
//     como "Consulta del abogado", para que el par consulta→respuesta
//     se lea visualmente conectado.
//   - sistema: bullet gris.
//   - agente (categoria='respuesta_agente'): borde primary, render del
//     componente RespuestaAgenteEvento que parsea el JSON de la
//     descripción y muestra tesis + fundamento + recomendaciones +
//     búsquedas.
//
// Borrar solo está disponible para `tipo === 'manual'`. La consulta
// del abogado (categoría=consulta_agente) también es manual técnicamente
// pero NO la dejamos borrar desde la UI porque es parte del par con
// la respuesta del agente — tendría que borrarse el par completo, lo
// cual no estamos exponiendo. El server además bloquea DELETE de
// eventos no-manuales (ver DELETE eventos route).
export function TimelineProcesal({ casoId, eventos, setEventos }: Props) {
  const [agregarOpen, setAgregarOpen] = useState(false);
  const [eliminarId, setEliminarId] = useState<string | null>(null);

  const insertarOrdenado = (lista: EventoCaso[], nuevo: EventoCaso) => {
    const i = lista.findIndex(
      (e) => new Date(e.ocurrido_en) > new Date(nuevo.ocurrido_en),
    );
    if (i === -1) return [...lista, nuevo];
    return [...lista.slice(0, i), nuevo, ...lista.slice(i)];
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-medium text-sm">
          Timeline procesal
          <span className="text-muted-foreground"> · {eventos.length} {eventos.length === 1 ? "evento" : "eventos"}</span>
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAgregarOpen(true)}
        >
          <Plus />
          Agregar evento
        </Button>
      </div>

      {eventos.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          Todavía no hay eventos en el timeline.
        </p>
      ) : (
        <ol className="relative pl-6 border-l-2 border-border space-y-4">
          {eventos.map((e) => (
            <EventoItem
              key={e.id}
              casoId={casoId}
              evento={e}
              onEliminar={() => setEliminarId(e.id)}
            />
          ))}
        </ol>
      )}

      <AgregarEventoSheet
        open={agregarOpen}
        casoId={casoId}
        onClose={() => setAgregarOpen(false)}
        onCreated={(nuevo) => {
          setEventos((prev) => insertarOrdenado(prev, nuevo));
          setAgregarOpen(false);
        }}
      />

      <EliminarEventoModal
        eventoId={eliminarId}
        casoId={casoId}
        onClose={() => setEliminarId(null)}
        onDeleted={(id) => {
          setEventos((prev) => prev.filter((e) => e.id !== id));
          setEliminarId(null);
        }}
      />
    </section>
  );
}

function bulletClassesPorEvento(evento: EventoCaso): string {
  if (evento.tipo === "agente") return "bg-primary";
  if (evento.tipo === "sistema") return "bg-muted-foreground/40";
  if (evento.categoria === "consulta_agente") return "bg-primary/60";
  return evento.estado === "sucedido" ? "bg-emerald-500" : "bg-amber-400";
}

function bordeIzqClassesPorEvento(evento: EventoCaso): string {
  if (evento.tipo === "agente") return "border-l-2 border-primary/60";
  if (evento.tipo === "sistema") return "border-l-2 border-muted";
  if (evento.categoria === "consulta_agente")
    return "border-l-2 border-primary/30";
  return "border-l-2 border-border";
}

function EventoItem({
  casoId,
  evento,
  onEliminar,
}: {
  casoId: string;
  evento: EventoCaso;
  onEliminar: () => void;
}) {
  const esManualEditable =
    evento.tipo === "manual" && evento.categoria !== "consulta_agente";
  const esRespuestaAgente =
    evento.tipo === "agente" && evento.categoria === "respuesta_agente";
  const esConsultaAgente =
    evento.tipo === "manual" && evento.categoria === "consulta_agente";
  const colorBullet = bulletClassesPorEvento(evento);
  const bordeCard = bordeIzqClassesPorEvento(evento);
  const tieneAdjuntos = evento.adjuntos && evento.adjuntos.length > 0;
  const labelCategoria =
    evento.categoria !== null
      ? CATEGORIA_LABEL[evento.categoria]
      : null;

  return (
    <li className="relative group">
      <span
        className={cn(
          "absolute -left-[7px] top-1.5 size-3 rounded-full ring-4 ring-background",
          colorBullet,
        )}
        aria-hidden="true"
      />
      <div className={cn("rounded-md bg-card/30 px-3 py-2 pl-3.5", bordeCard)}>
        {esRespuestaAgente ? (
          <RespuestaAgenteEvento evento={evento} />
        ) : esConsultaAgente ? (
          <ConsultaAgenteCard evento={evento} casoId={casoId} />
        ) : (
          <EventoManualOSistemaContenido
            evento={evento}
            casoId={casoId}
            esEditable={esManualEditable}
            onEliminar={onEliminar}
            tieneAdjuntos={tieneAdjuntos ?? false}
            labelCategoria={labelCategoria}
          />
        )}
      </div>
    </li>
  );
}

function EventoManualOSistemaContenido({
  evento,
  casoId,
  esEditable,
  onEliminar,
  tieneAdjuntos,
  labelCategoria,
}: {
  evento: EventoCaso;
  casoId: string;
  esEditable: boolean;
  onEliminar: () => void;
  tieneAdjuntos: boolean;
  labelCategoria: string | null;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
          {labelCategoria ? (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {labelCategoria}
            </span>
          ) : null}
          {evento.estado === "pendiente" ? (
            <span className="text-[10px] uppercase tracking-wider text-amber-500">
              · pendiente
            </span>
          ) : null}
        </div>
        <p className="text-sm leading-snug whitespace-pre-wrap">
          {evento.descripcion}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {fmtFecha(evento.ocurrido_en)}
        </p>
        {tieneAdjuntos ? (
          <AdjuntosRender casoId={casoId} adjuntos={evento.adjuntos} />
        ) : null}
      </div>
      {esEditable ? (
        <Button
          variant="ghost"
          size="sm"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onEliminar}
          aria-label="Eliminar evento"
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

// Card chiquita para la consulta del abogado (la pregunta que precede
// a la respuesta del agente). Borde lateral primary tenue, label
// "Consulta del abogado" + adjuntos si el abogado los envió.
function ConsultaAgenteCard({
  evento,
  casoId,
}: {
  evento: EventoCaso;
  casoId: string;
}) {
  const tieneAdjuntos = evento.adjuntos && evento.adjuntos.length > 0;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="size-3 text-primary/70" />
        <span className="text-[10px] uppercase tracking-wider text-primary/80 font-medium">
          Consulta del abogado
        </span>
        <span className="text-[10px] text-muted-foreground">
          · {fmtFecha(evento.ocurrido_en)}
        </span>
      </div>
      <p className="text-sm leading-snug whitespace-pre-wrap text-muted-foreground italic">
        {evento.descripcion}
      </p>
      {tieneAdjuntos ? (
        <AdjuntosRender casoId={casoId} adjuntos={evento.adjuntos} />
      ) : null}
    </div>
  );
}
