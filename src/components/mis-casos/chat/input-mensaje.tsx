"use client";
// Input del chat: textarea + AdjuntosUploader + botón enviar. Maneja
// el flujo POST /mensajes con loading + recovery post-502 (polling al
// GET /mensajes filtrando por desde > inicio del POST).

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdjuntosUploader, type AdjuntoUI } from "@/components/mis-casos/adjuntos-uploader";
import { DictadoVoz } from "./dictado-voz";
import {
  NIVELES_MODELO,
  NIVEL_DEFAULT,
  NIVEL_DESCRIPCION,
  NIVEL_LABEL,
  type NivelModelo,
} from "@/lib/agent/modelos";
import type { MensajeConversacion } from "@/lib/types";

// La última elección de nivel se recuerda por browser (conveniencia de
// UX). La elección AUTORITATIVA es per-mensaje: viaja en el body y el
// server resuelve el modelo — localStorage es solo el default visual.
const NIVEL_STORAGE_KEY = "chat_nivel_modelo";

function esNivel(v: string | null): v is NivelModelo {
  return v !== null && (NIVELES_MODELO as readonly string[]).includes(v);
}

// Lectura hydration-safe de localStorage sin setState-en-efecto:
// useSyncExternalStore renderiza el default en SSR (getServerSnapshot)
// y el valor guardado en el cliente. subscribe es no-op: acá nadie más
// escribe la key mientras el componente está montado (la escribe el
// propio selector, que además setea su state local).
const noopSubscribe = () => () => {};

function useNivelGuardado(): NivelModelo {
  const crudo = useSyncExternalStore(
    noopSubscribe,
    () => localStorage.getItem(NIVEL_STORAGE_KEY),
    () => null,
  );
  return esNivel(crudo) ? crudo : NIVEL_DEFAULT;
}

