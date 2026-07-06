"use client";
import { getBezierPath, type EdgeProps } from "@xyflow/react";
import type { Categoria, EdgeFlow } from "@/lib/mapa-procesal/layout";

// Conexión con estado (v3): el color es un gradiente userSpaceOnUse del color
// del estado del nodo ORIGEN al del DESTINO (nunca gris plano). Trazos:
//   • halo: ancho, translúcido, estático.
//   • core: fino, sólido con el degradé — la línea principal. Entre dos
//     ejecutadas (el "tronco real recorrido") va un toque más brillante.
//   • flujo: SOLO en caminos vivos (destino = decisión o riesgo) — punteado con
//     dash animado (energía bajando). Los caminos hacia posible/ejecutada van
//     sólidos y quietos: el motion queda reservado para lo que todavía está en
//     juego. Hacia nodos bloqueados (mapas viejos): gris punteado, sin energía.
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
  // Energía animada SOLO si el destino sigue "en juego" (decisión o riesgo).
  const esVivo = catTarget === "decision" || catTarget === "riesgo";
  // Tronco real recorrido (ejecutada→ejecutada): core más brillante.
  const esTronco = catSource === "ejecutada" && catTarget === "ejecutada";

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
        style={{ opacity: 0.18 }}
      />

      {/* Core: la línea principal, sólida con el degradé. Lleva la flecha. */}
      <path
        d={path}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={esTronco ? 2.6 : 2}
        strokeLinecap="round"
        markerEnd={markerEnd}
        style={{ opacity: esTronco ? 1 : 0.92 }}
      />

      {/* Flujo: SOLO en caminos vivos — punteado con dash animado (energía). */}
      {esVivo ? (
        <path
          d={path}
          fill="none"
          stroke={COLOR_ESTADO[catTarget]}
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="5 7"
          className="el-edge-flujo"
          style={{ opacity: 0.85 }}
        />
      ) : null}
    </>
  );
}
