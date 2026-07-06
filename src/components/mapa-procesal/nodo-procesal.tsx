"use client";
import { createElement } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  categoriaNodo,
  diametroNodo,
  type Categoria,
  type NodoFlow,
} from "@/lib/mapa-procesal/layout";
import { ETAPA_COLOR, ETAPA_LABEL } from "@/lib/mapa-procesal/etapas";
import { iconoDeNodo } from "@/lib/mapa-procesal/iconos";

// ============================================================================
// TRATAMIENTO VISUAL DEL NODO — v2 (presencia y vida) — ⚠️ PROVISORIO
// ----------------------------------------------------------------------------
// La LÓGICA estado→categoría y su precedencia viven en layout.ts (categoriaNodo)
// y NO se tocan acá. El relleno/borde/glow/pulso de cada orbe viven en las
// clases .el-orb-* de globals.css; acá solo elegimos la clase por categoría y
// los colores de ícono/label (tokens --el-estado-*-icon/-label). Centralizado
// para ajustar la intensidad fácil.
// ============================================================================

// Clase de orbe (globals.css) por categoría.
const ORB_CLASS: Record<Categoria, string> = {
  ejecutada: "el-orb-ejecutada",
  riesgo: "el-orb-riesgo",
  decision: "el-orb-decision",
  posible: "el-orb-posible",
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
  const ejecutadaNoRaiz = cat === "ejecutada" && !esRaiz;
  const iconSize = Math.round(d * 0.4); // ~26px en un orbe de 66

  return (
    <div className="relative" style={{ width: d, height: d }}>
      <div
        className={cn(
          "relative flex h-full w-full items-center justify-center rounded-full",
          // Hover: escala + brillo. transition solo de transform/filter para no
          // pisar la animación de box-shadow (pulso). El scale del orbe NO choca
          // con el translate que ReactFlow aplica al wrapper del nodo.
          "transition-[transform,filter] duration-[250ms] ease-[cubic-bezier(.2,.8,.2,1)]",
          bloqueado
            ? "cursor-default border-[1.5px] border-[rgba(130,130,140,0.4)] bg-[#101019] opacity-60 shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
            : cn(ORB_CLASS[cat], "cursor-pointer hover:scale-[1.09] hover:brightness-125"),
          // Selección vía outline (no box-shadow) para que conviva con el glow.
          selected &&
            "outline-offset-2 [outline:2px_solid_var(--el-violet-light)]",
        )}
      >
        <Handle type="target" position={Position.Top} className={HANDLE_CLS} />

        {createElement(icono, {
          size: iconSize,
          strokeWidth: 1.75,
          className: cn("shrink-0", bloqueado && "text-gray-500"),
          style: bloqueado
            ? undefined
            : { color: `var(--el-estado-${cat}-icon)` },
        })}

        {/* Chip de ETAPA (1-6) arriba a la izquierda: color por macro-fase del
            proceso (Fase D). Canal visual separado del estado del orbe. */}
        {!bloqueado ? (
          <span
            className="pointer-events-auto absolute -left-1.5 -top-1.5 flex size-[18px] items-center justify-center rounded-full text-[10px] font-bold leading-none text-[#0b0e14] ring-1 ring-black/50"
            style={{ background: ETAPA_COLOR[data.etapa] }}
            title={`Fase ${data.etapa} · ${ETAPA_LABEL[data.etapa]}`}
          >
            {data.etapa}
          </span>
        ) : null}

        {/* Badge de etapa completada (verde) arriba a la derecha. */}
        {ejecutadaNoRaiz ? (
          <span
            className="absolute -right-1.5 -top-1.5 flex size-[22px] items-center justify-center rounded-full text-[#06281e] shadow-[0_0_12px_rgba(52,211,153,0.7)]"
            style={{ background: "#34d399" }}
          >
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        ) : null}

        <Handle type="source" position={Position.Bottom} className={HANDLE_CLS} />
      </div>

      {/* Label debajo del orbe (estilo skill tree). Absoluto → no agranda el
          nodo ni mueve los handles; dagre sigue midiendo solo el círculo. */}
      <span
        className="pointer-events-none absolute left-1/2 top-[calc(100%+8px)] w-28 -translate-x-1/2 text-center text-[10px] font-medium leading-tight line-clamp-2"
        style={{
          color: bloqueado
            ? "#6b7280"
            : `var(--el-estado-${cat}-label)`,
        }}
      >
        {titulo}
      </span>
    </div>
  );
}
