"use client";
import { type CSSProperties } from "react";

// Overlay de 18 partículas (violeta de marca) flotando hacia arriba con fade,
// para dar profundidad al fondo del canvas. Va ENTRE el fondo y los nodos
// (z-0, pointer-events-none). La animación (.el-particula) se apaga con
// prefers-reduced-motion.
//
// Posiciones/duraciones/delays son pseudo-aleatorios DETERMINÍSTICOS (derivados
// del índice con offsets tipo golden-ratio): se ven dispersos pero son iguales
// en server y cliente, así que no hace falta useEffect ni hay hydration
// mismatch (y nada de Math.random en render).
const PARTICULAS = Array.from({ length: 18 }, (_, i) => ({
  id: i,
  left: (i * 61.8 + 9) % 100, // %
  bottom: (i * 38.2 + 13) % 100, // %
  dur: 5 + (i % 7), // 5–11s
  delay: ((i * 11) % 80) / 10, // 0–7.9s
}));

export function ParticlesOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      {PARTICULAS.map((p) => (
        <span
          key={p.id}
          className="el-particula absolute size-[3px] rounded-full"
          style={
            {
              left: `${p.left}%`,
              bottom: `${p.bottom}%`,
              background: "rgba(167,139,250,.5)",
              "--el-dur": `${p.dur}s`,
              "--el-delay": `${p.delay}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
