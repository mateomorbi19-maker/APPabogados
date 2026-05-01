"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Caso } from "@/lib/types";

type Props = {
  caso: Caso;
};

const TRUNCAR_EN = 300;

// Recuadro con el texto del caso original. Si el caso supera 300 chars,
// se trunca con "..." y aparece un botón "Ver más" / "Ver menos".
//
// Usamos useState porque el comportamiento "truncar inline + toggle" no se
// resuelve limpio con <details>/Collapsible (que son block-level y rompen
// la fluidez del texto). useState acá es 3 líneas y no reinventa nada.
export function SeccionCasoOriginal({ caso }: Props) {
  const [expanded, setExpanded] = useState(false);
  const texto = caso.caso_descripcion;
  const esLargo = texto.length > TRUNCAR_EN;
  const display = esLargo && !expanded ? texto.slice(0, TRUNCAR_EN) + "…" : texto;

  return (
    <Card className="p-6 space-y-3">
      <h3 className="font-medium text-xs uppercase tracking-wider text-muted-foreground">
        Caso original
      </h3>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{display}</p>
      {esLargo ? (
        <Button
          variant="link"
          size="sm"
          className="px-0 h-auto"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Ver menos" : "Ver más"}
        </Button>
      ) : null}
    </Card>
  );
}
