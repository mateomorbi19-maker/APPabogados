-- RAG del Repositorio de jurisprudencia y doctrina.
--
-- El Repositorio ya existe como CATÁLOGO (345 documentos en un módulo TS
-- generado, src/lib/repositorio/catalogo.ts) pero ese catálogo sólo conoce los
-- NOMBRES DE ARCHIVO de Drive: sirve para que el abogado navegue, no para que
-- el agente responda "¿qué jurisprudencia aplica a este caso?". Para eso hace
-- falta el CONTENIDO de los PDF, y eso es lo que crean estas dos tablas.
--
-- DOS NIVELES, a propósito:
--
--   1. `repositorio_documentos` — UNA fila por documento, con una FICHA
--      generada offline por el modelo al ingerir (holding / sumario / temas /
--      normas / utilidad para cada lado) y su embedding. Es el nivel con el que
--      se decide QUÉ FALLO SIRVE. Buscar sobre 345 fichas curadas rankea mucho
--      mejor que sobre 12.000 chunks crudos, donde el párrafo de "VISTOS" de un
--      fallo cualquiera compite con la ratio decidendi del fallo correcto.
--
--   2. `repositorio_chunks` — los pasajes del PDF, con embedding. Es el nivel
--      con el que se CITA: una vez elegido el documento, el agente recupera el
--      párrafo textual que sostiene la cita. Nunca se busca acá "a ciegas" sobre
--      todo el corpus; la búsqueda de pasajes va siempre acotada a los
--      documentos que ganó la etapa 1 (`filtro_documentos`).
--
-- Esa separación es la que hace la feature barata en tokens: el agente ve 6
-- fichas de ~120 palabras en vez de 30 chunks de 1.500 caracteres, y sólo baja a
-- los pasajes de los 3 o 4 documentos que efectivamente va a usar.
--
-- Mismo stack de embeddings que el corpus legal existente: OpenAI
-- text-embedding-3-small, 1536 dims, distancia coseno, índice HNSW.
-- Deliberadamente NO se reusa la tabla `documentos`: ese corpus es normativa
-- (Código Penal / CPPF / manuales) y su metadata es libro/título/artículo. Un
-- fallo tiene tribunal/año/carátula y una relación 1:N con sus pasajes que
-- `documentos` no modela. Mezclarlos también rompería el RAG existente, que
-- busca artículos y no debería empezar a devolver sentencias.
--
-- ESTE ARCHIVO NO FUE EJECUTADO por Claude Code. Lo corre Mateo a mano en el
-- SQL Editor de Supabase (ver MIGRATION_LOG.md). Hasta que se aplique, la app
-- funciona igual: las tools de jurisprudencia del agente detectan que las tablas
-- no existen y le contestan al modelo que el índice todavía no está construido.

-- ============================================================
-- 0. pgvector
-- ============================================================
-- Ya está instalada (la usa `documentos`). El CREATE IF NOT EXISTS es para que
-- esta migración sea auto-contenida si algún día se levanta la base de cero.

CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 1. repositorio_documentos — una fila por documento del catálogo
-- ============================================================