type Props = {
  casoId: string;
  conversacionId: string;
  archivada: boolean;
  // Protocolo optimista (UX de chat estándar): al enviar, el mensaje del
  // abogado se agrega YA a la lista con un id temporal y aparece la
  // burbuja "Pensando…"; al terminar, el temporal se reemplaza por los
  // mensajes reales (o se quita si el envío falló sin persistir).
  onEnvioIniciado: (optimista: MensajeConversacion) => void;
  onEnvioTerminado: (tempId: string, nuevos: MensajeConversacion[]) => void;
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
  onEnvioIniciado,
  onEnvioTerminado,
}: Props) {
  const [contenido, setContenido] = useState("");
  const [adjuntos, setAdjuntos] = useState<AdjuntoUI[]>([]);
  // true mientras se está dictando o transcribiendo: bloquea el envío para
  // que el texto que está por llegar no se pierda al vaciarse el input.
  const [dictando, setDictando] = useState(false);
  // Referencia al textarea, para devolverle el foco y dejar el cursor al final
  // después de insertar lo dictado.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // null = el usuario todavía no eligió en esta sesión → usar el
  // guardado (o el default). La elección autoritativa viaja per-mensaje.
  const [nivelElegido, setNivelElegido] = useState<NivelModelo | null>(null);
  const nivelGuardado = useNivelGuardado();
  const nivel = nivelElegido ?? nivelGuardado;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const onNivelChange = (v: unknown) => {
    if (typeof v === "string" && esNivel(v)) {
      setNivelElegido(v);
      localStorage.setItem(NIVEL_STORAGE_KEY, v);
    }
  };

  const trim = contenido.trim();
  const ok =
    !archivada &&
    trim.length >= PREGUNTA_MIN &&
    trim.length <= PREGUNTA_MAX;
  const adjuntosListos = adjuntos.every((a) => a.status === "done");
  const demasiadosAdjuntos = adjuntos.length > ADJUNTOS_MAX;
  const hayAudio = adjuntos.some((a) => a.mime_type.startsWith("audio/"));
  const formOk = ok && adjuntosListos && !demasiadosAdjuntos && !dictando;

  // Lo dictado se AGREGA a lo que ya había escrito, no lo pisa: es normal
  // escribir media idea, dictar el resto, y seguir editando. Se separa con un
  // espacio salvo que el texto previo termine en salto de línea.
  const insertarDictado = (texto: string) => {
    setContenido((prev) => {
      const base = prev.trimEnd();
      if (base.length === 0) return texto;
      const separador = prev.endsWith("\n") ? "\n" : " ";
      return `${base}${separador}${texto}`.slice(0, PREGUNTA_MAX);
    });
    // El foco vuelve al textarea con el cursor al final para poder corregir de
    // una — Whisper se equivoca con apellidos y números de artículo.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const enviar = async () => {
    if (loading || !formOk) return;
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const desdeIso = new Date(Date.now() - 5_000).toISOString();

    const enviados = adjuntos.filter(
      (a): a is Extract<AdjuntoUI, { status: "done" }> =>
        a.status === "done",
    );
    const adjuntosBody = enviados.map((a) => ({
      filename: a.filename,
      storage_path: a.storage_path,
      mime_type: a.mime_type,
      size_bytes: a.size_bytes,
      descripcion: a.descripcion,
    }));
    // Limpieza QUIRÚRGICA post-envío: solo se sacan los adjuntos que
    // efectivamente viajaron en este mensaje. Un audio/archivo agregado
    // mientras el POST estaba en vuelo sobrevive para el próximo mensaje
    // (antes setAdjuntos([]) lo descartaba en silencio y quedaba
    // huérfano en storage — hallazgo del review adversarial).
    const enviadosIds = new Set(enviados.map((a) => a.tempId));
    const limpiarEnviados = () =>
      setAdjuntos((prev) => prev.filter((a) => !enviadosIds.has(a.tempId)));

    // Envío optimista (UX de chat estándar): el mensaje aparece YA en la
    // lista y el input se limpia de inmediato. Si el envío falla sin que
    // el server lo haya persistido, se restaura texto y adjuntos para no
    // perder nada.
    const tempId = `optimista-${crypto.randomUUID()}`;
    const optimista: MensajeConversacion = {
      id: tempId,
      conversacion_id: conversacionId,
      rol: "usuario",
      contenido: trim,
      adjuntos: adjuntosBody,
      respuesta_estructurada: null,
      ejecucion_id: null,
      creado_en: new Date().toISOString(),
    };
    onEnvioIniciado(optimista);
    setContenido("");
    limpiarEnviados();

    const restaurar = () => {
      setContenido(trim);
      setAdjuntos((prev) => [...enviados, ...prev]);
    };

    try {
      const res = await fetch(
        `/api/casos/${casoId}/conversaciones/${conversacionId}/mensajes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contenido: trim,
            adjuntos: adjuntosBody,
            nivel,
          }),
          signal: controller.signal,
        },
      );
      const json = (await res.json().catch(() => null)) as RespBody | null;

      if (controller.signal.aborted) return;

      // Recovery-polling SOLO para el 502 de proxy (body no-JSON): es el
      // único caso en que el server pudo haber terminado OK después del
      // corte. Un 502 GENUINO del server trae JSON con ok:false — ahí el
      // mensaje del agente no va a aparecer jamás: pollear 60s era espera
      // fútil y, peor, la ventana desde-5s podía capturar la respuesta
      // del turno ANTERIOR y presentarla como si el envío hubiera salido
      // bien, silenciando el error (hallazgo del review adversarial).
      if (res.status === 502 && json === null) {
        const recuperados = await intentarRecuperar(
          casoId,
          conversacionId,
          desdeIso,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (recuperados) {
          onEnvioTerminado(tempId, recuperados);
          setLoading(false);
          return;
        }
        // No se pudo confirmar nada: quitamos el optimista y devolvemos
        // el texto al input para que el abogado reintente.
        onEnvioTerminado(tempId, []);
        restaurar();
        setError("El análisis falló. Probá de nuevo en unos minutos.");
        setLoading(false);
        return;
      }

      if (!res.ok || !json || ("ok" in json && json.ok === false)) {
        const msg =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : `Error enviando mensaje (HTTP ${res.status})`;
        if (json && "mensaje_usuario" in json && json.mensaje_usuario) {
          // El mensaje SÍ llegó al server (falló la respuesta del
          // agente): el optimista se reemplaza por el real y el input
          // queda limpio.
          onEnvioTerminado(tempId, [json.mensaje_usuario]);
        } else {
          // No se persistió nada: quitar el optimista y restaurar.
          onEnvioTerminado(tempId, []);
          restaurar();
        }
        setError(msg);
        setLoading(false);
        return;
      }

      if (!("mensaje_usuario" in json) || !("mensaje_agente" in json)) {
        onEnvioTerminado(tempId, []);
        restaurar();
        setError("Respuesta inesperada del servidor");
        setLoading(false);
        return;
      }

      onEnvioTerminado(tempId, [json.mensaje_usuario, json.mensaje_agente]);
      setLoading(false);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        onEnvioTerminado(tempId, []);
        setError("Mensaje cancelado.");
        setLoading(false);
        return;
      }
      onEnvioTerminado(tempId, []);
      restaurar();
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
        ref={textareaRef}
        value={contenido}
        onChange={(e) => setContenido(e.target.value)}
        disabled={loading}
        rows={3}
        maxLength={PREGUNTA_MAX}
        placeholder="Escribí o dictá tu pregunta. Adjuntá archivos si querés que el agente los analice."
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
          Los audios adjuntos se transcriben automáticamente: el agente lee la
          transcripción, no escucha el audio.
        </p>
      ) : null}

      {!adjuntosListos ? (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          Esperá a que los archivos terminen de subir (o quitá los que fallaron) para enviar.
        </p>
      ) : null}

      {demasiadosAdjuntos ? (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          Máximo {ADJUNTOS_MAX} adjuntos por mensaje. Quitá{" "}
          {adjuntos.length - ADJUNTOS_MAX} para poder enviar.
        </p>
      ) : null}

      {error ? (
        <div className="rounded border border-destructive bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        {/* Selector de nivel de modelo. Labels Bajo/Medio/Alto — la UI
            nunca muestra los nombres oficiales de los modelos. */}
        <div className="flex items-center gap-2">
          <DictadoVoz
            disabled={loading}
            onTexto={insertarDictado}
            onOcupadoChange={setDictando}
          />
          <span className="text-xs text-muted-foreground">Nivel:</span>
          {/* items={NIVEL_LABEL}: sin este mapa, el SelectValue de
              base-ui renderiza el value crudo del enum ("medio") en el
              trigger en vez del label de producto ("Medio"). */}
          <Select value={nivel} onValueChange={onNivelChange} items={NIVEL_LABEL}>
            <SelectTrigger
              size="sm"
              disabled={loading}
              title={NIVEL_DESCRIPCION[nivel]}
              aria-label="Nivel de modelo"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="min-w-(--anchor-width) w-fit">
              {NIVELES_MODELO.map((n) => (
                <SelectItem key={n} value={n} title={NIVEL_DESCRIPCION[n]}>
                  {NIVEL_LABEL[n]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
