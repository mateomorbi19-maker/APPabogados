// Layout del árbol: posiciones persistidas ("memoria del mapa", Fase E) con
// dagre como sembrador inicial + conversión a formato ReactFlow.
import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { ETAPA_ANCHOR_POR_TITULO, type Etapa } from "./etapas";
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
  // DERIVADO acá (no persiste): macro-fase del proceso (1-6) para el chip de
  // color por etapa. Anclas por título de etapa troncal; el resto hereda del
  // ancestro más cercano (ver etapas.ts).
  etapa: Etapa;
};
export type NodoFlow = Node<NodoData, "nodoProcesal">;

// === Categoría visual del nodo (estado → color) — fuente única ===
// Vive acá (y no en nodo-procesal.tsx) para que tanto el nodo como el edge
// (que se colorea según su nodo destino) compartan EXACTAMENTE la misma lógica
// y precedencia, sin duplicarla. La precedencia (de mayor a menor) es:
//   Ejecutada (verde) > Riesgo alto (rojo) > Decisión pendiente (amarillo) > Posible (azul)
export type Categoria = "ejecutada" | "riesgo" | "decision" | "posible";

export function categoriaNodo(data: NodoData): Categoria {
  if (data.estado === "ocurrido") return "ejecutada"; // incluye la raíz 'ocurrido'
  if (data.riesgoAlto) return "riesgo";
  if (data.decisionPendiente) return "decision";
  return "posible";
}

// El edge lleva la categoría de su nodo ORIGEN y DESTINO para pintar un
// gradiente origen→destino (mismos colores que los nodos).
export type EdgeData = {
  estadoTarget: EstadoNodo;
  categoriaSource: Categoria;
  categoriaTarget: Categoria;
};
export type EdgeFlow = Edge<EdgeData, "edgeProcesal">;

// Diámetro del nodo según tipo/estado. Compartido entre el layout (alimenta a
// dagre) y el componente del nodo (tamaño de render) para que coincidan.
export function diametroNodo(tipo: TipoNodo, estado: EstadoNodo): number {
  if (tipo === "raiz") return 76;
  if (estado === "bloqueado") return 56;
  return 66; // orbe estándar (~66px) que aloja ícono (~26px) + glow
}

// Spacing amplio: los glows v2 se extienden bastante (hasta ~46px del borde, y
// los pulsos hasta ~64-66px). Más aire para que los halos no se pisen entre
// nodos vecinos, y para el label que va DEBAJO del orbe.
// Exportados: queries.ts los usa para ubicar nodos hijos creados a mano.
export const RANK_SEP = 170; // separación entre niveles (vertical)
export const NODE_SEP = 130; // separación entre nodos del mismo nivel (horizontal)

export type PosicionXY = { x: number; y: number };

// Corre dagre sobre el árbol y devuelve la posición TOP-LEFT de cada nodo
// (convención ReactFlow — es exactamente lo que se persiste en
// posicion_x/posicion_y). Se usa para SEMBRAR posiciones (plantilla nueva,
// mapas pre-Fase E) y para el botón "Reordenar" del toolbar.
export function calcularPosiciones(
  nodos: Array<Pick<NodoProcesalDB, "id" | "padre_id" | "tipo" | "estado">>,
): Map<string, PosicionXY> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: RANK_SEP, nodesep: NODE_SEP });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodos) {
    const s = diametroNodo(n.tipo, n.estado);
    g.setNode(n.id, { width: s, height: s });
  }
  for (const n of nodos) {
    if (n.padre_id) g.setEdge(n.padre_id, n.id);
  }

  dagre.layout(g);

  const posiciones = new Map<string, PosicionXY>();
  for (const n of nodos) {
    const s = diametroNodo(n.tipo, n.estado);
    const pos = g.node(n.id) as { x: number; y: number } | undefined;
    // dagre devuelve el centro; ReactFlow posiciona por la esquina top-left.
    posiciones.set(n.id, {
      x: (pos?.x ?? 0) - s / 2,
      y: (pos?.y ?? 0) - s / 2,
    });
  }
  return posiciones;
}

