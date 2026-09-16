"use client";
// Los reportes al cliente de la causa, dentro de la ficha (Fase 12).
//
// Mismo molde que escritos-causa.tsx y por la misma razón: el flujo entero
// —elegir a quién, qué plantilla, completar el criterio, leer, corregir,
// enviar— vive acá, sin salir de la ficha. Lo que se lista es lo generado
// para esta causa; las seis plantillas aparecen adentro de «Nuevo reporte».
//
// Dos parámetros de URL abren cosas directo, para los links que dejan LEXIE
// y la tarjeta del Inicio: `?reporte=<id>` abre el detalle, `?reporte=nuevo`
// abre el diálogo de generación. Se leen igual que `?escrito=` en
// escritos-causa.tsx.

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { MessageSquareText, MessageSquarePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtFecha } from "@/lib/format";
import { Button } from "@/components/ui/button";
import type { Caso, ParteCaso } from "@/lib/types";
import {
  CANAL_REPORTE_LABEL,
  DIAS_SIN_REPORTE_AVISO,
  ESTADO_REPORTE_LABEL,
  contarMarcasReporte,
  type ReporteCliente,
  type ReporteClienteLista,
} from "@/lib/reporteria/types";
import { plantillaPorId } from "@/lib/reporteria/plantillas";
import { NuevoReporteDialog } from "./nuevo-reporte-dialog";
import { ReporteDetalleDialog } from "./reporte-detalle-dialog";

type Props = {
  caso: Caso;
  partes: ParteCaso[];
  reportes: ReporteClienteLista[];
  onReportesChange: Dispatch<SetStateAction<ReporteClienteLista[]>>;
};

