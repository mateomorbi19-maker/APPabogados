import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { embedQuery } from "@/lib/rag/embed";
import { buscarDocumentos } from "@/lib/rag/match-documents";
import type { ChunkRecuperado } from "@/lib/agent/run-agent";

export const BUSCAR_DOCUMENTOS_TOOL_NAME = "buscar_documentos_legales" as const;

export const buscarDocumentosTool: Anthropic.Tool = {
  name: BUSCAR_DOCUMENTOS_TOOL_NAME,
  description:
    "Busca artículos del Código Penal argentino, del Código Procesal Penal Federal (Ley 27.063, sistema acusatorio, Infojus 2014) y doctrina de manuales de litigación penal. Usa términos jurídicos específicos como 'homicidio tentativa', 'injurias', 'legítima defensa', 'emoción violenta', 'abuso de arma', 'control de detención', 'archivo investigación', etc. Hacé múltiples búsquedas con diferentes términos para cubrir todos los aspectos del caso, incluyendo aspectos sustantivos (Código Penal) y procesales (CPPF).",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Términos jurídicos a buscar, en español. Combiná conceptos relacionados en una sola query.",
      },
    },
    required: ["query"],
  },
};

// Cuántos caracteres de cada chunk se guardan en la copia de medición. El
// tool_result que ve el modelo NO se trunca: esto es solo para metadata.
const CHUNK_PREVIEW_CHARS = 500;

// Ejecuta una búsqueda sobre el corpus normativo (Código Penal, CPPF y
// manuales de litigación): embeddea la query con OpenAI y la matchea contra
// `documentos` por similitud coseno.
//
// Vivía duplicada dentro de run-agent.ts y run-agent-consulta.ts, cada una
// privada de su loop. Las dos copias ya habían divergido —solo la de
// /analizar-caso construía la copia de medición— así que la que queda es el
// superset: quien no necesita `chunks` simplemente lo ignora.
//
// Nota sobre el top K: está fijo en 5 en el call site, no en la RPC. Y el
// umbral de similitud (0.55) vive HARDCODEADO en la función SQL, no acá: la
// migración que lo volvía parámetro figura como aplicada en MIGRATION_LOG.md
// y no lo está. Ver la nota de match-documents.ts sobre el reintento por
// PGRST202.
export async function ejecutarToolBuscar(query: string): Promise<{
  contentJSON: string;
  chunks_devueltos: number;
  similarity_top: number | null;
  chunks: ChunkRecuperado[];
}> {
  const embedding = await embedQuery(query);
  const docs = await buscarDocumentos(embedding, 5);
  // El JSON que ve el modelo conserva el contenido íntegro de cada chunk.
  const contentJSON = JSON.stringify(
    docs.map((d) => ({
      content: d.content,
      metadata: d.metadata,
      similarity: Number(d.similarity.toFixed(4)),
    })),
  );
  // Copia liviana para medición/debug: contenido truncado + metadata clave.
  const chunks: ChunkRecuperado[] = docs.map((d) => ({
    contenido: d.content.slice(0, CHUNK_PREVIEW_CHARS),
    articulo: d.metadata?.articulo ?? null,
    tipo_documento: d.metadata?.tipo_documento ?? null,
    similarity: Number(d.similarity.toFixed(4)),
  }));
  const top = docs[0]?.similarity ?? null;
  return {
    contentJSON,
    chunks_devueltos: docs.length,
    similarity_top: top !== null ? Number(top.toFixed(4)) : null,
    chunks,
  };
}
