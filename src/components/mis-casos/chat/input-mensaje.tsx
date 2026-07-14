"use client";
// Input del chat: textarea + AdjuntosUploader + botón enviar. Maneja
// el flujo POST /mensajes con loading + recovery post-502 (polling al
// GET /mensajes filtrando por desde > inicio del POST).

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AdjuntosUploader, type AdjuntoUI } from "@/components/mis-casos/adjuntos-uploader";
import type { MensajeConversacion } from "@/lib/types";

type Props = {
  casoId: string;
  conversacionId: string;
  archivada: boolean;
  onMensajesNuevos: (nuevos: MensajeConversacion[]) => void;
};

const PREGUNTA_MIN = 1;
const PREGUNTA_MAX = 5000;
// Límite del server (crearMensajeInputSchema: adjuntos max 20). Validado
// también acá para que el usuario vea el motivo en vez de un 400 genérico.
const ADJUNTOS_MAX = 20;

const RECUPERAR_TIMEOUT_MS = 60_000;
const RECUPERAR_INTERVALO_MS = 5_000;
const RECUPERAR_DELAY_INICIAL_MS = 2_000;

type RespBody =
  | {
      ok: true;
      mensaje_usuario: MensajeConversacion;
      mensaje_agente: MensajeConversacion;
      respuesta: unknown;
    }
  | {
      ok: false;
      error: string;
      mensaje_usuario?: MensajeConversacion;
    };

async function intentarRecuperar(
  casoId: string,
  conversacionId: string,
  desdeIso: string,
  signal: AbortSignal,
): Promise<MensajeConversacion[] | null> {
  const inicio = Date.now();
  await new Promise((r) => setTimeout(r, RECUPERAR_DELAY_INICIAL_MS));
  if (signal.aborted) return null;

  while (Date.now() - inicio < RECUPERAR_TIMEOUT_MS) {
    if (signal.aborted) return null;
    try {
      const url = `/api/casos/${casoId}/conversaciones/${conversacionId}/mensajes?desde=${encodeURIComponent(desdeIso)}`;
      const res = await fetch(url, { signal });
      if (res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { mensajes?: MensajeConversacion[] }
          | null;
        const msgs = json?.mensajes ?? [];
        // Esperamos al menos un mensaje del agente (el server lo
        // crea último). Si solo está el del usuario, seguimos polling.
        const tieneAgente = msgs.some((m) => m.rol === "agente");
        if (tieneAgente) return msgs;
      }
    } catch {
      // sigue intentando.
    }
    if (signal.aborted) return null;
    await new Promise((r) => setTimeout(r, RECUPERAR_INTERVALO_MS));
  }
  return null;
}

