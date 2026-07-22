"use client";
// Barra superior fija del simulador inmersivo: volver al caso + título +
// configuración de la sesión + estado + acciones (cerrar / nueva audiencia).

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Gavel, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DIFICULTADES,
  ESTADO_SIMULACION_LABEL,
  MAGISTRADOS,
  ROLES_USUARIO,
  labelDe,
} from "@/lib/simulador/labels";
import type { SimulacionAudiencia, TurnoSimulacion } from "@/lib/types";
import { CerrarAudienciaModal } from "./cerrar-audiencia-modal";

type Props = {
  casoId: string;
  casoTitulo: string;
  simulacion: SimulacionAudiencia | null;
  turnos: TurnoSimulacion[];
  ocupado: boolean;
  onCerrada: (sim: SimulacionAudiencia) => void;
  onNuevaAudiencia: () => void;
  mostrandoConfig: boolean;
};

const ESTADO_CLASES: Record<string, string> = {
  en_curso: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400",
  finalizada: "border-violet-500/30 bg-violet-500/15 text-violet-300",
  abandonada: "border-amber-500/30 bg-amber-500/15 text-amber-400",
};

export function SimuladorHeader({
  casoId,
  casoTitulo,
  simulacion,
  turnos,
  ocupado,
  onCerrada,
  onNuevaAudiencia,
  mostrandoConfig,
}: Props) {
  const [cerrarOpen, setCerrarOpen] = useState(false);

  const enCurso = simulacion?.estado === "en_curso";
  // Sin intervenciones propias no hay nada que evaluar: el backend rechaza el
  // cierre de una audiencia vacía, así que tampoco lo ofrecemos.
  const puedeCerrar =
    enCurso && !ocupado && turnos.some((t) => t.emisor === "usuario");

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
        <Gavel className="size-4 text-primary shrink-0" />
        <span
          className="text-sm font-medium truncate max-w-[160px] md:max-w-[260px]"
          title={casoTitulo}
        >
          {casoTitulo}
        </span>

        {simulacion && !mostrandoConfig ? (
          <>
            <span className="text-muted-foreground/50 shrink-0">/</span>
            <span className="text-xs text-muted-foreground truncate">
              {labelDe(ROLES_USUARIO, simulacion.rol_usuario)} ·{" "}
              {labelDe(DIFICULTADES, simulacion.dificultad)} · Juez{" "}
              {labelDe(MAGISTRADOS, simulacion.magistrado_perfil).toLowerCase()}
            </span>
            <span
              className={cn(
                "text-[10px] uppercase tracking-wider rounded-md border px-1.5 py-0.5 shrink-0",
                ESTADO_CLASES[simulacion.estado] ?? "border-border",
              )}
            >
              {ESTADO_SIMULACION_LABEL[simulacion.estado]}
            </span>
          </>
        ) : null}

        <div className="flex-1" />

        {puedeCerrar ? (
          <Button variant="outline" size="sm" onClick={() => setCerrarOpen(true)}>
            Cerrar y ver informe
          </Button>
        ) : null}

        {/* Disponible también con una audiencia EN CURSO: si no, quien abre
            la sala y no llega a intervenir queda sin salida — no puede cerrar
            (no hay nada que evaluar) ni empezar de nuevo. El backend abandona
            la anterior al crear la nueva. */}
        {simulacion && !mostrandoConfig ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onNuevaAudiencia}
            disabled={ocupado}
          >
            <Plus className="size-3.5" />
            <span className="hidden sm:inline">Nueva audiencia</span>
            <span className="sm:hidden">Nueva</span>
          </Button>
        ) : null}
      </div>

      {simulacion ? (
        <CerrarAudienciaModal
          open={cerrarOpen}
          casoId={casoId}
          simulacionId={simulacion.id}
          onClose={() => setCerrarOpen(false)}
          onCerrada={(sim) => {
            setCerrarOpen(false);
            onCerrada(sim);
          }}
        />
      ) : null}
    </header>
  );
}
