"use client";
// Los escritos de la causa, dentro de la ficha.
//
// Gonzalo lo pidió así, textual: "debería estar dentro de la ficha de la causa
// para que gestione todo sin salir de la misma". El flujo entero vive acá:
// elegir el modelo, ver qué datos del expediente se van a usar, generar,
// corregir el texto, bajar el PDF y marcarlo como presentado. Ninguna de esas
// cosas navega a otra pantalla.
//
// Lo que se lista es lo GENERADO para esta causa, no el catálogo de modelos:
// el catálogo aparece adentro del diálogo de "Generar escrito", que es el único
// lugar donde tiene sentido elegir uno.

import { useState, type Dispatch, type SetStateAction } from "react";
import { FileText, FilePlus2, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtFecha } from "@/lib/format";
import { Button } from "@/components/ui/button";
import type { Caso, EventoCaso, ParteCaso } from "@/lib/types";
import {
  ESTADO_ESCRITO_LABEL,
  type EscritoGenerado,
  type EscritoGeneradoLista,
} from "@/lib/escritos/types";
import { GenerarEscritoDialog } from "./generar-escrito-dialog";
import { EscritoDetalleDialog } from "./escrito-detalle-dialog";

type Props = {
  caso: Caso;
  partes: ParteCaso[];
  escritos: EscritoGeneradoLista[];
  onEscritosChange: Dispatch<SetStateAction<EscritoGeneradoLista[]>>;
  /** Presentar un escrito crea un evento en el timeline: se suma sin refetch. */
  onEventoNuevo: (evento: EventoCaso) => void;
};

const ESTADO_BADGE: Record<EscritoGeneradoLista["estado"], string> = {
  borrador:
    "bg-[rgba(245,158,11,0.22)] text-amber-800 dark:text-[#FFE0A3] border-transparent",
  presentado:
    "bg-[rgba(16,185,129,0.22)] text-emerald-800 dark:text-[#A7F3D0] border-transparent",
};

function aFila(e: EscritoGenerado): EscritoGeneradoLista {
  const { contenido, ...resto } = e;
  const pendientes = contenido.match(/\[COMPLETAR:[^\]]*\]/g)?.length ?? 0;
  return { ...resto, pendientes };
}

export function EscritosCausa({
  caso,
  partes,
  escritos,
  onEscritosChange,
  onEventoNuevo,
}: Props) {
  const [generarOpen, setGenerarOpen] = useState(false);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  const handleGenerado = (e: EscritoGenerado) => {
    onEscritosChange((prev) => [aFila(e), ...prev]);
    setGenerarOpen(false);
    // Se abre directo en el detalle: lo primero que hay que hacer con un
    // escrito recién redactado es leerlo.
    setDetalleId(e.id);
  };

  const handleActualizado = (e: EscritoGenerado) => {
    onEscritosChange((prev) => prev.map((x) => (x.id === e.id ? aFila(e) : x)));
  };

  const handleBorrar = async (e: EscritoGeneradoLista) => {
    if (borrando) return;
    if (!window.confirm(`¿Borrar el escrito "${e.titulo}"? No se puede deshacer.`)) {
      return;
    }
    setBorrando(e.id);
    try {
      const res = await fetch(`/api/casos/${caso.id}/escritos/${e.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("No se pudo borrar el escrito");
        return;
      }
      onEscritosChange((prev) => prev.filter((x) => x.id !== e.id));
    } catch {
      toast.error("No se pudo borrar el escrito. Revisá la conexión.");
    } finally {
      setBorrando(null);
    }
  };

  return (
    <section
      className="rounded-xl border border-[var(--el-border)] bg-[var(--el-surface-card)] shadow-[var(--el-shadow-card)]"
      aria-labelledby="escritos-titulo"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <h2
          id="escritos-titulo"
          className="text-sm font-medium text-[var(--el-text)]"
        >
          Escritos
          {escritos.length > 0 ? (
            <span className="ml-2 font-normal text-[var(--el-text-muted)]">
              {escritos.length}
            </span>
          ) : null}
        </h2>
        <Button size="sm" onClick={() => setGenerarOpen(true)}>
          <FilePlus2 className="size-4" />
          Generar escrito
        </Button>
      </header>

      {escritos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 border-t border-[var(--el-border)] px-4 py-8 text-center sm:px-5">
          <span className="flex size-11 items-center justify-center rounded-xl border border-[var(--el-border)] bg-[var(--el-glass)]">
            <FileText className="size-5 text-[var(--el-text-muted)]" />
          </span>
          <p className="text-sm text-[var(--el-text-soft)]">
            Todavía no hay escritos redactados para esta causa
          </p>
          <p className="max-w-sm text-xs leading-relaxed text-[var(--el-text-muted)]">
            Elegí uno de los 50 modelos del estudio o uno propio, y el
            redactor lo adapta a los datos del expediente. Si no sabés cuál
            conviene, preguntale a LEXIE.
          </p>
        </div>
      ) : (
        <ul className="border-t border-[var(--el-border)]">
          {escritos.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-[var(--el-border)] px-4 py-3 last:border-b-0 sm:px-5"
            >
              <button
                type="button"
                onClick={() => setDetalleId(e.id)}
                className="min-w-0 flex-1 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <p className="text-sm font-medium text-[var(--el-text)] break-words">
                  {e.titulo}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Chip className={ESTADO_BADGE[e.estado]}>
                    {ESTADO_ESCRITO_LABEL[e.estado]}
                  </Chip>
                  {e.estado === "borrador" && e.pendientes > 0 ? (
                    <Chip className="border-[var(--el-border)] bg-[var(--el-glass)] text-[var(--el-text-soft)]">
                      {e.pendientes} por completar
                    </Chip>
                  ) : null}
                  <span className="text-xs text-[var(--el-text-muted)]">
                    {e.modelo_titulo} ·{" "}
                    {e.estado === "presentado" && e.presentado_en
                      ? `presentado ${fmtFecha(e.presentado_en)}`
                      : fmtFecha(e.creado_en)}
                  </span>
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Abrir PDF de ${e.titulo}`}
                  title="Ver PDF"
                  nativeButton={false}
                  render={
                    <a
                      href={`/api/casos/${caso.id}/escritos/${e.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  <ExternalLink className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => handleBorrar(e)}
                  disabled={borrando === e.id}
                  aria-label={`Borrar ${e.titulo}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <GenerarEscritoDialog
        open={generarOpen}
        caso={caso}
        partes={partes}
        onClose={() => setGenerarOpen(false)}
        onGenerado={handleGenerado}
      />

      <EscritoDetalleDialog
        casoId={caso.id}
        escritoId={detalleId}
        onClose={() => setDetalleId(null)}
        onActualizado={handleActualizado}
        onPresentado={(e, evento) => {
          handleActualizado(e);
          onEventoNuevo(evento);
        }}
      />
    </section>
  );
}

function Chip({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
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
