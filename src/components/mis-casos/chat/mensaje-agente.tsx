"use client";
// Render del mensaje del agente en el chat. Dos modos según el campo
// `modo` del JSON estructurado:
//
//   - 'conversacional': prosa libre. Mostramos solo `respuesta` con
//     párrafos respetados. Header dice "Respuesta del agente" porque
//     "Análisis del agente" es semánticamente raro para un mensaje
//     conversacional corto (saludo, follow-up, etc).
//   - 'analisis': estructura completa — tesis card, fundamento legal,
//     consideraciones, recomendaciones priorizadas. Header dice
//     "Análisis del agente".
//
// En AMBOS modos se mantiene: degraded_response badge si aplica,
// flag parser_fallback si aplica (caso raro: el parser no logró
// estructura y el server cayó al fallback con texto crudo del modelo),
// búsquedas colapsables al pie.
//
// Trabaja sobre `MensajeConversacion`. Prefiere `respuesta_estructurada`
// (jsonb persistido) sobre el `contenido` string (JSON-string fallback).

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  Gavel,
  Sparkles,
} from "lucide-react";
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
import { AccionesMapa } from "./acciones-mapa";

type Props = {
  mensaje: MensajeConversacion;
  // Necesario para linkear al mapa desde la tarjeta de acciones.
  casoId: string;
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
    classes: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  },
  media: {
    label: "Media",
    classes: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  },
  baja: {
    label: "Baja",
    classes: "bg-muted text-muted-foreground border-border",
  },
};

export function MensajeAgente({ mensaje, casoId }: Props) {
  const respuesta = parsearRespuesta(mensaje);

  if (!respuesta) {
    return (
      <article className="max-w-[90%] rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
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

  // Burbuja del agente alineada a la IZQUIERDA con superficie neutral
  // (convención de chat: el interlocutor va a la izquierda; el tinte
  // violeta queda para los mensajes propios del abogado).
  return (
    <article className="max-w-[90%] rounded-md border border-border bg-card/60 px-3 py-3 space-y-3">
      <Header respuesta={respuesta} fecha={mensaje.creado_en} />

      {respuesta.modo === "conversacional" ? (
        <Conversacional respuesta={respuesta.respuesta} />
      ) : (
        <Analisis respuesta={respuesta} />
      )}

      {/* Ortogonal al modo, igual que las búsquedas: el agente puede tocar
          el mapa respondiendo en cualquiera de los dos. */}
      <AccionesMapa acciones={respuesta.acciones ?? []} casoId={casoId} />

      <FuentesRepositorio fuentes={respuesta.fuentes_repositorio ?? []} />

      <BusquedasColapsable busquedas={respuesta.busquedas ?? []} />
    </article>
  );
}

// Documentos del Repositorio que el agente miró en este turno. La lista la arma
// el servidor con lo que la búsqueda devolvió de verdad, así que sirve como
// control: si el agente cita un fallo que no está acá, lo sacó de su memoria y
// no del repositorio del estudio.
function FuentesRepositorio({
  fuentes,
}: {
  fuentes: NonNullable<RespuestaConsulta["fuentes_repositorio"]>;
}) {
  if (fuentes.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-muted/10 px-3 py-2">
      <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        Consultado en el repositorio del estudio
      </p>
      <ul className="space-y-1">
        {fuentes.map((f) => {
          const Icono = f.tipo === "doctrina" ? BookOpen : Gavel;
          return (
            <li key={f.documento_id} className="flex items-start gap-1.5">
              <Icono className="mt-0.5 size-3 shrink-0 text-primary" />
              <Link
                href={`/dashboard/repositorio/${f.documento_id}`}
                target="_blank"
                className="text-[11px] leading-snug hover:text-primary hover:underline"
              >
                {f.cita}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Header({
  respuesta,
  fecha,
}: {
  respuesta: RespuestaConsulta;
  fecha: string;
}) {
  // Label del header varía según modo: análisis estructurado vs
  // respuesta corta. Decisión chica reversible — minimiza la fricción
  // visual cuando el agente responde algo corto.
  const labelHeader =
    respuesta.modo === "analisis"
      ? "Análisis del agente"
      : "Respuesta del agente";
  return (
    <header className="flex flex-wrap items-center gap-2">
      <Sparkles className="size-3.5 text-primary" />
      <span className="text-[10px] uppercase tracking-wider text-primary font-medium">
        {labelHeader}
      </span>
      <span className="text-[10px] text-muted-foreground">· {fmtFecha(fecha)}</span>
      {respuesta.degraded_response ? (
        <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 text-[10px]">
          <AlertTriangle className="size-3" />
          Análisis parcial
        </span>
      ) : null}
      {respuesta.parser_fallback ? (
        <span
          className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 text-[10px]"
          title="El modelo respondió en formato libre y el server lo guardó como prosa. Caso reportado al admin."
        >
          <AlertTriangle className="size-3" />
          Formato libre
        </span>
      ) : null}
    </header>
  );
}

function Conversacional({ respuesta }: { respuesta: string }) {
  // Splitemos por dobles \n para respetar párrafos del modelo.
  // Líneas sueltas dentro de un párrafo se preservan con whitespace-pre-wrap.
  const parrafos = respuesta.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="text-sm leading-relaxed space-y-2.5">
      {parrafos.length === 0 ? (
        <p className="whitespace-pre-wrap">{respuesta}</p>
      ) : (
        parrafos.map((p, i) => (
          <p key={i} className="whitespace-pre-wrap">
            {p}
          </p>
        ))
      )}
    </div>
  );
}

function Analisis({
  respuesta,
}: {
  respuesta: Extract<RespuestaConsulta, { modo: "analisis" }>;
}) {
  return (
    <>
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
    </>
  );
}

function BusquedasColapsable({
  busquedas,
}: {
  busquedas: NonNullable<RespuestaConsulta["busquedas"]>;
}) {
  if (busquedas.length === 0) return null;
  return (
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
          Ver búsquedas que hizo el agente ({busquedas.length})
        </span>
        <ChevronDown className="size-3.5 transition-transform group-data-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="border-t border-border divide-y divide-border/50">
          {busquedas.map((b, i) => (
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
