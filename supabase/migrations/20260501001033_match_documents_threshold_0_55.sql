-- Baja el threshold de similarity de match_documents de 0.6 a 0.55.
-- Motivo: con 0.6, el 50% de las búsquedas del agente devolvían 0 chunks
-- (test post-deploy mostró 2 de 4 queries vacías). 0.55 es punto medio
-- entre el 0.5 original (que producía alucinaciones por chunks tangenciales)
-- y el 0.6 (que cortaba info relevante). Si sigue dejando búsquedas en
-- cero, considerar threshold adaptativo en código de aplicación.

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
  where 1 - (d.embedding <=> query_embedding) > 0.55
  order by d.embedding <=> query_embedding
  limit match_count;
end;
$function$;