export function InputMensaje({
  casoId,
  conversacionId,
  archivada,
  onMensajesNuevos,
}: Props) {
  const [contenido, setContenido] = useState("");
  const [adjuntos, setAdjuntos] = useState<AdjuntoUI[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const trim = contenido.trim();
  const ok =
    !archivada &&
    trim.length >= PREGUNTA_MIN &&
    trim.length <= PREGUNTA_MAX;
  const adjuntosListos = adjuntos.every((a) => a.status === "done");
  const demasiadosAdjuntos = adjuntos.length > ADJUNTOS_MAX;
  const hayAudio = adjuntos.some((a) => a.mime_type.startsWith("audio/"));
  const formOk = ok && adjuntosListos && !demasiadosAdjuntos;

  const enviar = async () => {
    if (loading || !formOk) return;
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const desdeIso = new Date(Date.now() - 5_000).toISOString();

    const adjuntosBody = adjuntos
      .filter((a) => a.status === "done")
      .map((a) => ({
        filename: a.filename,
        storage_path: a.storage_path,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        descripcion: a.descripcion,
      }));

    try {
      const res = await fetch(
        `/api/casos/${casoId}/conversaciones/${conversacionId}/mensajes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contenido: trim, adjuntos: adjuntosBody }),
          signal: controller.signal,
        },
      );
      const json = (await res.json().catch(() => null)) as RespBody | null;

      if (controller.signal.aborted) return;

      if (res.status === 502) {
        // Recovery: polling al GET de mensajes para ver si el server
        // alcanzó a crear el mensaje del agente.
        const recuperados = await intentarRecuperar(
          casoId,
          conversacionId,
          desdeIso,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (recuperados) {
          onMensajesNuevos(recuperados);
          setContenido("");
          setAdjuntos([]);
          setLoading(false);
          return;
        }
        const msg =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : "El análisis falló. Probá de nuevo en unos minutos.";
        // Si el server alcanzó a crear el mensaje del usuario, lo
        // mostramos igual para que quede en pantalla y el abogado vea
        // que su mensaje sí llegó (aunque la respuesta no).
        if (json && "mensaje_usuario" in json && json.mensaje_usuario) {
          onMensajesNuevos([json.mensaje_usuario]);
          setContenido("");
          setAdjuntos([]);
        }
        setError(msg);
        setLoading(false);
        return;
      }

      if (!res.ok || !json || ("ok" in json && json.ok === false)) {
        const msg =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : `Error enviando mensaje (HTTP ${res.status})`;
        if (json && "mensaje_usuario" in json && json.mensaje_usuario) {
          onMensajesNuevos([json.mensaje_usuario]);
          setContenido("");
          setAdjuntos([]);
        }
        setError(msg);
        setLoading(false);
        return;
      }

      if (!("mensaje_usuario" in json) || !("mensaje_agente" in json)) {
        setError("Respuesta inesperada del servidor");
        setLoading(false);
        return;
      }

      onMensajesNuevos([json.mensaje_usuario, json.mensaje_agente]);
      setContenido("");
      setAdjuntos([]);
      setLoading(false);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("Mensaje cancelado.");
        setLoading(false);
        return;
      }
      setError(e instanceof Error ? e.message : "Error de red");
      setLoading(false);
    } finally {
      abortRef.current = null;
    }
  };

  if (archivada) {
    return (
      <div className="rounded-md border border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground text-center">
        Esta conversación está archivada. Para seguir consultando al agente,
        empezá una conversación nueva desde el botón en el header.
      </div>
    );
  }

  return (
    // El chrome de barra inferior (border-t, bg, track centrado) lo pone
    // el ChatShell; acá solo va el contenido del input.
    <div className="space-y-2">
      <Textarea
        value={contenido}
        onChange={(e) => setContenido(e.target.value)}
        disabled={loading}
        rows={3}
        maxLength={PREGUNTA_MAX}
        placeholder="Escribí tu pregunta o lo que pasó. Adjuntá archivos si querés que el agente los analice."
      />
      <AdjuntosUploader
        casoId={casoId}
        value={adjuntos}
        onChange={setAdjuntos}
        disabled={loading}
        conAudio
      />

      {hayAudio ? (
        <p className="text-xs text-muted-foreground">
          Los audios se transcriben automáticamente: el agente lee la
          transcripción, no escucha el audio.
        </p>
      ) : null}

      {!adjuntosListos ? (
        <p className="text-xs text-amber-500">
          Esperá a que los archivos terminen de subir (o quitá los que fallaron) para enviar.
        </p>
      ) : null}

      {demasiadosAdjuntos ? (
        <p className="text-xs text-amber-500">
          Máximo {ADJUNTOS_MAX} adjuntos por mensaje. Quitá{" "}
          {adjuntos.length - ADJUNTOS_MAX} para poder enviar.
        </p>
      ) : null}

      {loading ? (
        <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-primary flex items-center gap-2">
          <Sparkles className="size-3.5 animate-pulse" />
          El agente está analizando tu mensaje. Esto puede tardar entre 30 y 90 segundos.
        </div>
      ) : null}

      {error ? (
        <div className="rounded border border-destructive bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button onClick={enviar} disabled={loading || !formOk}>
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          {loading ? "Enviando..." : "Enviar"}
        </Button>
      </div>
    </div>
  );
}
