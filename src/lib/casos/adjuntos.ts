// Tipos y validadores compartidos cliente/server para adjuntos de
// eventos de caso y del chat. Sin "use client" / "server-only": módulo
// puro importable de ambos lados.
//
// FUENTE ÚNICA de mime types permitidos. El bucket
// `eventos-caso-adjuntos` tiene el MISMO allowlist a nivel Storage
// (config del bucket, ver MIGRATION_LOG.md 2026-07-14): si se agrega un
// mime acá hay que agregarlo también en el bucket o el PUT del upload
// falla.

export const MIME_TYPES_PERMITIDOS = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "audio/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/ogg",
] as const;

export type MimeTypePermitido = (typeof MIME_TYPES_PERMITIDOS)[number];

export const MIME_AUDIO: readonly MimeTypePermitido[] = [
  "audio/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/ogg",
];

export const MIME_IMAGEN: readonly MimeTypePermitido[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

export function esAudio(mime: string): boolean {
  return (MIME_AUDIO as readonly string[]).includes(mime);
}

export function esImagen(mime: string): boolean {
  return (MIME_IMAGEN as readonly string[]).includes(mime);
}

// Tamaños máximos por mime type (en bytes). PDF y audio más altos
// porque son los formatos más pesados legítimos (resoluciones largas /
// notas de voz). El bucket tiene un cap global de 10 MB.
export const TAMANO_MAX_POR_MIME: Record<MimeTypePermitido, number> = {
  "application/pdf": 10 * 1024 * 1024,
  "image/jpeg": 5 * 1024 * 1024,
  "image/png": 5 * 1024 * 1024,
  "image/webp": 5 * 1024 * 1024,
  "image/heic": 5 * 1024 * 1024,
  "image/heif": 5 * 1024 * 1024,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    5 * 1024 * 1024,
  "audio/webm": 10 * 1024 * 1024,
  "audio/mpeg": 10 * 1024 * 1024,
  "audio/mp4": 10 * 1024 * 1024,
  "audio/x-m4a": 10 * 1024 * 1024,
  "audio/wav": 10 * 1024 * 1024,
  "audio/ogg": 10 * 1024 * 1024,
};

// Label corto para mostrar al usuario. Para el icono ver fmtIconoMime.
export const MIME_LABEL: Record<MimeTypePermitido, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WEBP",
  "image/heic": "HEIC",
  "image/heif": "HEIF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "DOCX",
  "audio/webm": "Audio",
  "audio/mpeg": "MP3",
  "audio/mp4": "M4A",
  "audio/x-m4a": "M4A",
  "audio/wav": "WAV",
  "audio/ogg": "Audio",
};

// Estructura persistida en eventos_caso.adjuntos y
// mensajes_conversacion.adjuntos (jsonb array). `transcripcion` solo
// existe en adjuntos de audio del chat: la genera el server (Whisper)
// después de insertar el mensaje y se persiste para no re-transcribir
// al reconstruir el historial.
export type Adjunto = {
  filename: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  descripcion: string;
  transcripcion?: string;
};

export function esMimePermitido(mime: string): mime is MimeTypePermitido {
  return (MIME_TYPES_PERMITIDOS as readonly string[]).includes(mime);
}

// Fallback de detección por extensión: en Windows el browser suele
// reportar file.type = "" para .heic/.heif (sin app asociada) y algunos
// browsers reportan mimes no estándar para audio. Si el mime reportado
// no está en el allowlist pero la extensión sí es conocida, usamos el
// mime canónico de la extensión.
const MIME_POR_EXTENSION: Record<string, MimeTypePermitido> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  webm: "audio/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
};

export function resolverMime(
  filename: string,
  mimeReportado: string,
): string {
  if (esMimePermitido(mimeReportado)) return mimeReportado;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_POR_EXTENSION[ext] ?? mimeReportado;
}

// Sanitiza el filename para uso en el storage path. Quita `/`, `..`, y
// limita a chars ASCII seguros. Mantiene la extensión si la hay.
export function filenameSeguro(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) return "archivo";
  // Tomamos solo el basename: si vino con paths (`carpeta/x.pdf`), nos
  // quedamos con `x.pdf`.
  const base = trimmed.split(/[\\/]/).pop() ?? trimmed;
  // Reemplazamos chars no seguros con `_`. Mantenemos `.`, `-`, `_`.
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Limitamos a 200 chars para no inflar paths. La extensión la
  // preserva el slice porque está al final.
  return safe.length > 200 ? safe.slice(0, 200) : safe;
}

// Para mostrar tamaños amigables en la UI: "1.2 MB", "340 KB", etc.
export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Resultado de validación: ok o mensaje de error pensado para mostrar
// al usuario. Compartido cliente/server (el server lo usa como red
// adicional aunque el cliente ya validó).
export type ValidacionAdjunto =
  | { ok: true }
  | { ok: false; error: string };

export function validarAdjunto(input: {
  filename: string;
  mime_type: string;
  size_bytes: number;
}): ValidacionAdjunto {
  if (!input.filename || input.filename.trim().length === 0) {
    return { ok: false, error: "El archivo no tiene nombre" };
  }
  if (!esMimePermitido(input.mime_type)) {
    return {
      ok: false,
      error: `Tipo de archivo no permitido (${input.mime_type || "desconocido"}). Aceptamos PDF, imágenes (JPG/PNG/WEBP/HEIC), DOCX y audio (WEBM/MP3/M4A/WAV/OGG).`,
    };
  }
  if (!Number.isFinite(input.size_bytes) || input.size_bytes <= 0) {
    return { ok: false, error: "El archivo está vacío o tiene tamaño inválido" };
  }
  const max = TAMANO_MAX_POR_MIME[input.mime_type];
  if (input.size_bytes > max) {
    return {
      ok: false,
      error: `El archivo supera el tamaño máximo (${fmtBytes(max)} para ${MIME_LABEL[input.mime_type]})`,
    };
  }
  return { ok: true };
}
