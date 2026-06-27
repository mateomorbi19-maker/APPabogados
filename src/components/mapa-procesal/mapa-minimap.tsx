"use client";
import { MiniMap, type Node } from "@xyflow/react";
import { categoriaNodo, type Categoria, type NodoData } from "@/lib/mapa-procesal/layout";

// Color del nodo en el minimap = misma categoría/paleta que los orbes del mapa.
const COLOR_ESTADO: Record<Categoria, string> = {
  ejecutada: "#34d399",
  posible: "#60a5fa",
  decision: "#fbbf24",
  riesgo: "#f87171",
};

function colorNodo(n: Node): string {
  const data = n.data as NodoData | undefined;
  if (!data || data.estado === "bloqueado") return "#4b5563"; // legacy/bloqueado
  return COLOR_ESTADO[categoriaNodo(data)];
}

export function MapaMinimap() {
  return (
    <MiniMap
      nodeColor={colorNodo}
      nodeStrokeWidth={2}
      maskColor="rgba(10,14,23,0.65)"
      pannable
      zoomable
      className="!rounded-lg !border !border-border !bg-card"
    />
  );
}
