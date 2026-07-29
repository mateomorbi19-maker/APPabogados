import "server-only";
import { createServerClient } from "@/lib/supabase/server";

// Umbral de similaridad de coseno para el RPC `match_documents`. Este es el
// PUNTO ÚNICO para recalibrar el corte de recuperación: se pasa como argumento
// `match_threshold` en cada llamada al RPC, así que cambiar este valor recalibra
// todo el RAG sin necesidad de una migración SQL nueva. Bajado de 0.55 a 0.50
// porque 0.55 descartaba matches correctos top-ranked (ej.: "femicidio art 80"
// rankea #1 a 0.5466 y quedaba afuera).
export const RAG_SIMILARITY_THRESHOLD = 0.5;

export type DocumentoMatch = {
  id: number;
  content: string;
  metadata: {
    tipo_documento?: string | null;
    libro?: string | null;
    titulo?: string | null;
    capitulo?: string | null;
    articulo?: string | null;
    seccion?: string | null;
  };
  similarity: number;
};

/**
 * Llama a la función RPC `match_documents` (cosine similarity > RAG_SIMILARITY_THRESHOLD).
 * Devuelve hasta `k` documentos ordenados por similitud descendente.
 */
export async function buscarDocumentos(
  embedding: number[],
  k: number = 5,
): Promise<DocumentoMatch[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    match_count: k,
    filter: {},
    match_threshold: RAG_SIMILARITY_THRESHOLD,
  });

  if (!error) return (data ?? []) as DocumentoMatch[];

  // Fallback de compatibilidad: si la migración que parametriza el umbral
  // (20260627003911_match_documents_threshold_param.sql) no está aplicada en la
  // DB, PostgREST responde PGRST202 ("no existe la función con esos params") y
  // el RAG devuelve CERO chunks en silencio. Pasó en producción entre el
  // 2026-06-27 y el 2026-07-29: todo análisis salió sin grounding.
  // Reintentamos con la firma vieja (umbral hardcodeado dentro del SQL) para
  // que el RAG funcione aunque el repo y la DB estén desfasados.
  if (error.code === "PGRST202") {
    const legacy = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      match_count: k,
      filter: {},
    });
    if (legacy.error) {
      throw new Error(`match_documents falló: ${legacy.error.message}`);
    }
    return (legacy.data ?? []) as DocumentoMatch[];
  }

  throw new Error(`match_documents falló: ${error.message}`);
}
