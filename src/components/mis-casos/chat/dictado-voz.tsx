"use client";
// Dictado por voz del chat. Hablás y el texto aparece en el input.
//
//   1. Click en el mic → getUserMedia + MediaRecorder (webm/opus; Safari
//      cae a audio/mp4).
//   2. Mientras graba: timer mm:ss + cancelar (descarta) + listo (transcribe).
//   3. Al frenar → POST a /api/transcribir → el texto vuelve y se lo entrega
//      al padre, que lo mete en el textarea.
//
// El audio NO se guarda en ningún lado: se transcribe en memoria y se
// descarta. Lo que queda en la conversación es el texto que el abogado
// revisó y mandó.
//
// Por qué el texto va al input y no se envía solo: Whisper se equivoca con
// nombres propios, carátulas y números de artículo — justo lo que más importa
// en un mensaje sobre un expediente. Que el abogado lea y corrija antes de
// mandar es parte del diseño, no un paso de más.
//
// Guards de carrera (heredados del grabador que este componente reemplaza):
// empezar() es async — sin protección, un doble click o un unmount durante el
// await de getUserMedia dejaba un MediaStream huérfano con el micrófono abierto
// para siempre. `iniciandoRef` bloquea la reentrada síncrona y `montadoRef`
// corta la continuación post-await si el componente ya se desmontó.

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Mic, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  disabled?: boolean;
  /** Texto transcripto, listo para insertar en el input. Nunca vacío. */
  onTexto: (texto: string) => void;
  /** true mientras se graba o se transcribe: el padre bloquea el envío. */
  onOcupadoChange?: (ocupado: boolean) => void;
};

// Preferencia de formato: webm/opus (Chrome/Firefox/Edge) → mp4 (Safari).
const MIMES_GRABACION: { mime: string; ext: string }[] = [
  { mime: "audio/webm;codecs=opus", ext: "webm" },
  { mime: "audio/webm", ext: "webm" },
  { mime: "audio/mp4", ext: "m4a" },
];

// Corte duro de la grabación. 10 minutos de opus son ~5 MB, la mitad del tope
// del endpoint; el objetivo real es que un mic que quedó abierto por accidente
// no termine mandando una hora de ruido de oficina a transcribir.
const MAX_SEGUNDOS = 10 * 60;

