"use client";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
  type OnBeforeDelete,
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
import {
  calcularLayout,
  calcularPosiciones,
  type EdgeFlow,
  type NodoFlow,
} from "@/lib/mapa-procesal/layout";
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
  const { fitView, getViewport, setViewport } = useReactFlow();
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
  // Sugerencia del server (heurística jurisdicción/relato); pre-carga el
  // selector y marca la card con el badge "Sugerido". El abogado confirma.
  const [fueroSugerido, setFueroSugerido] = useState<Fuero | null>(null);
  const [reordenando, setReordenando] = useState(false);
  // Pila de deshacer para borrados: cada entrada es el subárbol COMPLETO
  // capturado antes del DELETE (se restaura con los mismos ids). Vive en un
  // ref (no re-renderiza); undoDepth solo habilita/deshabilita el botón.
  const undoStackRef = useRef<Array<{ nodos: NodoProcesalDB[] }>>([]);
  const [undoDepth, setUndoDepth] = useState(0);

  const [nodes, setNodes, onNodesChange] = useNodesState<NodoFlow>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<EdgeFlow>([]);

  // === Pan estilo n8n: Ctrl + click izquierdo arrastra el tablero ===
  // xyflow FILTRA ctrl+mousedown en su motor interno de zoom/pan (lo reserva
  // para pinch), así que panActivationKeyCode="Control" NO funciona con esa
  // tecla. Lo hacemos a mano: interceptamos el gesto en fase CAPTURA (antes de
  // que el pane abra la caja de selección) y movemos el viewport con panBy.
  // preventDefault en el pointerdown suprime los mouse events de
  // compatibilidad → el pane nunca ve el mousedown.
  const panOrigenRef = useRef<{ x: number; y: number } | null>(null);
  const [ctrlDown, setCtrlDown] = useState(false);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Control") setCtrlDown(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Control") setCtrlDown(false);
    };
    const blur = () => setCtrlDown(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const onPanStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey && e.button === 0)) return;
    panOrigenRef.current = { x: e.clientX, y: e.clientY };
    setPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onPanMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!panOrigenRef.current) return;
      const dx = e.clientX - panOrigenRef.current.x;
      const dy = e.clientY - panOrigenRef.current.y;
      panOrigenRef.current = { x: e.clientX, y: e.clientY };
      const v = getViewport();
      void setViewport({ ...v, x: v.x + dx, y: v.y + dy });
      e.preventDefault();
      e.stopPropagation();
    },
    [getViewport, setViewport],
  );

  const onPanEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!panOrigenRef.current) return;
    panOrigenRef.current = null;
    setPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    e.stopPropagation();
  }, []);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/casos/${casoId}/mapa`);
      const json = (await res.json().catch(() => null)) as
        | {
            ok: true;
            inicializado: boolean;
            nodos: NodoProcesalDB[];
            fuero: Fuero | null;
            fuero_sugerido: Fuero | null;
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
      // Auto-siembra de mapas creados antes de Fase E (todas las posiciones en
      // el default 0,0): corre dagre UNA vez acá, renderiza ya sembrado y
      // persiste en background. Las cargas siguientes entran por el camino
      // normal (posiciones de la DB).
      let nodos = json.nodos;
      if (
        nodos.length > 0 &&
        nodos.every((n) => n.posicion_x === 0 && n.posicion_y === 0)
      ) {
        const posiciones = calcularPosiciones(nodos);
        nodos = nodos.map((n) => {
          const p = posiciones.get(n.id);
          return p ? { ...n, posicion_x: p.x, posicion_y: p.y } : n;
        });
        void fetch(`/api/casos/${casoId}/mapa/nodos`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            posiciones: nodos.map((n) => ({
              id: n.id,
              posicion_x: n.posicion_x,
              posicion_y: n.posicion_y,
            })),
          }),
        }).catch(() => {
          // Siembra fallida: el mapa se ve bien igual (dagre local) y se
          // reintenta sola en la próxima carga.
        });
      }
      setEstado({
        status: "ready",
        inicializado: json.inicializado,
        nodos,
        fuero: json.fuero,
      });
      setFueroSugerido(json.fuero_sugerido ?? null);
      // Pre-carga del selector de inicialización: fuero guardado > sugerencia.
      // Functional update para no pisar una elección manual si cargar() se
      // re-ejecuta (p. ej. tras un error de init).
      if (!json.inicializado) {
        setFueroInit(
          (prev) => prev ?? json.fuero ?? json.fuero_sugerido ?? null,
        );
      }
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

  // PATCH batch de posiciones (siembra + Reordenar).
  const persistirPosiciones = useCallback(
    async (
      posiciones: Array<{ id: string; posicion_x: number; posicion_y: number }>,
    ) => {
      const res = await fetch(`/api/casos/${casoId}/mapa/nodos`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ posiciones }),
      });
      return res.ok;
    },
    [casoId],
  );

  // Auto-guardado al soltar nodos (memoria del mapa): con multi-selección se
  // arrastran VARIOS a la vez — persistimos todos en un PATCH batch. Update
  // optimista local, sin recarga completa.
  const onNodeDragStop = useCallback(
    (_: unknown, node: NodoFlow, arrastrados: NodoFlow[]) => {
      const movidos = arrastrados.length > 0 ? arrastrados : [node];
      const porId = new Map(movidos.map((m) => [m.id, m]));
      setEstado((prev) =>
        prev.status === "ready"
          ? {
              ...prev,
              nodos: prev.nodos.map((n) => {
                const m = porId.get(n.id);
                return m
                  ? { ...n, posicion_x: m.position.x, posicion_y: m.position.y }
                  : n;
              }),
            }
          : prev,
      );
      void persistirPosiciones(
        movidos.map((m) => ({
          id: m.id,
          posicion_x: m.position.x,
          posicion_y: m.position.y,
        })),
      )
        .then((ok) => {
          if (!ok) toast.error("No se pudo guardar la posición");
        })
        .catch(() => toast.error("Error de red guardando la posición"));
    },
    [persistirPosiciones],
  );

  // "Reordenar": re-corre dagre sobre el árbol completo, persiste y
  // re-encuadra. Escape hatch para cuando el mapa quedó desordenado a mano.
  const handleReordenar = useCallback(async () => {
    if (estado.status !== "ready" || reordenando) return;
    setReordenando(true);
    try {
      const posiciones = calcularPosiciones(estado.nodos);
      const nodosOrdenados = estado.nodos.map((n) => {
        const p = posiciones.get(n.id);
        return p ? { ...n, posicion_x: p.x, posicion_y: p.y } : n;
      });
      const ok = await persistirPosiciones(
        nodosOrdenados.map((n) => ({
          id: n.id,
          posicion_x: n.posicion_x,
          posicion_y: n.posicion_y,
        })),
      );
      if (!ok) {
        toast.error("No se pudo guardar el reordenamiento");
        return;
      }
      setEstado({ ...estado, nodos: nodosOrdenados });
      window.setTimeout(
        () => void fitView({ padding: 0.25, duration: 400 }),
        50,
      );
    } catch {
      toast.error("Error de red al reordenar");
    } finally {
      setReordenando(false);
    }
  }, [estado, reordenando, persistirPosiciones, fitView]);

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
      // Mapa nuevo: cualquier entrada de deshacer previa quedó huérfana.
      undoStackRef.current = [];
      setUndoDepth(0);
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

  // Simulación IA (Fase C): POST al endpoint, que llama al modelo y persiste
  // las ramas como nodos 'prediccion'. La espera se muestra en el botón del
  // panel (10-30s); al terminar recargamos el mapa completo.
  const handleSimular = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/casos/${casoId}/mapa/simular`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nodo_id: id }),
        });
        const json = (await res.json().catch(() => null)) as
          | { ok: true; nodos: NodoProcesalDB[] }
          | { ok: false; error?: string }
          | null;
        if (!res.ok || !json || json.ok === false) {
          toast.error(
            json && "error" in json && json.error
              ? json.error
              : "No se pudo simular",
          );
          return;
        }
        toast.success(
          `La IA propuso ${json.nodos.length} rama${json.nodos.length === 1 ? "" : "s"} posible${json.nodos.length === 1 ? "" : "s"}`,
        );
        await cargar();
      } catch {
        toast.error("Error de red al simular");
      }
    },
    [casoId, cargar],
  );

  // Deshacer el último borrado: re-inserta el subárbol capturado (mismos ids,
  // posiciones y estados). Si el padre externo ya no existe, la entrada se
  // descarta con error (no hay dónde colgarla).
  const handleDeshacer = useCallback(async () => {
    const entry = undoStackRef.current.pop();
    setUndoDepth(undoStackRef.current.length);
    if (!entry) return;
    const payload = entry.nodos.map((n) => ({
      id: n.id,
      titulo: n.titulo,
      descripcion: n.descripcion,
      tipo: n.tipo as "real" | "prediccion",
      estado: n.estado,
      padre_id: n.padre_id as string,
      riesgo_alto: n.riesgo_alto,
      posicion_x: n.posicion_x,
      posicion_y: n.posicion_y,
    }));
    try {
      const res = await fetch(`/api/casos/${casoId}/mapa/nodos/restaurar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodos: payload }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !json || json.ok === false) {
        toast.error(
          json && "error" in json && json.error
            ? json.error
            : "No se pudo deshacer el borrado",
        );
        return;
      }
      toast.success(
        `Se ${payload.length === 1 ? "restauró 1 nodo" : `restauraron ${payload.length} nodos`}`,
      );
      await cargar();
    } catch {
      toast.error("Error de red al deshacer");
    }
  }, [casoId, cargar]);

  // Borrado unificado (panel y tecla Supr, uno o varios): captura los
  // subárboles ANTES de borrar (para Deshacer), deduplica descendientes de
  // otros seleccionados (el cascade ya los cubre) y protege la raíz.
  const handleEliminarNodos = useCallback(
    async (idsRaw: string[]) => {
      if (estado.status !== "ready") return;
      const todos = estado.nodos;
      const porId = new Map(todos.map((n) => [n.id, n]));
      let ids = idsRaw.filter((id) => porId.has(id));
      if (ids.some((id) => porId.get(id)!.tipo === "raiz")) {
        toast.error("El nodo raíz no se puede eliminar");
        ids = ids.filter((id) => porId.get(id)!.tipo !== "raiz");
      }
      if (ids.length === 0) return;

      // Top-level: descartar seleccionados que descienden de otro seleccionado.
      const sel = new Set(ids);
      const esTop = (id: string): boolean => {
        let p = porId.get(id)?.padre_id ?? null;
        while (p) {
          if (sel.has(p)) return false;
          p = porId.get(p)?.padre_id ?? null;
        }
        return true;
      };
      const tops = ids.filter(esTop);

      // Captura del subárbol completo de cada top (DFS) para el Deshacer.
      const hijosPor = new Map<string, NodoProcesalDB[]>();
      for (const n of todos) {
        if (!n.padre_id) continue;
        const arr = hijosPor.get(n.padre_id) ?? [];
        arr.push(n);
        hijosPor.set(n.padre_id, arr);
      }
      const capturados: NodoProcesalDB[] = [];
      const walk = (id: string) => {
        const n = porId.get(id);
        if (!n) return;
        capturados.push(n);
        for (const h of hijosPor.get(id) ?? []) walk(h.id);
      };
      for (const t of tops) walk(t);

      let fallo = false;
      for (const id of tops) {
        const res = await fetch(`/api/casos/${casoId}/mapa/nodos/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          fallo = true;
          const json = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          toast.error(json?.error ?? `Error eliminando (HTTP ${res.status})`);
        }
      }
      setSelectedNodoId(null);

      if (!fallo) {
        undoStackRef.current.push({ nodos: capturados });
        setUndoDepth(undoStackRef.current.length);
        toast.success(
          `${capturados.length === 1 ? "1 nodo eliminado" : `${capturados.length} nodos eliminados`}`,
          { action: { label: "Deshacer", onClick: () => void handleDeshacer() } },
        );
      }
      await cargar();
    },
    [estado, casoId, cargar, handleDeshacer],
  );

  // Veto de ReactFlow antes de borrar con teclado: nunca dejar caer la raíz.
  const onBeforeDelete: OnBeforeDelete<NodoFlow, EdgeFlow> = useCallback(
    async ({ nodes: aBorrar, edges: edgesABorrar }) => {
      const sinRaiz = aBorrar.filter((n) => n.data.tipo !== "raiz");
      if (sinRaiz.length === 0) {
        if (aBorrar.length > 0) toast.error("El nodo raíz no se puede eliminar");
        return false;
      }
      return { nodes: sinRaiz, edges: edgesABorrar };
    },
    [],
  );

  const onNodesDelete = useCallback(
    (borrados: NodoFlow[]) => {
      void handleEliminarNodos(borrados.map((n) => n.id));
    },
    [handleEliminarNodos],
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
      // Mapa reinstanciado: la pila de deshacer apunta a nodos que ya no existen.
      undoStackRef.current = [];
      setUndoDepth(0);
      setReiniciarOpen(false);
      toast.success("Mapa reiniciado con el flujo nuevo");
    } catch {
      toast.error("Error de red al reiniciar");
    } finally {
      setReiniciando(false);
    }
  };

  const onNodeClick = useCallback(
    (e: React.MouseEvent, node: NodoFlow) => {
      // Shift+click = sumar a la multi-selección: no abrir el panel.
      if (e.shiftKey) return;
      if (node.data.estado === "bloqueado") return;
      setSelectedNodoId(node.id);
    },
    [],
  );

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
                setFueroReiniciar(estado.fuero ?? fueroSugerido);
                setReiniciarOpen(true);
              }
            : undefined
        }
        onReordenar={
          estado.status === "ready" && estado.inicializado
            ? handleReordenar
            : undefined
        }
        reordenando={reordenando}
        onDeshacer={undoDepth > 0 ? () => void handleDeshacer() : undefined}
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
              sugerido={fueroSugerido}
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
            {/* Wrapper del pan Ctrl+arrastre: captura el gesto ANTES de que
                el pane de ReactFlow abra la caja de selección. */}
            <div
              className="h-full w-full"
              style={{
                cursor: panning ? "grabbing" : ctrlDown ? "grab" : undefined,
              }}
              onPointerDownCapture={onPanStart}
              onMouseDownCapture={(e) => {
                if (e.ctrlKey && e.button === 0) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              onPointerMove={onPanMove}
              onPointerUp={onPanEnd}
              onPointerCancel={onPanEnd}
            >
              <ReactFlow<NodoFlow, EdgeFlow>
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                onNodeDragStop={onNodeDragStop}
                onPaneClick={onPaneClick}
                onBeforeDelete={onBeforeDelete}
                onNodesDelete={onNodesDelete}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                colorMode="dark"
                fitView
                fitViewOptions={{ padding: 0.25 }}
                minZoom={0.2}
                proOptions={{ hideAttribution: true }}
                style={{ background: "transparent" }}
                // === Interacción estilo n8n ===
                // Click izquierdo + arrastre en el fondo = CAJA DE SELECCIÓN
                // (parcial: alcanza con tocar el nodo). Pan: Ctrl + arrastre
                // (interceptado por el wrapper de arriba), o botón del medio /
                // derecho. Shift+click suma a la selección. Supr/Backspace
                // borra los seleccionados (con Deshacer).
                selectionOnDrag
                selectionMode={SelectionMode.Partial}
                panOnDrag={[1, 2]}
                multiSelectionKeyCode="Shift"
                deleteKeyCode={["Delete", "Backspace"]}
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
            </div>

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
                onSimular={handleSimular}
                onEditar={editarNodo}
                onEliminar={(id) => handleEliminarNodos([id])}
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
              sugerido={fueroSugerido}
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
// `sugerido` marca la opción que la heurística/IA recomendó (badge "Sugerido").
function SelectorFuero({
  value,
  onChange,
  sugerido,
  disabled,
}: {
  value: Fuero | null;
  onChange: (f: Fuero) => void;
  sugerido?: Fuero | null;
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
              "flex items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-left text-sm transition-colors disabled:opacity-50",
              selected
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
            )}
          >
            <span>{FUERO_LABEL[f]}</span>
            {sugerido === f ? (
              <span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                Sugerido
              </span>
            ) : null}
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