const ESTADO_BADGE: Record<ReporteClienteLista["estado"], string> = {
  borrador:
    "bg-[rgba(245,158,11,0.22)] text-amber-800 dark:text-[#FFE0A3] border-transparent",
  enviado:
    "bg-[rgba(16,185,129,0.22)] text-emerald-800 dark:text-[#A7F3D0] border-transparent",
  descartado:
    "bg-[rgba(113,113,122,0.22)] text-zinc-700 dark:text-zinc-300 border-transparent",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function aFilaReporte(r: ReporteCliente): ReporteClienteLista {
  const {
    contenido,
    contenido_generado: _g,
    contenido_enviado: _e,
    criterio: _c,
    datos: _d,
    ...resto
  } = r;
  void _g;
  void _e;
  void _c;
  void _d;
  return { ...resto, pendientes: contarMarcasReporte(contenido) };
}

function diasDesde(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function ReportesCausa({ caso, partes, reportes, onReportesChange }: Props) {
  const pathname = usePathname();
  const param = useSearchParams().get("reporte");
  const reporteEnUrl = param && UUID_RE.test(param) ? param : null;
  const nuevoEnUrl = param === "nuevo";

  const [nuevoOpen, setNuevoOpen] = useState(nuevoEnUrl);
  const [detalleId, setDetalleId] = useState<string | null>(reporteEnUrl);
  const [borrando, setBorrando] = useState<string | null>(null);

  // Ajuste durante el render (ver escritos-causa.tsx): la ventana de LEXIE no
  // se desmonta al navegar y el abogado puede pedir dos reportes seguidos.
  const [paramVisto, setParamVisto] = useState(param);
  if (param !== paramVisto) {
    setParamVisto(param);
    if (reporteEnUrl) setDetalleId(reporteEnUrl);
    if (nuevoEnUrl) setNuevoOpen(true);
  }

  const limpiarUrl = () => {
    if (param) window.history.replaceState(null, "", pathname);
  };

  const ultimoEnvio = useMemo(() => {
    const enviados = reportes
      .filter((r) => r.estado === "enviado" && r.enviado_en)
      .map((r) => r.enviado_en as string)
      .sort()
      .reverse();
    return enviados[0] ?? null;
  }, [reportes]);
  const hayCliente = partes.some((p) => p.es_cliente);
  const dias = ultimoEnvio ? diasDesde(ultimoEnvio) : null;

  const handleGenerado = (r: ReporteCliente) => {
    onReportesChange((prev) => [aFilaReporte(r), ...prev]);
    setNuevoOpen(false);
    limpiarUrl();
    setDetalleId(r.id);
  };

  const handleActualizado = (r: ReporteCliente) => {
    onReportesChange((prev) => prev.map((x) => (x.id === r.id ? aFilaReporte(r) : x)));
  };

  const handleBorrar = async (r: ReporteClienteLista) => {
    if (borrando) return;
    if (!window.confirm("¿Borrar este borrador? No se puede deshacer.")) return;
    setBorrando(r.id);
    try {
      const res = await fetch(`/api/casos/${caso.id}/reportes/${r.id}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) {
        toast.error(json?.error ?? "No se pudo borrar el reporte");
        return;
      }
      onReportesChange((prev) => prev.filter((x) => x.id !== r.id));
    } catch {
      toast.error("No se pudo borrar el reporte. Revisá la conexión.");
    } finally {
      setBorrando(null);
    }
  };

  return (
    <section
      className="rounded-xl border border-[var(--el-border)] bg-[var(--el-surface-card)] shadow-[var(--el-shadow-card)]"
      aria-labelledby="reportes-titulo"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 id="reportes-titulo" className="text-sm font-medium text-[var(--el-text)]">
            Reportes al cliente
            {reportes.length > 0 ? (
              <span className="ml-2 font-normal text-[var(--el-text-muted)]">
                {reportes.length}
              </span>
            ) : null}
          </h2>
          {hayCliente ? (
            <p
              className={cn(
                "mt-0.5 text-xs",
                dias !== null && dias < DIAS_SIN_REPORTE_AVISO
                  ? "text-[var(--el-text-muted)]"
                  : "text-amber-700 dark:text-amber-300",
              )}
            >
              {ultimoEnvio
                ? `Último reporte enviado hace ${dias} día${dias === 1 ? "" : "s"} (${fmtFecha(ultimoEnvio)})`
                : "Todavía no se le mandó ningún reporte al cliente"}
            </p>
          ) : null}
        </div>
        <Button size="sm" onClick={() => setNuevoOpen(true)} disabled={!hayCliente}>
          <MessageSquarePlus className="size-4" />
          Nuevo reporte
        </Button>
      </header>

      {reportes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 border-t border-[var(--el-border)] px-4 py-8 text-center sm:px-5">
          <span className="flex size-11 items-center justify-center rounded-xl border border-[var(--el-border)] bg-[var(--el-glass)]">
            <MessageSquareText className="size-5 text-[var(--el-text-muted)]" />
          </span>
          <p className="text-sm text-[var(--el-text-soft)]">
            Todavía no hay reportes para esta causa
          </p>
          <p className="max-w-sm text-xs leading-relaxed text-[var(--el-text-muted)]">
            {hayCliente
              ? "Elegí una de las seis plantillas del estudio: la app arma el borrador con lo que sabe de la causa, vos completás el criterio y lo mandás por correo o por WhatsApp. Nada sale sin que lo leas."
              : "Para reportar hace falta una persona marcada como cliente del estudio en el bloque Partes."}
          </p>
        </div>
      ) : (
        <ul className="border-t border-[var(--el-border)]">
          {reportes.map((r) => {
            const p = plantillaPorId(r.plantilla);
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-[var(--el-border)] px-4 py-3 last:border-b-0 sm:px-5"
              >
                <button
                  type="button"
                  onClick={() => setDetalleId(r.id)}
                  className="min-w-0 flex-1 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <p className="text-sm font-medium text-[var(--el-text)] break-words">
                    {p ? `${p.codigo} · ${p.titulo}` : r.plantilla}
                    <span className="ml-2 font-normal text-[var(--el-text-muted)]">
                      para {r.destinatario_nombre}
                    </span>
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Chip className={ESTADO_BADGE[r.estado]}>
                      {ESTADO_REPORTE_LABEL[r.estado]}
                    </Chip>
                    {r.estado === "borrador" && r.pendientes > 0 ? (
                      <Chip className="border-[var(--el-border)] bg-[var(--el-glass)] text-[var(--el-text-soft)]">
                        {r.pendientes} por completar
                      </Chip>
                    ) : null}
                    {r.sin_ia ? (
                      <Chip className="border-[var(--el-border)] bg-[var(--el-glass)] text-[var(--el-text-soft)]">
                        sin IA
                      </Chip>
                    ) : null}
                    <span className="text-xs text-[var(--el-text-muted)]">
                      {r.estado === "enviado" && r.enviado_en
                        ? `enviado ${fmtFecha(r.enviado_en)} · ${r.enviado_a ?? CANAL_REPORTE_LABEL[r.canal]}`
                        : `${CANAL_REPORTE_LABEL[r.canal]} · ${fmtFecha(r.creado_en)}`}
                    </span>
                  </div>
                </button>
                {r.estado !== "enviado" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => handleBorrar(r)}
                    disabled={borrando === r.id}
                    aria-label="Borrar borrador"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <NuevoReporteDialog
        open={nuevoOpen}
        caso={caso}
        partes={partes}
        onClose={() => {
          setNuevoOpen(false);
          limpiarUrl();
        }}
        onGenerado={handleGenerado}
      />

      <ReporteDetalleDialog
        casoId={caso.id}
        partes={partes}
        reporteId={detalleId}
        onClose={() => {
          setDetalleId(null);
          limpiarUrl();
        }}
        onActualizado={handleActualizado}
      />
    </section>
  );
}

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full border border-transparent px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}
