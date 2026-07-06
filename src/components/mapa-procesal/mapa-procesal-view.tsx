"use client";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react";
import { Loader2, Network } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { calcularLayout, type EdgeFlow, type NodoFlow } from "@/lib/mapa-procesal/layout";
import {
  FUEROS,
  FUERO_LABEL,
  type Fuero,
  type NodoProcesalDB,
} from "@/lib/mapa-procesal/types";
import { NodoProcesal } from "./nodo-procesal";
import { EdgeProcesal } from "./edge-procesal";
import { MapaToolbar } from "./mapa-toolbar";
import { MapaMinimap } from "./mapa-minimap";
import { NodoDetailPanel } from "./nodo-detail-panel";
import { ParticlesOverlay } from "./particles-overlay";

// Profundidad de fondo del canvas: degradado radial (más claro al centro,
// oscureciendo a los bordes). El ReactFlow va transparente por encima, y las
// partículas quedan ENTRE este fondo y los nodos.
const FONDO_CANVAS =
  "radial-gradient(ellipse 70% 55% at 50% 38%, #12121c 0%, #0a0a10 55%, #08080c 100%)";

// nodeTypes/edgeTypes a scope de módulo: si se recrean por render, ReactFlow
// re-monta los componentes (warning + jank).
const nodeTypes: NodeTypes = { nodoProcesal: NodoProcesal };
const edgeTypes: EdgeTypes = { edgeProcesal: EdgeProcesal };

type Props = { casoId: string; casoTitulo: string };

type Estado =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      inicializado: boolean;
      nodos: NodoProcesalDB[];
      fuero: Fuero | null;
    };

export function MapaProcesalView(props: Props) {
  return (
    <ReactFlowProvider>
      <MapaInner {...props} />
    </ReactFlowProvider>
  );
}

