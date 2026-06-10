"use client";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Check, Lock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { diametroNodo, type NodoFlow } from "@/lib/mapa-procesal/layout";
import type { EstadoNodo, TipoNodo } from "@/lib/mapa-procesal/types";

// Clases (literales, dark-only) por tipo/estado. Bordes con el hex exacto de la
// paleta del feature; fondos con tinte sutil del mismo color.
function estiloNodo(tipo: TipoNodo, estado: EstadoNodo): string {
  if (tipo === "raiz") {
    return "border-[3px] border-[#1D9E75] bg-emerald-950/50 text-emerald-300";
  }
  if (tipo === "real" || estado === "ocurrido") {
    return "border-[2.5px] border-[#7F77DD] bg-violet-950/50 text-violet-200";
  }
  if (estado === "desbloqueado") {
    return "border-2 border-[#378ADD] bg-blue-950/50 text-blue-200 cursor-pointer hover:shadow-[0_0_10px_rgba(55,138,221,0.5)] hover:border-[#5BA3E8]";
  }
  // bloqueado
  return "border-[1.5px] border-gray-700 bg-gray-900/70 text-gray-500 opacity-60 cursor-default";
}

const HANDLE_CLS = "!h-1.5 !w-1.5 !border-0 !bg-foreground/20";

export function NodoProcesal({ data, selected }: NodeProps<NodoFlow>) {
  const { titulo, tipo, estado } = data;
  const d = diametroNodo(tipo, estado);
  const bloqueado = estado === "bloqueado";
  const ocurridoNoRaiz = tipo === "real" || (estado === "ocurrido" && tipo !== "raiz");

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center rounded-full text-center transition-all duration-150",
        estiloNodo(tipo, estado),
        selected && "ring-2 ring-primary/70 ring-offset-2 ring-offset-background",
      )}
      style={{ width: d, height: d }}
    >
      <Handle type="target" position={Position.Top} className={HANDLE_CLS} />

      {tipo === "raiz" ? <Sparkles className="mb-0.5 size-3 shrink-0" /> : null}
      {bloqueado ? <Lock className="mb-0.5 size-3 shrink-0" /> : null}

      <span className="line-clamp-2 break-words px-1 text-[10px] font-medium leading-tight">
        {titulo}
      </span>

      {ocurridoNoRaiz ? (
        <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-[#7F77DD] text-white">
          <Check className="size-2.5" />
        </span>
      ) : null}

      <Handle type="source" position={Position.Bottom} className={HANDLE_CLS} />
    </div>
  );
}
