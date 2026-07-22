"use client";
// Zona central del simulador: la ÚNICA que scrollea. Contenedor externo
// flex-1 min-h-0 overflow-y-auto (receta obligatoria para que el overflow
// enganche dentro de la columna acotada del shell); track interno centrado en
// max-w-4xl para legibilidad. Auto-scroll al final cuando entra un turno.
//
// Si la audiencia está finalizada, el informe se renderiza al pie del
// transcript: se lee como el cierre natural de la sesión.

import { useEffect, useRef } from "react";
import { Gavel } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtFecha } from "@/lib/format";
import { ROL_USUARIO_EN_SALA } from "@/lib/simulador/labels";
import { debriefingSchema } from "@/lib/simulador/schemas";
import type { SimulacionAudiencia, TurnoSimulacion } from "@/lib/types";
import { TurnoSala } from "./turno-sala";
import { DebriefingPanel } from "./debriefing-panel";

type Props = {
  simulacion: SimulacionAudiencia;
  turnos: TurnoSimulacion[];
  esperando: boolean;
  // Alternar escena/texto cambia el alto disponible del transcript: sin esto,
  // al prender la sala el último turno quedaba fuera de vista abajo.
  vistaSala?: boolean;
};

export function TranscriptAudiencia({
  simulacion,
  turnos,
  esperando,
  vistaSala = false,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turnos.length, esperando, simulacion.estado, vistaSala]);

  // El debriefing es jsonb sin validar al escribir: se valida al leer, igual
  // que el resto del repo hace con estrategia_snapshot.
  const debriefing = simulacion.debriefing
    ? debriefingSchema.safeParse(simulacion.debriefing)
    : null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-4 md:px-6 space-y-4">
        {turnos.map((t) =>
          t.emisor === "usuario" ? (
            <TurnoUsuario
              key={t.id}
              turno={t}
              rotulo={ROL_USUARIO_EN_SALA[simulacion.rol_usuario]}
            />
          ) : (
            <TurnoSala key={t.id} turno={t} />
          ),
        )}

        {esperando ? <SalaDeliberando /> : null}

        {simulacion.estado !== "en_curso" ? (
          debriefing?.success ? (
            <DebriefingPanel debriefing={debriefing.data} />
          ) : simulacion.debriefing ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-xs">
              <p className="text-destructive font-medium mb-1">
                El informe se guardó pero no se pudo interpretar
              </p>
              <p className="text-muted-foreground">
                Podés ver el JSON crudo en el panel admin.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
              Esta audiencia se cerró sin informe.
            </div>
          )
        ) : null}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function TurnoUsuario({
  turno,
  rotulo,
}: {
  turno: TurnoSimulacion;
  rotulo: string;
}) {
  // Alineado a la DERECHA con tinte violeta: convención del chat para los
  // mensajes propios del abogado.
  const optimista = turno.id.startsWith("temp-");
  return (
    <div className="flex justify-end">
      <article
        className={cn(
          "max-w-[92%] rounded-md border border-primary/30 bg-primary/10 px-3 py-2.5",
          optimista && "opacity-60",
        )}
      >
        <p className="text-[10px] uppercase tracking-wider text-primary font-medium mb-1">
          {rotulo}
        </p>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {turno.contenido}
        </p>
        {!optimista ? (
          <p className="text-[10px] text-muted-foreground mt-1.5">
            {fmtFecha(turno.creado_en)}
          </p>
        ) : null}
      </article>
    </div>
  );
}

function SalaDeliberando() {
  return (
    <div
      className="max-w-[92%] rounded-md border border-border bg-card/60 px-3 py-3"
      role="status"
      aria-live="polite"
      aria-label="La sala está respondiendo"
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Gavel className="size-3.5 text-primary animate-pulse" />
        <span>La sala responde</span>
        <span className="inline-flex items-end gap-0.5" aria-hidden="true">
          <span className="size-1 rounded-full bg-muted-foreground animate-bounce" />
          <span className="size-1 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
          <span className="size-1 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
        </span>
      </div>
    </div>
  );
}
