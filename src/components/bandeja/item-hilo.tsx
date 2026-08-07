"use client";
// Fila de la lista de hilos. Densidad tipo Gmail: remitente + fecha arriba,
// asunto, y fragmento a una línea.
//
// La fila no es un <button> porque adentro va la estrella, que sí lo es (botón
// dentro de botón es HTML inválido). Va como div con role="button" + tabIndex
// y manejo explícito de Enter/Espacio.

import { Paperclip, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HiloResumen } from "@/lib/gmail/types";
import { fechaListado } from "./fechas";
import { nombreDe } from "./presentacion";

type Props = {
  hilo: HiloResumen;
  seleccionado: boolean;
  demo: boolean;
  /** En modo demo la estrella no se puede tocar: el server responde 409. */
  puedeModificar: boolean;
  onAbrir: (h: HiloResumen) => void;
  onToggleDestacado: (h: HiloResumen) => void;
};

export function ItemHilo({
  hilo,
  seleccionado,
  demo,
  puedeModificar,
  onAbrir,
  onToggleDestacado,
}: Props) {
  const noLeido = !hilo.leido;

  return (
    <li role="listitem">
      <div
        role="button"
        tabIndex={0}
        aria-current={seleccionado ? "true" : undefined}
        aria-label={`${nombreDe(hilo.remitente)}: ${hilo.asunto}${noLeido ? " (sin leer)" : ""}`}
        onClick={() => onAbrir(hilo)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onAbrir(hilo);
          }
        }}
        className={cn(
          "group flex cursor-pointer gap-2 border-l-2 px-3 py-2.5 outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-[var(--el-violet)]/60 focus-visible:ring-inset",
          seleccionado
            ? "border-[var(--el-violet)] bg-[rgba(139,92,246,0.12)]"
            : "border-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.04]",
        )}
      >
        {/* Punto de no leído: columna fija para que los asuntos queden alineados */}
        <span className="flex w-2 shrink-0 justify-center pt-2">
          {noLeido ? (
            <span
              aria-hidden
              className="size-2 rounded-full bg-[var(--el-violet-light)]"
            />
          ) : null}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p
              className={cn(
                "min-w-0 flex-1 truncate text-[13px]",
                noLeido
                  ? "font-semibold text-[var(--el-text)]"
                  : "text-[var(--el-text-soft)]",
              )}
            >
              {nombreDe(hilo.remitente)}
              {hilo.cantidad_mensajes > 1 ? (
                <span className="ml-1 font-normal text-[var(--el-text-muted)]">
                  ({hilo.cantidad_mensajes})
                </span>
              ) : null}
            </p>
            <span className="shrink-0 text-[11px] tabular-nums text-[var(--el-text-muted)]">
              {fechaListado(hilo.fecha)}
            </span>
          </div>

          <div className="mt-0.5 flex items-center gap-1.5">
            <p
              className={cn(
                "min-w-0 flex-1 truncate text-[13px]",
                noLeido
                  ? "font-medium text-[var(--el-text)]"
                  : "text-[var(--el-text-soft)]",
              )}
            >
              {hilo.asunto}
            </p>
            {hilo.tiene_adjuntos ? (
              <Paperclip
                aria-label="Tiene adjuntos"
                className="size-3.5 shrink-0 text-[var(--el-text-muted)]"
              />
            ) : null}
          </div>

          <p className="mt-0.5 truncate text-xs text-[var(--el-text-muted)]">
            {hilo.fragmento}
          </p>

          {demo ? (
            <span className="mt-1.5 inline-flex items-center rounded-4xl border border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.12)] px-1.5 py-px text-[10px] font-medium text-amber-700 dark:text-[#fcd34d]">
              Ejemplo
            </span>
          ) : null}
        </div>

        <button
          type="button"
          disabled={!puedeModificar}
          aria-label={hilo.destacado ? "Quitar de destacados" : "Destacar"}
          aria-pressed={hilo.destacado}
          onClick={(e) => {
            e.stopPropagation();
            onToggleDestacado(hilo);
          }}
          className={cn(
            "mt-1 size-6 shrink-0 rounded-md outline-none transition-colors",
            "flex items-center justify-center",
            "focus-visible:ring-2 focus-visible:ring-[var(--el-violet)]/60",
            puedeModificar
              ? "hover:bg-black/10 dark:hover:bg-white/10"
              : "cursor-not-allowed opacity-40",
          )}
        >
          <Star
            className={cn(
              "size-3.5",
              hilo.destacado
                ? "fill-amber-600 dark:fill-[#fcd34d] text-amber-700 dark:text-[#fcd34d]"
                : "text-[var(--el-text-muted)]",
            )}
          />
        </button>
      </div>
    </li>
  );
}
