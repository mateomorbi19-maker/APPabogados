"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  TIPOS_EVENTO,
  TIPOS_EVENTO_VALUES,
  type CasoOption,
  type EventoAgenda,
  type TipoEvento,
} from "@/lib/agenda/types";
import {
  ahoraPartesAR,
  isoAPartesAR,
  partesAIsoAR,
} from "@/lib/agenda/tz-ar";
import {
  SelectorFechaHora,
  type ValorFechaHora,
} from "./selector-fecha-hora";

const SELECT_CLS =
  "h-9 w-full rounded-md border border-input bg-transparent text-foreground px-2 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-50";

// Inicio por defecto de un evento nuevo: ahora en hora de Argentina, redondeado
// a la franja de 15' anterior (para que coincida con el dropdown de horas).
function inicioPorDefecto(): string {
  const n = ahoraPartesAR();
  return partesAIsoAR({ ...n, mi: Math.floor(n.mi / 15) * 15 });
}

type Props = {
  open: boolean;
  evento: EventoAgenda | null; // null = crear
  casos: CasoOption[];
  onClose: () => void;
  onSaved: () => void; // el parent recarga la lista
};

export function EventoForm({ open, evento, casos, onClose, onSaved }: Props) {
  const editando = evento !== null;

  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState<TipoEvento>("audiencia");
  const [fechaHora, setFechaHora] = useState<ValorFechaHora>(() => ({
    inicioIso: inicioPorDefecto(),
    finIso: null,
    todoElDia: false,
  }));
  const [casoId, setCasoId] = useState<string>("");
  const [descripcion, setDescripcion] = useState("");
  const [notas, setNotas] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // (Re)prefill al abrir o al cambiar el evento que se edita. Las fechas se
  // normalizan a ISO con offset -03:00 (hora de pared de Argentina) para el
  // selector; la ida/vuelta de zona horaria la maneja tz-ar.ts.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (evento) {
      setTitulo(evento.titulo);
      setTipo(evento.tipo);
      setFechaHora({
        inicioIso: partesAIsoAR(isoAPartesAR(evento.fecha_inicio)),
        finIso: evento.fecha_fin
          ? partesAIsoAR(isoAPartesAR(evento.fecha_fin))
          : null,
        todoElDia: evento.todo_el_dia,
      });
      setCasoId(evento.caso_id ?? "");
      setDescripcion(evento.descripcion ?? "");
      setNotas(evento.notas ?? "");
    } else {
      setTitulo("");
      setTipo("audiencia");
      setFechaHora({
        inicioIso: inicioPorDefecto(),
        finIso: null,
        todoElDia: false,
      });
      setCasoId("");
      setDescripcion("");
      setNotas("");
    }
  }, [open, evento]);

  const tituloTrim = titulo.trim();
  const formOk = tituloTrim.length > 0;

  const handleClose = () => {
    if (loading) return;
    onClose();
  };

  const handleSubmit = async () => {
    if (loading || !formOk) return;

    const { inicioIso, finIso, todoElDia } = fechaHora;

    // Validación de fin >= inicio (la misma que el schema; acá es feedback
    // inmediato antes de pegarle a la API).
    if (finIso && new Date(finIso).getTime() < new Date(inicioIso).getTime()) {
      setError("La fecha de fin no puede ser anterior a la de inicio");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const body = {
        titulo: tituloTrim,
        tipo,
        todo_el_dia: todoElDia,
        fecha_inicio: inicioIso,
        fecha_fin: finIso,
        caso_id: casoId || null,
        descripcion: descripcion.trim() || null,
        notas: notas.trim() || null,
      };
      const url = editando
        ? `/api/agenda/eventos/${evento.id}`
        : "/api/agenda/eventos";
      const res = await fetch(url, {
        method: editando ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; google_synced?: boolean; google_error?: string }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !json || json.ok === false) {
        const msg =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : `Error guardando evento (HTTP ${res.status})`;
        setError(msg);
        setLoading(false);
        return;
      }
      onSaved();
      setLoading(false);
      onClose();
      // Feedback de la sincronización con Google (best-effort). Si está
      // desconectado (sin token), no hay google_error y de eso ya avisa el
      // banner — no molestamos con un toast.
      if (json.google_synced === true) {
        toast.success("Evento guardado y sincronizado con Google Calendar");
      } else if (json.google_error) {
        toast.error(
          `Evento guardado, pero no se sincronizó con Google Calendar: ${json.google_error}`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        showCloseButton={!loading}
      >
        <DialogHeader>
          <DialogTitle>
            {editando ? "Editar evento" : "Nuevo evento"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ev-titulo">Título</Label>
            <Input
              id="ev-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              disabled={loading}
              maxLength={300}
              placeholder="Ej: Audiencia de formalización"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ev-tipo">Tipo</Label>
            <select
              id="ev-tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoEvento)}
              disabled={loading}
              className={SELECT_CLS}
            >
              {TIPOS_EVENTO_VALUES.map((t) => (
                <option key={t} value={t}>
                  {TIPOS_EVENTO[t].label}
                </option>
              ))}
            </select>
          </div>

          <SelectorFechaHora
            value={fechaHora}
            onChange={setFechaHora}
            disabled={loading}
          />

          <div className="space-y-1.5">
            <Label htmlFor="ev-caso">Caso asociado (opcional)</Label>
            <select
              id="ev-caso"
              value={casoId}
              onChange={(e) => setCasoId(e.target.value)}
              disabled={loading}
              className={SELECT_CLS}
            >
              <option value="">Sin caso asociado</option>
              {casos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.titulo}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ev-desc">Descripción (opcional)</Label>
            <Textarea
              id="ev-desc"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              disabled={loading}
              rows={2}
              maxLength={5000}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ev-notas">Notas (opcional)</Label>
            <Textarea
              id="ev-notas"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              disabled={loading}
              rows={2}
              maxLength={5000}
            />
          </div>

          {error ? (
            <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !formOk}>
            {loading ? <Loader2 className="animate-spin" /> : null}
            {loading
              ? "Guardando..."
              : editando
                ? "Guardar cambios"
                : "Crear evento"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
