"use client";
// Barra superior fija del chat inmersivo. Unifica en una sola fila:
// volver al caso + título del caso + dropdown de conversaciones +
// renombrar + badge archivada + "Nueva conversación".

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Conversacion } from "@/lib/types";
import { ConversacionesDropdown } from "./conversaciones-dropdown";
import { NuevaConversacionModal } from "./nueva-conversacion-modal";
import { RenombrarConversacionModal } from "./renombrar-conversacion-modal";

type Props = {
  casoId: string;
  casoTitulo: string;
  conversacion: Conversacion;
  conversaciones: Conversacion[];
  onTituloRenombrado: (nuevoTitulo: string) => void;
};

export function ChatHeader({
  casoId,
  casoTitulo,
  conversacion,
  conversaciones,
  onTituloRenombrado,
}: Props) {
  const [nuevaOpen, setNuevaOpen] = useState(false);
  const [renombrarOpen, setRenombrarOpen] = useState(false);

  const archivada = conversacion.estado === "archivada";

  return (
    <header className="shrink-0 border-b border-border bg-card/50 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 md:px-6">
        <Link
          href={`/dashboard/mis-casos/${casoId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">Volver al caso</span>
        </Link>
        <span className="text-muted-foreground shrink-0">·</span>
        <span
          className="text-sm font-medium truncate max-w-[180px] md:max-w-[280px]"
          title={casoTitulo}
        >
          {casoTitulo}
        </span>
        <span className="text-muted-foreground/50 shrink-0">/</span>
        <ConversacionesDropdown
          casoId={casoId}
          conversacionActual={conversacion}
          conversaciones={conversaciones}
        />
        {archivada ? (
          <span className="text-[10px] uppercase tracking-wider rounded-md border border-amber-500/30 bg-amber-500/15 text-amber-400 px-1.5 py-0.5">
            Archivada
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRenombrarOpen(true)}
          title="Renombrar conversación"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          aria-label="Renombrar"
        >
          <Pencil className="size-3.5" />
        </Button>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setNuevaOpen(true)}
        >
          <Plus className="size-3.5" />
          <span className="hidden sm:inline">Nueva conversación</span>
          <span className="sm:hidden">Nueva</span>
        </Button>
      </div>

      <NuevaConversacionModal
        open={nuevaOpen}
        casoId={casoId}
        onClose={() => setNuevaOpen(false)}
      />
      <RenombrarConversacionModal
        open={renombrarOpen}
        casoId={casoId}
        conversacion={conversacion}
        onClose={() => setRenombrarOpen(false)}
        onRenombrado={onTituloRenombrado}
      />
    </header>
  );
}
