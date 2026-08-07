"use client";
// Paginación numérica con anterior / siguiente. Mantiene los demás query
// params al cambiar de página (no hardcodea filtros).
//
// Construye los hrefs internamente usando los searchParams actuales: NO
// recibe función desde el server component padre. Las funciones no son
// serializables a través del límite RSC y crashean el build de producción
// con "Functions cannot be passed directly to Client Components". Antes el
// padre pasaba `buildHref`; ahora le pasamos solo primitivos y este hook
// reconstruye las URLs leyendo los params actuales del browser.

import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  page: number;
  pageSize: number;
  total: number;
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

export function Pagination({ page, pageSize, total }: Props) {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  // Clonamos los searchParams actuales para preservar todos los filtros
  // (usuario, estado, desde, hasta, q) al cambiar de página. Para página 1
  // omitimos `?page=1` por estética: la URL canónica de la primera página
  // no lleva el param.
  const buildHref = (newPage: number): string => {
    const params = new URLSearchParams(searchParams.toString());
    if (newPage <= 1) params.delete("page");
    else params.set("page", String(newPage));
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

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
                ? "bg-orange-500/20 text-orange-800 dark:text-orange-300 border-orange-500/40"
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