CREATE TABLE IF NOT EXISTS repositorio_documentos (
  -- Slug del catálogo (`CATALOGO[].id`). Es la PK y NO un uuid nuevo a
  -- propósito: el agente devuelve este id en sus citas y el frontend lo usa
  -- tal cual para linkear a /dashboard/repositorio/<id>. Un id sintético
  -- obligaría a un join extra en cada render.
  documento_id     text PRIMARY KEY,
  drive_id         text NOT NULL,
  coleccion        text NOT NULL CHECK (coleccion IN ('jurisprudencia', 'doctrina')),

  -- Copia desnormalizada de la metadata del catálogo. Se duplica a propósito:
  -- las RPC tienen que poder devolver la cita completa sin que el server
  -- cruce cada resultado contra el módulo TS.
  titulo           text NOT NULL,
  tribunal         text NULL,
  anio             integer NULL,
  caratula         text NULL,
  autor            text NULL,
  materias         text[] NOT NULL DEFAULT '{}',

  -- === Ficha generada por el modelo durante la ingesta ===
  -- `holding` es el campo que hace el trabajo: la regla que el fallo sienta, en
  -- una o dos oraciones. Es lo que el agente necesita para decidir si el
  -- precedente respalda la hipótesis que ya construyó.
  holding          text NULL,
  sumario          text NULL,
  temas            text[] NOT NULL DEFAULT '{}',
  normas           text[] NOT NULL DEFAULT '{}',
  utilidad_defensa text NULL,
  utilidad_acusacion text NULL,

  -- Embedding de la ficha completa (holding + sumario + temas + normas).
  -- NULL mientras el documento está ingerido pero sin ficha (estado != 'ok').
  embedding        vector(1536) NULL,

  -- === Trazabilidad de la ingesta ===
  estado           text NOT NULL DEFAULT 'pendiente'
                     CHECK (estado IN ('ok', 'sin_texto', 'error', 'pendiente')),
  -- Por qué falló, cuando estado IN ('sin_texto','error'). Sirve para que la
  -- re-corrida del script sepa qué reintentar y qué no.
  error_detalle    text NULL,
  paginas          integer NULL,
  caracteres       integer NULL,
  -- sha256 del texto extraído. Si no cambió, la re-ingesta saltea el documento
  -- entero (no re-embeddea ni re-genera la ficha). Es lo que hace incremental
  -- una corrida sobre una carpeta de Drive que crece de a pocos archivos.
  texto_hash       text NULL,
  modelo_ficha     text NULL,
  ingestado_en     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repositorio_documentos_coleccion
  ON repositorio_documentos (coleccion);
CREATE INDEX IF NOT EXISTS idx_repositorio_documentos_estado
  ON repositorio_documentos (estado);

-- HNSW coseno, igual que documentos_embedding_idx. Con ~350 filas cualquier
-- índice alcanza; se pone igual para no depender del tamaño del corpus.
CREATE INDEX IF NOT EXISTS idx_repositorio_documentos_embedding
  ON repositorio_documentos USING hnsw (embedding vector_cosine_ops);

COMMENT ON TABLE repositorio_documentos IS
  'Una fila por documento del Repositorio (jurisprudencia y doctrina del estudio, espejado desde Drive). Guarda la ficha generada por IA durante la ingesta y su embedding: es el nivel con el que el agente decide QUÉ precedente sirve para un caso. El texto completo vive chunkeado en repositorio_chunks.';

-- ============================================================
-- 2. repositorio_chunks — los pasajes citables
-- ============================================================

CREATE TABLE IF NOT EXISTS repositorio_chunks (
  id            bigserial PRIMARY KEY,
  documento_id  text NOT NULL
                  REFERENCES repositorio_documentos(documento_id) ON DELETE CASCADE,
  -- Orden dentro del documento. Con (documento_id, chunk_index) UNIQUE, la
  -- re-ingesta de un documento puede borrar sus chunks y reinsertarlos sin
  -- tocar el resto del corpus.
  chunk_index   integer NOT NULL,
  -- Página del PDF donde arranca el chunk. NULL para formatos sin paginado
  -- (DOCX). Es lo que permite que la cita diga "p. 14" y el abogado lo
  -- verifique en el visor.
  pagina        integer NULL,
  contenido     text NOT NULL,
  embedding     vector(1536) NOT NULL,
  UNIQUE (documento_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_repositorio_chunks_documento
  ON repositorio_chunks (documento_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_repositorio_chunks_embedding
  ON repositorio_chunks USING hnsw (embedding vector_cosine_ops);

COMMENT ON TABLE repositorio_chunks IS
  'Pasajes con embedding de cada documento del Repositorio. Se buscan SIEMPRE acotados a un conjunto de documento_id (el que ganó la búsqueda de fichas), nunca a ciegas sobre todo el corpus.';

-- ============================================================
-- 3. RPC — etapa 1: qué documentos sirven
-- ============================================================
-- Devuelve la ficha completa, no el texto: es lo que el agente lee para decidir.
-- `filtro_coleccion` NULL = las dos colecciones.
--
-- Se filtra por `embedding IS NOT NULL` explícitamente: un documento en estado
-- 'sin_texto' (PDF escaneado sin capa de texto) existe como fila pero no tiene
-- con qué rankear, y sin el filtro el operador <=> lo trataría como distancia
-- NULL y ensuciaría el orden.

CREATE OR REPLACE FUNCTION public.match_repositorio_documentos(
  query_embedding vector,
  match_count integer DEFAULT 6,
  match_threshold float8 DEFAULT 0.25,
  filtro_coleccion text DEFAULT NULL
)
RETURNS TABLE(
  documento_id text,
  coleccion text,
  titulo text,
  tribunal text,
  anio integer,
  caratula text,
  autor text,
  materias text[],
  holding text,
  sumario text,
  temas text[],
  normas text[],
  utilidad_defensa text,
  utilidad_acusacion text,
  similarity double precision
)
LANGUAGE sql STABLE
AS $$
  SELECT
    d.documento_id,
    d.coleccion,
    d.titulo,
    d.tribunal,
    d.anio,
    d.caratula,
    d.autor,
    d.materias,
    d.holding,
    d.sumario,
    d.temas,
    d.normas,
    d.utilidad_defensa,
    d.utilidad_acusacion,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM repositorio_documentos d
  WHERE d.embedding IS NOT NULL
    AND d.estado = 'ok'
    AND (filtro_coleccion IS NULL OR d.coleccion = filtro_coleccion)
    AND 1 - (d.embedding <=> query_embedding) > match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ============================================================
-- 4. RPC — etapa 2: qué pasajes citar
-- ============================================================
-- `filtro_documentos` NULL = todo el corpus (sólo se usa así desde scripts de
-- diagnóstico; el agente siempre pasa la lista de la etapa 1).
--
-- El umbral por defecto es BAJO (0.2) y es deliberado: acá ya se decidió que el
-- documento es pertinente, y lo único que se pide es el mejor párrafo que
-- tenga. Un umbral alto devolvería cero pasajes de un fallo correcto sólo
-- porque su redacción no se parece léxicamente a la consulta, y el agente se
-- quedaría con la ficha sin nada textual que citar.

CREATE OR REPLACE FUNCTION public.match_repositorio_chunks(
  query_embedding vector,
  match_count integer DEFAULT 8,
  match_threshold float8 DEFAULT 0.2,
  filtro_documentos text[] DEFAULT NULL
)
RETURNS TABLE(
  id bigint,
  documento_id text,
  chunk_index integer,
  pagina integer,
  contenido text,
  similarity double precision
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.documento_id,
    c.chunk_index,
    c.pagina,
    c.contenido,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM repositorio_chunks c
  WHERE (filtro_documentos IS NULL OR c.documento_id = ANY(filtro_documentos))
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ============================================================
-- 5. RLS deny-by-default
-- ============================================================
-- Igual que el resto del schema desde la Fase 5.5: habilitada SIN policies. El
-- server accede siempre con service_role (bypassa RLS); ningún rol anon o
-- authenticated puede leer ni escribir directo. Importa acá aunque el contenido
-- no sea del usuario: es material del estudio y el catálogo de Drive es privado.

ALTER TABLE repositorio_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE repositorio_chunks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON repositorio_documentos FROM anon, authenticated;
REVOKE ALL ON repositorio_chunks FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_repositorio_documentos(vector, integer, float8, text)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_repositorio_chunks(vector, integer, float8, text[])
  FROM anon, authenticated;
