"use client";
import { AlertTriangle, CheckCircle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Caso } from "@/lib/types";

type Props = {
  caso: Caso;
};

// Card con borde violeta que muestra la estrategia elegida al momento de
// crear el caso (snapshot). El "ver fundamento legal completo" expande
// fundamento_legal + doctrina_aplicable + fortalezas + riesgos +
// pasos_procesales — usamos Collapsible (panel-level, no inline) que
// maneja su propio open state.
export function SeccionEstrategiaElegida({ caso }: Props) {
  const e = caso.estrategia_snapshot;
  const numero = caso.estrategia_seleccionada_idx + 1;
  const rolLabel =
    caso.estrategia_seleccionada_rol === "defensor" ? "Defensor" : "Querellante";

  const tieneDetalle =
    e.fundamento_legal.length > 0 ||
    e.fortalezas.length > 0 ||
    e.riesgos.length > 0 ||
    e.pasos_procesales.length > 0 ||
    e.doctrina_aplicable.length > 0;

  return (
    <Card className="p-6 space-y-4 border-primary/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
          Estrategia {numero}
        </span>
        <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
          {rolLabel}
        </span>
      </div>

      <h3 className="font-serif text-xl">{e.nombre}</h3>

      <p className="text-sm leading-relaxed whitespace-pre-wrap">
        {e.tesis_central}
      </p>

      {tieneDetalle ? (
        <Collapsible className="space-y-4">
          <CollapsibleTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="group w-full sm:w-auto"
              />
            }
          >
            Ver fundamento legal completo
            <ChevronDown className="size-4 ml-1.5 transition-transform group-data-open:rotate-180" />
          </CollapsibleTrigger>

          <CollapsibleContent className="space-y-4 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0">
            {e.fundamento_legal.length > 0 ? (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                  Fundamento legal
                </p>
                <ul className="text-sm space-y-1 list-disc pl-5">
                  {e.fundamento_legal.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {e.doctrina_aplicable ? (
              <div className="border-l-2 border-primary/40 pl-3 italic text-sm text-muted-foreground">
                {e.doctrina_aplicable}
              </div>
            ) : null}

            {(e.fortalezas.length > 0 || e.riesgos.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {e.fortalezas.length > 0 ? (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                      Fortalezas
                    </p>
                    <ul className="text-sm space-y-1.5">
                      {e.fortalezas.map((f, i) => (
                        <li key={i} className="flex gap-2">
                          <CheckCircle className="size-4 mt-0.5 shrink-0 text-emerald-500" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {e.riesgos.length > 0 ? (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                      Riesgos
                    </p>
                    <ul className="text-sm space-y-1.5">
                      {e.riesgos.map((r, i) => (
                        <li key={i} className="flex gap-2">
                          <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-500" />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}

            {e.pasos_procesales.length > 0 ? (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                  Pasos procesales
                </p>
                <ol className="text-sm space-y-1 list-decimal pl-5">
                  {e.pasos_procesales.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ol>
              </div>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </Card>
  );
}
