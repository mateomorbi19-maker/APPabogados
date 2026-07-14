"use client";
// Botón de grabación de nota de voz para el chat. Flujo:
//
//   1. Click en el mic → getUserMedia + MediaRecorder (webm/opus; Safari
//      cae a audio/mp4).
//   2. Mientras graba: timer mm:ss + botón cancelar (descarta) + botón
//      frenar (entrega).
//   3. Al frenar → arma un File y se lo entrega al padre, que lo sube
//      por el MISMO flujo signed-URL de cualquier adjunto.
//
// El audio NO va nativo al modelo: el server lo transcribe con Whisper
// y el agente lee la transcripción (aclarado en la UI del input).

import { useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  disabled?: boolean;
  onAudioListo: (file: File) => void;
};

// Preferencia de formato: webm/opus (Chrome/Firefox/Edge) → mp4 (Safari).
const MIMES_GRABACION: { mime: string; ext: string }[] = [
  { mime: "audio/webm;codecs=opus", ext: "webm" },
  { mime: "audio/webm", ext: "webm" },
  { mime: "audio/mp4", ext: "m4a" },
];

function fmtSegundos(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function GrabadorAudio({ disabled = false, onAudioListo }: Props) {
  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // true = el stop en curso es una cancelación (descartar sin entregar).
  const canceladoRef = useRef(false);

  const limpiar = () => {
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
    setGrabando(false);
    setSegundos(0);
  };

  // Al desmontar (navegación, cambio de conversación) soltamos el mic.
  useEffect(() => {
    return () => {
      canceladoRef.current = true;
      recorderRef.current?.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const empezar = async () => {
    setError(null);
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("Este navegador no soporta grabación de audio.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(
        "No se pudo acceder al micrófono. Revisá el permiso del navegador.",
      );
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
      limpiar();
      if (cancelado || chunks.length === 0) return;
      const blob = new Blob(chunks, { type: mimeFinal });
      const id = crypto.randomUUID().slice(0, 8);
      const file = new File([blob], `nota-de-voz-${id}.${ext}`, {
        type: mimeFinal,
      });
      onAudioListo(file);
    };

    recorderRef.current = rec;
    rec.start();
    setGrabando(true);
    setSegundos(0);
    timerRef.current = setInterval(() => {
      setSegundos((s) => s + 1);
    }, 1000);
  };

  const frenar = () => {
    recorderRef.current?.stop();
  };

  const cancelar = () => {
    canceladoRef.current = true;
    recorderRef.current?.stop();
  };

  if (!grabando) {
    return (
      <div className="inline-flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void empezar()}
          disabled={disabled}
          title="Grabar nota de voz"
        >
          <Mic className="size-3.5" />
          Grabar audio
        </Button>
        {error ? (
          <span className="text-xs text-destructive">{error}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1"
      role="status"
      aria-live="polite"
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-destructive" />
      </span>
      <span className="text-xs tabular-nums font-medium">
        {fmtSegundos(segundos)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        onClick={frenar}
        title="Frenar y adjuntar"
      >
        <Square className="size-3.5" />
        Listo
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
        onClick={cancelar}
        aria-label="Cancelar grabación"
        title="Cancelar grabación"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
