"use client";
// Las personas de la causa.
//
// Por qué es una lista y no un campo "Imputados" con nombres separados por
// coma: el imputado NO es siempre el cliente. Si el estudio actúa como
// querellante, el cliente es la víctima y el imputado es la contraparte. Esa
// distinción es la que va a decidir a quién se le manda el reporte cuando
// exista la reportería, y mandárselo a la persona equivocada no se deshace.
//
// La situación de libertad se muestra sólo cuando el rol la hace significativa
// (imputado). Un testigo "en libertad" es ruido.

import { useState } from "react";
import { Plus, Pencil, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ROL_PARTE_BADGE,
  ROL_PARTE_LABEL,
  SITUACION_LIBERTAD_BADGE,
  SITUACION_LIBERTAD_LABEL,
} from "@/lib/casos/ficha";
import type { ParteCaso } from "@/lib/types";
import { ParteForm } from "./parte-form";

type Props = {
  casoId: string;
  partes: ParteCaso[];
  onPartesChange: (partes: ParteCaso[]) => void;
};

export function PartesCausa({ casoId, partes, onPartesChange }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [editando, setEditando] = useState<ParteCaso | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  const abrirNueva = () => {
    setEditando(null);
    setFormOpen(true);
  };

  const abrirEdicion = (p: ParteCaso) => {
    setEditando(p);
    setFormOpen(true);
  };

  const handleBorrar = async (p: ParteCaso) => {
    if (borrando) return;
    setBorrando(p.id);
    try {
      const res = await fetch(`/api/casos/${casoId}/partes/${p.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("No se pudo quitar a la persona");
        return;
      }
      onPartesChange(partes.filter((x) => x.id !== p.id));
    } catch {
      toast.error("No se pudo quitar a la persona. Revisá la conexión.");
    } finally {
      setBorrando(null);
    }
  };

  const handleSaved = (p: ParteCaso) => {
    const existe = partes.some((x) => x.id === p.id);
    onPartesChange(
      existe ? partes.map((x) => (x.id === p.id ? p : x)) : [...partes, p],
    );
  };

  return (
    <section
      className="rounded-xl border border-[var(--el-border)] bg-[var(--el-surface-card)] shadow-[var(--el-shadow-card)]"
      aria-labelledby="partes-titulo"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <h2
          id="partes-titulo"
          className="text-sm font-medium text-[var(--el-text)]"
        >
          Partes
          {partes.length > 0 ? (
            <span className="ml-2 font-normal text-[var(--el-text-muted)]">
              {partes.length}
            </span>
          ) : null}
        </h2>
        <Button variant="outline" size="sm" onClick={abrirNueva}>
          <Plus className="size-4" />
          Agregar persona
        </Button>
      </header>

      {partes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 border-t border-[var(--el-border)] px-4 py-8 text-center sm:px-5">
          <span className="flex size-11 items-center justify-center rounded-xl border border-[var(--el-border)] bg-[var(--el-glass)]">
            <UserRound className="size-5 text-[var(--el-text-muted)]" />
          </span>
          <p className="text-sm text-[var(--el-text-soft)]">
            Todavía no hay personas cargadas
          </p>
          <p className="max-w-xs text-xs leading-relaxed text-[var(--el-text-muted)]">
            Imputados, víctima, querellante. Marcá cuál es el cliente del
            estudio: no siempre es el imputado.
          </p>
        </div>
      ) : (
        <ul className="border-t border-[var(--el-border)]">
          {partes.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-[var(--el-border)] px-4 py-3 last:border-b-0 sm:px-5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--el-text)] break-words">
                  {p.nombre}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Chip className={ROL_PARTE_BADGE[p.rol]}>
                    {ROL_PARTE_LABEL[p.rol]}
                  </Chip>
                  {p.es_cliente ? (
                    <Chip className="bg-[rgba(139,92,246,0.22)] text-violet-800 dark:text-[#CDBEFF]">
                      Nuestro cliente
                    </Chip>
                  ) : null}
                  {p.situacion_libertad && p.rol === "imputado" ? (
                    <Chip
                      className={SITUACION_LIBERTAD_BADGE[p.situacion_libertad]}
                    >
                      {SITUACION_LIBERTAD_LABEL[p.situacion_libertad]}
                    </Chip>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => abrirEdicion(p)}
                  aria-label={`Editar ${p.nombre}`}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => handleBorrar(p)}
                  disabled={borrando === p.id}
                  aria-label={`Quitar ${p.nombre}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ParteForm
        open={formOpen}
        casoId={casoId}
        parte={editando}
        onClose={() => setFormOpen(false)}
        onSaved={handleSaved}
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
