"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarCheck2,
  CalendarDays,
  CalendarX2,
  Filter,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { claveDia, etiquetaDiaPartes } from "@/lib/agenda/fechas";
import {
  type CasoOption,
  type ClaseEvento,
  type EventoAgenda,
} from "@/lib/agenda/types";
import { AgendaFilters, type FiltrosUI, type Rango } from "./agenda-filters";
import { EventoCard } from "./evento-card";
import { EventoForm } from "./evento-form";
import { GoogleCalendarStatus } from "./google-calendar-status";

type Props = { casos: CasoOption[] };

type Estado =
  | { status: "loading" }
  | { status: "ready"; eventos: EventoAgenda[] }
  | { status: "error"; message: string };

// Límites desde/hasta (ISO) de cada rango, en hora local (= ART para los
// usuarios). Filtran sobre fecha_inicio.
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
    const desdeLunes = (diaSemana + 6) % 7;
    const lunes = inicioDelDia(new Date(now.getTime() - desdeLunes * 86_400_000));
    const domingo = finDelDia(new Date(lunes.getTime() + 6 * 86_400_000));
    return { desde: lunes.toISOString(), hasta: domingo.toISOString() };
  }
  const primero = inicioDelDia(new Date(now.getFullYear(), now.getMonth(), 1));
  const ultimo = finDelDia(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  return { desde: primero.toISOString(), hasta: ultimo.toISOString() };
}

function buildQuery(f: FiltrosUI): string {
  const params = new URLSearchParams();
  if (f.clase !== "todos") params.set("clase", f.clase);
  for (const t of f.tipos) params.append("tipo", t);
  if (f.casoId) params.set("caso_id", f.casoId);
  const { desde, hasta } = rangoABounds(f.rango);
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  return params.toString();
}

