"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtFecha } from "@/lib/format";
import { nombreCaso, sinCaratula } from "@/lib/casos/nombre";
import { rolBadge, rolLabel } from "@/lib/casos/rol";
import {
  ESTADO_SEGUIMIENTO_BADGE,
  ESTADO_SEGUIMIENTO_LABEL,
} from "@/lib/casos/ficha";
import { FUERO_LABEL } from "@/lib/mapa-procesal/types";
import type { Fuero } from "@/lib/mapa-procesal/types";
import type { Caso } from "@/lib/types";
import { EliminarCasoModal } from "./eliminar-caso-modal";

type Props = {
  caso: Caso;
  /** Etapa procesal derivada del mapa. `null` = mapa sin inicializar. */
  etapa: { label: string; nodoTitulo: string } | null;
};

// Header del caso: nombre + badges (etapa, estado, rol, fuero) + botón
// "Eliminar".
//
// El nombre sale de `nombreCaso()`, no de `caso.titulo`: si hay carátula manda
// la carátula. Mientras no la haya, el título automático se muestra en cursiva
// y apagado, porque es un nombre provisorio sacado del relato y no el del
// expediente.
//
// Los DOS badges de la cabecera del mockup son cosas distintas y es la
// confusión más fácil de cometer: "Instrucción" es la ETAPA PROCESAL, que la
// deriva el mapa; "En seguimiento" es el estado de la causa PARA EL ESTUDIO,
// que es un campo de la ficha.
export function HeaderCaso({ caso, etapa }: Props) {
  const [eliminarOpen, setEliminarOpen] = useState(false);
  const provisorio = sinCaratula(caso);

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
        {/* Las carátulas provisorias son largas (los primeros 60 chars del
            relato): a 30px fijos se comían 4-6 renglones de la pantalla antes
            de que apareciera cualquier otra cosa. */}
        <h1
          className={cn(
            "font-serif text-xl sm:text-2xl md:text-3xl leading-tight min-w-0 break-words",
            provisorio && "italic text-muted-foreground",
          )}
          title={provisorio ? "Sin carátula cargada" : undefined}
        >
          {nombreCaso(caso)}
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

      <div className="flex flex-wrap items-center gap-1.5">
        {etapa ? (
          <Badge
            className="bg-[rgba(139,92,246,0.22)] text-violet-800 dark:text-[#CDBEFF]"
            title={`Etapa según el mapa procesal: ${etapa.nodoTitulo}`}
          >
            {etapa.label}
          </Badge>
        ) : null}
        {/* "Activa" no se muestra: es el default de las 8 causas y un badge
            que llevan todas no distingue nada. Los otros dos sí. */}
        {caso.estado_seguimiento !== "activa" ? (
          <Badge className={ESTADO_SEGUIMIENTO_BADGE[caso.estado_seguimiento]}>
            {ESTADO_SEGUIMIENTO_LABEL[caso.estado_seguimiento]}
          </Badge>
        ) : null}
        <Badge className={rolBadge(caso.rol)}>{rolLabel(caso.rol)}</Badge>
        {caso.fuero ? (
          <Badge className="bg-[rgba(59,130,246,0.18)] text-blue-800 dark:text-[#A9CDFF]">
            {FUERO_LABEL[caso.fuero as Fuero]}
          </Badge>
        ) : null}
      </div>

      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <dt className="uppercase tracking-wider">Creado</dt>
          <dd>{fmtFecha(caso.creado_en)}</dd>
        </div>
        {caso.expediente_numero ? (
          <>
            <span aria-hidden="true">·</span>
            <div className="flex items-center gap-1.5 min-w-0">
              <dt className="uppercase tracking-wider">Expediente</dt>
              <dd className="tabular-nums break-all">
                {caso.expediente_numero}
              </dd>
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

function Badge({
  className,
  title,
  children,
}: {
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "rounded-full border border-transparent px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}
