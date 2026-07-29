import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/http";
import { gmailErrorMessage, gmailErrorStatus } from "@/lib/gmail/client";
import { esIdDemo } from "@/lib/gmail/demo";
import { obtenerAdjunto } from "@/lib/gmail/mensajes";
import {
  codificarFilenameRfc2231,
  sanitizarNombreArchivo,
} from "@/lib/gmail/parse";
import { abrirSesionBandeja } from "@/lib/gmail/sesion";
import { adjuntoIdSchema, gmailIdSchema } from "@/lib/gmail/types";

export const runtime = "nodejs";
export const maxDuration = 30;

// Únicos tipos que se pueden servir `inline`: imágenes rasterizadas, que el
// browser no puede ejecutar. Nada de HTML, y nada de SVG (puede traer script
// embebido). Con `nosniff` puesto, un archivo que MIENTA sobre su tipo tampoco
// se reinterpreta: se rompe la imagen y listo.
const IMAGENES_RENDERIZABLES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/x-icon",
]);

// === GET /api/bandeja/adjuntos/[mensaje_id]/[adjunto_id] ===
//
// Devuelve los bytes del adjunto. El filename y el Content-Type se toman del
// part del mensaje en Gmail, NUNCA de la URL: si vinieran del cliente, se
// podría forzar el navegador a interpretar el archivo como otra cosa.
//
// Por defecto `attachment`: así el browser no renderiza en nuestro origen un
// HTML/SVG que venga de un tercero. Con `?inline=1` —que sólo usa el `<img>`
// del cuerpo, donde `sanitizarHtml` reescribe los `cid:`— se sirve `inline`,
// pero únicamente si el tipo está en IMAGENES_RENDERIZABLES.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ mensaje_id: string; adjunto_id: string }> },
): Promise<Response> {
  const { mensaje_id, adjunto_id } = await params;
  const pidenInline = new URL(req.url).searchParams.get("inline") === "1";

  if (
    !gmailIdSchema.safeParse(mensaje_id).success ||
    !adjuntoIdSchema.safeParse(adjunto_id).success
  ) {
    return jsonResponse({ ok: false, error: "Id inválido" }, 400);
  }

  const sesion = await abrirSesionBandeja();
  if (sesion.estado === "error") {
    return jsonResponse({ ok: false, error: sesion.error }, sesion.status);
  }
  // Los adjuntos demo no tienen bytes detrás: no se inventa un archivo.
  if (sesion.estado === "demo" || esIdDemo(mensaje_id)) {
    return jsonResponse(
      {
        ok: false,
        error:
          "Los adjuntos de ejemplo no se pueden descargar. Conectá tu Gmail para acceder a los archivos reales.",
      },
      404,
    );
  }

  try {
    const adjunto = await obtenerAdjunto(sesion.gmail, mensaje_id, adjunto_id);
    if (!adjunto) {
      return jsonResponse({ ok: false, error: "Adjunto no encontrado" }, 404);
    }

    const nombre = sanitizarNombreArchivo(adjunto.filename);
    const tipo = adjunto.mime_type || "application/octet-stream";
    const comoInline =
      pidenInline && IMAGENES_RENDERIZABLES.has(tipo.split(";")[0].trim().toLowerCase());
    // filename= para clientes viejos, filename*= (RFC 2231/5987) para los
    // nombres con tildes y eñes, que son la norma acá.
    const disposition =
      `${comoInline ? "inline" : "attachment"}; ` +
      `filename="${nombre.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "_")}"; ` +
      `filename*=UTF-8''${codificarFilenameRfc2231(nombre)}`;

    return new Response(new Uint8Array(adjunto.data), {
      status: 200,
      headers: {
        "Content-Type": tipo,
        "Content-Length": String(adjunto.data.length),
        "Content-Disposition": disposition,
        // Nada de cachear correspondencia en proxies intermedios.
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const error = gmailErrorMessage(e);
    const status = gmailErrorStatus(e);
    if (status === 404) {
      return jsonResponse({ ok: false, error: "Adjunto no encontrado" }, 404);
    }
    console.error("[GET /api/bandeja/adjuntos] error:", error);
    return jsonResponse(
      { ok: false, error: "No se pudo descargar el adjunto" },
      502,
    );
  }
}
