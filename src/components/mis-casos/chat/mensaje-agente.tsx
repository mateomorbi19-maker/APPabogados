"use client";
// Render del mensaje del agente en el chat. Reutiliza la lógica visual
// del antiguo respuesta-agente-evento.tsx (PR3, ya eliminado): parsea
// el JSON, valida con zod, y muestra tesis + fundamento + consideraciones
// + recomendaciones priorizadas + búsquedas colapsables.
//
// Diferencia con el componente del PR3: trabaja sobre `MensajeConversacion`
// y prefiere `respuesta_estructurada` (jsonb persistido) sobre el
// contenido string. El JSON-string en `contenido` queda como fallback
// si la columna nueva está null por alguna razón.

import { useState } from "react";
import { ChevronDown, Sparkles, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { fmtFecha, fmtNumber } from "@/lib/format";
import {
  respuestaConsultaSchema,
  type Recomendacion,
  type RespuestaConsulta,
} from "@/lib/schemas";
import type { MensajeConversacion } from "@/lib/types";

type Props = {
  mensaje: MensajeConversacion;
};

function parsearRespuesta(
  mensaje: MensajeConversacion,
): RespuestaConsulta | null {
  // Primero intentamos la columna estructurada nueva.
  if (mensaje.respuesta_estructurada) {
    const parsed = respuestaConsultaSchema.safeParse(
      mensaje.respuesta_estructurada,
    );
    if (parsed.success) return parsed.data;
  }
  // Fallback: el `contenido` es el JSON serializado en el endpoint.
  try {
    const obj = JSON.parse(mensaje.contenido);
    const parsed = respuestaConsultaSchema.safeParse(obj);
    if (parsed.success) return parsed.data;
  } catch {
    // ignore
  }
  return null;
}

const PRIORIDAD_VARIANT: Record<
  Recomendacion["prioridad"],
  { label: string; classes: string }
> = {
  alta: {
    label: "Alta",
    classes: "bg-red-500/15 text-red-400 border-red-500/30",
  },
  media: {
    label: "Media",
    classes: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  baja: {
    label: "Baja",
    classes: "bg-muted text-muted-foreground border-border",
  },
};

export function MensajeAgente({ mensaje }: Props) {
  const respuesta = parsearRespuesta(mensaje);

  if (!respuesta) {
    return (
      <article className="ml-auto max-w-[90%] rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
        <p className="text-destructive font-medium mb-1">
          Respuesta del agente no parseable
        </p>
        <p className="text-muted-foreground">
          La respuesta se persistió pero el cliente no logró interpretarla.
          Podés ver la metadata cruda en el panel admin.
        </p>
      </article>
    );
  }

  return (
    <article className="ml-auto max-w-[90%] rounded-md border border-primary/40 bg-primary/5 px-3 py-3 space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-3.5 text-primary" />
        <span className="text-[10px] uppercase tracking-wider text-primary font-medium">
          Análisis del agente
        </span>
        <span className="text-[10px] text-muted-foreground">
          · {fmtFecha(mensaje.creado_en)}
        </span>
        {respuesta.degraded_response ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/15 text-amber-400 px-1.5 py-0.5 text-[10px]">
            <AlertTriangle className="size-3" />
            Análisis parcial
          </span>
        ) : null}
      </header>

      <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          Tesis central
        </p>
        <p className="text-sm leading-relaxed">
          {respuesta.analisis.tesis_central}
        </p>
      </div>

      {respuesta.analisis.fundamento_legal.length > 0 ? (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Fundamento legal
          </p>
          <ul className="text-sm space-y-1 list-disc pl-5">
            {respuesta.analisis.fundamento_legal.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {respuesta.analisis.consideraciones ? (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Consideraciones
          </p>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {respuesta.analisis.consideraciones}
          </p>
        </div>
      ) : null}

      {respuesta.recomendaciones.length > 0 ? (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Recomendaciones
          </p>
          <ul className="space-y-2">
            {respuesta.recomendaciones.map((r, i) => (
              <RecomendacionCard key={i} r={r} />
            ))}
          </ul>
        </div>
      ) : null}

      {respuesta.busquedas && respuesta.busquedas.length > 0 ? (
        <Collapsible className="rounded-md border border-border bg-muted/10">
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="group w-full justify-between rounded-md px-3 py-1.5 h-auto"
              />
            }
          >
            <span className="text-[11px] text-muted-foreground">
              Ver búsquedas que hizo el agente ({respuesta.busquedas.length})
            </span>
            <ChevronDown className="size-3.5 transition-transform group-data-open:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="border-t border-border divide-y divide-border/50">
              {respuesta.busquedas.map((b, i) => (
                <li
                  key={i}
                  className="px-3 py-1.5 text-[11px] flex items-center justify-between gap-3"
                >
                  <span className="font-mono truncate flex-1 min-w-0">
                    {i + 1}. {b.query}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    sim:{" "}
                    {b.similarity_top !== null
                      ? b.similarity_top.toFixed(3)
                      : "—"}{" "}
                    · chunks: {fmtNumber(b.chunks_devueltos)}
                  </span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </article>
  );
}

function RecomendacionCard({ r }: { r: Recomendacion }) {
  const [open, setOpen] = useState(false);
  const variant = PRIORIDAD_VARIANT[r.prioridad];
  return (
    <li className="rounded-md border border-border bg-card/30 px-3 py-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
            variant.classes,
          )}
        >
          {variant.label}
        </span>
        <span className="text-sm font-medium flex-1">{r.accion}</span>
      </div>
      {r.plazo ? (
        <p className="text-[11px] text-muted-foreground">
          <span className="uppercase tracking-wider">Plazo:</span> {r.plazo}
        </p>
      ) : null}
      {r.fundamento ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {open ? "Ocultar fundamento" : "Ver por qué"}
        </button>
      ) : null}
      {open && r.fundamento ? (
        <p className="text-xs text-muted-foreground italic mt-1 whitespace-pre-wrap">
          {r.fundamento}
        </p>
      ) : null}
    </li>
  );
}
