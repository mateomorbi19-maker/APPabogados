import "server-only";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { filenameSeguro } from "./adjuntos";
import { MAX_PDF_BYTES, MAX_PDF_PAGINAS } from "./carga-schema";

export class ErrorCarga extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export type PdfCarga = { bytes: Buffer; filename: string; paginas: number };
const archivoSchema = z.instanceof(File).refine((f) => f.size > 0, "El PDF está vacío")
  .refine((f) => f.size <= MAX_PDF_BYTES, "El PDF supera los 10 MB")
  .refine((f) => /\.pdf$/i.test(f.name) && (!f.type || f.type === "application/pdf"), "Adjuntá un archivo PDF")
  .refine((f) => f.name.length <= 255, "El nombre del archivo es demasiado largo");

export async function validarPdfCarga(entrada: FormDataEntryValue | null): Promise<PdfCarga | null> {
  if (entrada === null) return null;
  const parsed = archivoSchema.safeParse(entrada);
  if (!parsed.success) throw new ErrorCarga(parsed.error.issues[0]?.message ?? "PDF inválido");
  const bytes = Buffer.from(await parsed.data.arrayBuffer());
  if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new ErrorCarga("El archivo no es un PDF válido");
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true }); }
  catch { throw new ErrorCarga("No se pudo leer el PDF. Revisá que no esté dañado ni protegido con contraseña."); }
  const paginas = pdf.getPageCount();
  if (paginas < 1 || paginas > MAX_PDF_PAGINAS) throw new ErrorCarga("El PDF debe tener entre 1 y 100 páginas. Dividí el documento si es más largo.");
  return { bytes, filename: filenameSeguro(parsed.data.name), paginas };
}

const MAX_FORM_BYTES = MAX_PDF_BYTES + 1024 * 1024;

export async function leerFormularioCarga(req: Request): Promise<FormData> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) throw new ErrorCarga("El formulario debe incluir los datos y, opcionalmente, un PDF");
  if (Number(req.headers.get("content-length")) > MAX_FORM_BYTES) throw new ErrorCarga("El archivo o formulario es demasiado grande", 413);
  if (!req.body) throw new ErrorCarga("El formulario está vacío");
  // Contar bytes reales: Content-Length no siempre está presente ni es fiable.
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FORM_BYTES) {
        await reader.cancel();
        throw new ErrorCarga("El archivo o formulario es demasiado grande", 413);
      }
      chunks.push(value);
    }
    return await new Response(Buffer.concat(chunks), { headers: { "content-type": contentType } }).formData();
  } catch (e) {
    if (e instanceof ErrorCarga) throw e;
    throw new ErrorCarga("No se pudo leer el formulario. Volvé a intentarlo.");
  } finally { reader.releaseLock(); }
}

export function validarCamposFormulario(form: FormData, permitidos: string[]): void {
  const vistos = new Set<string>();
  for (const clave of form.keys()) {
    if (!permitidos.includes(clave) || vistos.has(clave)) throw new ErrorCarga("El formulario tiene campos inválidos o repetidos");
    vistos.add(clave);
  }
}
