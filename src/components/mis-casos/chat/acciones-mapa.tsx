"use client";
// Tarjeta con los cambios que el agente hizo (o intentó hacer) sobre el mapa
// procesal durante un turno del chat.
//
// Es ORTOGONAL al `modo` de la respuesta: el agente puede tocar el mapa tanto
// en una respuesta conversacional corta como en un análisis largo, así que se
// monta al lado de las búsquedas, no adentro de ninguno de los dos modos.
//
// Distinción visual central: lo EJECUTADO (violeta/verde) vs lo RECHAZADO
// (ámbar). El rechazo no es un fallo a esconder — es el sistema frenando un
// cambio incoherente, y para el abogado suele ser la información más valiosa
// del turno, así que se muestra con su motivo y su sugerencia a la vista.

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  GitBranch,
  Map as MapIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AccionMapa } from "@/lib/schemas";

type Props = {
  acciones: AccionMapa[];
  casoId: string;
};

// Records con clases COMPLETAS: Tailwind v4 escanea strings literales, así que
// nada de armar `bg-${x}-500` en runtime.
const ACCION_LABEL: Record<AccionMapa["accion"], string> = {
  crear: "Nodo creado",
  editar: "Nodo editado",
  eliminar: "Nodo eliminado",
  marcar_ocurrido: "Marcado como ocurrido",
  simular: "Ramas simuladas",
};

const ACCION_LABEL_RECHAZO: Record<AccionMapa["accion"], string> = {
  crear: "No se creó el nodo",
  editar: "No se editó el nodo",
  eliminar: "No se eliminó el nodo",
  marcar_ocurrido: "No se marcó como ocurrido",
  simular: "No se simularon ramas",
};

export function AccionesMapa({ acciones, casoId }: Props) {
  if (acciones.length === 0) return null;

  const ejecutadas = acciones.filter((a) => a.ok);
  const rechazadas = acciones.filter((a) => !a.ok);

  return (
    <section className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 space-y-2">
      <header className="flex flex-wrap items-center gap-2">
        <MapIcon className="size-3.5 text-primary" />
        <span className="text-[10px] uppercase tracking-wider text-primary font-medium">
          Mapa procesal
        </span>
        <span className="text-[10px] text-muted-foreground">
          {ejecutadas.length} {ejecutadas.length === 1 ? "cambio" : "cambios"}
          {rechazadas.length > 0
            ? ` · ${rechazadas.length} ${rechazadas.length === 1 ? "rechazado" : "rechazados"}`
            : ""}
        </span>
      </header>

      <ul className="space-y-1.5">
        {acciones.map((a, i) => (
          <AccionItem key={i} accion={a} />
        ))}
      </ul>

      {ejecutadas.length > 0 ? (
        <Link
          href={`/dashboard/mapa-procesal/${casoId}`}
          // Es la única salida al mapa desde el chat: como renglón de 11px
          // era un target de ~15px de alto. Abajo de 768px va con 40px.
          className="inline-flex items-center gap-1 min-h-10 text-xs text-primary underline underline-offset-2 hover:text-foreground md:min-h-0 md:text-[11px]"
        >
          Ver el mapa
          <ArrowRight className="size-3" />
        </Link>
      ) : null}
    </section>
  );
}

function AccionItem({ accion }: { accion: AccionMapa }) {
  const titulo = accion.titulo ?? "(nodo sin título)";

  return (
    <li
      className={cn(
        "rounded-md border px-2.5 py-1.5 space-y-1",
        accion.ok
          ? "border-emerald-500/30 bg-emerald-500/10"
          : "border-amber-500/30 bg-amber-500/10",
      )}
    >
      <div className="flex items-start gap-1.5">
        {accion.ok ? (
          <Check className="size-3.5 shrink-0 mt-0.5 text-emerald-700 dark:text-emerald-400" />
        ) : (
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs">
            <span
              className={cn(
                "font-medium",
                accion.ok ? "text-emerald-800 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300",
              )}
            >
              {accion.ok
                ? ACCION_LABEL[accion.accion]
                : ACCION_LABEL_RECHAZO[accion.accion]}
            </span>
            <span className="text-muted-foreground"> · </span>
            <span className="break-words">{titulo}</span>
          </p>

          {accion.creados && accion.creados.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {accion.creados.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground"
                >
                  <GitBranch className="size-3 shrink-0" />
                  <span className="break-words">{c.titulo}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {!accion.ok && accion.motivo ? (
        <p className="text-[11px] text-muted-foreground pl-5 break-words">
          {accion.motivo}
        </p>
      ) : null}

      {!accion.ok && accion.sugerencia ? (
        <p className="text-[11px] text-amber-800/90 dark:text-amber-200/80 italic pl-5 break-words">
          {accion.sugerencia}
        </p>
      ) : null}

      {accion.advertencias.length > 0 ? (
        <ul className="pl-5 space-y-0.5">
          {accion.advertencias.map((adv, i) => (
            <li
              key={i}
              className="text-[11px] text-muted-foreground break-words"
            >
              · {adv}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
