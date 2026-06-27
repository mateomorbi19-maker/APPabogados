// Cálculo de posiciones del árbol con dagre + conversión a formato ReactFlow.
import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import type { EstadoNodo, NodoProcesalDB, TipoNodo } from "./types";

// Data que viaja a los componentes custom de nodo/edge.
export type NodoData = {
  titulo: string;
  tipo: TipoNodo;
  estado: EstadoNodo;
  // Persiste en DB: marca de riesgo alto (render rojo).
  riesgoAlto: boolean;
  // DERIVADO acá (no persiste): el nodo tiene >=2 hijos y ninguno está aún en
  // estado 'ocurrido' → "decisión pendiente" (render amarillo). Se calcula a
  // partir del set completo de nodos en calcularLayout.
  decisionPendiente: boolean;
};
export type NodoFlow = Node<NodoData, "nodoProcesal">;

export type EdgeData = { estadoTarget: EstadoNodo };
export type EdgeFlow = Edge<EdgeData, "edgeProcesal">;

// Diámetro del nodo según tipo/estado. Compartido entre el layout (alimenta a
// dagre) y el componente del nodo (tamaño de render) para que coincidan.
export function diametroNodo(tipo: TipoNodo, estado: EstadoNodo): number {
  if (tipo === "raiz") return 70;
  if (estado === "bloqueado") return 48;
  return 56;
}

const RANK_SEP = 120; // separación entre niveles
const NODE_SEP = 80; // separación entre nodos del mismo nivel

export function calcularLayout(nodos: NodoProcesalDB[]): {
  nodes: NodoFlow[];
  edges: EdgeFlow[];
} {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: RANK_SEP, nodesep: NODE_SEP });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodos) {
    const s = diametroNodo(n.tipo, n.estado);
    g.setNode(n.id, { width: s, height: s });
  }

  const edges: EdgeFlow[] = [];
  for (const n of nodos) {
    if (n.padre_id) {
      g.setEdge(n.padre_id, n.id);
      edges.push({
        id: `${n.padre_id}->${n.id}`,
        source: n.padre_id,
        target: n.id,
        type: "edgeProcesal",
        data: { estadoTarget: n.estado },
        // Animación de flujo solo hacia nodos desbloqueados (próximo paso).
        animated: n.estado === "desbloqueado",
      });
    }
  }

  dagre.layout(g);

  // Índice de hijos por padre, para derivar "decisión pendiente" (>=2 hijos y
  // ninguno 'ocurrido'). Se computa una vez sobre todo el set de nodos.
  const hijosPorPadre = new Map<string, NodoProcesalDB[]>();
  for (const n of nodos) {
    if (!n.padre_id) continue;
    const arr = hijosPorPadre.get(n.padre_id) ?? [];
    arr.push(n);
    hijosPorPadre.set(n.padre_id, arr);
  }

  const nodes: NodoFlow[] = nodos.map((n) => {
    const s = diametroNodo(n.tipo, n.estado);
    const pos = g.node(n.id) as { x: number; y: number } | undefined;
    const hijos = hijosPorPadre.get(n.id) ?? [];
    const decisionPendiente =
      hijos.length >= 2 && hijos.every((h) => h.estado !== "ocurrido");
    // dagre devuelve el centro; ReactFlow posiciona por la esquina top-left.
    return {
      id: n.id,
      type: "nodoProcesal",
      position: { x: (pos?.x ?? 0) - s / 2, y: (pos?.y ?? 0) - s / 2 },
      data: {
        titulo: n.titulo,
        tipo: n.tipo,
        estado: n.estado,
        riesgoAlto: n.riesgo_alto,
        decisionPendiente,
      },
    };
  });

  return { nodes, edges };
}
