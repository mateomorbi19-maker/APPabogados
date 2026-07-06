"use client";
import { createElement } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  categoriaNodo,
  diametroNodo,
  type Categoria,
  type NodoFlow,
} from "@/lib/mapa-procesal/layout";
import { iconoDeNodo } from "@/lib/mapa-procesal/iconos";

// ============================================================================
// ORBE — tratamiento visual v3 "dossier holográfico".
// Anatomía (de atrás hacia adelante): plataforma difuminada (3D) → orbe
// (relleno radial + rim + glow) → aro/retícula (decisión/riesgo) → ícono →
// specular (gloss) → badges → label debajo.
// El relleno/glow/pulso por estado y los tintes de la plataforma viven en
// globals.css (.el-node-* .el-orb / .el-platform). Acá solo se arma la
// estructura y se eligen los tokens de color de ícono/label. La LÓGICA
// estado→categoría (precedencia) vive en layout.ts (categoriaNodo) y NO se toca
// acá. La ETAPA ya NO se pinta en el nodo: se movió a los carriles de fondo.
// ============================================================================

// Clase de wrapper por categoría (globals.css estila orbe + plataforma).
const NODE_CLASS: Record<Categoria, string> = {
  ejecutada: "el-node-ejecutada",
  riesgo: "el-node-riesgo",
  decision: "el-node-decision",
  posible: "el-node-posible",
};

const HANDLE_CLS = "!h-1.5 !w-1.5 !border-0 !bg-foreground/20";

export function NodoProcesal({ data, selected }: NodeProps<NodoFlow>) {
  const { titulo, tipo, estado } = data;
  const d = diametroNodo(tipo, estado);
  const esRaiz = tipo === "raiz";
  const bloqueado = estado === "bloqueado"; // solo en mapas viejos
  const cat = categoriaNodo(data);
  // Componente de ícono (referencia estable del Record del template). Se
  // renderiza con createElement para no disparar react-hooks/static-components.
  const icono = bloqueado ? Lock : iconoDeNodo(titulo);
  const iconSize = Math.round(d * 0.42); // ~28px en un orbe de 66

  // Mapa viejo (bloqueado): orbe gris apagado, sin la anatomía v3.
  if (bloqueado) {
    return (
      <div className="relative" style={{ width: d, height: d }}>
        <div className="relative flex h-full w-full items-center justify-center rounded-full border-[1.5px] border-[rgba(130,130,140,0.4)] bg-[#101019] opacity-60 shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
          <Handle type="target" position={Position.Top} className={HANDLE_CLS} />
          {createElement(icono, {
            size: iconSize,
            strokeWidth: 1.75,
            className: "shrink-0 text-gray-500",
          })}
          <Handle
            type="source"
            position={Position.Bottom}
            className={HANDLE_CLS}
          />
        </div>
        <span
          className="pointer-events-none absolute left-1/2 top-[calc(100%+8px)] w-28 -translate-x-1/2 text-center text-[10px] font-medium leading-tight line-clamp-2"
          style={{ color: "#6b7280" }}
        >
          {titulo}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn("el-node relative", NODE_CLASS[cat])}
      style={{ width: d, height: d }}
    >
      {/* Plataforma difuminada bajo el orbe (tinte por estado en globals). */}
      <div
        className="el-platform pointer-events-none absolute left-1/2 z-0 -translate-x-1/2 rounded-full"
        style={{
          top: `calc(50% + ${d * 0.44}px)`,
          width: d * 1.55,
          height: d * 0.5,
        }}
      />

      {/* Orbe (relleno/borde/glow/pulso por estado en globals). Hover lift +
          selección por outline (convive con el glow). */}
      <div
        className={cn(
          "el-orb relative z-[1] flex h-full w-full cursor-pointer items-center justify-center rounded-full",
          selected &&
            "outline-offset-[5px] [outline:2px_solid_var(--el-violet-light)]",
        )}
      >
        <Handle type="target" position={Position.Top} className={HANDLE_CLS} />

        {/* Aro de encrucijada (decisión) / retícula rotante (riesgo). */}
        {cat === "decision" ? (
          <span className="el-fork-ring pointer-events-none absolute -inset-[7px] z-0 rounded-full" />
        ) : cat === "riesgo" ? (
          <span className="el-reticle pointer-events-none absolute -inset-[9px] z-0 rounded-full" />
        ) : null}

        {createElement(icono, {
          size: iconSize,
          strokeWidth: 1.7,
          className: "relative z-[1] shrink-0",
          style: { color: `var(--el-estado-${cat}-icon)` },
        })}

        {/* Specular (gloss) arriba-izquierda. */}
        <span
          className="el-specular pointer-events-none absolute z-[2] rounded-full"
          style={{ top: "10%", left: "20%", width: "46%", height: "36%" }}
        />

        {/* Badge: check (ejecutada, no raíz) arriba-derecha / alerta (riesgo)
            arriba-izquierda. La etapa ya no ocupa la esquina izquierda. */}
        {cat === "ejecutada" && !esRaiz ? (
          <span
            className="absolute -right-1.5 -top-1.5 z-[4] flex size-5 items-center justify-center rounded-full"
            style={{
              background: "#0d6b4f",
              boxShadow: "0 0 0 2px #08080c, 0 0 9px rgba(52,211,153,0.6)",
            }}
          >
            <Check
              className="size-3"
              strokeWidth={2.6}
              style={{ color: "#d1fae5" }}
            />
          </span>
        ) : cat === "riesgo" ? (
          <span
            className="absolute -left-1.5 -top-1.5 z-[4] flex size-5 items-center justify-center rounded-full"
            style={{
              background: "#5a1818",
              boxShadow: "0 0 0 2px #08080c, 0 0 9px rgba(248,113,113,0.6)",
            }}
          >
            <AlertTriangle
              className="size-3"
              strokeWidth={2.6}
              style={{ color: "#fecaca" }}
            />
          </span>
        ) : null}

        <Handle
          type="source"
          position={Position.Bottom}
          className={HANDLE_CLS}
        />
      </div>

      {/* Label debajo del orbe. Absoluto → no agranda el nodo ni mueve los
          handles; dagre sigue midiendo solo el círculo. */}
      <span
        className="pointer-events-none absolute left-1/2 top-[calc(100%+9px)] z-[3] w-32 -translate-x-1/2 text-center text-[11px] font-medium leading-tight line-clamp-2"
        style={{ color: `var(--el-estado-${cat}-label)` }}
      >
        {titulo}
      </span>
    </div>
  );
}
