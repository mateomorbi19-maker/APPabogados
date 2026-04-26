"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const MENSAJES = [
  "Analizando el caso…",
  "Buscando jurisprudencia…",
  "Consultando código penal…",
  "Redactando estrategias…",
] as const;

const ROTACION_MS = 12000;
const TICK_MS = 200;
// Asintótica al 95%. τ ≈ 30s da una curva que llega a ~63% a los 30s,
// ~86% a los 60s, ~95% a los 90s. La medición empírica del E2E cae en
// ese rango (87-90s). El 5% restante se completa cuando vuelve la response.
const TAU_S = 30;
const ASINTOTA = 95;

type Props = {
  inicio: number;
  onCancel: () => void;
};

export function ProgresoAnalisis({ inicio, onCancel }: Props) {
  const [progress, setProgress] = useState(0);
  const [mensajeIdx, setMensajeIdx] = useState(0);

  useEffect(() => {
    // Tick de la barra: avanza siguiendo curva log asintótica al 95%.
    const tProgress = setInterval(() => {
      const elapsed = (Date.now() - inicio) / 1000;
      setProgress(ASINTOTA * (1 - Math.exp(-elapsed / TAU_S)));
    }, TICK_MS);

    // Tick del mensaje: rota cada 12s, vuelve al primero al pasar el último.
    const tMensaje = setInterval(() => {
      setMensajeIdx((i) => (i + 1) % MENSAJES.length);
    }, ROTACION_MS);

    return () => {
      clearInterval(tProgress);
      clearInterval(tMensaje);
    };
  }, [inicio]);

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Loader2 className="size-4 animate-spin text-primary" />
        <span className="text-sm font-medium">{MENSAJES[mensajeIdx]}</span>
      </div>
      <Progress value={progress} />
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </Card>
  );
}
