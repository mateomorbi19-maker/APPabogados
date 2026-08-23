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
      // Vidrio oscuro + rect del viewport en violeta (v3).
      maskColor="rgba(8,8,12,0.6)"
      maskStrokeColor="#a78bfa"
      maskStrokeWidth={2}
      pannable
      zoomable
      // El minimapa toma el tamaño default de la librería (200x150 + margen de
      // 15px): en un teléfono de 390px eso es el 55% del ancho y ~29% del alto
      // del canvas, tapando los nodos de un mapa que ya abre chico. Abajo de
      // 768px se esconde — el mapa completo se ve con el pinch.
      className="max-md:hidden !rounded-xl !border !border-[var(--el-glass-border)] !bg-[var(--el-glass)] !backdrop-blur-md"
    />
  );
}