function MapaInner({ casoId, casoTitulo }: Props) {
  const [estado, setEstado] = useState<Estado>({ status: "loading" });
  const [initializing, setInitializing] = useState(false);
  const [selectedNodoId, setSelectedNodoId] = useState<string | null>(null);
  const [crearParaNodoId, setCrearParaNodoId] = useState<string | null>(null);
  const [reiniciarOpen, setReiniciarOpen] = useState(false);
  const [reiniciando, setReiniciando] = useState(false);
  // Fuero elegido en la pantalla de inicialización (Fase B lo pre-carga con la
  // sugerencia de la IA; por ahora arranca sin selección).
  const [fueroInit, setFueroInit] = useState<Fuero | null>(null);
  // Fuero del diálogo de reiniciar (default: el fuero actual del caso).
  const [fueroReiniciar, setFueroReiniciar] = useState<Fuero | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<NodoFlow>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<EdgeFlow>([]);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/casos/${casoId}/mapa`);
      const json = (await res.json().catch(() => null)) as
        | {
            ok: true;
            inicializado: boolean;
            nodos: NodoProcesalDB[];
            fuero: Fuero | null;
          }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !json || json.ok === false) {
        setEstado({
          status: "error",
          message:
            json && "error" in json && json.error
              ? json.error
              : `No se pudo cargar el mapa (HTTP ${res.status})`,
        });
        return;
      }
      setEstado({
        status: "ready",
        inicializado: json.inicializado,
        nodos: json.nodos,
        fuero: json.fuero,
      });
    } catch (e) {
      setEstado({
        status: "error",
        message: e instanceof Error ? e.message : "Error de red",
      });
    }
  }, [casoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Re-layout cuando cambian los nodos de la DB.
  useEffect(() => {
    if (estado.status === "ready") {
      const { nodes: n, edges: e } = calcularLayout(estado.nodos);
      setNodes(n);
      setEdges(e);
    }
  }, [estado, setNodes, setEdges]);

  const inicializar = async () => {
    if (initializing || fueroInit === null) return;
    setInitializing(true);
    try {
      const res = await fetch(`/api/casos/${casoId}/mapa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fuero: fueroInit }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; nodos: NodoProcesalDB[]; fuero: Fuero }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !json || json.ok === false) {
        toast.error(
          json && "error" in json && json.error
            ? json.error
            : "No se pudo inicializar el mapa",
        );
        return;
      }
      setEstado({
        status: "ready",
        inicializado: true,
        nodos: json.nodos,
        fuero: json.fuero,
      });
    } catch {
      toast.error("Error de red al inicializar");
    } finally {
      setInitializing(false);
    }
  };

  const crearHijo = async (padreId: string, titulo: string, descripcion: string) => {
    const res = await fetch(`/api/casos/${casoId}/mapa/nodos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padre_id: padreId, titulo, descripcion: descripcion || null }),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok: true }
      | { ok: false; error?: string }
      | null;
    if (!res.ok || !json || json.ok === false) {
      toast.error(
        json && "error" in json && json.error ? json.error : "No se pudo crear el nodo",
      );
      return false;
    }
    await cargar();
    return true;
  };

  const editarNodo = useCallback(
    async (id: string, data: { titulo?: string; descripcion?: string | null }) => {
      const res = await fetch(`/api/casos/${casoId}/mapa/nodos/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !json || json.ok === false) {
        toast.error(
          json && "error" in json && json.error ? json.error : "No se pudo guardar",
        );
        return;
      }
      await cargar();
    },
    [casoId, cargar],
  );

  // Marca un nodo como ocurrido (PUT estado=ocurrido → desbloquea los hijos).
  const handleMarcarOcurrido = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/casos/${casoId}/mapa/nodos/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ estado: "ocurrido" }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !json || json.ok === false) {
        toast.error(
          json && "error" in json && json.error
            ? json.error
            : "No se pudo marcar como ocurrido",
        );
        return;
      }
      await cargar();
    },
    [casoId, cargar],
  );

  // Togglea riesgo_alto (rojo) del nodo. PUT riesgo_alto → recarga.
  const handleToggleRiesgo = useCallback(
    async (id: string, value: boolean) => {
      const res = await fetch(`/api/casos/${casoId}/mapa/nodos/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ riesgo_alto: value }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !json || json.ok === false) {
        toast.error(
          json && "error" in json && json.error
            ? json.error
            : "No se pudo actualizar el riesgo",
        );
        return;
      }
      await cargar();
    },
    [casoId, cargar],
  );

  const handleEliminar = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/casos/${casoId}/mapa/nodos/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        toast.error(json?.error ?? `Error eliminando (HTTP ${res.status})`);
        return;
      }
      setSelectedNodoId(null);
      await cargar();
    },
    [casoId, cargar],
  );

  // Reinicia el mapa: borra los nodos y reinstancia la plantilla del fuero
  // elegido en el diálogo (permite cambiar de fuero al reiniciar). PUT.
  const handleReiniciar = async () => {
    if (reiniciando || fueroReiniciar === null) return;
    setReiniciando(true);
    try {
      const res = await fetch(`/api/casos/${casoId}/mapa`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fuero: fueroReiniciar }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; nodos: NodoProcesalDB[]; fuero: Fuero }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !json || json.ok === false) {
        toast.error(
          json && "error" in json && json.error
            ? json.error
            : "No se pudo reiniciar el mapa",
        );
        return;
      }
      setSelectedNodoId(null);
      setEstado({
        status: "ready",
        inicializado: true,
        nodos: json.nodos,
        fuero: json.fuero,
      });
      setReiniciarOpen(false);
      toast.success("Mapa reiniciado con el flujo nuevo");
    } catch {
      toast.error("Error de red al reiniciar");
    } finally {
      setReiniciando(false);
    }
  };

  const onNodeClick = useCallback((_: unknown, node: NodoFlow) => {
    if (node.data.estado === "bloqueado") return;
    setSelectedNodoId(node.id);
  }, []);

  const onPaneClick = useCallback(() => setSelectedNodoId(null), []);

  const nodos = estado.status === "ready" ? estado.nodos : [];
  const selectedNodo = nodos.find((n) => n.id === selectedNodoId) ?? null;
  const hijosSeleccionado = useMemo(
    () => (selectedNodoId ? nodos.filter((n) => n.padre_id === selectedNodoId) : []),
    [nodos, selectedNodoId],
  );
  const puedeAgregar = selectedNodo !== null && selectedNodo.estado !== "bloqueado";

  return (
    <div className="flex h-screen flex-col bg-background">
      <MapaToolbar
        casoId={casoId}
        casoTitulo={casoTitulo}
        fueroLabel={
          estado.status === "ready" && estado.fuero
            ? FUERO_LABEL[estado.fuero]
            : undefined
        }
        puedeAgregar={puedeAgregar}
        onAgregarEvento={() => {
          if (selectedNodoId) setCrearParaNodoId(selectedNodoId);
        }}
        // El reinicio solo tiene sentido con un mapa ya inicializado. Al abrir
        // el diálogo, el fuero arranca en el actual del caso.
        onReiniciar={
          estado.status === "ready" && estado.inicializado
            ? () => {
                setFueroReiniciar(estado.fuero);
                setReiniciarOpen(true);
              }
            : undefined
        }
      />

      <div className="relative flex-1" style={{ background: FONDO_CANVAS }}>
        {estado.status === "loading" ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Cargando mapa…
          </div>
        ) : estado.status === "error" ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
              {estado.message}
            </div>
          </div>
        ) : !estado.inicializado ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 p-6 text-center">
            <Network className="size-12 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-lg font-medium">Mapa procesal sin inicializar</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Elegí el fuero donde tramita la causa: el mapa se genera con las
                etapas de su código procesal. Después vas a poder agregar,
                editar y marcar nodos.
              </p>
            </div>
            <SelectorFuero
              value={fueroInit}
              onChange={setFueroInit}
              disabled={initializing}
            />
            <Button
              onClick={inicializar}
              disabled={initializing || fueroInit === null}
            >
              {initializing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Network className="size-4" />
              )}
              {initializing ? "Inicializando..." : "Inicializar mapa procesal"}
            </Button>
          </div>
        ) : (
          <>
            {/* Partículas entre el fondo (degradado del contenedor) y los nodos.
                ReactFlow va transparente por encima para dejarlas ver. */}
            <ParticlesOverlay />
            <ReactFlow<NodoFlow, EdgeFlow>
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              colorMode="dark"
              fitView
              fitViewOptions={{ padding: 0.25 }}
              minZoom={0.2}
              proOptions={{ hideAttribution: true }}
              style={{ background: "transparent" }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={24}
                size={1}
                color="rgba(255,255,255,0.035)"
              />
              <Controls />
              <MapaMinimap />
            </ReactFlow>

            {selectedNodo ? (
              <NodoDetailPanel
                key={selectedNodo.id}
                nodo={selectedNodo}
                hijos={hijosSeleccionado}
                onClose={() => setSelectedNodoId(null)}
                onSelectNodo={(id) => setSelectedNodoId(id)}
                onMarcarOcurrido={handleMarcarOcurrido}
                onToggleRiesgo={handleToggleRiesgo}
                onAgregarHijo={(id) => setCrearParaNodoId(id)}
                onEditar={editarNodo}
                onEliminar={handleEliminar}
              />
            ) : null}
          </>
        )}
      </div>

      <CrearNodoDialog
        open={crearParaNodoId !== null}
        onClose={() => setCrearParaNodoId(null)}
        onCrear={async (titulo, descripcion) => {
          if (!crearParaNodoId) return false;
          const ok = await crearHijo(crearParaNodoId, titulo, descripcion);
          if (ok) setCrearParaNodoId(null);
          return ok;
        }}
      />

      <Dialog open={reiniciarOpen} onOpenChange={(v) => !v && !reiniciando && setReiniciarOpen(false)}>
        <DialogContent className="sm:max-w-md" showCloseButton={!reiniciando}>
          <DialogHeader>
            <DialogTitle>Reiniciar mapa procesal</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Esto borra <strong>todo el progreso del mapa</strong> (nodos,
            estados y nodos agregados a mano) y lo reinstancia desde cero con el
            flujo procesal del fuero elegido. No se puede deshacer.
          </p>
          <div className="space-y-1.5">
            <Label>Fuero del mapa nuevo</Label>
            <SelectorFuero
              value={fueroReiniciar}
              onChange={setFueroReiniciar}
              disabled={reiniciando}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReiniciarOpen(false)}
              disabled={reiniciando}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleReiniciar}
              disabled={reiniciando || fueroReiniciar === null}
            >
              {reiniciando ? <Loader2 className="size-4 animate-spin" /> : null}
              {reiniciando ? "Reiniciando..." : "Reiniciar mapa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Toaster position="top-center" richColors />
    </div>
  );
}

// Selector de fuero como cards clickeables (usado en el init y en Reiniciar).
function SelectorFuero({
  value,
  onChange,
  disabled,
}: {
  value: Fuero | null;
  onChange: (f: Fuero) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Fuero"
      className="flex w-full max-w-md flex-col gap-2"
    >
      {FUEROS.map((f) => {
        const selected = value === f;
        return (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(f)}
            className={cn(
              "rounded-lg border px-4 py-2.5 text-left text-sm transition-colors disabled:opacity-50",
              selected
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
            )}
          >
            {FUERO_LABEL[f]}
          </button>
        );
      })}
    </div>
  );
}

function CrearNodoDialog({
  open,
  onClose,
  onCrear,
}: {
  open: boolean;
  onClose: () => void;
  onCrear: (titulo: string, descripcion: string) => Promise<boolean>;
}) {
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    if (open) {
      setTitulo("");
      setDescripcion("");
    }
  }, [open]);

  const tituloTrim = titulo.trim();

  const crear = async () => {
    if (creando || tituloTrim.length === 0) return;
    setCreando(true);
    try {
      await onCrear(tituloTrim, descripcion.trim());
    } finally {
      setCreando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !creando && onClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={!creando}>
        <DialogHeader>
          <DialogTitle>Agregar evento hijo</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="nuevo-nodo-titulo">Título</Label>
            <Input
              id="nuevo-nodo-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={200}
              placeholder="Ej: Recurso de apelación"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nuevo-nodo-desc">Descripción (opcional)</Label>
            <Textarea
              id="nuevo-nodo-desc"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={creando}>
            Cancelar
          </Button>
          <Button onClick={crear} disabled={creando || tituloTrim.length === 0}>
            {creando ? <Loader2 className="size-4 animate-spin" /> : null}
            {creando ? "Creando..." : "Crear nodo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
