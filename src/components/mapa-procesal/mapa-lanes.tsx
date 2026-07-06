"use client";
import { useViewport } from "@xyflow/react";
import { ETAPA_LABEL, ETAPA_RGB } from "@/lib/mapa-procesal/etapas";
import type { Lane } from "@/lib/mapa-procesal/layout";

// Carriles de ETAPA (v3): bandas horizontales tenues DETRÁS del árbol, una por
// macro-fase presente, con el número + nombre de la fase al margen izquierdo.
// Reemplazan al chip numerado que iba sobre el nodo → separan definitivamente
// el eje "estado" (color del orbe) del eje "etapa" (color de fondo).
//
// Se sincronizan al viewport de React Flow con useViewport (mismo transform que
// nodos/edges), así panéan y zoomean junto con el mapa. Se renderizan como una
// capa aparte, ANTES del <ReactFlow> y detrás de sus nodos/edges (que van sobre
// un fondo transparente). Los rangos verticales los deriva calcularLanes desde
// el layout real (dinámicos por fuero), no están hardcodeados.
export function MapaLanes({ lanes }: { lanes: Lane[] }) {
  const { x, y, zoom } = useViewport();
  if (lanes.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          transformOrigin: "0 0",
          transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        }}
      >
        {lanes.map((lane) => {
          const rgb = ETAPA_RGB[lane.etapa];
          return (
            <div
              key={lane.etapa}
              style={{
                position: "absolute",
                left: lane.left,
                top: lane.top,
                width: lane.width,
                height: lane.height,
              }}
            >
              {/* Banda: degradé horizontal tenue + regla superior. */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `linear-gradient(90deg, rgba(${rgb},0.075) 0%, rgba(${rgb},0.02) 42%, transparent 76%)`,
                  borderTop: `1px solid rgba(${rgb},0.16)`,
                }}
              />
              {/* Label de fase al margen izquierdo. */}
              <div
                style={{
                  position: "relative",
                  margin: "11px 0 0 18px",
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "rgba(255,255,255,0.72)",
                    background: `rgba(${rgb},0.22)`,
                    boxShadow: `inset 0 0 0 1px rgba(${rgb},0.5)`,
                  }}
                >
                  {lane.etapa}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 12,
                    fontWeight: 500,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.42)",
                  }}
                >
                  {ETAPA_LABEL[lane.etapa]}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
