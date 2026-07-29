"use client";
// Card de un documento en la grilla de resultados. Todo campo nulo se omite:
// con 8% de cobertura de año y 29% de tribunal, una fila de metadatos con
// huecos ("— · — · —") sería la norma, no la excepción.

import Link from "next/link";
import { useState } from "react";
import { Download, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  COLECCIONES,
  metaTribunal,
  slugMateria,
  type DocumentoRepositorio,
} from "@/lib/repositorio/types";
import { normalizarTexto } from "@/lib/repositorio/texto";
import { descargarArchivo } from "./api";
import { ICONO_COLECCION } from "./iconos";

type Props = {
  doc: DocumentoRepositorio;
  /** Filtrar por una materia desde el chip de la card. */
  onMateria: (slug: string) => void;
};

/** Metadatos de una línea. Vacío = no se renderiza la fila. */
function lineaMetadatos(doc: DocumentoRepositorio): string[] {
  const partes: string[] = [];
  if (doc.tribunal) partes.push(metaTribunal(doc.tribunal).corto);
  if (doc.anio !== null) partes.push(String(doc.anio));
  if (doc.autor) partes.push(doc.autor);
  // La carátula suele estar contenida en el título (ambos salen del nombre del
  // archivo). Repetirla no agrega información: sólo se muestra si aporta algo.
  if (
    doc.caratula &&
    !normalizarTexto(doc.titulo).includes(normalizarTexto(doc.caratula))
  ) {
    partes.push(doc.caratula);
  }
  return partes;
}

export function DocumentoCard({ doc, onMateria }: Props) {
  const meta = COLECCIONES[doc.coleccion];
  const Icono = ICONO_COLECCION[doc.coleccion];
  const [bajando, setBajando] = useState(false);

  const metadatos = lineaMetadatos(doc);
  const materias = doc.materias.slice(0, 2);
  const restantes = doc.materias.length - materias.length;

  const handleDescargar = async () => {
    if (bajando) return;
    setBajando(true);
    try {
      const r = await descargarArchivo(doc.id, doc.titulo_original);
      if (!r.ok) {
        toast.error(r.error, {
          action: r.view_url
            ? {
                label: "Abrir en Drive",
                onClick: () => window.open(r.view_url ?? "", "_blank"),
              }
            : undefined,
        });
      }
    } finally {
      setBajando(false);
    }
  };

  return (
    <article
      role="listitem"
      className="flex h-full flex-col gap-2.5 rounded-xl border border-[var(--el-border)] bg-[var(--el-surface-card)] p-4 transition-colors hover:border-[var(--el-violet)]/45"
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            meta.badge,
          )}
        >
          <Icono className="size-3" aria-hidden />
          {meta.label}
        </span>
        {doc.anonimizado ? (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-[var(--el-border-soft)] px-2 py-0.5 text-[10px] text-[var(--el-text-muted)]"
            title="El nombre viene testado o con iniciales: identidad reservada."
          >
            <EyeOff className="size-3" aria-hidden />
            Reservado
          </span>
        ) : null}
      </div>

      <h3 className="text-sm leading-snug font-medium text-[var(--el-text)]">
        <Link
          href={`/dashboard/repositorio/${doc.id}`}
          className="line-clamp-3 rounded-sm outline-none hover:text-[var(--el-violet-light)] focus-visible:ring-2 focus-visible:ring-[var(--el-violet)]/60"
        >
          {doc.titulo}
        </Link>
      </h3>

      {metadatos.length > 0 ? (
        <p className="truncate text-xs text-[var(--el-text-muted)]">
          {metadatos.join(" · ")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {materias.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => onMateria(slugMateria(doc.coleccion, label))}
            title={`Ver todo en ${label}`}
            className="max-w-[14rem] truncate rounded-md border border-[var(--el-border-soft)] px-1.5 py-0.5 text-[11px] text-[var(--el-text-soft)] transition-colors hover:border-[var(--el-violet)]/45 hover:text-[var(--el-text)]"
          >
            {label}
          </button>
        ))}
        {restantes > 0 ? (
          <span
            className="text-[11px] text-[var(--el-text-muted)]"
            title={doc.materias.slice(2).join(" · ")}
          >
            +{restantes}
          </span>
        ) : null}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-1.5">
        <Link
          href={`/dashboard/repositorio/${doc.id}`}
          className={cn(buttonVariants({ size: "sm" }), "flex-1")}
        >
          Leer
        </Link>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDescargar}
          disabled={bajando}
          aria-label={`Descargar ${doc.titulo}`}
        >
          {bajando ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Download aria-hidden />
          )}
          Descargar
        </Button>
      </div>
    </article>
  );
}
