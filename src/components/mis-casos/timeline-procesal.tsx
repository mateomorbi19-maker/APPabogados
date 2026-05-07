"use client";
import { useState, type Dispatch, type SetStateAction } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtFecha } from "@/lib/format";
import { CATEGORIA_LABEL } from "@/lib/casos/categorias";
import type { EventoCaso, TipoEvento } from "@/lib/types";
import { AgregarEventoSheet } from "./agregar-evento-sheet";
import { EliminarEventoModal } from "./eliminar-evento-modal";
import { AdjuntosRender } from "./adjuntos-render";

type Props = {
  casoId: string;
  eventos: EventoCaso[];
  setEventos: Dispatch<SetStateAction<EventoCaso[]>>;
};

// Timeline procesal con distinción visual por origen del evento (`tipo`):
//   - manual: borde lateral neutro, bullet emerald/amber según estado.
//   - sistema: bullet gris (eventos creados por el server, ej:
//     "Caso creado y estrategia elegida").
//   - agente: borde izquierdo violeta, label "Análisis del agente".
//     El contenido renderable de la respuesta del agente llegará en PR3
//     cuando exista el endpoint /api/casos/[id]/consultar; por ahora
//     solo proveemos el chrome visual para que cuando aparezcan
//     se vean diferenciados.
//
// Borrar solo está disponible para tipo === 'manual'. El server también
// rechaza el delete para sistema/agente (ver DELETE eventos route).
export function TimelineProcesal({ casoId, eventos, setEventos }: Props) {
  const [agregarOpen, setAgregarOpen] = useState(false);
  const [eliminarId, setEliminarId] = useState<string | null>(null);

  // Mantenemos el orden por ocurrido_en ASC. Cuando agregamos un evento
  // nuevo, lo insertamos en el lugar correcto sin re-ordenar todo.
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

// Color del bullet según `tipo` y `estado`. Manual usa los colores del
// estado (verde sucedido / amarillo pendiente). Agente usa primary
// (acento del producto). Sistema usa gris para no distraer visualmente.
function bulletClassesPorEvento(evento: EventoCaso): string {
  if (evento.tipo === "agente") return "bg-primary";
  if (evento.tipo === "sistema") return "bg-muted-foreground/40";
  return evento.estado === "sucedido" ? "bg-emerald-500" : "bg-amber-400";
}

function bordeIzqClassesPorTipo(tipo: TipoEvento): string {
  if (tipo === "agente") return "border-l-2 border-primary/60";
  if (tipo === "sistema") return "border-l-2 border-muted";
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
  const esManual = evento.tipo === "manual";
  const esAgente = evento.tipo === "agente";
  const colorBullet = bulletClassesPorEvento(evento);
  const bordeCard = bordeIzqClassesPorTipo(evento.tipo);
  const tieneAdjuntos = evento.adjuntos && evento.adjuntos.length > 0;
  const labelCategoria =
    evento.categoria !== null ? CATEGORIA_LABEL[evento.categoria] : null;

  return (
    <li className="relative group">
      {/* Bullet sobre la línea vertical */}
      <span
        className={cn(
          "absolute -left-[7px] top-1.5 size-3 rounded-full ring-4 ring-background",
          colorBullet,
        )}
        aria-hidden="true"
      />
      <div className={cn("rounded-md bg-card/30 px-3 py-2 pl-3.5", bordeCard)}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
              {esAgente ? (
                <span className="text-[10px] uppercase tracking-wider text-primary font-medium">
                  Análisis del agente
                </span>
              ) : labelCategoria ? (
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
          {esManual ? (
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
      </div>
    </li>
  );
}
