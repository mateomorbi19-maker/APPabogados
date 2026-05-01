"use client";
import { fmtFecha } from "@/lib/format";
import type { Caso } from "@/lib/types";

type Props = {
  caso: Caso;
};

// Header del caso: título grande + metadata (creado / rol / jurisdicción).
// FASE 5B agrega el botón "Eliminar" arriba a la derecha + modal de confirm.
export function HeaderCaso({ caso }: Props) {
  const jurisdiccion =
    caso.contexto && typeof caso.contexto === "object"
      ? (caso.contexto.jurisdiccion as string | null | undefined)
      : null;

  return (
    <header className="space-y-2">
      <h1 className="font-serif text-3xl leading-tight">{caso.titulo}</h1>
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
    </header>
  );
}
