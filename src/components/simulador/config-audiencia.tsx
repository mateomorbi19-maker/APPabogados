"use client";
// Pantalla de arranque: el abogado elige rol, dificultad y perfil del
// magistrado, y recién ahí se abre la audiencia. NO hay lazy-init como en el
// chat, porque abrir la sala gasta tokens.
//
// Los tres selectores son botones segmentados en vez de <select>: son 3
// opciones cada uno, con una descripción que conviene tener a la vista para
// decidir.

import { useState } from "react";
import { Gavel, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DIFICULTADES,
  MAGISTRADOS,
  ROLES_USUARIO,
  type OpcionConfig,
} from "@/lib/simulador/labels";
import type {
  DificultadSimulacion,
  MagistradoPerfil,
  RolUsuarioSimulacion,
  SimulacionAudiencia,
  TurnoSimulacion,
} from "@/lib/types";

type Props = {
  casoId: string;
  hayAudienciaPrevia: boolean;
  onIniciada: (sim: SimulacionAudiencia, turnos: TurnoSimulacion[]) => void;
  // Solo si hay una audiencia previa que mirar: permite volver sin iniciar.
  onCancelar?: () => void;
};

export function ConfigAudiencia({
  casoId,
  hayAudienciaPrevia,
  onIniciada,
  onCancelar,
}: Props) {
  const [rol, setRol] = useState<RolUsuarioSimulacion>("defensa");
  const [dificultad, setDificultad] =
    useState<DificultadSimulacion>("b_estandar");
  const [magistrado, setMagistrado] = useState<MagistradoPerfil>("neutro");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const iniciar = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/casos/${casoId}/simulacion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rol_usuario: rol,
          dificultad,
          magistrado_perfil: magistrado,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; simulacion: SimulacionAudiencia; turnos: TurnoSimulacion[] }
        | { ok: false; error: string }
        | null;

      if (!res.ok || !json || json.ok === false) {
        setError(
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : `No se pudo abrir la audiencia (HTTP ${res.status})`,
        );
        setLoading(false);
        return;
      }
      onIniciada(json.simulacion, json.turnos);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 md:px-6 space-y-6">
        <div className="flex items-start gap-3">
          <Gavel className="size-5 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="text-base font-medium">
              Audiencia de prisión preventiva
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Se corre sobre los hechos, la prueba y la estrategia de este caso.
              La sala reacciona a cómo litigues: el resultado no está escrito.
            </p>
          </div>
        </div>

        <Selector
          titulo="Tu rol en la audiencia"
          opciones={ROLES_USUARIO}
          value={rol}
          onChange={setRol}
          disabled={loading}
        />
        <Selector
          titulo="Dificultad"
          opciones={DIFICULTADES}
          value={dificultad}
          onChange={setDificultad}
          disabled={loading}
        />
        <Selector
          titulo="Perfil del magistrado"
          opciones={MAGISTRADOS}
          value={magistrado}
          onChange={setMagistrado}
          disabled={loading}
        />

        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 flex items-start gap-2">
          <AlertTriangle className="size-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-200/90">
            El guion de esta audiencia es un{" "}
            <span className="font-medium">borrador pendiente de validación</span>{" "}
            legal. Sirve para practicar, no para preparar una presentación real.
          </p>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button onClick={iniciar} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {loading ? "Abriendo la sala…" : "Iniciar audiencia"}
          </Button>
          {onCancelar ? (
            <Button variant="ghost" onClick={onCancelar} disabled={loading}>
              Cancelar
            </Button>
          ) : null}
        </div>

        {hayAudienciaPrevia ? (
          <p className="text-xs text-muted-foreground">
            Si tenés una audiencia en curso, iniciar una nueva la da por
            abandonada.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Selector<T extends string>({
  titulo,
  opciones,
  value,
  onChange,
  disabled,
}: {
  titulo: string;
  opciones: ReadonlyArray<OpcionConfig<T>>;
  value: T;
  onChange: (v: T) => void;
  disabled: boolean;
}) {
  const elegida = opciones.find((o) => o.value === value);
  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {titulo}
      </p>
      <div
        className="grid grid-cols-3 gap-1.5"
        role="radiogroup"
        aria-label={titulo}
      >
        {opciones.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md border px-3 py-2 text-sm transition-colors disabled:opacity-50",
              o.value === value
                ? "border-primary/50 bg-primary/15 text-foreground font-medium"
                : "border-border bg-card hover:bg-muted/50 text-muted-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {elegida ? (
        <p className="text-xs text-muted-foreground">{elegida.descripcion}</p>
      ) : null}
    </div>
  );
}
