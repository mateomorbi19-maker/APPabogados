import "server-only";
import { getOpenAI, EMBEDDING_MODEL } from "@/lib/openai";

export async function embedQuery(query: string): Promise<number[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new Error("embedQuery: query vacío");
  }
  const client = getOpenAI();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: trimmed,
  });
  const vector = response.data[0]?.embedding;
  if (!vector) {
    throw new Error("embedQuery: respuesta sin embedding");
  }
  return vector;
}
