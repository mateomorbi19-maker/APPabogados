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

// === Conversión HEIC/HEIF → JPEG dentro de los límites de Anthropic ===
//
// Anthropic solo acepta jpeg/png/gif/webp como image blocks, con límites
// duros de 5 MB por imagen y 8000 px por lado. Un HEIC válido para
// nuestro upload (≤5 MB) puede violar AMBOS al convertirse: HEIC
// comprime ~2x mejor que JPEG (5 MB HEIC → 6-12 MB JPEG) y las fotos
// HEIF Max de iPhone son 8064×6048. Por eso acá se decodifica, se
// reescala si hace falta y se re-encodea con escalera de calidad hasta
// entrar en límites (hallazgo del review adversarial de la sesión 1).
//
// Cap de resolución en 1568 px: Anthropic downsamplea igual por encima
// de eso, así que resolución extra solo quema tokens y bytes.
//
// heic-decode + jpeg-js son JS puro (libheif via wasm): sin binarios
// nativos, no complican el Docker build de la Fase 5.4. Imports
// dinámicos para no cargar el wasm en rutas que no lo usan.

const MAX_LADO_PX = 1568;
const MAX_JPEG_BYTES = Math.floor(4.5 * 1024 * 1024); // margen bajo los 5 MB duros

// Downscale RGBA por promedio de caja (box-average): simple, sin deps,
// y de mejor calidad que nearest-neighbor para reducciones grandes
// (8064px → 1568px es ~5x).
function reescalarRgba(
  src: Uint8Array,
  w: number,
  h: number,
  tw: number,
  th: number,
): Buffer {
  const dst = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor((y * h) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / th));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor((x * w) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / tw));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
          n++;
        }
      }
      const j = (y * tw + x) * 4;
      dst[j] = Math.round(r / n);
      dst[j + 1] = Math.round(g / n);
      dst[j + 2] = Math.round(b / n);
      dst[j + 3] = Math.round(a / n);
    }
  }
  return dst;
}

export async function convertirHeicAJpeg(buffer: Buffer): Promise<Buffer> {
  const { default: decode } = await import("heic-decode");
  const decoded = await decode({ buffer: new Uint8Array(buffer) });

  let w = decoded.width;
  let h = decoded.height;
  let rgba: Uint8Array | Buffer = new Uint8Array(decoded.data);

  const escala = Math.min(1, MAX_LADO_PX / Math.max(w, h));
  if (escala < 1) {
    const tw = Math.max(1, Math.round(w * escala));
    const th = Math.max(1, Math.round(h * escala));
    rgba = reescalarRgba(rgba as Uint8Array, w, h, tw, th);
    w = tw;
    h = th;
  }

  const jpegjs = await import("jpeg-js");
  // Escalera de calidad: bajamos hasta entrar en el límite de bytes.
  for (const quality of [85, 70, 55]) {
    const out = jpegjs.encode(
      { data: Buffer.from(rgba), width: w, height: h },
      quality,
    ).data;
    if (out.length <= MAX_JPEG_BYTES) return Buffer.from(out);
  }
  // A 1568px y calidad 55 esto no debería pasar nunca; si pasa, mejor
  // degradar el adjunto (catch por-adjunto en el route) que mandar un
  // block que la API va a rechazar de forma determinística.
  throw new Error(
    "convertirHeicAJpeg: la imagen convertida excede el tamaño máximo aceptado por el modelo",
  );
}
