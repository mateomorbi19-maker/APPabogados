"use client";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { EdgeFlow } from "@/lib/mapa-procesal/layout";

// Edge curvo (bezier). Hacia nodos bloqueados: punteado gris. Hacia
// ocurrido/desbloqueado: línea sólida violácea (la animación de flujo de los
// desbloqueados la activa `animated` en el objeto edge → CSS de ReactFlow).
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

  const bloqueado = data?.estadoTarget === "bloqueado";

  return (
    <BaseEdge
      path={path}
      markerEnd={markerEnd}
      style={
        bloqueado
          ? {
              stroke: "rgba(130,130,140,0.30)",
              strokeWidth: 1.5,
              strokeDasharray: "5 5",
            }
          : { stroke: "rgba(127,119,221,0.45)", strokeWidth: 2 }
      }
    />
  );
}
