"use client";
// Header del chat. Título de la conversación actual + dropdown con
// archivadas + botón "Nueva conversación" (con modal de confirmación)
// + botón "Renombrar".

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Conversacion } from "@/lib/types";
import { ConversacionesDropdown } from "./conversaciones-dropdown";
import { NuevaConversacionModal } from "./nueva-conversacion-modal";
import { RenombrarConversacionModal } from "./renombrar-conversacion-modal";

type Props = {
  casoId: string;
  conversacion: Conversacion;
  conversaciones: Conversacion[];
  onTituloRenombrado: (nuevoTitulo: string) => void;
};

export function ChatHeader({
  casoId,
  conversacion,
  conversaciones,
  onTituloRenombrado,
}: Props) {
  const [nuevaOpen, setNuevaOpen] = useState(false);
  const [renombrarOpen, setRenombrarOpen] = useState(false);

  const archivada = conversacion.estado === "archivada";

  return (
    <header className="flex items-center gap-2 flex-wrap rounded-md border border-border bg-card/30 px-3 py-2">
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
        Nueva conversación
      </Button>

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
