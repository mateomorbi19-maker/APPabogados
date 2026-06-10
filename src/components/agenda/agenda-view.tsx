"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CalendarX2, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { claveDia, etiquetaDia } from "@/lib/agenda/fechas";
import type { CasoOption, EventoAgenda } from "@/lib/agenda/types";
import { AgendaFilters, type FiltrosUI, type Rango } from "./agenda-filters";
import { EventoCard } from "./evento-card";
import { EventoForm } from "./evento-form";
import { GoogleCalendarStatus } from "./google-calendar-status";

type Props = { casos: CasoOption[] };

type Estado =
  | { status: "loading" }
  | { status: "ready"; eventos: EventoAgenda[] }
  | { status: "error"; message: string };

// Límites desde/hasta (ISO) de cada rango, calculados en hora local (= ART
// para los usuarios de la app). Filtran sobre fecha_inicio.
function rangoABounds(rango: Rango): { desde: string | null; hasta: string | null } {
  if (rango === "todo") return { desde: null, hasta: null };
  const now = new Date();
  const inicioDelDia = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const finDelDia = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };
  if (rango === "hoy") {
    return {
      desde: inicioDelDia(now).toISOString(),
      hasta: finDelDia(now).toISOString(),
    };
  }
  if (rango === "semana") {
    const diaSemana = now.getDay(); // 0=domingo .. 6=sábado
    const desdeLunes = (diaSemana + 6) % 7; // días desde el lunes
    const lunes = inicioDelDia(new Date(now.getTime() - desdeLunes * 86_400_000));
    const domingo = finDelDia(new Date(lunes.getTime() + 6 * 86_400_000));
    return { desde: lunes.toISOString(), hasta: domingo.toISOString() };
  }
  // mes
  const primero = inicioDelDia(new Date(now.getFullYear(), now.getMonth(), 1));
  const ultimo = finDelDia(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  return { desde: primero.toISOString(), hasta: ultimo.toISOString() };
}

function buildQuery(f: FiltrosUI): string {
  const params = new URLSearchParams();
  for (const t of f.tipos) params.append("tipo", t);
  if (f.casoId) params.set("caso_id", f.casoId);
  const { desde, hasta } = rangoABounds(f.rango);
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  return params.toString();
}

export function AgendaView({ casos }: Props) {
  const [filtros, setFiltros] = useState<FiltrosUI>({
    tipos: [],
    casoId: null,
    rango: "semana",
  });
  const [estado, setEstado] = useState<Estado>({ status: "loading" });
  const [formOpen, setFormOpen] = useState(false);
  const [editando, setEditando] = useState<EventoAgenda | null>(null);

  const controllerRef = useRef<AbortController | null>(null);

  const cargar = useCallback(async (f: FiltrosUI) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setEstado({ status: "loading" });
    try {
      const res = await fetch(`/api/agenda/eventos?${buildQuery(f)}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      // Éxito = objeto crudo { eventos }; error = { ok: false, error }.
      const json = (await res.json().catch(() => null)) as
        | { eventos: EventoAgenda[] }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !json || !("eventos" in json)) {
        setEstado({
          status: "error",
          message:
            json && "error" in json && json.error
              ? json.error
              : `No se pudieron cargar los eventos (HTTP ${res.status})`,
        });
        return;
      }
      setEstado({ status: "ready", eventos: json.eventos });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setEstado({
        status: "error",
        message: e instanceof Error ? e.message : "Error de red",
      });
    }
  }, []);

  useEffect(() => {
    void cargar(filtros);
    return () => controllerRef.current?.abort();
  }, [filtros, cargar]);

  const refetch = useCallback(() => {
    void cargar(filtros);
  }, [cargar, filtros]);

  const abrirNuevo = () => {
    setEditando(null);
    setFormOpen(true);
  };
  const abrirEditar = (e: EventoAgenda) => {
    setEditando(e);
    setFormOpen(true);
  };

  const handleToggleCompletado = useCallback(
    async (e: EventoAgenda) => {
      const nuevo = !e.completado;
      // Optimista: reflejamos el cambio ya, revertimos si falla.
      setEstado((prev) =>
        prev.status === "ready"
          ? {
              status: "ready",
              eventos: prev.eventos.map((x) =>
                x.id === e.id ? { ...x, completado: nuevo } : x,
              ),
            }
          : prev,
      );
      try {
        const res = await fetch(`/api/agenda/eventos/${e.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ completado: nuevo }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        toast.error("No se pudo actualizar el evento");
        setEstado((prev) =>
          prev.status === "ready"
            ? {
                status: "ready",
                eventos: prev.eventos.map((x) =>
                  x.id === e.id ? { ...x, completado: e.completado } : x,
                ),
              }
            : prev,
        );
      }
    },
    [],
  );

  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch(`/api/agenda/eventos/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      toast.error(json?.error ?? `Error eliminando (HTTP ${res.status})`);
      return;
    }
    setEstado((prev) =>
      prev.status === "ready"
        ? { status: "ready", eventos: prev.eventos.filter((x) => x.id !== id) }
        : prev,
    );
    toast.success("Evento eliminado");
  }, []);

  // Eventos vienen ASC por fecha_inicio; el orden de inserción de las claves de
  // día queda ascendente, y dentro de cada día también.
  const grupos = useMemo(() => {
    if (estado.status !== "ready") return [];
    const map = new Map<string, EventoAgenda[]>();
    for (const ev of estado.eventos) {
      const k = claveDia(ev.fecha_inicio);
      const lista = map.get(k);
      if (lista) lista.push(ev);
      else map.set(k, [ev]);
    }
    return Array.from(map.entries());
  }, [estado]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 font-serif text-2xl">
          <CalendarDays className="size-6 text-primary" /> Agenda
        </h1>
        <div className="flex-1" />
        <Button onClick={abrirNuevo}>
          <Plus className="size-4" /> Nuevo evento
        </Button>
      </div>

      <GoogleCalendarStatus onSynced={refetch} />

      <AgendaFilters filtros={filtros} casos={casos} onChange={setFiltros} />

      {estado.status === "loading" ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Cargando eventos…
        </div>
      ) : estado.status === "error" ? (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
          {estado.message}
        </div>
      ) : grupos.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <CalendarX2 className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No tenés eventos para este período.
          </p>
          <Button variant="outline" onClick={abrirNuevo}>
            <Plus className="size-4" /> Crear evento
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {grupos.map(([clave, eventos]) => (
            <section key={clave} className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                {etiquetaDia(clave)}
              </h2>
              <div className="space-y-2">
                {eventos.map((ev) => (
                  <EventoCard
                    key={ev.id}
                    evento={ev}
                    onEdit={abrirEditar}
                    onDelete={handleDelete}
                    onToggleCompletado={handleToggleCompletado}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <EventoForm
        open={formOpen}
        evento={editando}
        casos={casos}
        onClose={() => setFormOpen(false)}
        onSaved={refetch}
      />

      <Toaster position="top-center" richColors />
    </div>
  );
}