function StatCard({
  label,
  value,
  danger,
  muted,
}: {
  label: string;
  value: number | string;
  danger?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg bg-secondary/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-xl font-medium",
          danger && "text-destructive",
          muted && "text-sm text-muted-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function AgendaView({ casos }: Props) {
  const [filtros, setFiltros] = useState<FiltrosUI>({
    clase: "todos",
    tipos: [], // [] = "Todos" (sin filtro de tipo → se muestran todos)
    casoId: null,
    rango: "semana",
  });
  const [estado, setEstado] = useState<Estado>({ status: "loading" });
  const [formOpen, setFormOpen] = useState(false);
  const [editando, setEditando] = useState<EventoAgenda | null>(null);
  const [formClase, setFormClase] = useState<ClaseEvento>("evento");
  const [mobileFiltrosOpen, setMobileFiltrosOpen] = useState(false);
  // Estado de conexión con Google: lo posee la vista porque lo necesitan el
  // badge del header, la stat "Pendientes de sync" y el componente del sidebar.
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);

  const controllerRef = useRef<AbortController | null>(null);

  const cargar = useCallback(async (f: FiltrosUI) => {
    controllerRef.current?.abort();
    // tipos vacío = "Todos": buildQuery no manda filtro de tipo y la API devuelve
    // todos los eventos (filtrados por caso/período).
    const controller = new AbortController();
    controllerRef.current = controller;
    setEstado({ status: "loading" });
    try {
      const res = await fetch(`/api/agenda/eventos?${buildQuery(f)}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
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

  // Check de conexión con Google (GET sin efectos), para header + stats + sidebar.
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch("/api/agenda/eventos/sync");
        const json = (await res.json().catch(() => null)) as
          | { connected?: boolean }
          | null;
        if (cancel) return;
        setGoogleConnected(
          res.ok && json && typeof json.connected === "boolean"
            ? json.connected
            : false,
        );
      } catch {
        if (!cancel) setGoogleConnected(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  // Auto-sync con Google al montar: push de pendientes + pull de cambios hechos
  // dentro de Google Calendar (ruta /sync extendida). Es ADEMÁS del botón
  // manual. Silencioso: si no hay token o falla, la agenda local sigue
  // funcionando. Si el pull trajo cambios, refrescamos la lista (bump de
  // filtros → re-dispara `cargar`).
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch("/api/agenda/eventos/sync", { method: "POST" });
        const json = (await res.json().catch(() => null)) as
          | { ok: true; synced: true; pushed: number; pulled: number }
          | { ok: true; synced: false; reason: string }
          | { ok: false }
          | null;
        if (cancel || !res.ok || !json || json.ok === false) return;
        if (json.synced === false) {
          setGoogleConnected(false);
          return;
        }
        setGoogleConnected(true);
        if (json.pulled > 0 || json.pushed > 0) {
          setFiltros((f) => ({ ...f }));
        }
      } catch {
        // Silencioso: la agenda funciona 100% sin Google.
      }
    })();
    return () => {
      cancel = true;
    };
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape cierra el panel de filtros de móvil, igual que el Sheet del resto de
  // la app. No bloqueamos el scroll del body a propósito: si el panel quedara
  // abierto y el viewport pasara a ≥768px (rotación de una tablet) el aside
  // vuelve a ser la columna de siempre y el bloqueo quedaría colgado.
  useEffect(() => {
    if (!mobileFiltrosOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileFiltrosOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileFiltrosOpen]);

  const refetch = useCallback(() => {
    void cargar(filtros);
  }, [cargar, filtros]);

  const abrirNuevo = (clase: ClaseEvento) => {
    setEditando(null);
    setFormClase(clase);
    setFormOpen(true);
  };
  const abrirEditar = (e: EventoAgenda) => {
    setEditando(e);
    setFormOpen(true);
  };

  const handleToggleCompletado = useCallback(async (e: EventoAgenda) => {
    const nuevo = !e.completado;
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
  }, []);

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

  // Stats client-side. OJO: se calculan sobre los eventos YA CARGADOS, que están
  // filtrados por los filtros activos (tipo/caso/período). Bajo un período
  // angosto pueden subcontar (ej: "Esta semana" con período "Hoy"). Es el
  // comportamiento pedido ("a partir de los eventos ya cargados").
  const stats = useMemo(() => {
    if (estado.status !== "ready") return null;
    const { desde, hasta } = rangoABounds("semana");
    const wk0 = desde ? Date.parse(desde) : 0;
    const wk1 = hasta ? Date.parse(hasta) : 0;
    const hoyKey = claveDia(new Date().toISOString());
    const now = Date.now();
    const in7 = now + 7 * 86_400_000;
    let hoy = 0;
    let semana = 0;
    let venc = 0;
    let pend = 0;
    let tareasPend = 0;
    for (const e of estado.eventos) {
      const t = new Date(e.fecha_inicio).getTime();
      if (claveDia(e.fecha_inicio) === hoyKey) hoy++;
      if (t >= wk0 && t <= wk1) semana++;
      if (e.tipo === "vencimiento_procesal" && t >= now && t <= in7) venc++;
      // "Pendientes de sync" es solo de eventos: las tareas no van a Google.
      if (e.clase === "evento" && !e.google_calendar_event_id) pend++;
      if (e.clase === "tarea" && !e.completado) tareasPend++;
    }
    return { hoy, semana, venc, pend, tareasPend };
  }, [estado]);

  // Eventos vienen ASC por fecha_inicio → claves de día y eventos quedan ASC.
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
    <div className="flex flex-col gap-4 md:flex-row">
      {/* Fondo del panel de filtros en móvil. Cierra al tocar afuera. */}
      {mobileFiltrosOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileFiltrosOpen(false)}
          aria-hidden
        />
      ) : null}

      {/* Sidebar. En escritorio es la columna izquierda de siempre; en móvil se
          abre como panel anclado abajo con el botón "Filtros".

          Antes se limitaba a pasar de `hidden` a `block` en su lugar del DOM, y
          como el aside va PRIMERO y el botón que lo abre vive dentro del <main>,
          el panel (mide ~380px) aparecía ARRIBA del título y del propio botón:
          tocabas "Filtros", todo saltaba 380px hacia abajo y lo que acababas de
          abrir quedaba fuera de pantalla por arriba. Reordenar por CSS no
          alcanza (main incluye la lista entera, así que el panel caería al pie
          de la página). Todas las clases del panel llevan `max-md:` para que de
          768px para arriba el layout de escritorio quede exactamente igual. */}
      <aside
        id="agenda-filtros"
        className={cn(
          "space-y-3 md:block md:w-52 md:shrink-0",
          mobileFiltrosOpen
            ? "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-50 max-md:max-h-[80dvh] max-md:overflow-y-auto max-md:overscroll-contain max-md:rounded-t-2xl max-md:border-t max-md:border-border max-md:bg-card max-md:p-4 max-md:pb-[calc(1rem+env(safe-area-inset-bottom))] max-md:shadow-2xl"
            : "hidden",
        )}
      >
        {/* Encabezado del panel: en móvil el aside es un overlay y necesita una
            salida visible (afuera del panel no siempre hay dónde tocar). Va
            montado condicionalmente y no con `md:hidden`: un hijo oculto igual
            cuenta para el `space-y-3` y dejaría 12px muertos arriba del sidebar
            de escritorio. */}
        {mobileFiltrosOpen ? (
          <div className="flex items-center justify-between md:hidden">
            <p className="text-sm font-medium">Filtros</p>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setMobileFiltrosOpen(false)}
              aria-label="Cerrar filtros"
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : null}
        <AgendaFilters filtros={filtros} casos={casos} onChange={setFiltros} />
        <div className="rounded-lg bg-secondary/40 p-3">
          <GoogleCalendarStatus
            connected={googleConnected}
            onSynced={refetch}
            onConnectedChange={setGoogleConnected}
          />
        </div>
      </aside>

      {/* Contenido principal */}
      <main className="min-w-0 flex-1 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-xl font-medium">
            <CalendarDays className="size-[22px] text-primary" />
            Agenda
          </h1>
          {googleConnected ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
              <CalendarCheck2 className="size-3" /> Sincronizado
            </span>
          ) : null}
          <div className="flex-1" />
          {/* En móvil los dos botones toman la fila completa a mitades: a 360px
              "Nueva tarea" + "Nuevo evento" entraban justos y quedaban pegados
              al borde derecho. */}
          <div className="grid w-full grid-cols-2 items-center gap-2 md:flex md:w-auto">
            <Button
              variant="outline"
              className="w-full md:w-auto"
              onClick={() => abrirNuevo("tarea")}
            >
              <Plus className="size-4" /> Nueva tarea
            </Button>
            <Button
              className="w-full md:w-auto"
              onClick={() => abrirNuevo("evento")}
            >
              <Plus className="size-4" /> Nuevo evento
            </Button>
          </div>
        </div>

        {/* Toggle de filtros (solo mobile) */}
        <Button
          variant="outline"
          size="sm"
          className="md:hidden"
          onClick={() => setMobileFiltrosOpen((o) => !o)}
          aria-expanded={mobileFiltrosOpen}
          aria-controls="agenda-filtros"
        >
          <Filter className="size-3.5" />{" "}
          {mobileFiltrosOpen ? "Ocultar filtros" : "Filtros"}
        </Button>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Hoy" value={stats?.hoy ?? "—"} />
          <StatCard label="Esta semana" value={stats?.semana ?? "—"} />
          <StatCard label="Tareas pendientes" value={stats?.tareasPend ?? "—"} />
          <StatCard
            label="Vencimientos próximos"
            value={stats?.venc ?? "—"}
            danger={(stats?.venc ?? 0) > 0}
          />
          <StatCard
            label="Pendientes de sincronización"
            value={googleConnected ? (stats?.pend ?? "—") : "No conectado"}
            muted={!googleConnected}
          />
        </div>

        {/* Listado */}
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
              No tenés tareas ni eventos para este período.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" onClick={() => abrirNuevo("tarea")}>
                <Plus className="size-4" /> Crear tarea
              </Button>
              <Button variant="outline" onClick={() => abrirNuevo("evento")}>
                <Plus className="size-4" /> Crear evento
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {grupos.map(([clave, eventos]) => {
              const { label, esHoy, fecha } = etiquetaDiaPartes(clave);
              return (
                <section key={clave} className="space-y-2">
                  <div className="flex items-center gap-3">
                    <h2 className="flex items-baseline gap-2 text-sm">
                      <span className={cn("font-medium", esHoy && "text-primary")}>
                        {label}
                      </span>
                      <span className="text-muted-foreground">{fecha}</span>
                    </h2>
                    <div className="h-px flex-1 bg-border" />
                  </div>
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
              );
            })}
          </div>
        )}
      </main>

      <EventoForm
        open={formOpen}
        evento={editando}
        claseInicial={formClase}
        casos={casos}
        onClose={() => setFormOpen(false)}
        onSaved={refetch}
      />

      <Toaster position="top-center" richColors />
    </div>
  );
}
