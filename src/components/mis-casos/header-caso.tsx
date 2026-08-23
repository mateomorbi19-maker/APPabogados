"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtFecha } from "@/lib/format";
import type { Caso } from "@/lib/types";
import { EliminarCasoModal } from "./eliminar-caso-modal";

type Props = {
  caso: Caso;
};

// Header del caso: título grande + metadata (creado / rol / jurisdicción) +
// botón "Eliminar" arriba a la derecha que abre el modal de confirmación.
export function HeaderCaso({ caso }: Props) {
  const [eliminarOpen, setEliminarOpen] = useState(false);

  const jurisdiccion =
    caso.contexto && typeof caso.contexto === "object"
      ? (caso.contexto.jurisdiccion as string | null | undefined)
      : null;

  return (
    // flex+gap en vez de space-y: el link de volver es `md:hidden`, y con
    // space-y (que se aplica por selector de hermano, no por caja) el título
    // seguía heredando el margen del elemento oculto en escritorio.
    <header className="flex flex-col gap-2">
      {/* Vuelta atrás del master-detail: abajo de 768px el shell esconde la
          lista de casos cuando hay uno abierto, así que este link es la única
          forma de volver sin el botón del browser. */}
      <Link
        href="/dashboard/mis-casos"
        className="md:hidden self-start inline-flex items-center gap-1 min-h-10 pr-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-4" />
        Mis casos
      </Link>
      <div className="flex items-start justify-between gap-3">
        {/* Las carátulas reales son malas (varias son la primera línea del
            relato): a 30px fijos se comían 4-6 renglones de la pantalla antes
            de que apareciera cualquier otra cosa. */}
        <h1 className="font-serif text-xl sm:text-2xl md:text-3xl leading-tight min-w-0 break-words">
          {caso.titulo}
        </h1>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
          onClick={() => setEliminarOpen(true)}
          aria-label="Eliminar caso"
        >
          <Trash2 />
          {/* El texto se oculta abajo de 640px: con el título son ~92px que
              no sobran a 360px. El ícono de tacho basta y el aria-label
              cubre al lector de pantalla. */}
          <span className="hidden sm:inline">Eliminar</span>
        </Button>
      </div>
      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <dt className="uppercase tracking-wider">Creado</dt>
          <dd>{fmtFecha(caso.creado_en)}</dd>
        </div>
        <span aria-hidden="true">·</span>
        <div className="flex items-center gap-1.5">
          <dt className="uppercase tracking-wider">Rol</dt>
          <dd className="capitalize">{caso.rol}</dd>
        </div>
        {jurisdiccion ? (
          <>
            <span aria-hidden="true">·</span>
            <div className="flex items-center gap-1.5">
              <dt className="uppercase tracking-wider">Jurisdicción</dt>
              <dd>{jurisdiccion}</dd>
            </div>
          </>
        ) : null}
      </dl>

      <EliminarCasoModal
        open={eliminarOpen}
        casoId={caso.id}
        onClose={() => setEliminarOpen(false)}
      />
    </header>
  );
}
