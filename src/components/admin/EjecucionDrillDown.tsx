"use client";
// Drill-down lateral del panel admin. Recibe la ejecución completa (con
// metadata jsonb intacto) y la renderiza en 7 secciones según el spec del
// feature admin-panel-v1. No hace fetch — toda la data necesaria viaja
// con la fila desde la query del listado.

import { useState } from "react";
import { Copy, Check, X as CloseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/admin/Badge";
import { Sheet } from "@/components/ui/sheet";
import { fmtCosto, fmtFecha, fmtModelo, fmtNumber } from "@/lib/format";
import type { EjecucionAdmin } from "@/lib/admin/types";

const ESTADO_LABEL = {
  ok: { variant: "ok" as const, label: "OK" },
  degradada: { variant: "warning" as const, label: "Degradada" },
  error: { variant: "error" as const, label: "Error" },
};

type Busqueda = {
  query?: string;
  similarity_top?: number | null;
  chunks_devueltos?: number;
};

export function EjecucionDrillDown({
  ejecucion,
  onClose,
}: {
  ejecucion: EjecucionAdmin | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={ejecucion !== null} onOpenChange={(o) => !o && onClose()}>
      {ejecucion ? <Contenido ejecucion={ejecucion} onClose={onClose} /> : null}
    </Sheet>
  );
}

function Contenido({
  ejecucion,
  onClose,
}: {
  ejecucion: EjecucionAdmin;
  onClose: () => void;
}) {
  const meta = (ejecucion.metadata ?? {}) as Record<string, unknown>;
  const caso = typeof meta.caso === "string" ? meta.caso : "";
  const contexto =
    meta.contexto && typeof meta.contexto === "object"
      ? (meta.contexto as Record<string, unknown>)
      : null;
  const resultado =
    meta.resultado && typeof meta.resultado === "object"
      ? (meta.resultado as Record<string, unknown>)
      : null;
  const busquedas = Array.isArray(meta.busquedas)
    ? (meta.busquedas as Busqueda[])
    : [];
  const errorMsg = typeof meta.error === "string" ? meta.error : null;
  const errorCode =
    typeof meta.error_code === "string" ? meta.error_code : null;
  const isDegraded = meta.degraded_response === true;
  const iterations =
    typeof meta.iterations === "number" ? meta.iterations : null;
  const cacheCreate =
    typeof meta.cache_creation_input_tokens === "number"
      ? meta.cache_creation_input_tokens
      : 0;
  const cacheRead =
    typeof meta.cache_read_input_tokens === "number"
      ? meta.cache_read_input_tokens
      : 0;
  const parseoIntento =
    typeof meta.parseo_intento === "number" ? meta.parseo_intento : null;
  const parseoError =
    typeof meta.parseo_error === "string" ? meta.parseo_error : null;

  const estado = ESTADO_LABEL[ejecucion.estado];
  const idCorto = ejecucion.id.slice(-8);

  return (
    <div className="flex flex-col">
      {/* === Sección 1: Cabecera === */}
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card/95 backdrop-blur px-5 py-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Ejecución
            </span>
            <code className="font-mono text-xs">…{idCorto}</code>
            <CopyBtn label="UUID" value={ejecucion.id} />
            <Badge variant={estado.variant}>{estado.label}</Badge>
          </div>
          <div className="text-xs text-muted-foreground space-x-3">
            <span>{ejecucion.usuario_nombre}</span>
            <span>·</span>
            <span>{fmtFecha(ejecucion.ejecutado_en)}</span>
            <span>·</span>
            <span>{fmtModelo(ejecucion.modelo)}</span>
            <span>·</span>
            <span>tipo: {ejecucion.tipo}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CopyBtn
            label="Copiar JSON completo"
            value={JSON.stringify(ejecucion, null, 2)}
            wide
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <CloseIcon className="size-4" />
          </Button>
        </div>
      </div>

      <div className="px-5 py-4 space-y-5">
        {isDegraded ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Esta respuesta fue parcial: el agente alcanzó el límite de
            búsquedas y sintetizó con la información ya recopilada
            (<code className="font-mono">degraded_response = true</code>).
          </div>
        ) : null}

        {/* === Sección 2: Caso === */}
        <Seccion titulo="Caso enviado">
          {caso ? (
            <p className="text-sm whitespace-pre-wrap">{caso}</p>
          ) : (
            <NoPersistido />
          )}
        </Seccion>

        {/* === Sección 3: Contexto === */}
        <Seccion titulo="Contexto del formulario dinámico">
          {contexto && Object.keys(contexto).length > 0 ? (
            <table className="w-full text-xs">
              <tbody className="divide-y divide-border/50">
                {/* Insertamos `rol` de la ejecución arriba si existe en metadata,
                    porque el código guarda `rol` fuera de `contexto` (top-level
                    de metadata). En el panel admin lo unificamos visualmente. */}
                {typeof meta.rol === "string" ? (
                  <RowKv k="rol" v={meta.rol} />
                ) : null}
                {Object.entries(contexto).map(([k, v]) => (
                  <RowKv key={k} k={k} v={v} />
                ))}
              </tbody>
            </table>
          ) : typeof meta.rol === "string" ? (
            <table className="w-full text-xs">
              <tbody>
                <RowKv k="rol" v={meta.rol} />
              </tbody>
            </table>
          ) : (
            <NoPersistido />
          )}
        </Seccion>

        {/* === Sección 4: Respuesta === */}
        <Seccion titulo="Respuesta entregada al usuario">
          <RespuestaDelAgente resultado={resultado} tipo={ejecucion.tipo} />
        </Seccion>

        {/* === Sección 5: Búsquedas — lo más importante para debug === */}
        <Seccion titulo="Búsquedas realizadas">
          {busquedas.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No hay búsquedas registradas. (Las ejecuciones de tipo{" "}
              <code className="font-mono">pre_analisis</code> no usan RAG.)
            </p>
          ) : (
            <>
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 text-left w-8">#</th>
                    <th className="px-2 py-1 text-left">Query</th>
                    <th className="px-2 py-1 text-right">Sim. top</th>
                    <th className="px-2 py-1 text-right">Chunks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {busquedas.map((b, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5 font-mono">{i + 1}</td>
                      <td className="px-2 py-1.5">{b.query ?? "(sin query)"}</td>
                      <td className="px-2 py-1.5 text-right">
                        <SimilarityBadge value={b.similarity_top ?? null} />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <ChunksBadge value={b.chunks_devueltos ?? 0} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-2">
                {busquedas.length}{" "}
                {busquedas.length === 1 ? "búsqueda" : "búsquedas"}
                {iterations !== null
                  ? ` en ${iterations} ${iterations === 1 ? "iteración" : "iteraciones"}`
                  : ""}
                {", "}
                tiempo total {fmtNumber(ejecucion.latencia_ms)}ms
              </p>
            </>
          )}
        </Seccion>

        {/* === Sección 6: Detalles técnicos === */}
        <Seccion titulo="Detalles técnicos">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-border/50">
              <RowKv k="input_tokens" v={fmtNumber(ejecucion.input_tokens)} />
              <RowKv k="output_tokens" v={fmtNumber(ejecucion.output_tokens)} />
              <RowKv k="total_tokens" v={fmtNumber(ejecucion.total_tokens)} />
              {cacheCreate > 0 ? (
                <RowKv
                  k="cache_creation_input_tokens"
                  v={fmtNumber(cacheCreate)}
                />
              ) : null}
              {cacheRead > 0 ? (
                <RowKv k="cache_read_input_tokens" v={fmtNumber(cacheRead)} />
              ) : null}
              <RowKv k="costo_usd" v={fmtCosto(ejecucion.costo_usd)} />
              <RowKv
                k="latencia_ms"
                v={`${fmtNumber(ejecucion.latencia_ms)} ms`}
              />
              {iterations !== null ? (
                <RowKv k="iterations" v={iterations} />
              ) : null}
              {parseoIntento !== null ? (
                <RowKv
                  k="parseo_intento"
                  v={`${parseoIntento} de 3${parseoIntento > 1 ? " (recovery)" : ""}`}
                />
              ) : null}
              {parseoError ? <RowKv k="parseo_error" v={parseoError} /> : null}
              {errorCode ? <RowKv k="error_code" v={errorCode} /> : null}
              {errorMsg ? (
                <tr>
                  <td className="px-2 py-1.5 align-top text-muted-foreground">
                    error
                  </td>
                  <td className="px-2 py-1.5 font-mono whitespace-pre-wrap text-red-400">
                    {errorMsg}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Seccion>

        {/* === Sección 7: JSON crudo === */}
        <details className="rounded-md border border-border bg-card/50">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium hover:bg-muted/30">
            Ver JSON crudo de metadata
          </summary>
          <div className="border-t border-border px-3 py-2">
            <div className="flex justify-end mb-2">
              <CopyBtn
                label="Copiar al portapapeles"
                value={JSON.stringify(meta, null, 2)}
                wide
              />
            </div>
            <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all max-h-96 overflow-y-auto">
              {JSON.stringify(meta, null, 2)}
            </pre>
          </div>
        </details>
      </div>
    </div>
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
    <section>
      <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
        {titulo}
      </h3>
      <div className="rounded-md border border-border bg-card/30 px-3 py-2">
        {children}
      </div>
    </section>
  );
}

function RowKv({ k, v }: { k: string; v: unknown }) {
  return (
    <tr>
      <td className="px-2 py-1.5 align-top text-muted-foreground w-1/3">
        {k}
      </td>
      <td className="px-2 py-1.5 font-mono break-all">
        {v === null || v === undefined
          ? "—"
          : typeof v === "object"
            ? JSON.stringify(v)
            : String(v)}
      </td>
    </tr>
  );
}

function NoPersistido() {
  return (
    <p className="text-xs text-muted-foreground italic">
      (no persistido — ejecución previa al fix de persistencia)
    </p>
  );
}

function SimilarityBadge({ value }: { value: number | null }) {
  if (value === null) return <Badge variant="neutral">—</Badge>;
  let v: "ok" | "warning" | "error" = "neutral" as never;
  if (value > 0.7) v = "ok";
  else if (value >= 0.55) v = "warning";
  else v = "error";
  return (
    <Badge variant={v}>
      <span className="font-mono">{value.toFixed(3)}</span>
    </Badge>
  );
}

function ChunksBadge({ value }: { value: number }) {
  if (value === 0) {
    return <Badge variant="error">0</Badge>;
  }
  return <Badge variant="neutral">{value}</Badge>;
}

function CopyBtn({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  const [copiado, setCopiado] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Si clipboard API no está disponible (HTTP prod sin TLS, browsers
      // viejos), igual mostramos feedback. El usuario puede copiar a mano
      // del JSON crudo.
      setCopiado(false);
    }
  };

  if (!wide) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={`Copiar ${label}`}
        className="inline-flex items-center justify-center rounded h-5 w-5 text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
      >
        {copiado ? (
          <Check className="size-3 text-emerald-400" />
        ) : (
          <Copy className="size-3" />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 h-7 text-xs hover:bg-muted/30 transition-colors"
    >
      {copiado ? (
        <>
          <Check className="size-3 text-emerald-400" />
          Copiado
        </>
      ) : (
        <>
          <Copy className="size-3" />
          {label}
        </>
      )}
    </button>
  );
}

function RespuestaDelAgente({
  resultado,
  tipo,
}: {
  resultado: Record<string, unknown> | null;
  tipo: string;
}) {
  if (!resultado) {
    return (
      <p className="text-xs text-muted-foreground italic">
        (sin resultado parseado — ver sección 7 para metadata cruda)
      </p>
    );
  }

  // Pre-análisis: { resumen_preliminar, datos_detectados, preguntas[] }
  if (tipo === "pre_analisis" && Array.isArray(resultado.preguntas)) {
    const resumen =
      typeof resultado.resumen_preliminar === "string"
        ? resultado.resumen_preliminar
        : "";
    return (
      <div className="space-y-2 text-xs">
        {resumen ? (
          <div>
            <span className="font-medium">Resumen preliminar:</span>{" "}
            <span className="whitespace-pre-wrap">{resumen}</span>
          </div>
        ) : null}
        <div>
          <span className="font-medium">
            {resultado.preguntas.length} preguntas generadas
          </span>
        </div>
      </div>
    );
  }

  // Análisis profundo: { defensor?: {...}, querellante?: {...}, metadata }
  const def = resultado.defensor as
    | { estrategias?: unknown[] }
    | undefined;
  const quer = resultado.querellante as
    | { estrategias?: unknown[] }
    | undefined;

  if (def || quer) {
    return (
      <div className="space-y-2 text-xs">
        {def?.estrategias ? (
          <div>
            <span className="font-medium">Defensor:</span>{" "}
            <span>
              {def.estrategias.length}{" "}
              {def.estrategias.length === 1 ? "estrategia" : "estrategias"}
            </span>
            <EstrategiasList list={def.estrategias} />
          </div>
        ) : null}
        {quer?.estrategias ? (
          <div>
            <span className="font-medium">Querellante:</span>{" "}
            <span>
              {quer.estrategias.length}{" "}
              {quer.estrategias.length === 1 ? "estrategia" : "estrategias"}
            </span>
            <EstrategiasList list={quer.estrategias} />
          </div>
        ) : null}
      </div>
    );
  }

  // Fallback: dump como JSON.
  return (
    <pre className="text-[11px] font-mono whitespace-pre-wrap break-all">
      {JSON.stringify(resultado, null, 2)}
    </pre>
  );
}

function EstrategiasList({ list }: { list: unknown[] }) {
  return (
    <ul className="mt-1 space-y-1.5">
      {list.map((est, i) => {
        if (!est || typeof est !== "object") return null;
        const e = est as Record<string, unknown>;
        const nombre = typeof e.nombre === "string" ? e.nombre : `Estrategia ${i + 1}`;
        const tesis =
          typeof e.tesis_central === "string" ? e.tesis_central : "";
        return (
          <li key={i} className="rounded border border-border/60 px-2 py-1.5">
            <div className="font-medium">
              {i + 1}. {nombre}
            </div>
            {tesis ? (
              <div className="text-muted-foreground mt-0.5">{tesis}</div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
