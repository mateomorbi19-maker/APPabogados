"use client";
import { useState } from "react";
import Link from "next/link";
import { CalendarCheck2, Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TIPOS_EVENTO, type EventoAgenda } from "@/lib/agenda/types";
import { fmtHora } from "@/lib/agenda/fechas";

type Props = {
  evento: EventoAgenda;
  onEdit: (e: EventoAgenda) => void;
  onDelete: (id: string) => Promise<void>;
  onToggleCompletado: (e: EventoAgenda) => void;
};

export function EventoCard({
  evento,
  onEdit,
  onDelete,
  onToggleCompletado,
}: Props) {
  const meta = TIPOS_EVENTO[evento.tipo];
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete(evento.id);
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border border-l-4 bg-card px-3 py-2.5",
        meta.borde,
        evento.completado && "opacity-60",
      )}
    >
      <Checkbox
        checked={evento.completado}
        onCheckedChange={() => onToggleCompletado(evento)}
        className="mt-1"
        aria-label={
          evento.completado ? "Marcar como pendiente" : "Marcar como completado"
        }
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {evento.todo_el_dia ? "Todo el día" : fmtHora(evento.fecha_inicio)}
          </span>
          <Badge className={meta.badge}>{meta.label}</Badge>
          {evento.google_calendar_event_id ? (
            <CalendarCheck2
              className="size-3.5 text-emerald-400"
              aria-label="Sincronizado con Google Calendar"
            />
          ) : null}
        </div>

        <p
          className={cn(
            "mt-0.5 text-sm font-medium",
            evento.completado && "line-through",
          )}
        >
          {evento.titulo}
        </p>

        {evento.descripcion ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {evento.descripcion}
          </p>
        ) : null}

        {evento.caso_id && evento.nombre_caso ? (
          <Link
            href={`/dashboard/mis-casos/${evento.caso_id}`}
            className="mt-1 inline-block text-xs text-primary hover:underline"
          >
            {evento.nombre_caso}
          </Link>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onEdit(evento)}
          aria-label="Editar evento"
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setConfirmOpen(true)}
          aria-label="Eliminar evento"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={(v) => {
          if (!v && !deleting) setConfirmOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!deleting}>
          <DialogHeader>
            <DialogTitle>¿Eliminar evento?</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que querés eliminar “{evento.titulo}”?
              {evento.google_calendar_event_id
                ? " También se quitará de tu Google Calendar."
                : ""}{" "}
              Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="animate-spin" /> : null}
              {deleting ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
