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
    // `relative` para que el dropdown de conversaciones pueda anclarse al
    // header entero en móvil (ver conversaciones-dropdown). El pt de la
    // safe-area evita que la status bar del iPhone tape esta fila: el chat
    // ocupa la pantalla completa por el viewportFit "cover" del layout.
    <header className="relative shrink-0 border-b border-border bg-card/50 backdrop-blur pt-[env(safe-area-inset-top)]">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 md:px-6">
        <Link
          href={`/dashboard/mis-casos/${casoId}`}
          // Abajo de 640px el texto se oculta y queda solo la flecha: sin el
          // min-h/min-w el target era el ícono de 16px, y es la única salida
          // del chat hacia el caso.
          className="inline-flex items-center justify-center gap-1 min-h-10 min-w-10 sm:min-h-0 sm:min-w-0 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label="Volver al caso"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">Volver al caso</span>
        </Link>
        {/* Los separadores se ocultan abajo de 640px: con 7 items en una
            fila de 360px cada "·" empujaba el header a 3 renglones y se
            comía ~100px del alto útil del chat. */}
        <span className="text-muted-foreground shrink-0 hidden sm:inline">·</span>
        <span
          className="text-sm font-medium truncate max-w-[120px] sm:max-w-[180px] md:max-w-[280px]"
          title={casoTitulo}
        >
          {casoTitulo}
        </span>
        <span className="text-muted-foreground/50 shrink-0 hidden sm:inline">/</span>
        <ConversacionesDropdown
          casoId={casoId}
          conversacionActual={conversacion}
          conversaciones={conversaciones}
        />
        {archivada ? (
          <span className="text-[10px] uppercase tracking-wider rounded-md border border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1.5 py-0.5">
            Archivada
          </span>
        ) : null}
        {/* size="icon-sm" en vez de "sm"+h-7 w-7: el primitivo ya trae el
            piso táctil (28px en escritorio, 40px abajo de 768px). Con 28px
            pegado al dropdown se abría uno queriendo el otro. */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setRenombrarOpen(true)}
          title="Renombrar conversación"
          className="text-muted-foreground hover:text-foreground"
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
