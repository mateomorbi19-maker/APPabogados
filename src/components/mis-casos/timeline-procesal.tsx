"use client";
import { useState, type Dispatch, type SetStateAction } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtFecha } from "@/lib/format";
import type { EventoCaso } from "@/lib/types";
import { AgregarEventoModal } from "./agregar-evento-modal";
import { EliminarEventoModal } from "./eliminar-evento-modal";

type Props = {
  casoId: string;
  eventos: EventoCaso[];
  setEventos: Dispatch<SetStateAction<EventoCaso[]>>;
};

// Timeline procesal: línea vertical con bullets coloreados según estado.
// Verde (#10b981 / emerald-500) para 'sucedido', amarillo (#fbbf24 / amber-400)
// para 'pendiente'. Borde de 2px del bg para que el bullet "pise" la línea.
//
// Solo los eventos de tipo 'manual' tienen el botón de eliminar al hover.
// Los de tipo 'sistema' (ej: "Caso creado y estrategia elegida") y futuros
// 'agente' no se pueden borrar desde la UI. (El server también lo permite,
// pero nosotros no lo exponemos.)
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
              evento={e}
              onEliminar={() => setEliminarId(e.id)}
            />
          ))}
        </ol>
      )}

      <AgregarEventoModal
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

function EventoItem({
  evento,
  onEliminar,
}: {
  evento: EventoCaso;
  onEliminar: () => void;
}) {
  const esManual = evento.tipo === "manual";
  const colorBullet =
    evento.estado === "sucedido" ? "bg-emerald-500" : "bg-amber-400";

  return (
    <li className="relative group">
      {/* Bullet: posición absoluta a la izquierda para "pisar" la línea
          vertical (-left-[7px] = mitad del ancho del bullet, ajustado
          para que esté centrado sobre la línea). El ring del bg-background
          oculta la línea detrás del círculo. */}
      <span
        className={cn(
          "absolute -left-[7px] top-1.5 size-3 rounded-full ring-4 ring-background",
          colorBullet,
        )}
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="text-sm leading-snug">{evento.descripcion}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {fmtFecha(evento.ocurrido_en)}
            {evento.estado === "pendiente" ? (
              <span className="ml-2 text-amber-500">· pendiente</span>
            ) : null}
          </p>
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
    </li>
  );
}
