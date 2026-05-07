"use client";
// Paginación numérica con anterior / siguiente. Mantiene los demás query
// params al cambiar de página (no hardcodea filtros).

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  // Construye el href para una página dada preservando los demás filtros.
  buildHref: (page: number) => string;
};

// Genera la lista de páginas con elipsis estilo "1 ... 4 5 6 ... 10".
// Para volúmenes chicos (1-7 páginas) muestra todo.
function paginas(current: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(totalPages - 1, current + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < totalPages - 1) out.push("…");
  out.push(totalPages);
  return out;
}

export function Pagination({ page, pageSize, total, buildHref }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const list = paginas(page, totalPages);
  const baseBtn =
    "inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border px-2 text-xs transition-colors";

  return (
    <nav
      aria-label="Paginación"
      className="flex items-center gap-1 mt-3 flex-wrap"
    >
      <Link
        href={buildHref(Math.max(1, page - 1))}
        className={cn(
          baseBtn,
          page === 1
            ? "pointer-events-none opacity-40"
            : "hover:bg-muted/50",
        )}
        aria-disabled={page === 1}
      >
        <ChevronLeft className="size-3.5" />
        Anterior
      </Link>
      {list.map((p, i) =>
        p === "…" ? (
          <span
            key={`gap-${i}`}
            className="inline-flex h-8 min-w-8 items-center justify-center text-muted-foreground text-xs"
            aria-hidden
          >
            …
          </span>
        ) : (
          <Link
            key={p}
            href={buildHref(p)}
            className={cn(
              baseBtn,
              p === page
                ? "bg-orange-500/20 text-orange-300 border-orange-500/40"
                : "hover:bg-muted/50",
            )}
            aria-current={p === page ? "page" : undefined}
          >
            {p}
          </Link>
        ),
      )}
      <Link
        href={buildHref(Math.min(totalPages, page + 1))}
        className={cn(
          baseBtn,
          page === totalPages
            ? "pointer-events-none opacity-40"
            : "hover:bg-muted/50",
        )}
        aria-disabled={page === totalPages}
      >
        Siguiente
        <ChevronRight className="size-3.5" />
      </Link>
      <span className="ml-2 text-xs text-muted-foreground">
        Mostrando {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} de {total}
      </span>
    </nav>
  );
}
