"use client";
// Orquestador del Simulador de Audiencias. Vista inmersiva full-height
// (patrón Chat / Mapa Procesal): columna de 3 filas acotada al viewport —
//
//   1. SimuladorHeader   (shrink-0)
//   2. transcript        (flex-1 min-h-0, ÚNICA zona que scrollea)
//   3. barra de input    (shrink-0)
//
// Máquina de estados de la vista:
//   sin simulación         -> ConfigAudiencia (pantalla de arranque)
//   simulación en curso    -> transcript + input
//   finalizada/abandonada  -> transcript de solo lectura + informe

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SimulacionAudiencia, TurnoSimulacion } from "@/lib/types";
import { TIPO_AUDIENCIA_LABEL } from "@/lib/simulador/labels";
import { SimuladorHeader } from "./simulador-header";
import { ConfigAudiencia } from "./config-audiencia";
import { TranscriptAudiencia } from "./transcript-audiencia";
import { InputIntervencion } from "./input-intervencion";
import { FueroNoSoportado } from "./fuero-no-soportado";
import { EscenaSala } from "./sala/escena-sala";

type Props = {
  casoId: string;
  casoTitulo: string;
  fueroSoportado: boolean;
  fueroCaso: string | null;
  simulacionInicial: SimulacionAudiencia | null;
  turnosIniciales: TurnoSimulacion[];
  // Vista de sala (escena + barra de fases) en lugar del transcript pelado.
  // Llega del searchParam `?vista=sala`.
  vistaSala: boolean;
};

export function SimuladorShell({
  casoId,
  casoTitulo,
  fueroSoportado,
  fueroCaso,
  simulacionInicial,
  turnosIniciales,
  vistaSala,
}: Props) {
  const router = useRouter();
  const [simulacion, setSimulacion] = useState(simulacionInicial);
  const [turnos, setTurnos] = useState(turnosIniciales);
  // true mientras la sala genera su respuesta (o el informe final).
  const [esperando, setEsperando] = useState(false);
  // Fuerza la pantalla de configuración aunque exista una audiencia previa
  // finalizada ("Nueva audiencia").
  const [configurando, setConfigurando] = useState(false);

  if (!fueroSoportado) {
    return (
      <FueroNoSoportado
        casoId={casoId}
        casoTitulo={casoTitulo}
        fueroCaso={fueroCaso}
      />
    );
  }

  const enCurso = simulacion?.estado === "en_curso";
  const mostrarConfig = !simulacion || configurando;

  const onIniciada = (
    nueva: SimulacionAudiencia,
    turnosNuevos: TurnoSimulacion[],
  ) => {
    setSimulacion(nueva);
    setTurnos(turnosNuevos);
    setConfigurando(false);
    setEsperando(false);
    // El server component tiene que ver la audiencia nueva si se recarga.
    router.refresh();
  };

  // Protocolo optimista: la intervención del abogado aparece al instante con
  // un id temporal; cuando el server responde, se reemplaza por los turnos
  // reales (o se quita, si el envío falló antes de persistir).
  const onEnvioIniciado = (optimista: TurnoSimulacion) => {
    setTurnos((prev) => [...prev, optimista]);
    setEsperando(true);
  };

  const onEnvioTerminado = (tempId: string, nuevos: TurnoSimulacion[]) => {
    setTurnos((prev) => {
      const base = prev.filter((t) => t.id !== tempId);
      const ids = new Set(base.map((t) => t.id));
      return [...base, ...nuevos.filter((t) => !ids.has(t.id))];
    });
    setEsperando(false);
  };

  const onCerrada = (cerrada: SimulacionAudiencia) => {
    setSimulacion(cerrada);
    // Sale de la pantalla de configuración: sin esto, cerrar desde ahí
    // generaba el informe (y lo cobraba) para dejarte en la misma pantalla,
    // sin transcript ni informe a la vista.
    setConfigurando(false);
    setEsperando(false);
    router.refresh();
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <SimuladorHeader
        casoId={casoId}
        casoTitulo={casoTitulo}
        simulacion={simulacion}
        turnos={turnos}
        ocupado={esperando}
        onCerrada={onCerrada}
        onNuevaAudiencia={() => setConfigurando(true)}
        mostrandoConfig={mostrarConfig}
        vistaSala={vistaSala}
      />

      {mostrarConfig ? (
        <ConfigAudiencia
          casoId={casoId}
          hayAudienciaPrevia={Boolean(simulacion)}
          onIniciada={onIniciada}
          onCancelar={simulacion ? () => setConfigurando(false) : undefined}
        />
      ) : (
        <>
          {/* M1: la escena se monta pero todavía no lee los turnos — nadie se
              ilumina. El cableado de `activo` / `esTuTurno` es M2/M5. */}
          {vistaSala ? (
            <EscenaSala
              rolUsuario={simulacion!.rol_usuario}
              descripcion={TIPO_AUDIENCIA_LABEL[simulacion!.tipo_audiencia]}
            />
          ) : null}

          <TranscriptAudiencia
            simulacion={simulacion!}
            turnos={turnos}
            esperando={esperando}
            vistaSala={vistaSala}
          />

          {enCurso ? (
            <div className="shrink-0 border-t border-border bg-card/40">
              <div className="mx-auto w-full max-w-4xl px-4 py-3 md:px-6">
                <InputIntervencion
                  casoId={casoId}
                  simulacion={simulacion!}
                  deshabilitado={esperando}
                  onEnvioIniciado={onEnvioIniciado}
                  onEnvioTerminado={onEnvioTerminado}
                />
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
