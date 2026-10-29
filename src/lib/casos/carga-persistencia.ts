import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Adjunto } from "./adjuntos";
import type { GuardarCarga } from "./carga-schema";
import { ErrorCarga, type PdfCarga } from "./carga-archivo";

const BUCKET = "eventos-caso-adjuntos";

export async function verificarCargaDisponible(db: SupabaseClient, usuarioId: string): Promise<void> {
  const { error } = await db.rpc("crear_causa_importada", {
    p_id: randomUUID(), p_usuario_id: usuarioId, p_ficha: {}, p_adjunto: null,
    p_huella: "", p_solo_validar: true,
  });
  if (error) {
    console.error("[carga-causa] preflight", error.code);
    throw new ErrorCarga("La carga de causas todavía no está habilitada. Falta completar la actualización de la base de datos.", 503);
  }
}

export async function guardarCausaImportada(
  db: SupabaseClient, usuarioId: string, datos: GuardarCarga, pdf: PdfCarga | null,
): Promise<string> {
  const { id, ficha } = datos;
  const adjunto: Adjunto | null = pdf ? {
    filename: pdf.filename,
    storage_path: `${usuarioId}/${id}/carga-${createHash("sha256").update(pdf.bytes).digest("hex")}.pdf`,
    mime_type: "application/pdf", size_bytes: pdf.bytes.byteLength,
    descripcion: "Documento utilizado para cargar la causa",
  } : null;
  const huella = createHash("sha256").update(JSON.stringify({ ficha, adjunto })).digest("hex");
  const { data: previo, error: errorLectura } = await db.from("casos")
    .select("contexto").eq("id", id).eq("usuario_id", usuarioId).maybeSingle();
  if (errorLectura) throw new ErrorCarga("No se pudo verificar el guardado anterior. Reintentá sin cerrar la ficha.", 503);
  if (previo) {
    if (previo.contexto?.carga_inicial?.huella === huella) return id;
    throw new ErrorCarga("Esta causa ya fue guardada con otros datos. Abrila desde Mis causas para revisarla.", 409);
  }
  if (pdf && adjunto) {
    const { error } = await db.storage.from(BUCKET).upload(adjunto.storage_path, pdf.bytes, {
      contentType: "application/pdf", upsert: false,
    });
    if (error) {
      // Storage puede devolver duplicados como HTTP 400 (legacy) o 409.
      // El SDK no conserva siempre el código Duplicate; verificar los bytes
      // evita aceptar por error otro fallo o un objeto distinto en esa ruta.
      const status = "status" in error ? Number(error.status) : NaN;
      let mismoArchivo = false;
      if (status === 400 || status === 409) {
        const { data: existente, error: descargaError } = await db.storage.from(BUCKET).download(adjunto.storage_path);
        if (!descargaError && existente) {
          const bytes = Buffer.from(await existente.arrayBuffer());
          mismoArchivo = bytes.equals(pdf.bytes);
        }
      }
      if (!mismoArchivo) {
        console.error("[carga-causa] upload", error.name);
        throw new ErrorCarga("No se pudo guardar el PDF. Tus datos siguen disponibles para reintentar.", 503);
      }
    }
  }
  const { data, error } = await db.rpc("crear_causa_importada", {
    p_id: id, p_usuario_id: usuarioId, p_ficha: ficha, p_adjunto: adjunto,
    p_huella: huella, p_solo_validar: false,
  });
  if (error || typeof data !== "string") {
    // No borrar el PDF ante resultado incierto: la transacción puede haber
    // confirmado y perdido la respuesta. El reintento usa el mismo id/hash.
    console.error("[carga-causa] guardar", error?.code ?? "respuesta inválida");
    if (error?.code === "23505" || error?.code === "P0001") {
      throw new ErrorCarga("Esta causa ya fue guardada con otros datos. Revisala en Mis causas.", 409);
    }
    throw new ErrorCarga("No se pudo confirmar el guardado. Reintentá sin cerrar esta ficha para evitar duplicados.", 503);
  }
  return data;
}
