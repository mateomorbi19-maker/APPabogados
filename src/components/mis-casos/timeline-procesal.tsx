"use client";
import { useState, type Dispatch, type SetStateAction } from "react";
import { Plus, X, ChevronRight, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtFecha } from "@/lib/format";
import { CATEGORIA_LABEL } from "@/lib/casos/categorias";
import type { EventoCaso } from "@/lib/types";
import { AgregarEventoSheet } from "./agregar-evento-sheet";
import { EliminarEventoModal } from "./eliminar-evento-modal";
import { AdjuntosRender } from "./adjuntos-render";

type Props = {
  casoId: string;
  eventos: EventoCaso[];
  setEventos: Dispatch<SetStateAction<EventoCaso[]>>;
};

// Timeline procesal — expediente puro del caso. Solo eventos manuales
// (creados por el abogado: audiencias, escritos, resoluciones, etc.) y
// del sistema (creación del caso). El chat con el agente vive en su
// propia sub-ruta /chat (PR4 sub-PR2) — no aparece acá.
//
// Eventos colapsables (PR4 corrección 3):
//   - Si hay <=2 eventos: todos arrancan expandidos.
//   - Si hay >2: solo el último (más reciente) arranca expandido.
//   - Click en el header de un evento toggle expandido/colapsado.
//   - Eventos nuevos quedan expandidos por default.
//
// Botón "Agregar evento" al final del timeline (PR4 corrección 4) en
// vez del header — metáfora "agregar al final del chat".
//
// Borrar solo está disponible para `tipo === 'manual'`. El server además
// bloquea DELETE de no-manuales (ver DELETE eventos route).
export function TimelineProcesal({ casoId, eventos, setEventos }: Props) {
  const [agregarOpen, setAgregarOpen] = useState(false);
  const [eliminarId, setEliminarId] = useState<string | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(() => {
    if (eventos.length === 0) return new Set();
    if (eventos.length <= 2) return new Set(eventos.map((e) => e.id));
    const ultimo = eventos[eventos.length - 1];
    return new Set([ultimo.id]);
  });

  const toggle = (id: string) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const insertarOrdenado = (lista: EventoCaso[], nuevo: EventoCaso) => {
    const i = lista.findIndex(
      (e) => new Date(e.ocurrido_en) > new Date(nuevo.ocurrido_en),
    );
    if (i === -1) return [...lista, nuevo];
    return [...lista.slice(0, i), nuevo, ...lista.slice(i)];
  };

  const onEventoCreado = (nuevo: EventoCaso) => {
    setEventos((prev) => insertarOrdenado(prev, nuevo));
    setExpandidos((prev) => {
      const next = new Set(prev);
      next.add(nuevo.id);
      return next;
    });
    setAgregarOpen(false);
  };

  const onEventoBorrado = (id: string) => {
    setEventos((prev) => prev.filter((e) => e.id !== id));
    setExpandidos((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setEliminarId(null);
  };

  return (
    <section className="space-y-4">
      <h3 className="font-medium text-sm">
        Timeline procesal
        <span className="text-muted-foreground">
          {" · "}
          {eventos.length} {eventos.length === 1 ? "evento" : "eventos"}
        </span>
      </h3>

      {eventos.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          Todavía no hay eventos en el timeline.
        </p>
      ) : (
        <ol className="relative pl-6 border-l-2 border-border space-y-3">
          {eventos.map((e) => (
            <EventoItem
              key={e.id}
              casoId={casoId}
              evento={e}
              expandido={expandidos.has(e.id)}
              onToggle={() => toggle(e.id)}
              onEliminar={() => setEliminarId(e.id)}
            />
          ))}
        </ol>
      )}

      <div className="pl-6">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAgregarOpen(true)}
        >
          <Plus />
          Agregar evento
        </Button>
      </div>

      <AgregarEventoSheet
        open={agregarOpen}
        casoId={casoId}
        onClose={() => setAgregarOpen(false)}
        onCreated={onEventoCreado}
      />

      <EliminarEventoModal
        eventoId={eliminarId}
        casoId={casoId}
        onClose={() => setEliminarId(null)}
        onDeleted={onEventoBorrado}
      />
    </section>
  );
}

function bulletClassesPorEvento(evento: EventoCaso): string {
  if (evento.tipo === "sistema") return "bg-muted-foreground/40";
  return evento.estado === "sucedido" ? "bg-emerald-500" : "bg-amber-400";
}

function bordeIzqClassesPorEvento(evento: EventoCaso): string {
  if (evento.tipo === "sistema") return "border-l-2 border-muted";
  return "border-l-2 border-border";
}

function snippetParaColapsado(evento: EventoCaso): string {
  const MAX = 110;
  const texto = (evento.descripcion.split("\n")[0] ?? "").trim();
  if (texto.length > MAX) return texto.slice(0, MAX).trim() + "…";
  return texto;
}

function EventoItem({
  casoId,
  evento,
  expandido,
  onToggle,
  onEliminar,
}: {
  casoId: string;
  evento: EventoCaso;
  expandido: boolean;
  onToggle: () => void;
  onEliminar: () => void;
}) {
  const esEditable = evento.tipo === "manual";
  const colorBullet = bulletClassesPorEvento(evento);
  const bordeCard = bordeIzqClassesPorEvento(evento);
  const tieneAdjuntos = evento.adjuntos && evento.adjuntos.length > 0;
  const numAdjuntos = evento.adjuntos?.length ?? 0;

  const labelCabecera =
    evento.categoria !== null
      ? CATEGORIA_LABEL[evento.categoria]
      : evento.tipo === "sistema"
        ? "Sistema"
        : "Evento";

  return (
    <li className="relative group">
      <span
        className={cn(
          "absolute -left-[7px] top-3 size-3 rounded-full ring-4 ring-background",
          colorBullet,
        )}
        aria-hidden="true"
      />
      <div className={cn("rounded-md bg-card/30 pl-3.5", bordeCard)}>
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-muted/20 rounded-md transition-colors"
          aria-expanded={expandido}
        >
          <ChevronRight
            className={cn(
              "size-3.5 mt-0.5 shrink-0 text-muted-foreground transition-transform",
              expandido && "rotate-90",
            )}
            aria-hidden="true"
          />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {labelCabecera}
              </span>
              <span className="text-[10px] text-muted-foreground">
                · {fmtFecha(evento.ocurrido_en)}
              </span>
              {evento.estado === "pendiente" ? (
                <span className="text-[10px] uppercase tracking-wider text-amber-500">
                  · pendiente
                </span>
              ) : null}
              {numAdjuntos > 0 ? (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                  <Paperclip className="size-3" />
                  {numAdjuntos}
                </span>
              ) : null}
            </div>
            {!expandido ? (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {snippetParaColapsado(evento)}
              </p>
            ) : null}
          </div>
        </button>

        {expandido ? (
          <div className="px-3 pb-3 -mt-1">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-snug whitespace-pre-wrap">
                  {evento.descripcion}
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
          </div>
        ) : null}
      </div>
    </li>
  );
}
