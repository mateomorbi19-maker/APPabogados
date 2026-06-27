"use client";
import { getBezierPath, type EdgeProps } from "@xyflow/react";
import type { Categoria, EdgeFlow } from "@/lib/mapa-procesal/layout";

// Conexión con "energía fluyendo": dos paths sobre el mismo trazado —
//   • halo: ancho, translúcido, estático.
//   • flujo: fino, punteado, con dash animado (energía bajando por la línea).
// El color es un gradiente userSpaceOnUse del color del estado del nodo ORIGEN
// al del nodo DESTINO. Hacia nodos bloqueados (mapas viejos): gris punteado.
const COLOR_ESTADO: Record<Categoria, string> = {
  ejecutada: "#34d399",
  posible: "#60a5fa",
  decision: "#fbbf24",
  riesgo: "#f87171",
};

export function EdgeProcesal({
  id,
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
      <path
        d={path}
        fill="none"
        stroke="rgba(130,130,140,0.30)"
        strokeWidth={1.5}
        strokeDasharray="5 5"
        markerEnd={markerEnd}
      />
    );
  }

  const catSource: Categoria = data?.categoriaSource ?? "posible";
  const catTarget: Categoria = data?.categoriaTarget ?? "posible";
  // Gradiente único por edge (id del edge), entre los extremos del trazado.
  const gradId = `el-edge-grad-${id}`;

  return (
    <>
      <defs>
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor={COLOR_ESTADO[catSource]} />
          <stop offset="100%" stopColor={COLOR_ESTADO[catTarget]} />
        </linearGradient>
      </defs>

      {/* Halo: ancho y translúcido, sin animación. */}
      <path
        d={path}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={6}
        strokeLinecap="round"
        style={{ opacity: 0.2 }}
      />

      {/* Flujo: fino, punteado, con dash animado (energía bajando). */}
      <path
        d={path}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="5 7"
        markerEnd={markerEnd}
        className="el-edge-flujo"
        style={{ opacity: 0.8 }}
      />
    </>
  );
}
