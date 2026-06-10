"use client";
import { MiniMap, type Node } from "@xyflow/react";
import type { NodoData } from "@/lib/mapa-procesal/layout";

// Color del nodo en el minimap según tipo/estado (misma paleta que los nodos).
function colorNodo(n: Node): string {
  const data = n.data as Partial<NodoData> | undefined;
  if (data?.tipo === "raiz") return "#1D9E75";
  if (data?.tipo === "real" || data?.estado === "ocurrido") return "#7F77DD";
  if (data?.estado === "desbloqueado") return "#378ADD";
  return "#4b5563"; // bloqueado
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
