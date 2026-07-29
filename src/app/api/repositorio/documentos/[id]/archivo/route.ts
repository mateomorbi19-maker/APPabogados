import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse } from "@/lib/http";
import { CATALOGO } from "@/lib/repositorio/catalogo";
import { documentoPorId } from "@/lib/repositorio/buscar";
import { esInlineSeguro } from "@/lib/repositorio/types";
import {
  descargarDocumento,
  type ErrorDescarga,
} from "@/lib/repositorio/drive";

// Un PDF de un fallo pesa entre 100 KB y unos pocos MB; el cuello de botella es
// la latencia de Drive, no el tamaño.
export const maxDuration = 60;

const idSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/, "id inválido");

// Mensajes para el usuario final (abogado, no técnico).
const MENSAJES: Record<ErrorDescarga | "tipo_cambiado", string> = {
  sin_token:
    "Falta conectar Google Drive con permiso de lectura para abrir los PDF acá adentro.",
  token_invalido:
    "Se venció el permiso de Google Drive. Volvé a iniciar sesión y aceptalo de nuevo.",
  sin_permiso:
    "Tu cuenta de Google no tiene acceso a este archivo en la carpeta del estudio.",
  no_encontrado:
    "El archivo ya no está en la carpeta de Drive (lo movieron o lo borraron).",
  error_drive: "Google Drive no respondió. Probá de nuevo en un momento.",
  tipo_cambiado:
    "En Drive reemplazaron este archivo por otro de un tipo distinto. Abrilo en Drive y avisá para regenerar el catálogo.",
};

/**
 * Cabecera de la respuesta del binario.
 *
 * El `Content-Type` sale SIEMPRE del catálogo, nunca de Drive: la metadata de
 * Drive es un dato de terceros y si alguien sube una versión HTML de un fallo
 * (Drive conserva el fileId y cambia el mimeType), servirla `inline` con ese
 * tipo ejecutaría el script en el origen de la app, con la sesión de Clerk
 * puesta. Mismo criterio que la ruta de adjuntos de la bandeja.
 *
 * Tres capas, verificadas contra Chrome:
 *   1. `Content-Type` del catálogo + `nosniff`: un HTML servido como
 *      `application/pdf` entra al visor de PDF y no se parsea como documento.
 *   2. `attachment` para todo lo que no esté en `MIMES_INLINE` (los .docx/.pptx
 *      del catálogo): el navegador no renderiza nada en nuestro origen.
 *   3. CSP de la respuesta: aunque el tipo fuera HTML, no corre ni un script.
 *      Se usa CSP y NO `sandbox` (ni el atributo del <iframe> ni la directiva):
 *      Chrome bloquea el visor de PDF dentro de un frame sandboxeado
 *      (`net::ERR_BLOCKED_BY_CLIENT`) y se caería el lector entero, que es el
 *      99% del uso. La CSP, en cambio, no le hace nada al visor de PDF.
 */
const CSP_ARCHIVO =
  "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

/**
 * `filename` ASCII + `filename*` RFC 5987, para que el nombre con tildes
 * ("Fernández Galeano.pdf") no se rompa en ningún navegador.
 */
function contentDisposition(nombre: string, adjunto: boolean): string {
  const ascii = nombre.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const tipo = adjunto ? "attachment" : "inline";
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`;
}

// === GET /api/repositorio/documentos/[id]/archivo ===
// Streamea el PDF desde Drive con el token de Google del usuario. `inline` para
// el visor embebido; `?descargar=1` fuerza la descarga.
//
// Cuando falta el token o el scope responde 409 (no 401/403) con el `view_url`:
// la sesión de la app está bien, lo que falta es el permiso de Google, y la UI
// tiene que poder ofrecer "Abrir en Drive" en vez de mandar a re-loguear.
// También responde 409 si el archivo de Drive cambió de tipo respecto del
// catálogo (`tipo_cambiado`).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  const doc = documentoPorId(CATALOGO, id);
  if (!doc) {
    return jsonResponse({ ok: false, error: "Documento no encontrado" }, 404);
  }

  const r = await descargarDocumento(wl.clerk_user_id, doc.drive_id);
  if (!r.ok) {
    // 409 = la sesión está bien pero falta el permiso de Google (la UI ofrece
    // "Abrir en Drive"); 404 = el archivo ya no existe; 502 = falló Google.
    const status =
      r.error === "error_drive" ? 502 : r.error === "no_encontrado" ? 404 : 409;
    return jsonResponse(
      {
        ok: false,
        error: MENSAJES[r.error],
        motivo: r.error,
        view_url: doc.view_url,
      },
      status,
    );
  }

  // El archivo de Drive dejó de ser el que el catálogo dice que es. Puede ser
  // que alguien haya subido otra versión: no se streamea nada, se manda a Drive.
  if (r.mimeType !== doc.mime_type) {
    // El media ya está abierto contra Google: sin esto queda un stream colgado.
    void r.stream.cancel();
    console.warn(
      "[repositorio/archivo] mime distinto al del catálogo:",
      doc.id,
      `catálogo=${doc.mime_type}`,
      `drive=${r.mimeType}`,
    );
    return jsonResponse(
      {
        ok: false,
        error: MENSAJES.tipo_cambiado,
        motivo: "tipo_cambiado",
        view_url: doc.view_url,
      },
      409,
    );
  }

  const descargar = req.nextUrl.searchParams.get("descargar") === "1";
  // Sólo se renderiza embebido lo que el visor del navegador abre sin ejecutar
  // nada; el resto (los .docx/.pptx del catálogo) baja como adjunto.
  const adjunto = descargar || !esInlineSeguro(doc.mime_type);
  const headers = new Headers({
    "Content-Type": doc.mime_type,
    "Content-Disposition": contentDisposition(r.nombre, adjunto),
    "Content-Security-Policy": CSP_ARCHIVO,
    // El corpus es inmutable en la práctica (nadie reemplaza un fallo ya
    // dictado), pero es privado: cache sólo en el browser del usuario.
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  if (r.sizeBytes !== null) headers.set("Content-Length", String(r.sizeBytes));

  return new Response(r.stream, { status: 200, headers });
}
