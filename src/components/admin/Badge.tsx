// Badge con variantes de estado para el panel admin. Sin dependencia de
// shadcn/ui badge (no instalado). Usamos colores fijos en vez de tokens
// del theme porque el panel admin es puntual: rojo = error, amarillo =
// warning/degradación, verde = ok, gris = neutral.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant =
  | "ok"
  | "warning"
  | "error"
  | "neutral"
  | "admin";

const VARIANTS: Record<BadgeVariant, string> = {
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  error: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  neutral: "bg-muted text-muted-foreground border-border",
  admin: "bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/40",
};

export function Badge({
  variant = "neutral",
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium leading-tight whitespace-nowrap",
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
