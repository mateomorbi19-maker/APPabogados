-- Parametriza el umbral de similaridad de match_documents.
-- Antes el corte estaba hardcodeado en 0.55 dentro del cuerpo del RPC, así que
-- cada recalibración requería una migración SQL nueva. Ahora el umbral es un
-- parámetro (`match_threshold`) con default 0.5, y la fuente de verdad operativa
-- pasa a ser la constante TS `RAG_SIMILARITY_THRESHOLD` que los call sites pasan
-- en cada llamada al RPC. Recalibrar = cambiar la constante, sin tocar SQL.
--
-- Motivo del nuevo default 0.5: con 0.55 se descartaban matches correctos
-- top-ranked por márgenes chicos. Ej.: la consulta "femicidio art 80" rankea el
-- artículo correcto en el puesto #1 con score 0.5466 < 0.55, por lo que el RPC
-- devolvía vacío. 0.5 recupera esos casos sin volver a la zona de alucinaciones
-- por chunks tangenciales que motivó subir desde 0.5 en su momento.
--
-- CREATE OR REPLACE (sin DROP) para aplicar sin downtime. El parámetro nuevo va
-- AL FINAL de la lista y con default, requisito de PostgreSQL para reemplazar la
-- función sin alterar los parámetros existentes ni romper los call sites.

CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector,
  match_count integer DEFAULT 5,
  filter jsonb DEFAULT '{}'::jsonb,
  match_threshold float8 DEFAULT 0.5
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
  where 1 - (d.embedding <=> query_embedding) > match_threshold
  order by d.embedding <=> query_embedding
  limit match_count;
end;
$function$;
