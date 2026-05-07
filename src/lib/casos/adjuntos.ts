// Tipos y validadores compartidos cliente/server para adjuntos de
// eventos de caso. Sin "use client" / "server-only": módulo puro
// importable de ambos lados.

export const MIME_TYPES_PERMITIDOS = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type MimeTypePermitido = (typeof MIME_TYPES_PERMITIDOS)[number];

// Tamaños máximos por mime type (en bytes). PDF un poco más alto porque
// es el formato más común para resoluciones / escritos largos. El bucket
// tiene un cap global de 10 MB (ver migración 20260507120000).
export const TAMANO_MAX_POR_MIME: Record<MimeTypePermitido, number> = {
  "application/pdf": 10 * 1024 * 1024,
  "image/jpeg": 5 * 1024 * 1024,
  "image/png": 5 * 1024 * 1024,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    5 * 1024 * 1024,
};

// Label corto para mostrar al usuario. Para el icono ver fmtIconoMime.
export const MIME_LABEL: Record<MimeTypePermitido, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "DOCX",
};

// Estructura persistida en eventos_caso.adjuntos (jsonb array).
export type Adjunto = {
  filename: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  descripcion: string;
};

export function esMimePermitido(mime: string): mime is MimeTypePermitido {
  return (MIME_TYPES_PERMITIDOS as readonly string[]).includes(mime);
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
      error: `Tipo de archivo no permitido (${input.mime_type}). Aceptamos PDF, JPG, PNG y DOCX.`,
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
