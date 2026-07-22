"use client";
// Barra de intervención del abogado. Versión acotada del input del chat: sin
// adjuntos, sin audio y sin selector de modelo — en una audiencia hablás, no
// subís archivos, y el nivel del modelo es fijo (ver run-simulacion.ts).
//
// Protocolo optimista igual que el chat: la intervención aparece al instante
// con id temporal y el shell la reemplaza cuando el server responde. Si el
// server devuelve `turno_usuario` en un error, quiere decir que la
// intervención SÍ se persistió y solo falló la respuesta de la sala: se
// conserva en la lista y no se restaura el texto en el input.

import { useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { SimulacionAudiencia, TurnoSimulacion } from "@/lib/types";

// Igual que el max del schema Zod del borde (crearTurnoInputSchema).
const MAX_CHARS = 5000;

type Props = {
  casoId: string;
  simulacion: SimulacionAudiencia;
  deshabilitado: boolean;
  onEnvioIniciado: (optimista: TurnoSimulacion) => void;
  onEnvioTerminado: (tempId: string, nuevos: TurnoSimulacion[]) => void;
};

export function InputIntervencion({
  casoId,
  simulacion,
  deshabilitado,
  onEnvioIniciado,
  onEnvioTerminado,
}: Props) {
  const [contenido, setContenido] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contadorRef = useRef(0);

  const enviar = async () => {
    const texto = contenido.trim();
    if (!texto || loading || deshabilitado) return;

    setError(null);
    setLoading(true);
    const tempId = `temp-${++contadorRef.current}`;
    const optimista: TurnoSimulacion = {
      id: tempId,
      simulacion_id: simulacion.id,
      emisor: "usuario",
      emisor_nombre: null,
      contenido: texto,
      metadata: {},
      ejecucion_id: null,
      creado_en: new Date().toISOString(),
    };
    onEnvioIniciado(optimista);
    setContenido("");

    try {
      const res = await fetch(
        `/api/casos/${casoId}/simulacion/${simulacion.id}/turno`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contenido: texto }),
        },
      );
      const json = (await res.json().catch(() => null)) as
        | { ok: true; turnos: TurnoSimulacion[] }
        | { ok: false; error: string; turno_usuario?: TurnoSimulacion }
        | null;

      if (!res.ok || !json || json.ok === false) {
        const msg =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : `Error enviando la intervención (HTTP ${res.status})`;
        if (json && "turno_usuario" in json && json.turno_usuario) {
          // La intervención quedó guardada; falló la respuesta de la sala.
          onEnvioTerminado(tempId, [json.turno_usuario]);
        } else {
          // No se persistió nada: sacamos el optimista y devolvemos el texto.
          onEnvioTerminado(tempId, []);
          setContenido(texto);
        }
        setError(msg);
        setLoading(false);
        return;
      }

      onEnvioTerminado(tempId, json.turnos);
      setLoading(false);
    } catch (e) {
      onEnvioTerminado(tempId, []);
      setContenido(texto);
      setError(e instanceof Error ? e.message : "Error de red");
      setLoading(false);
    }
  };

  const bloqueado = loading || deshabilitado;

  return (
    <div className="space-y-2">
      <Textarea
        value={contenido}
        onChange={(e) => setContenido(e.target.value)}
        onKeyDown={(e) => {
          // Enter envía; Shift+Enter hace salto de línea.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void enviar();
          }
        }}
        disabled={bloqueado}
        rows={3}
        maxLength={MAX_CHARS}
        placeholder="Tu intervención en la audiencia. Hablá como lo harías en la sala."
      />

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          Enter envía · Shift+Enter salto de línea
        </p>
        <Button onClick={enviar} disabled={bloqueado || !contenido.trim()}>
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          {loading ? "Enviando…" : "Intervenir"}
        </Button>
      </div>
    </div>
  );
}
