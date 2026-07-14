import "server-only";
import { createServerClient } from "@/lib/supabase/server";

const BUCKET = "eventos-caso-adjuntos";

// Baja un objeto del bucket y devuelve sus bytes como Buffer + base64.
// Usado por runAgentConsulta para mandar PDFs e imágenes como contenido
// nativo al modelo, y por el extractor de DOCX (que lee el buffer crudo).
export async function descargarAdjuntoBytes(storagePath: string): Promise<{
  buffer: Buffer;
  base64: string;
}> {
  const supabase = createServerClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath);
  if (error || !data) {
    throw new Error(
      `descargarAdjuntoBytes: error bajando ${storagePath}: ${error?.message ?? "sin data"}`,
    );
  }
  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64 = buffer.toString("base64");
  return { buffer, base64 };
}

// Extrae el texto plano de un DOCX usando mammoth. Devuelve "" si la
// extracción falla por archivo corrupto, etc — la consulta sigue
// adelante sin ese texto pero con el filename + descripción en el
// contexto.
//
// Nota: import dinámico para que mammoth no se incluya en bundles que
// no lo usen (p. ej. el endpoint /analizar-caso que no soporta DOCX).
export async function extraerTextoDocx(buffer: Buffer): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? "";
  } catch (e) {
    console.warn("[extraerTextoDocx] error:", e);
    return "";
  }
}

// Convierte una imagen HEIC/HEIF (fotos de iPhone) a JPEG. Anthropic
// solo acepta jpeg/png/gif/webp como image blocks, así que las HEIC se
// convierten server-side antes de mandarlas al modelo.
//
// heic-convert es JS puro (libheif via wasm): sin binarios nativos, no
// complica el Docker build de la Fase 5.4. Import dinámico para no
// cargar el wasm en rutas que no lo usan.
export async function convertirHeicAJpeg(buffer: Buffer): Promise<Buffer> {
  const { default: convert } = await import("heic-convert");
  const salida = await convert({
    buffer: new Uint8Array(buffer),
    format: "JPEG",
    quality: 0.85,
  });
  return Buffer.from(salida);
}
