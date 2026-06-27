"use client";
import { createElement, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  categoriaNodo,
  diametroNodo,
  type Categoria,
  type NodoFlow,
} from "@/lib/mapa-procesal/layout";
import { iconoDeNodo } from "@/lib/mapa-procesal/plantilla-base";

// ============================================================================
// TRATAMIENTO VISUAL DEL NODO — ⚠️ PROVISORIO (rediseño visual)
// ----------------------------------------------------------------------------
// La LÓGICA estado→categoría y su precedencia viven en layout.ts (categoriaNodo)
// y NO se tocan acá. Esto define solo CÓMO se ve cada categoría: tono (tokens
// --el-estado-*), borde, fill, glow y si pulsa. Centralizado para iterar rápido.
//
//   ejecutada → verde, "encendida": borde brillante, glow estático, check.
//   posible   → azul apagado, "latente": fill card, borde tenue, sin glow, dim.
//   decision  → ámbar, llama la atención: borde brillante, glow con pulso sutil.
//   riesgo    → rojo, alerta sin estridencia: borde+glow rojos, pulso sutil.
// ============================================================================

type Glow = "none" | "static" | "pulse";

const VISUAL: Record<Categoria, { token: string; glow: Glow; dim: boolean }> = {
  ejecutada: { token: "--el-estado-ejecutada", glow: "static", dim: false },
  riesgo: { token: "--el-estado-riesgo", glow: "pulse", dim: false },
  decision: { token: "--el-estado-decision", glow: "pulse", dim: false },
  posible: { token: "--el-estado-posible", glow: "none", dim: true },
};

// Estilo inline del círculo según categoría (borde, fill y --el-glow para las
// clases de glow). Tonos derivados del token con color-mix sobre el canvas.
function estiloNodo(cat: Categoria): CSSProperties {
  const accent = `var(${VISUAL[cat].token})`;
  if (cat === "posible") {
    // Latente: fill de card, borde tenue, sin glow.
    return {
      borderColor: `color-mix(in srgb, ${accent} 40%, transparent)`,
      background: "var(--el-surface-card)",
    };
  }
  const fillPct = cat === "ejecutada" ? 16 : 13;
  const glowPct = cat === "ejecutada" ? 42 : 46;
  return {
    borderColor: accent,
    background: `color-mix(in srgb, ${accent} ${fillPct}%, #0b0b11)`,
    ["--el-glow"]: `color-mix(in srgb, ${accent} ${glowPct}%, transparent)`,
  } as CSSProperties;
}

function glowClass(cat: Categoria): string {
  const g = VISUAL[cat].glow;
  if (g === "pulse") return "el-nodo-pulso";
  if (g === "static") return "el-nodo-glow";
  return "el-nodo";
}

const HANDLE_CLS = "!h-1.5 !w-1.5 !border-0 !bg-foreground/20";

export function NodoProcesal({ data, selected }: NodeProps<NodoFlow>) {
  const { titulo, tipo, estado } = data;
  const d = diametroNodo(tipo, estado);
  const esRaiz = tipo === "raiz";
  const bloqueado = estado === "bloqueado"; // solo en mapas viejos
  const cat = categoriaNodo(data);
  // Componente de ícono (referencia estable desde el Record del template). Se
  // renderiza con createElement para no disparar react-hooks/static-components.
  const icono = bloqueado ? Lock : iconoDeNodo(titulo);
  const ejecutadaNoRaiz = cat === "ejecutada" && !esRaiz;
  const iconSize = Math.round(d * 0.4);
  const dim = VISUAL[cat].dim && !bloqueado;

  return (
    <div className="relative" style={{ width: d, height: d }}>
      <div
        className={cn(
          "relative flex h-full w-full items-center justify-center rounded-full transition-transform duration-200",
          esRaiz ? "border-[3px]" : "border-2",
          bloqueado
            ? "el-nodo cursor-default border-[rgba(130,130,140,0.4)] bg-[#101019] opacity-60"
            : cn("cursor-pointer hover:scale-[1.06]", glowClass(cat), dim && "opacity-[0.82]"),
          // Selección vía outline (no box-shadow) para que conviva con el glow.
          selected &&
            "outline-offset-2 [outline:2px_solid_var(--el-violet-light)]",
        )}
        style={bloqueado ? undefined : estiloNodo(cat)}
      >
        <Handle type="target" position={Position.Top} className={HANDLE_CLS} />

        {createElement(icono, {
          size: iconSize,
          strokeWidth: 1.75,
          className: cn("shrink-0", bloqueado && "text-gray-500"),
          style: bloqueado ? undefined : { color: `var(${VISUAL[cat].token})` },
        })}

        {/* Indicador discreto de etapa completada (verde). */}
        {ejecutadaNoRaiz ? (
          <span
            className="absolute -right-1 -top-1 flex size-[18px] items-center justify-center rounded-full text-[#06281d]"
            style={{ background: "var(--el-estado-ejecutada)" }}
          >
            <Check className="size-3" strokeWidth={3} />
          </span>
        ) : null}

        <Handle type="source" position={Position.Bottom} className={HANDLE_CLS} />
      </div>

      {/* Label debajo del círculo (estilo skill tree). Absoluto → no agranda el
          nodo ni mueve los handles; dagre sigue midiendo solo el círculo. */}
      <span
        className={cn(
          "pointer-events-none absolute left-1/2 top-[calc(100%+6px)] w-28 -translate-x-1/2 text-center text-[10px] font-medium leading-tight line-clamp-2",
          bloqueado
            ? "text-gray-500"
            : dim
              ? "text-[var(--el-text-muted)]"
              : "text-[var(--el-text-soft)]",
        )}
      >
        {titulo}
      </span>
    </div>
  );
}
