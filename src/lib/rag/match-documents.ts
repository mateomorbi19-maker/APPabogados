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
  if (error) {
    throw new Error(`match_documents falló: ${error.message}`);
  }
  return (data ?? []) as DocumentoMatch[];
}
