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
  // El envío quedó en estado indeterminado (corte de proxy / red): NO sabemos
  // si el server persistió. Bloquea el input para que un reintento a ciegas no
  // duplique el turno y no cobre otra llamada al modelo.
  const [sinConfirmar, setSinConfirmar] = useState(false);
  const contadorRef = useRef(0);

  // Conserva la burbuja optimista (el shell la re-agrega porque su id ya no
  // está en la lista base), no devuelve el texto al input y bloquea el envío.
  const indeterminado = (tempId: string, optimista: TurnoSimulacion) => {
    onEnvioTerminado(tempId, [optimista]);
    setSinConfirmar(true);
    setError(
      "No pudimos confirmar si tu intervención llegó. Recargá la página para ver el estado real de la audiencia antes de seguir.",
    );
    setLoading(false);
  };

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

      // Body ilegible (típico: el proxy cortó y devolvió HTML). El server
      // persiste el turno del usuario ANTES de llamar al modelo, así que en
      // este caso lo más probable es que SÍ haya quedado guardado — junto con
      // la respuesta de la sala. Borrar el optimista y devolver el texto haría
      // que el abogado reenvíe y duplique intervención y cobro.
      if (!json) {
        indeterminado(tempId, optimista);
        return;
      }

      if (!res.ok || json.ok === false) {
        // 409 = la audiencia ya no está en curso (se cerró desde otra pestaña
        // o se inició otra). La vista local quedó vieja y no hay GET para
        // resincronizar: recargar es la única forma de ver la verdad.
        if (res.status === 409) {
          window.location.reload();
          return;
        }
        const msg =
          "error" in json && typeof json.error === "string"
            ? json.error
            : `Error enviando la intervención (HTTP ${res.status})`;
        if ("turno_usuario" in json && json.turno_usuario) {
          // La intervención quedó guardada; falló la respuesta de la sala.
          onEnvioTerminado(tempId, [json.turno_usuario]);
        } else {
          // Error con body JSON: el server garantiza que no persistió nada.
          onEnvioTerminado(tempId, []);
          setContenido(texto);
        }
        setError(msg);
        setLoading(false);
        return;
      }

      onEnvioTerminado(tempId, json.turnos);
      setLoading(false);
    } catch {
      // Error de red: mismo razonamiento que el body ilegible. El request pudo
      // haber llegado y completado del lado del server.
      indeterminado(tempId, optimista);
    }
  };

  const bloqueado = loading || deshabilitado || sinConfirmar;

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
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-destructive">{error}</p>
          {sinConfirmar ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
            >
              Recargar
            </Button>
          ) : null}
        </div>
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
