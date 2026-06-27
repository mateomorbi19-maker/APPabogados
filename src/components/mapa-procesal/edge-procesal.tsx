"use client";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { Categoria, EdgeFlow } from "@/lib/mapa-procesal/layout";

// Edge curvo (bezier). El COLOR de la línea sigue la categoría de su nodo
// DESTINO (mismos tokens --el-estado-* que el nodo) + un glow leve con
// drop-shadow. El flujo animado (dash) lo refina el CSS global
// `.react-flow__edge.animated` (solo en edges con animated=true, que el layout
// pone hacia los nodos "posibles"/desbloqueados). Hacia nodos bloqueados (mapas
// viejos): gris punteado, sin color ni glow.
export function EdgeProcesal({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<EdgeFlow>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  if (data?.estadoTarget === "bloqueado") {
    return (
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: "rgba(130,130,140,0.30)",
          strokeWidth: 1.5,
          strokeDasharray: "5 5",
        }}
      />
    );
  }

  const cat: Categoria = data?.categoriaTarget ?? "posible";
  const token = `var(--el-estado-${cat})`;
  // Posible: azul tenue (latente). Resto: el acento pleno.
  const stroke =
    cat === "posible" ? `color-mix(in srgb, ${token} 55%, transparent)` : token;
  const glowPct = cat === "posible" ? 30 : 48;
  const filter = `drop-shadow(0 0 2px color-mix(in srgb, ${token} ${glowPct}%, transparent))`;

  return (
    <BaseEdge
      path={path}
      markerEnd={markerEnd}
      style={{ stroke, strokeWidth: 2, filter }}
    />
  );
}
