"use client";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ResultadosAnalisis } from "@/components/nuevo-analisis/resultados-analisis";
import {
  analisisOutputSchema,
  ejecucionMetadataSchema,
  type EjecucionMetadata,
  preAnalisisOutputSchema,
} from "@/lib/schemas";
import {
  fmtCosto,
  fmtFecha,
  fmtModelo,
  fmtNumber,
  fmtTipo,
} from "@/lib/format";
import type { EjecucionRow } from "@/lib/hooks/use-consumo";

type Props = {
  ejecucion: EjecucionRow | null;
  onOpenChange: (open: boolean) => void;
};

export function HistorialDetalle({ ejecucion, onOpenChange }: Props) {
  return (
    <Dialog open={ejecucion !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        {ejecucion ? <Contenido ejecucion={ejecucion} /> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cerrar</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Contenido({ ejecucion }: { ejecucion: EjecucionRow }) {
  // Parse defensivo. Si el shape no matchea, caemos a "sin detalle"
  // (p. ej. filas viejas pre-Fase 4 o futuras con keys nuevas).
  const metaParsed = ejecucionMetadataSchema.safeParse(ejecucion.metadata);
  const meta: EjecucionMetadata = metaParsed.success ? metaParsed.data : {};
  const sinDetalle =
    !metaParsed.success ||
    ejecucion.metadata === null ||
    Object.keys(meta).length === 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-xl">
          {fmtTipo(ejecucion.tipo)}
        </DialogTitle>
        <DialogDescription>
          {fmtFecha(ejecucion.ejecutado_en)} · {fmtModelo(ejecucion.modelo)} ·{" "}
          {fmtNumber(ejecucion.total_tokens)} tokens ·{" "}
          {fmtCosto(ejecucion.costo_usd)}
        </DialogDescription>
      </DialogHeader>

      {sinDetalle ? (
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">
            Sin detalle disponible para esta ejecución.
          </p>
        </Card>
      ) : ejecucion.tipo === "analizar_caso" ? (
        <CuerpoAnalizarCaso meta={meta} />
      ) : ejecucion.tipo === "pre_analisis" ? (
        <CuerpoPreAnalisis meta={meta} />
      ) : (
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">
            Tipo de ejecución desconocido: {ejecucion.tipo}
          </p>
        </Card>
      )}

      <Diagnostico meta={meta} />
    </>
  );
}

function formatContextoValor(v: string | number | boolean | null): string {
  if (v === null) return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  return String(v);
}

function CuerpoAnalizarCaso({ meta }: { meta: EjecucionMetadata }) {
  const errorMsg = meta.error ?? meta.parseo_error;
  const tieneResultado = meta.resultado !== undefined && meta.resultado !== null;
  const resultadoParsed = tieneResultado
    ? analisisOutputSchema.safeParse(meta.resultado)
    : null;

  return (
    <div className="space-y-6">
      {errorMsg ? (
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-4 mt-0.5 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">
                {meta.error ? "Error del agente" : "Error de parseo"}
              </p>
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
            </div>
          </div>
        </Card>
      ) : null}

      {meta.caso ? (
        <Seccion titulo="Caso">
          <Card className="p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {meta.caso}
            </p>
          </Card>
        </Seccion>
      ) : null}

      {meta.rol ? (
        <Seccion titulo="Rol">
          <p className="text-sm capitalize">{meta.rol}</p>
        </Seccion>
      ) : null}

      {meta.contexto && Object.keys(meta.contexto).length > 0 ? (
        <Seccion titulo="Contexto">
          <Card className="p-4">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {Object.entries(meta.contexto).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted-foreground capitalize">
                    {k.replace(/_/g, " ")}
                  </dt>
                  <dd>{formatContextoValor(v)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </Seccion>
      ) : null}

      <Separator />

      {resultadoParsed?.success ? (
        <ResultadosAnalisis
          data={resultadoParsed.data}
          busquedas={meta.busquedas ?? []}
        />
      ) : !tieneResultado ? (
        <Card className="p-4 border-amber-500/40 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-500" />
            <p className="text-sm text-amber-200">
              Resultado no disponible. La ejecución no llegó a generar
              estrategias.
            </p>
          </div>
        </Card>
      ) : (
        <ResultadoMalformado raw={meta.resultado} />
      )}
    </div>
  );
}

function CuerpoPreAnalisis({ meta }: { meta: EjecucionMetadata }) {
  const errorMsg = meta.parseo_error;
  const tieneResultado = meta.resultado !== undefined && meta.resultado !== null;
  const resultadoParsed = tieneResultado
    ? preAnalisisOutputSchema.safeParse(meta.resultado)
    : null;

  return (
    <div className="space-y-6">
      {errorMsg ? (
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-4 mt-0.5 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">
                Error de parseo
              </p>
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
            </div>
          </div>
        </Card>
      ) : null}

      {meta.caso ? (
        <Seccion titulo="Caso">
          <Card className="p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {meta.caso}
            </p>
          </Card>
        </Seccion>
      ) : null}

      {resultadoParsed?.success ? (
        <>
          <Seccion titulo="Resumen preliminar">
            <Card className="p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {resultadoParsed.data.resumen_preliminar}
              </p>
            </Card>
          </Seccion>

          <Seccion titulo="Datos detectados">
            <Card className="p-4">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Jurisdicción</dt>
                  <dd>
                    {resultadoParsed.data.datos_detectados
                      .jurisdiccion_inferida ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Etapa procesal</dt>
                  <dd>
                    {resultadoParsed.data.datos_detectados.etapa_procesal ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">¿Hay detenidos?</dt>
                  <dd>
                    {resultadoParsed.data.datos_detectados.hay_detenidos ?? "—"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Delitos posibles</dt>
                  <dd>
                    {resultadoParsed.data.datos_detectados.delitos_posibles
                      .length > 0
                      ? resultadoParsed.data.datos_detectados.delitos_posibles.join(
                          ", ",
                        )
                      : "—"}
                  </dd>
                </div>
              </dl>
            </Card>
          </Seccion>

          <Seccion titulo="Preguntas generadas">
            <div className="space-y-3">
              {resultadoParsed.data.preguntas.map((p) => (
                <Card key={p.id} className="p-4 space-y-1.5">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className="text-sm font-medium">
                      {p.label}
                      {p.requerido ? (
                        <span className="text-destructive">*</span>
                      ) : null}
                    </p>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted font-mono uppercase tracking-wider text-muted-foreground">
                      {p.tipo}
                    </span>
                  </div>
                  {p.opciones && p.opciones.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Opciones: {p.opciones.join(", ")}
                    </p>
                  ) : null}
                  {p.motivo ? (
                    <p className="text-xs text-muted-foreground italic">
                      {p.motivo}
                    </p>
                  ) : null}
                </Card>
              ))}
            </div>
          </Seccion>
        </>
      ) : !tieneResultado ? (
        <Card className="p-4 border-amber-500/40 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-500" />
            <p className="text-sm text-amber-200">Resultado no disponible.</p>
          </div>
        </Card>
      ) : (
        <ResultadoMalformado raw={meta.resultado} />
      )}
    </div>
  );
}

function ResultadoMalformado({ raw }: { raw: unknown }) {
  return (
    <Card className="p-4 border-amber-500/40 bg-amber-500/5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-500" />
        <div className="space-y-2 min-w-0 flex-1">
          <p className="text-sm text-amber-200 font-medium">
            Resultado en formato inesperado
          </p>
          <pre className="text-xs overflow-x-auto bg-background/50 p-2 rounded border border-border max-h-64">
            {JSON.stringify(raw, null, 2).slice(0, 2000)}
          </pre>
        </div>
      </div>
    </Card>
  );
}

function Seccion({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="font-medium text-xs uppercase tracking-wider text-muted-foreground">
        {titulo}
      </h3>
      {children}
    </div>
  );
}

function Diagnostico({ meta }: { meta: EjecucionMetadata }) {
  const items: Array<[string, string | number]> = [];
  if (meta.parseo_intento != null)
    items.push(["Parseo intento", meta.parseo_intento]);
  if (meta.iterations !== undefined)
    items.push(["Iteraciones del agente", meta.iterations]);
  if (
    meta.cache_creation_input_tokens !== undefined &&
    meta.cache_creation_input_tokens > 0
  ) {
    items.push([
      "Cache creation tokens",
      meta.cache_creation_input_tokens,
    ]);
  }
  if (
    meta.cache_read_input_tokens !== undefined &&
    meta.cache_read_input_tokens > 0
  ) {
    items.push(["Cache read tokens", meta.cache_read_input_tokens]);
  }

  if (items.length === 0) return null;

  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronDown className="size-4 transition-transform duration-200 group-data-[panel-open]:rotate-180" />
        Diagnóstico
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3">
        <Card className="p-4">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {items.map(([k, v]) => (
              <div
                key={k}
                className="flex items-baseline justify-between gap-2"
              >
                <dt className="text-muted-foreground text-xs uppercase tracking-wider">
                  {k}
                </dt>
                <dd className="font-mono">
                  {typeof v === "number" ? v.toLocaleString("es-AR") : v}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}