export function calcularLayout(nodos: NodoProcesalDB[]): {
  nodes: NodoFlow[];
  edges: EdgeFlow[];
} {
  // Posición: la fuente de verdad son posicion_x/posicion_y persistidas
  // ("memoria del mapa" — el mapa queda exactamente como lo dejó el abogado).
  // Fallback a dagre SOLO para mapas sembrados antes de Fase E, que quedaron
  // con TODAS las filas en el default (0,0); la view los auto-siembra al
  // detectarlos, así el fallback se usa una única carga.
  const sinSembrar =
    nodos.length > 0 &&
    nodos.every((n) => n.posicion_x === 0 && n.posicion_y === 0);
  const dagrePos = sinSembrar ? calcularPosiciones(nodos) : null;

  // Índice de hijos por padre, para derivar "decisión pendiente" (>=2 hijos y
  // ninguno 'ocurrido'). Se computa una vez sobre todo el set de nodos.
  const hijosPorPadre = new Map<string, NodoProcesalDB[]>();
  for (const n of nodos) {
    if (!n.padre_id) continue;
    const arr = hijosPorPadre.get(n.padre_id) ?? [];
    arr.push(n);
    hijosPorPadre.set(n.padre_id, arr);
  }

  // Etapa (1-6) por nodo: ancla por título de etapa troncal, o herencia del
  // ancestro más cercano. Memoizado; el guard `enCurso` corta ante un ciclo
  // (imposible por construcción, pero mejor degradar a 1 que colgar el render).
  const porId = new Map(nodos.map((n) => [n.id, n]));
  const etapaPorId = new Map<string, Etapa>();
  const enCurso = new Set<string>();
  const resolverEtapa = (id: string): Etapa => {
    const memo = etapaPorId.get(id);
    if (memo) return memo;
    if (enCurso.has(id)) return 1;
    enCurso.add(id);
    const n = porId.get(id);
    const etapa: Etapa = !n
      ? 1
      : ETAPA_ANCHOR_POR_TITULO[n.titulo] ??
        (n.padre_id ? resolverEtapa(n.padre_id) : 1);
    enCurso.delete(id);
    etapaPorId.set(id, etapa);
    return etapa;
  };
  for (const n of nodos) resolverEtapa(n.id);

  // decisión pendiente + categoría por nodo, una sola vez. La categoría se usa
  // tanto en el nodo como en el edge (que toma la de su nodo destino).
  const decisionPorId = new Map<string, boolean>();
  const categoriaPorId = new Map<string, Categoria>();
  for (const n of nodos) {
    const hijos = hijosPorPadre.get(n.id) ?? [];
    const decisionPendiente =
      hijos.length >= 2 && hijos.every((h) => h.estado !== "ocurrido");
    decisionPorId.set(n.id, decisionPendiente);
    categoriaPorId.set(
      n.id,
      categoriaNodo({
        titulo: n.titulo,
        tipo: n.tipo,
        estado: n.estado,
        riesgoAlto: n.riesgo_alto,
        decisionPendiente,
        etapa: etapaPorId.get(n.id) ?? 1,
      }),
    );
  }

  const edges: EdgeFlow[] = [];
  for (const n of nodos) {
    if (n.padre_id) {
      edges.push({
        id: `${n.padre_id}->${n.id}`,
        source: n.padre_id,
        target: n.id,
        type: "edgeProcesal",
        data: {
          estadoTarget: n.estado,
          categoriaSource: categoriaPorId.get(n.padre_id) ?? "posible",
          categoriaTarget: categoriaPorId.get(n.id) ?? "posible",
        },
      });
    }
  }

  const nodes: NodoFlow[] = nodos.map((n) => {
    const position =
      dagrePos?.get(n.id) ?? { x: n.posicion_x, y: n.posicion_y };
    return {
      id: n.id,
      type: "nodoProcesal",
      position,
      data: {
        titulo: n.titulo,
        tipo: n.tipo,
        estado: n.estado,
        riesgoAlto: n.riesgo_alto,
        decisionPendiente: decisionPorId.get(n.id) ?? false,
        etapa: etapaPorId.get(n.id) ?? 1,
      },
    };
  });

  return { nodes, edges };
}
