import "server-only";
import { toFile } from "openai";
import { getOpenAI } from "@/lib/openai";

// Transcripción de audios adjuntos del chat con Whisper (OpenAI).
//
// La Messages API de Anthropic NO acepta audio como content block: el
// modelo no puede "escuchar". Por eso el audio se transcribe acá y al
// modelo le llega la TRANSCRIPCIÓN como texto etiquetado (esto está
// explicitado en la UI para no generar la expectativa contraria).
//
// Modelo: whisper-1 — barato (~USD 0.006/min) y suficiente para notas
// de voz. Se factura aparte en OpenAI (no cuenta tokens de Anthropic);
// la duración/costo no se trackea en `ejecuciones` por ahora.
//
// Límite de Whisper: 25 MB por archivo. Nuestro bucket capea a 10 MB,
// así que nunca lo alcanzamos.

export const TRANSCRIPCION_MODEL = "whisper-1" as const;

// Whisper valida el formato por la EXTENSIÓN del filename del multipart
// (no por el contenido): un .opus de WhatsApp (contenedor Ogg válido)
// se rechaza con "Invalid file format" aunque el mismo contenido con
// filename .ogg se transcribe perfecto (hallazgo del review adversarial
// de la sesión 1). Por eso el filename que viaja a OpenAI se deriva
// SIEMPRE del mime resuelto por la app, no de la extensión que trajo el
// archivo del usuario.
const EXT_POR_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
};

export function filenameParaWhisper(
  filename: string,
  mimeType: string,
): string {
  const ext = EXT_POR_MIME[mimeType] ?? "mp3";
  const base = filename.replace(/\.[^.]*$/, "").trim() || "audio";
  return `${base}.${ext}`;
}

export async function transcribirAudio(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const openai = getOpenAI();
  const file = await toFile(buffer, filenameParaWhisper(filename, mimeType), {
    type: mimeType,
  });
  const result = await openai.audio.transcriptions.create({
    model: TRANSCRIPCION_MODEL,
    file,
    // Hint de idioma: los tres usuarios son abogados argentinos.
    language: "es",
  });
  return result.text?.trim() ?? "";
}
