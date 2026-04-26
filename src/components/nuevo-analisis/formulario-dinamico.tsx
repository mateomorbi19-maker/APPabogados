"use client";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { PreAnalisisOutput } from "@/lib/schemas";
import { PreguntaField, type RespuestaValor } from "./pregunta-field";

type Props = {
  data: PreAnalisisOutput;
  onVolver: () => void;
};

function valorInicial(
  p: PreAnalisisOutput["preguntas"][number],
): RespuestaValor {
  if (p.tipo === "checkbox") {
    return p.opciones && p.opciones.length > 0 ? [] : false;
  }
  // valor_sugerido es opcional y puede ser null. Para select/radio/text
  // arrancamos con string vacío si no hay sugerencia.
  return p.valor_sugerido ?? "";
}

export function FormularioDinamico({ data, onVolver }: Props) {
  const [respuestas, setRespuestas] = useState<Record<string, RespuestaValor>>(
    () =>
      Object.fromEntries(data.preguntas.map((p) => [p.id, valorInicial(p)])),
  );

  const dd = data.datos_detectados;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-serif text-3xl">Pre-análisis</h2>
        <Button variant="outline" size="sm" onClick={onVolver}>
          <ArrowLeft />
          Volver
        </Button>
      </div>

      <Card className="p-6 space-y-2">
        <h3 className="font-medium text-xs uppercase tracking-wider text-muted-foreground">
          Resumen preliminar
        </h3>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {data.resumen_preliminar}
        </p>
      </Card>

      <Card className="p-6">
        <h3 className="font-medium text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Datos detectados
        </h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Jurisdicción</dt>
            <dd>{dd.jurisdiccion_inferida ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Etapa procesal</dt>
            <dd>{dd.etapa_procesal ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">¿Hay detenidos?</dt>
            <dd>{dd.hay_detenidos ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Delitos posibles</dt>
            <dd>
              {dd.delitos_posibles.length > 0
                ? dd.delitos_posibles.join(", ")
                : "—"}
            </dd>
          </div>
        </dl>
      </Card>

      <Separator />

      <div className="space-y-5">
        <h3 className="font-medium text-xs uppercase tracking-wider text-muted-foreground">
          Preguntas
        </h3>
        {data.preguntas.map((p) => (
          <PreguntaField
            key={p.id}
            pregunta={p}
            value={respuestas[p.id]}
            onChange={(v) => setRespuestas((r) => ({ ...r, [p.id]: v }))}
          />
        ))}
      </div>

      <div className="flex flex-col items-end gap-1.5 pt-2">
        <Button disabled>Analizar caso</Button>
        <p className="text-sm text-muted-foreground">
          Disponible en el próximo paso del flujo
        </p>
      </div>
    </div>
  );
}
