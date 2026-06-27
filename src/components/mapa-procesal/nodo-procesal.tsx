"use client";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Check, Lock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { diametroNodo, type NodoData, type NodoFlow } from "@/lib/mapa-procesal/layout";

// ============================================================================
// SISTEMA DE 4 COLORES POR ESTADO DEL NODO — ⚠️ PROVISORIO
// ----------------------------------------------------------------------------
// El mapeo de categorías → color Y la precedencia entre categorías están
// centralizados acá a propósito, para poder ajustarlos rápido al validar con el
// experto legal. Categorías:
//
//   Verde  "Ejecutada"          → estado 'ocurrido'
//   Rojo   "Riesgo alto"        → riesgo_alto === true
//   Amarillo "Decisión pendiente" → derivado: >=2 hijos y ninguno 'ocurrido'
//   Azul   "Posible"            → todo lo demás (default)
//
// PRECEDENCIA (de mayor a menor) cuando un nodo cae en más de una categoría:
//   Ejecutada (verde) > Riesgo alto (rojo) > Decisión pendiente (amarillo) > Posible (azul)
//
// Tonos elegidos para contrastar sobre el dark theme (canvas #08080C, cards
// #20202E), coherentes con la paleta del proyecto. Cambiar acá = cambia todo.
// ============================================================================

type Categoria = "ejecutada" | "riesgo" | "decision" | "posible";

function categoriaNodo(data: NodoData): Categoria {
  if (data.estado === "ocurrido") return "ejecutada"; // incluye la raíz 'ocurrido'
  if (data.riesgoAlto) return "riesgo";
  if (data.decisionPendiente) return "decision";
  return "posible";
}

const COLOR_POR_CATEGORIA: Record<Categoria, string> = {
  ejecutada: "border-[#1D9E75] bg-emerald-950/55 text-emerald-200",
  riesgo: "border-[#E0524D] bg-red-950/55 text-red-200",
  decision: "border-[#E0B341] bg-amber-950/50 text-amber-100",
  posible: "border-[#378ADD] bg-blue-950/55 text-blue-200",
};

// Realce hover solo para nodos interactivos (no bloqueados): el color del glow
// matchea la categoría para reforzar el feedback.
const HOVER_POR_CATEGORIA: Record<Categoria, string> = {
  ejecutada: "hover:border-[#34C795] hover:shadow-[0_0_10px_rgba(29,158,117,0.45)]",
  riesgo: "hover:border-[#EC6F6A] hover:shadow-[0_0_10px_rgba(224,82,77,0.5)]",
  decision: "hover:border-[#EEC25A] hover:shadow-[0_0_10px_rgba(224,179,65,0.5)]",
  posible: "hover:border-[#5BA3E8] hover:shadow-[0_0_10px_rgba(55,138,221,0.5)]",
};

const HANDLE_CLS = "!h-1.5 !w-1.5 !border-0 !bg-foreground/20";

export function NodoProcesal({ data, selected }: NodeProps<NodoFlow>) {
  const { titulo, tipo, estado, riesgoAlto } = data;
  const d = diametroNodo(tipo, estado);
  const esRaiz = tipo === "raiz";
  const bloqueado = estado === "bloqueado"; // solo en mapas viejos
  const categoria = categoriaNodo(data);
  const ejecutadaNoRaiz = categoria === "ejecutada" && !esRaiz;

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center rounded-full text-center transition-all duration-150",
        // Grosor de borde: raíz más marcada; bloqueado (legacy) más fino.
        esRaiz ? "border-[3px]" : bloqueado ? "border-[1.5px]" : "border-2",
        COLOR_POR_CATEGORIA[categoria],
        bloqueado
          ? "cursor-default opacity-60"
          : cn("cursor-pointer", HOVER_POR_CATEGORIA[categoria]),
        selected && "ring-2 ring-primary/70 ring-offset-2 ring-offset-background",
      )}
      style={{ width: d, height: d }}
    >
      <Handle type="target" position={Position.Top} className={HANDLE_CLS} />

      {esRaiz ? <Sparkles className="mb-0.5 size-3 shrink-0" /> : null}
      {bloqueado ? <Lock className="mb-0.5 size-3 shrink-0" /> : null}
      {!esRaiz && !bloqueado && riesgoAlto && categoria === "riesgo" ? (
        <AlertTriangle className="mb-0.5 size-3 shrink-0" />
      ) : null}

      <span className="line-clamp-2 break-words px-1 text-[10px] font-medium leading-tight">
        {titulo}
      </span>

      {ejecutadaNoRaiz ? (
        <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-[#1D9E75] text-white">
          <Check className="size-2.5" />
        </span>
      ) : null}

      <Handle type="source" position={Position.Bottom} className={HANDLE_CLS} />
    </div>
  );
}
