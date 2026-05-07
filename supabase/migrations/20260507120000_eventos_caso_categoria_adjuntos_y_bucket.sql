-- PR1 de feature/simulacion-procesal-v1: schema para soportar categoría
-- procesal de eventos + adjuntos + bucket de Storage privado.
--
-- IMPORTANTE — mapeo de nombres con respecto al spec del prompt:
--   - El prompt pide agregar `origen` (manual|agente) a eventos_caso. Ya
--     existe `tipo` con esa misma semántica (manual|sistema|agente). Por
--     decisión del director, NO duplicamos: `tipo` sigue siendo el origen.
--   - El prompt pide poner valores procesales en `tipo` (audiencia, etc.).
--     Como `tipo` ya tiene otra semántica, agregamos columna nueva
--     `categoria` para los valores procesales.
--   - El prompt pide agregar `analisis_original_id`, `estrategia_elegida_numero`,
--     `estrategia_elegida_snapshot` a `casos`. Esas columnas ya existen como
--     `ejecucion_origen_id`, `estrategia_seleccionada_idx` (0-2 vs 1-3),
--     `estrategia_snapshot`. NO se tocan en este PR.

ALTER TABLE eventos_caso
  ADD COLUMN IF NOT EXISTS categoria TEXT NULL
    CHECK (categoria IS NULL OR categoria IN (
      'audiencia',
      'escrito_presentado',
      'resolucion_recibida',
      'prueba_incorporada',
      'consulta_agente',
      'respuesta_agente',
      'otro'
    ));

ALTER TABLE eventos_caso
  ADD COLUMN IF NOT EXISTS adjuntos JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN eventos_caso.tipo IS
  'Origen del evento: manual (lo crea el abogado), sistema (lo crea el server, ej: creación del caso), agente (es respuesta del LLM). NO confundir con la categoría procesal.';

COMMENT ON COLUMN eventos_caso.categoria IS
  'Categoría procesal del evento (audiencia, escrito_presentado, etc.). NULL para eventos previos al feature simulación procesal v1 y para eventos del sistema sin categoría procesal específica.';

COMMENT ON COLUMN eventos_caso.adjuntos IS
  'Array de { filename, storage_path, mime_type, size_bytes, descripcion } apuntando al bucket eventos-caso-adjuntos. Default array vacío.';

-- Bucket privado para archivos adjuntos a eventos. Path convention:
--   {usuario_id}/{caso_id}/{timestamp}_{filename_seguro}
--
-- Límite global por archivo: 10 MB (PDF). Imágenes y DOCX se filtran a
-- 5 MB del lado de la app (validación en el endpoint de signed URL).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'eventos-caso-adjuntos',
  'eventos-caso-adjuntos',
  false,
  10 * 1024 * 1024,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies del bucket: pendientes para PR2 cuando exista el flujo de
-- upload. Mientras tanto, server-side con service_role bypassea cualquier
-- policy de storage.objects, que matchea el patrón actual de la app.
