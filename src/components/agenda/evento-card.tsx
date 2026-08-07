"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Briefcase,
  CalendarCheck2,
  Flag,
  ListTodo,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
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
import { PRIORIDADES, TIPOS_EVENTO, type EventoAgenda } from "@/lib/agenda/types";
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
        "group relative flex items-stretch gap-3 rounded-lg border border-border bg-background px-4 py-3 transition-colors hover:border-foreground/20",
        evento.completado && "opacity-60",
      )}
    >
      {/* Checkbox circular: verde al completar */}
      <Checkbox
        checked={evento.completado}
        onCheckedChange={() => onToggleCompletado(evento)}
        aria-label={
          evento.completado ? "Marcar como pendiente" : "Marcar como completado"
        }
        className="size-[18px] self-center rounded-full border-muted-foreground/40 data-checked:border-emerald-500 data-checked:bg-emerald-500 data-checked:text-white"
      />

      {/* Acento de color del tipo: barra vertical de 4px rellena con el color
          sólido del tipo. Reusa meta.dot (la clase bg-{color} del tipo) como
          fill — no como puntito. No se puede usar un campo dedicado sin tocar
          types.ts (fuera de scope de este refactor). */}
      <div className={cn("w-1 shrink-0 self-stretch rounded-none", meta.dot)} aria-hidden />

      {/* Hora (evento) · ícono de tarea · "Todo el día" */}
      <div className="w-14 shrink-0 self-center text-center">
        {evento.clase === "tarea" ? (
          <ListTodo
            className="mx-auto size-5 text-muted-foreground"
            aria-label="Tarea"
          />
        ) : evento.todo_el_dia ? (
          <span className="text-xs text-muted-foreground">Todo el día</span>
        ) : (
          <span className="text-base font-medium tabular-nums">
            {fmtHora(evento.fecha_inicio)}
          </span>
        )}
      </div>

      {/* Cuerpo */}
      <div className="min-w-0 flex-1 self-center">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "text-base font-medium",
              evento.completado && "line-through",
            )}
          >
            {evento.titulo}
          </span>
          <Badge className={cn(meta.badge, evento.completado && "opacity-50")}>
            {meta.label}
          </Badge>
          {/* Prioridad: siempre en tareas; en eventos solo si no es la media. */}
          {evento.clase === "tarea" || evento.prioridad !== "media" ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs",
                PRIORIDADES[evento.prioridad].text,
                evento.completado && "opacity-50",
              )}
            >
              <Flag className="size-3" />
              {PRIORIDADES[evento.prioridad].label}
            </span>
          ) : null}
          {evento.google_calendar_event_id ? (
            <CalendarCheck2
              className="size-[13px] text-emerald-700 dark:text-emerald-400"
              aria-label="Sincronizado con Google Calendar"
            />
          ) : null}
        </div>

        <div className="mt-0.5 flex items-center gap-1.5 text-xs">
          <Briefcase className="size-3.5 shrink-0 text-muted-foreground" />
          {evento.caso_id && evento.nombre_caso ? (
            <Link
              href={`/dashboard/mis-casos/${evento.caso_id}`}
              className="truncate text-primary hover:underline"
            >
              {evento.nombre_caso}
            </Link>
          ) : (
            <span className="text-muted-foreground">Sin caso asociado</span>
          )}
        </div>

        {evento.descripcion || evento.notas ? (
          <div className="mt-2 space-y-1 border-t border-border pt-2 text-sm text-muted-foreground">
            {evento.descripcion ? <p>{evento.descripcion}</p> : null}
            {evento.notas ? <p>{evento.notas}</p> : null}
          </div>
        ) : null}
      </div>

      {/* Acciones: ocultas hasta hover en desktop, siempre visibles en mobile */}
      <div className="flex shrink-0 items-center gap-0.5 self-center opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
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
