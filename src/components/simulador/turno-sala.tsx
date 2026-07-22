"use client";
// Render de un turno de la sala (emisor='sistema').
//
// El backend guarda TODA la respuesta del modelo como un único turno, porque
// el texto ya viene rotulado por orador ("JUEZ:", "AGENTE FISCAL:", ...) —
// así lo exige el guion. Acá se parsean esos rótulos SOLO para mostrar: cada
// intervención va en su propia tarjeta con el color del orador. Es display,
// no persistencia: si el modelo no rotula, cae al bloque único sin romperse.

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtFecha } from "@/lib/format";
import type { TurnoSimulacion } from "@/lib/types";

type Intervencion = { orador: string | null; texto: string };

// Un rótulo es una línea que arranca en mayúscula y termina en ":" —
// "JUEZ:", "AGENTE FISCAL:", "SECRETARIO / OGA:". Se acota a 45 caracteres
// para no confundir una oración entera que contenga dos puntos.
const RE_ORADOR = /^([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ0-9 .·/()-]{1,44}):\s*(.*)$/;

export function parsearIntervenciones(texto: string): Intervencion[] {
  const out: Intervencion[] = [];
  let actual: Intervencion | null = null;

  for (const linea of texto.split("\n")) {
    const m = linea.match(RE_ORADOR);
    if (m) {
      if (actual) out.push(actual);
      actual = { orador: m[1].trim(), texto: m[2] ?? "" };
    } else if (actual) {
      actual.texto += `\n${linea}`;
    } else {
      actual = { orador: null, texto: linea };
    }
  }
  if (actual) out.push(actual);

  return out
    .map((i) => ({ orador: i.orador, texto: i.texto.trim() }))
    .filter((i) => i.texto.length > 0 || i.orador !== null);
}

// Acento por orador. Se matchea por prefijo normalizado para tolerar
// variantes ("JUEZ DE GARANTÍAS", "AGENTE FISCAL", "FISCAL").
const ACENTOS: ReadonlyArray<{ test: RegExp; clases: string; label: string }> = [
  { test: /^juez|^jueza|^tribunal/i, clases: "border-violet-500/40 text-violet-300", label: "text-violet-300" },
  { test: /^secretari|^oga|^oficina/i, clases: "border-slate-500/40 text-slate-300", label: "text-slate-300" },
  { test: /^fiscal|^agente fiscal|^mpf/i, clases: "border-rose-500/40 text-rose-300", label: "text-rose-300" },
  { test: /^querell|^particular/i, clases: "border-amber-500/40 text-amber-300", label: "text-amber-300" },
  { test: /^defens/i, clases: "border-emerald-500/40 text-emerald-300", label: "text-emerald-300" },
  { test: /^imputad|^acusad/i, clases: "border-sky-500/40 text-sky-300", label: "text-sky-300" },
  { test: /^testigo|^perito/i, clases: "border-teal-500/40 text-teal-300", label: "text-teal-300" },
];

function acentoDe(orador: string | null) {
  if (!orador) return { clases: "border-border", label: "text-muted-foreground" };
  const hit = ACENTOS.find((a) => a.test.test(orador));
  return hit ?? { clases: "border-border", label: "text-muted-foreground" };
}

export function TurnoSala({ turno }: { turno: TurnoSimulacion }) {
  const intervenciones = parsearIntervenciones(turno.contenido);
  const truncado = Boolean(
    (turno.metadata as { truncado?: unknown } | null)?.truncado,
  );

  return (
    <div className="space-y-2">
      {intervenciones.map((int, i) => {
        const acento = acentoDe(int.orador);
        return (
          <article
            key={i}
            className={cn(
              "max-w-[92%] rounded-md border bg-card/60 px-3 py-2.5",
              acento.clases,
            )}
          >
            {int.orador ? (
              <p
                className={cn(
                  "text-[10px] uppercase tracking-wider font-medium mb-1",
                  acento.label,
                )}
              >
                {int.orador}
              </p>
            ) : null}
            <Parrafos texto={int.texto} />
          </article>
        );
      })}

      <div className="flex items-center gap-2 pl-1">
        <span className="text-[10px] text-muted-foreground">
          {fmtFecha(turno.creado_en)}
        </span>
        {truncado ? (
          <span
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/15 text-amber-400 px-1.5 py-0.5 text-[10px]"
            title="La respuesta alcanzó el límite de longitud y quedó cortada."
          >
            <AlertTriangle className="size-3" />
            Intervención cortada
          </span>
        ) : null}
      </div>
    </div>
  );
}

// Respeta los párrafos del modelo y resalta las aclaraciones entre corchetes
// que el guion pide usar cuando completa un dato faltante.
function Parrafos({ texto }: { texto: string }) {
  const parrafos = texto
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const items = parrafos.length > 0 ? parrafos : [texto];

  return (
    <div className="text-sm leading-relaxed space-y-2">
      {items.map((p, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {p.split(/(\[[^\]]+\])/g).map((frag, j) =>
            frag.startsWith("[") && frag.endsWith("]") ? (
              <span key={j} className="text-muted-foreground italic">
                {frag}
              </span>
            ) : (
              <span key={j}>{frag}</span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}
