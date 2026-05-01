"use client";
import { useState } from "react";
import { Trash2 } from "lucide-react";
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
    <header className="space-y-2">
      <div className="flex items-start justify-between gap-4">
        <h1 className="font-serif text-3xl leading-tight">{caso.titulo}</h1>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
          onClick={() => setEliminarOpen(true)}
        >
          <Trash2 />
          Eliminar
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
