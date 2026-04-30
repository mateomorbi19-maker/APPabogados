-- Sube el threshold de similarity de match_documents de 0.5 a 0.6.
-- Motivo: con threshold 0.5 el RPC devolvía chunks tangenciales que confundían
-- al agente y derivaban en alucinaciones de contenido (caso testeado: el agente
-- atribuía al Art 183 CPPF un contenido sobre "comunicar inmediatamente al juez"
-- que no aparece en el chunk real). Threshold más estricto reduce ruido a costa
-- de algunas búsquedas que pueden devolver menos resultados (que es preferible
-- a ruido — el agente ya tiene HARD_CAP_BUSQUEDAS=6 para reintentar con
-- queries reformuladas).

CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector,
  match_count integer DEFAULT 5,
  filter jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(id bigint, content text, metadata jsonb, similarity double precision)
LANGUAGE plpgsql
AS $function$
begin
  return query
  select
    d.id,
    d.contenido as content,
    jsonb_build_object(
      'tipo_documento', d.tipo_documento,
      'libro',          d.libro,
      'titulo',         d.titulo,
      'capitulo',       d.capitulo,
      'articulo',       d.articulo,
      'seccion',        d.seccion
    ) as metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from documentos d
  where 1 - (d.embedding <=> query_embedding) > 0.6
  order by d.embedding <=> query_embedding
  limit match_count;
end;
$function$;
