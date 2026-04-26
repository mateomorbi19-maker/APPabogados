"use client";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { AnalisisOutput, Busqueda, SeccionAnalisis } from "@/lib/schemas";
import { BusquedasRag } from "./busquedas-rag";

type Props = {
  data: AnalisisOutput;
  busquedas: Busqueda[];
  onVolver: () => void;
  onReiniciar: () => void;
};

export function ResultadosAnalisis({
  data,
  busquedas,
  onVolver,
  onReiniciar,
}: Props) {
  const warning = data.metadata?.warning;
  const articulos = data.metadata?.articulos_consultados ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="font-serif text-3xl">Estrategias</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onVolver}>
            <ArrowLeft />
            Volver al formulario
          </Button>
          <Button size="sm" onClick={onReiniciar}>
            <RotateCcw />
            Nuevo análisis
          </Button>
        </div>
      </div>

      {warning ? (
        <Card className="p-4 border-amber-500/40 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-500" />
            <p className="text-sm text-amber-200">{warning}</p>
          </div>
        </Card>
      ) : null}

      {data.defensor ? <Seccion seccion={data.defensor} /> : null}
      {data.defensor && data.querellante ? <Separator /> : null}
      {data.querellante ? <Seccion seccion={data.querellante} /> : null}

      {articulos.length > 0 ? (
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Artículos consultados
          </p>
          <div className="flex flex-wrap gap-1.5">
            {articulos.map((a) => (
              <span
                key={a}
                className="text-xs px-2 py-0.5 rounded bg-muted font-mono"
              >
                {a}
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      <BusquedasRag busquedas={busquedas} />
    </div>
  );
}

function Seccion({ seccion }: { seccion: SeccionAnalisis }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-serif text-2xl">{seccion.rol}</h3>
        {(seccion.imputados_identificados.length > 0 ||
          seccion.delitos_imputables.length > 0) && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {seccion.imputados_identificados.map((i) => (
              <span
                key={`imp-${i}`}
                className="text-xs px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/30"
              >
                {i}
              </span>
            ))}
            {seccion.delitos_imputables.map((d) => (
              <span
                key={`del-${d}`}
                className="text-xs px-2 py-0.5 rounded bg-destructive/15 text-destructive border border-destructive/30"
              >
                {d}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {seccion.estrategias.map((e) => (
          <Card key={e.numero} className="p-6 space-y-4">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-3xl text-muted-foreground tabular-nums">
                {e.numero}
              </span>
              <h4 className="font-serif text-xl">{e.nombre}</h4>
            </div>

            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {e.tesis_central}
            </p>

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
          </Card>
        ))}
      </div>
    </div>
  );
}
