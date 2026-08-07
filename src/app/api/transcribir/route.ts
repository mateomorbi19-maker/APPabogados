import { NextRequest } from "next/server";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import { esAudio, resolverMime } from "@/lib/casos/adjuntos";
import { transcribirAudio } from "@/lib/casos/transcribir-audio";

// === POST /api/transcribir ===
//
// Dictado por voz del chat: recibe el audio recién grabado y devuelve el TEXTO.
// No persiste nada — ni en storage ni en la base. El audio se transcribe en
// memoria, se devuelve el texto y se descarta.
//
// Es deliberadamente distinto del camino de los audios ADJUNTOS (que sí se
// suben al bucket y los transcribe la ruta de mensajes): acá el audio no es un
// documento del caso, es la forma en que el abogado escribió el mensaje. Lo que
// queda registrado es el texto que él revisó y mandó, no la grabación.
//
// Cuota: no pasa por enforceTokenLimit porque Whisper no gasta tokens de
// Anthropic (se factura aparte en OpenAI, ~USD 0,006 el minuto). El control es
// la whitelist + el tope de tamaño de acá abajo.

export const maxDuration = 60;

// Mismo tope que un adjunto de audio. Whisper acepta hasta 25 MB; 10 MB de
// webm/opus son más de una hora de voz, así que el límite real lo pone la
// paciencia del abogado y no el formato.
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonResponse(
      { ok: false, error: "Se esperaba multipart/form-data con un campo 'audio'" },
      400,
    );
  }

  const audio = form.get("audio");
  if (!(audio instanceof File)) {
    return jsonResponse({ ok: false, error: "Falta el archivo de audio" }, 400);
  }
  if (audio.size === 0) {
    return jsonResponse(
      { ok: false, error: "La grabación llegó vacía. Probá de nuevo." },
      400,
    );
  }
  if (audio.size > MAX_BYTES) {
    return jsonResponse(
      { ok: false, error: "La grabación es demasiado larga (máximo 10 MB)." },
      413,
    );
  }

  // El mime del blob de MediaRecorder puede venir raro según el navegador
  // (Safari manda audio/mp4 sin codecs, algunos Chromium mandan ""), así que se
  // resuelve igual que un adjunto: por mime y, si no alcanza, por extensión.
  const mime = resolverMime(audio.name || "dictado.webm", audio.type);
  if (!esAudio(mime)) {
    return jsonResponse(
      { ok: false, error: `Formato de audio no soportado (${audio.type || "desconocido"})` },
      415,
    );
  }

  try {
    const buffer = Buffer.from(await audio.arrayBuffer());
    const texto = await transcribirAudio(
      buffer,
      audio.name || "dictado",
      mime,
    );
    // Whisper devuelve "" cuando el audio no tiene voz detectable (silencio, un
    // micrófono mudo, un toque accidental). No es un error del servidor: se
    // avisa con ok:true y texto vacío para que el cliente lo diga en su idioma.
    return jsonResponse({ ok: true, texto }, 200);
  } catch (e) {
    console.error("[/api/transcribir] Whisper falló:", e);
    return jsonResponse(
      {
        ok: false,
        error: "No se pudo transcribir el audio. Probá de nuevo.",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      502,
    );
  }
}
