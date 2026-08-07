"use client";
// Rail horizontal de buzones. No usa <Tabs/> de shadcn a propósito: acá el
// panel de contenido no está dentro del tab (la lista y el hilo son hermanos),
// así que alcanza con un <nav> de botones con aria-current.

import { Inbox, Send, Star, Trash2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BUZONES_LABEL, BUZONES_ORDEN, type Buzon } from "@/lib/gmail/types";

const ICONOS: Record<Buzon, LucideIcon> = {
  INBOX: Inbox,
  STARRED: Star,
  SENT: Send,
  TRASH: Trash2,
};

type Props = {
  activo: Buzon;
  onChange: (b: Buzon) => void;
};

export function BuzonRail({ activo, onChange }: Props) {
  return (
    <nav
      aria-label="Buzones"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--el-border-soft)] px-2 py-1.5"
    >
      {BUZONES_ORDEN.map((b) => {
        const Icon = ICONOS[b];
        const esActivo = b === activo;
        return (
          <button
            key={b}
            type="button"
            aria-current={esActivo ? "page" : undefined}
            onClick={() => onChange(b)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-xs transition-colors",
              esActivo
                ? "bg-[rgba(139,92,246,0.22)] font-medium text-violet-800 dark:text-[#CDBEFF]"
                : "text-[var(--el-text-soft)] hover:bg-black/5 dark:hover:bg-white/5 hover:text-[var(--el-text)]",
            )}
          >
            <Icon className="size-3.5 shrink-0" />
            {BUZONES_LABEL[b]}
          </button>
        );
      })}
    </nav>
  );
}
