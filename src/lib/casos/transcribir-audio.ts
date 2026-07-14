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

export async function transcribirAudio(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const openai = getOpenAI();
  const file = await toFile(buffer, filename, { type: mimeType });
  const result = await openai.audio.transcriptions.create({
    model: TRANSCRIPCION_MODEL,
    file,
    // Hint de idioma: los tres usuarios son abogados argentinos.
    language: "es",
  });
  return result.text?.trim() ?? "";
}
