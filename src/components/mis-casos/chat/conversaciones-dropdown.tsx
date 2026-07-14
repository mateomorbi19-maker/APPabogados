"use client";
// Dropdown del header del chat con la conversación activa marcada y
// las archivadas listadas. Click en una entrada navega a /chat?conv=<id>
// (o /chat sin param para la activa, que es la canónica).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtFecha } from "@/lib/format";
import type { Conversacion } from "@/lib/types";

type Props = {
  casoId: string;
  conversacionActual: Conversacion;
  conversaciones: Conversacion[];
};

export function ConversacionesDropdown({
  casoId,
  conversacionActual,
  conversaciones,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Click fuera o ESC cierra.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (
        wrapRef.current &&
        !wrapRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const navegarA = (conv: Conversacion) => {
    setOpen(false);
    if (conv.estado === "activa") {
      router.push(`/dashboard/chat/${casoId}`);
    } else {
      router.push(`/dashboard/chat/${casoId}?conv=${conv.id}`);
    }
  };

  const archivadas = conversaciones.filter((c) => c.estado === "archivada");
  const activa = conversaciones.find((c) => c.estado === "activa");

  return (
    <div ref={wrapRef} className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="gap-1 max-w-[260px] truncate"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="text-sm font-medium truncate">
          {conversacionActual.titulo}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </Button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 z-20 w-80 max-h-96 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
            Activa
          </div>
          {activa ? (
            <ItemConv
              conv={activa}
              actualId={conversacionActual.id}
              onClick={() => navegarA(activa)}
            />
          ) : (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No hay conversación activa.
            </div>
          )}
          {archivadas.length > 0 ? (
            <>
              <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-y border-border">
                Archivadas ({archivadas.length})
              </div>
              {archivadas.map((c) => (
                <ItemConv
                  key={c.id}
                  conv={c}
                  actualId={conversacionActual.id}
                  onClick={() => navegarA(c)}
                />
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ItemConv({
  conv,
  actualId,
  onClick,
}: {
  conv: Conversacion;
  actualId: string;
  onClick: () => void;
}) {
  const esActual = conv.id === actualId;
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      className={cn(
        "w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors",
        esActual && "bg-muted/30",
      )}
    >
      <span className="shrink-0 mt-0.5 w-3.5">
        {esActual ? (
          <Check className="size-3.5 text-primary" />
        ) : null}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{conv.titulo}</p>
        <p className="text-[10px] text-muted-foreground">
          {fmtFecha(conv.actualizada_en)}
          {conv.estado === "archivada" ? " · archivada" : ""}
        </p>
      </div>
    </button>
  );
}
