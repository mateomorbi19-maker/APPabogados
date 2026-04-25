import "server-only";
import { createServerClient } from "@/lib/supabase/server";

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
 * Llama a la función RPC `match_documents` (cosine similarity > 0.5).
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
  });
  if (error) {
    throw new Error(`match_documents falló: ${error.message}`);
  }
  return (data ?? []) as DocumentoMatch[];
}
