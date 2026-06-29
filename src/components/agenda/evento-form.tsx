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
import { cn } from "@/lib/utils";
import {
  PRIORIDADES,
  PRIORIDADES_VALUES,
  TIPOS_EVENTO,
  TIPOS_EVENTO_VALUES,
  type CasoOption,
  type ClaseEvento,
  type EventoAgenda,
  type Prioridad,
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

// Fecha por defecto de una tarea nueva: hoy a las 00:00 ART (todo el día).
function fechaTareaPorDefecto(): string {
  const n = ahoraPartesAR();
  return partesAIsoAR({ ...n, h: 0, mi: 0 });
}

type Props = {
  open: boolean;
  evento: EventoAgenda | null; // null = crear
  claseInicial?: ClaseEvento; // clase con la que se abre al crear
  casos: CasoOption[];
  onClose: () => void;
  onSaved: () => void; // el parent recarga la lista
};

export function EventoForm({
  open,
  evento,
  claseInicial = "evento",
  casos,
  onClose,
  onSaved,
}: Props) {
  const editando = evento !== null;

  const [clase, setClase] = useState<ClaseEvento>(claseInicial);
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState<TipoEvento>("audiencia");
  const [prioridad, setPrioridad] = useState<Prioridad>("media");
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

  const esTarea = clase === "tarea";

  // (Re)prefill al abrir o al cambiar el evento que se edita. Las fechas se
  // normalizan a ISO con offset -03:00 (hora de pared de Argentina) para el
  // selector; la ida/vuelta de zona horaria la maneja tz-ar.ts.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (evento) {
      setClase(evento.clase);
      setTitulo(evento.titulo);
      setTipo(evento.tipo);
      setPrioridad(evento.prioridad);
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
      setClase(claseInicial);
      setTitulo("");
      setTipo(claseInicial === "tarea" ? "otro" : "audiencia");
      setPrioridad("media");
      setFechaHora(
        claseInicial === "tarea"
          ? { inicioIso: fechaTareaPorDefecto(), finIso: null, todoElDia: true }
          : { inicioIso: inicioPorDefecto(), finIso: null, todoElDia: false },
      );
      setCasoId("");
      setDescripcion("");
      setNotas("");
    }
  }, [open, evento, claseInicial]);

  // Cambio de clase (solo al crear; al editar la clase es inmutable). Normaliza
  // la fecha/hora a la forma de la clase destino: tarea → fecha sola a 00:00;
  // evento → si venía a 00:00 le pone una hora razonable (09:00).
  const cambiarClase = (c: ClaseEvento) => {
    if (editando || c === clase) return;
    setClase(c);
    const p = isoAPartesAR(fechaHora.inicioIso);
    if (c === "tarea") {
      setFechaHora({
        inicioIso: partesAIsoAR({ ...p, h: 0, mi: 0 }),
        finIso: null,
        todoElDia: true,
      });
    } else {
      const conHora = p.h === 0 && p.mi === 0 ? { ...p, h: 9, mi: 0 } : p;
      setFechaHora({
        inicioIso: partesAIsoAR(conHora),
        finIso: null,
        todoElDia: false,
      });
    }
  };

  const tituloTrim = titulo.trim();
  const formOk = tituloTrim.length > 0;

  const handleClose = () => {
    if (loading) return;
    onClose();
  };

  const handleSubmit = async () => {
    if (loading || !formOk) return;

    const { inicioIso, finIso, todoElDia } = fechaHora;

    // Validación de fin >= inicio (solo eventos; las tareas no tienen fin). La
    // misma que el schema; acá es feedback inmediato antes de pegarle a la API.
    if (
      !esTarea &&
      finIso &&
      new Date(finIso).getTime() < new Date(inicioIso).getTime()
    ) {
      setError("La fecha de fin no puede ser anterior a la de inicio");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const body = {
        titulo: tituloTrim,
        tipo,
        clase,
        prioridad,
        todo_el_dia: esTarea ? true : todoElDia,
        fecha_inicio: inicioIso,
        fecha_fin: esTarea ? null : finIso,
        caso_id: casoId || null,
        descripcion: descripcion.trim() || null,
        notas: esTarea ? null : notas.trim() || null,
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
            : `Error guardando (HTTP ${res.status})`;
        setError(msg);
        setLoading(false);
        return;
      }
      onSaved();
      setLoading(false);
      onClose();
      // Feedback de la sincronización con Google (best-effort, solo eventos). Si
      // está desconectado (sin token), no hay google_error y de eso ya avisa el
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

  const tituloModal = editando
    ? esTarea
      ? "Editar tarea"
      : "Editar evento"
    : esTarea
      ? "Nueva tarea"
      : "Nuevo evento";

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
          <DialogTitle>{tituloModal}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Toggle tarea/evento. Solo al crear: al editar la clase es fija
              (evita convertir un evento ya sincronizado con Google en tarea). */}
          {!editando ? (
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary/40 p-1">
              {(["tarea", "evento"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => cambiarClase(c)}
                  disabled={loading}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
                    clase === c
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c === "tarea" ? "Tarea" : "Evento"}
                </button>
              ))}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="ev-titulo">Título</Label>
            <Input
              id="ev-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              disabled={loading}
              maxLength={300}
              placeholder={
                esTarea
                  ? "Ej: Presentar escrito de excarcelación"
                  : "Ej: Audiencia de formalización"
              }
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
            soloFecha={esTarea}
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

          {/* Notas: solo eventos (la tarea se queda con título + descripción). */}
          {!esTarea ? (
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
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="ev-prioridad">Prioridad</Label>
            <select
              id="ev-prioridad"
              value={prioridad}
              onChange={(e) => setPrioridad(e.target.value as Prioridad)}
              disabled={loading}
              className={SELECT_CLS}
            >
              {PRIORIDADES_VALUES.map((p) => (
                <option key={p} value={p}>
                  {PRIORIDADES[p].label}
                </option>
              ))}
            </select>
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
                : esTarea
                  ? "Crear tarea"
                  : "Crear evento"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