function fmtSegundos(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Estado = "libre" | "iniciando" | "grabando" | "transcribiendo";

export function DictadoVoz({
  disabled = false,
  onTexto,
  onOcupadoChange,
}: Props) {
  const [estado, setEstado] = useState<Estado>("libre");
  const [segundos, setSegundos] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // true = el stop en curso es una cancelación (descartar sin transcribir).
  const canceladoRef = useRef(false);
  const iniciandoRef = useRef(false);
  const montadoRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  // Callbacks en ref: `onTexto` y `onOcupadoChange` se llaman desde el handler
  // `onstop` del MediaRecorder, que se registra una sola vez por grabación. Sin
  // la ref, ese handler se queda con la versión de la primera render.
  const onTextoRef = useRef(onTexto);
  const onOcupadoRef = useRef(onOcupadoChange);
  useEffect(() => {
    onTextoRef.current = onTexto;
    onOcupadoRef.current = onOcupadoChange;
  });

  const soltarMicrofono = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const rec = recorderRef.current;
    if (rec) {
      rec.stream.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
    }
    chunksRef.current = [];
    setSegundos(0);
  };

  // Al desmontar (navegación, cambio de conversación) soltamos el mic y
  // abortamos la transcripción en vuelo.
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      canceladoRef.current = true;
      abortRef.current?.abort();
      recorderRef.current?.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const transcribir = async (blob: Blob, ext: string) => {
    setEstado("transcribiendo");
    onOcupadoRef.current?.(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const form = new FormData();
      form.append("audio", new File([blob], `dictado.${ext}`, { type: blob.type }));
      const res = await fetch("/api/transcribir", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; texto: string }
        | { ok: false; error: string }
        | null;

      if (!montadoRef.current) return;

      if (!res.ok || !json || json.ok === false) {
        setError(
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : `No se pudo transcribir (HTTP ${res.status})`,
        );
        return;
      }
      const texto = json.texto.trim();
      if (texto.length === 0) {
        setError("No se escuchó nada. Revisá el micrófono y probá de nuevo.");
        return;
      }
      onTextoRef.current(texto);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (!montadoRef.current) return;
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      abortRef.current = null;
      if (montadoRef.current) {
        setEstado("libre");
        onOcupadoRef.current?.(false);
      }
    }
  };

  const empezar = async () => {
    if (iniciandoRef.current || recorderRef.current || estado !== "libre") return;
    iniciandoRef.current = true;
    setEstado("iniciando");
    setError(null);
    try {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      ) {
        setError("Este navegador no soporta grabación de audio.");
        setEstado("libre");
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setError(
          "No se pudo acceder al micrófono. Revisá el permiso del navegador.",
        );
        setEstado("libre");
        return;
      }

      // Post-await: si el componente se desmontó mientras el usuario decidía el
      // permiso (o apareció otra grabación), soltamos los tracks recién
      // adquiridos y NO arrancamos nada.
      if (!montadoRef.current || recorderRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const formato =
        MIMES_GRABACION.find((f) => MediaRecorder.isTypeSupported(f.mime)) ??
        null;
      const rec = formato
        ? new MediaRecorder(stream, { mimeType: formato.mime })
        : new MediaRecorder(stream);
      // Mime real con el que terminó grabando (sin el sufijo ;codecs=…).
      const mimeFinal = (formato?.mime ?? rec.mimeType).split(";")[0];
      const ext = formato?.ext ?? "webm";

      canceladoRef.current = false;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const cancelado = canceladoRef.current;
        const chunks = chunksRef.current;
        soltarMicrofono();
        if (cancelado || chunks.length === 0) {
          if (montadoRef.current) {
            setEstado("libre");
            onOcupadoRef.current?.(false);
          }
          return;
        }
        void transcribir(new Blob(chunks, { type: mimeFinal }), ext);
      };

      recorderRef.current = rec;
      rec.start();
      setEstado("grabando");
      setSegundos(0);
      onOcupadoRef.current?.(true);
      timerRef.current = setInterval(() => {
        setSegundos((s) => {
          // Corte automático: se frena solo al llegar al tope. El stop dispara
          // onstop, que transcribe lo grabado hasta acá (no se pierde nada).
          if (s + 1 >= MAX_SEGUNDOS) recorderRef.current?.stop();
          return s + 1;
        });
      }, 1000);
    } finally {
      iniciandoRef.current = false;
    }
  };

  const frenar = () => {
    recorderRef.current?.stop();
  };

  const cancelar = () => {
    canceladoRef.current = true;
    recorderRef.current?.stop();
  };

  // --- grabando: pastilla con timer + listo + cancelar ---
  if (estado === "grabando") {
    return (
      <div
        className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1"
        role="status"
        aria-live="polite"
      >
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-destructive" />
        </span>
        <span className="text-xs font-medium tabular-nums">
          {fmtSegundos(segundos)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // El h-7 fijo anulaba el piso táctil del primitivo: "Listo" es el
          // botón que cierra el dictado y con 28px se falla con el dedo.
          // Abajo de 768px queda en los 36px de la variante sm.
          className="md:h-7 md:px-2"
          onClick={frenar}
          title="Terminar y pasar a texto"
        >
          <Check className="size-3.5" />
          Listo
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={cancelar}
          aria-label="Descartar dictado"
          title="Descartar"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  // --- libre / iniciando / transcribiendo ---
  const ocupado = estado === "iniciando" || estado === "transcribiendo";
  return (
    <div className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void empezar()}
        disabled={disabled || ocupado}
        aria-label="Dictar por voz"
        title="Dictar por voz"
        className={cn(estado === "transcribiendo" && "text-muted-foreground")}
      >
        {ocupado ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Mic className="size-3.5" />
        )}
        {estado === "transcribiendo" ? "Transcribiendo…" : "Dictar"}
      </Button>
      {error ? (
        <span className="text-xs text-destructive">{error}</span>
      ) : null}
    </div>
  );
}
