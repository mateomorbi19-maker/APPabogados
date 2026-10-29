-- Carga directa de causas revisadas, sin análisis ni estrategia inventados.
-- PENDIENTE: ejecutar a mano en SQL Editor y verificar (MIGRATION_LOG.md).
-- No requiere la migración pendiente de contacto/reportes. No toca documentos.
-- Archivo creado manualmente conforme al flujo del repo (sin Supabase CLI).
BEGIN;

ALTER TABLE public.casos
  ALTER COLUMN estrategia_seleccionada_rol DROP NOT NULL,
  ALTER COLUMN estrategia_seleccionada_idx DROP NOT NULL,
  ALTER COLUMN estrategia_snapshot DROP NOT NULL;

ALTER TABLE public.casos DROP CONSTRAINT IF EXISTS casos_estrategia_completa_check;
ALTER TABLE public.casos ADD CONSTRAINT casos_estrategia_completa_check CHECK (
  (estrategia_seleccionada_rol IS NULL AND estrategia_seleccionada_idx IS NULL AND estrategia_snapshot IS NULL)
  OR
  (estrategia_seleccionada_rol IS NOT NULL AND estrategia_seleccionada_idx IS NOT NULL AND estrategia_snapshot IS NOT NULL)
);

-- Extender cada CHECK de tipo conservando su expresión real: no se retiran
-- valores de migraciones previas, incluso si hay drift entre repo y base.
DO $$
DECLARE
  c record;
  encontro boolean := false;
BEGIN
  FOR c IN
    SELECT con.conname, pg_get_expr(con.conbin, con.conrelid) AS expresion
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attname = 'tipo'
     WHERE con.conrelid = 'public.ejecuciones'::regclass AND con.contype = 'c'
       AND con.conkey = ARRAY[a.attnum]::smallint[]
  LOOP
    encontro := true;
    IF position('importar_causa' IN c.expresion) = 0 THEN
      EXECUTE format('ALTER TABLE public.ejecuciones DROP CONSTRAINT %I', c.conname);
      EXECUTE format('ALTER TABLE public.ejecuciones ADD CONSTRAINT %I CHECK ((%s) OR tipo = %L)',
                     c.conname, c.expresion, 'importar_causa');
    END IF;
  END LOOP;
  IF NOT encontro THEN
    ALTER TABLE public.ejecuciones ADD CONSTRAINT ejecuciones_tipo_check CHECK (tipo IN (
      'pre_analisis', 'analizar_caso', 'consulta_caso', 'simular_mapa',
      'simular_audiencia', 'lexie', 'generar_escrito', 'reporte_cliente', 'importar_causa'
    ));
  END IF;
END $$;

-- El trigger previo refería a `casos` sin esquema y heredaría el search_path
-- vacío de la RPC. Calificar la tabla conserva el bump del timeline.
CREATE OR REPLACE FUNCTION public.trg_eventos_bump_caso_actualizado()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE caso_id_target uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN caso_id_target := OLD.caso_id;
  ELSE caso_id_target := NEW.caso_id;
  END IF;
  UPDATE public.casos SET actualizado_en = now() WHERE id = caso_id_target;
  IF TG_OP = 'DELETE' THEN RETURN OLD;
  ELSE RETURN NEW;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.crear_causa_importada(
  p_id uuid,
  p_usuario_id uuid,
  p_ficha jsonb,
  p_adjunto jsonb,
  p_huella text,
  p_solo_validar boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  existente public.casos%ROWTYPE;
  parte jsonb;
  clave text;
  prefijo text;
BEGIN
  -- Preflight de disponibilidad/permisos: el endpoint lo llama ANTES del
  -- modelo con ficha vacía. No valida un borrador ni escribe ninguna fila.
  IF p_solo_validar IS TRUE THEN RETURN NULL; END IF;

  IF p_id IS NULL OR p_usuario_id IS NULL OR p_huella IS NULL
     OR p_huella !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Identidad o huella de carga inválida' USING ERRCODE = '22023';
  END IF;

  -- El mismo id serializa reintentos, también cuando todavía no hay fila.
  -- Las colisiones del hash sólo serializan cargas independientes.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text, 0));
  SELECT * INTO existente FROM public.casos WHERE id = p_id FOR UPDATE;
  IF FOUND THEN
    IF existente.usuario_id = p_usuario_id
       AND existente.contexto #>> '{carga_inicial,huella}' = p_huella THEN
      RETURN p_id;
    END IF;
    RAISE EXCEPTION 'El intento de carga ya existe con otro contenido o propietario' USING ERRCODE = '23505';
  END IF;

  IF p_ficha IS NULL OR jsonb_typeof(p_ficha) <> 'object' THEN
    RAISE EXCEPTION 'Ficha inválida' USING ERRCODE = '22023';
  END IF;
  -- Validación adicional al Zod del borde. No se convierte un JSON libre en
  -- una fila: más abajo las columnas están enumeradas explícitamente.
  IF jsonb_typeof(p_ficha->'titulo') IS DISTINCT FROM 'string'
     OR length(btrim(p_ficha->>'titulo')) = 0
     OR jsonb_typeof(p_ficha->'caso_descripcion') IS DISTINCT FROM 'string'
     OR length(btrim(p_ficha->>'caso_descripcion')) NOT BETWEEN 1 AND 50000
     OR (p_ficha->>'rol') IS NULL OR (p_ficha->>'rol') NOT IN ('defensor', 'querellante', 'ambos')
     OR (p_ficha->>'estado_seguimiento') IS NULL
     OR (p_ficha->>'estado_seguimiento') NOT IN ('activa', 'en_espera', 'archivada')
     OR jsonb_typeof(p_ficha->'delitos') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_ficha->'partes') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Faltan datos requeridos de la ficha' USING ERRCODE = '22023';
  END IF;
  IF p_ficha->>'fuero' IS NOT NULL AND p_ficha->>'fuero' NOT IN ('nacion', 'pba', 'federal') THEN
    RAISE EXCEPTION 'Fuero inválido' USING ERRCODE = '22023';
  END IF;
  FOREACH clave IN ARRAY ARRAY['caratula', 'expediente_numero', 'organismo', 'secretaria', 'juez', 'fiscalia', 'fuero'] LOOP
    IF p_ficha ? clave AND jsonb_typeof(p_ficha->clave) NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'Campo de ficha inválido: %', clave USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_ficha->'delitos') d WHERE jsonb_typeof(d) <> 'string') THEN
    RAISE EXCEPTION 'Delitos inválidos' USING ERRCODE = '22023';
  END IF;
  FOR parte IN SELECT value FROM jsonb_array_elements(p_ficha->'partes') LOOP
    IF jsonb_typeof(parte) <> 'object'
       OR jsonb_typeof(parte->'nombre') IS DISTINCT FROM 'string'
       OR length(btrim(parte->>'nombre')) = 0
       OR (parte->>'rol') IS NULL
       OR (parte->>'rol') NOT IN ('imputado', 'victima', 'querellante', 'denunciante', 'testigo', 'otro')
       OR jsonb_typeof(parte->'es_cliente') IS DISTINCT FROM 'boolean'
       OR (parte ? 'documento' AND jsonb_typeof(parte->'documento') NOT IN ('string', 'null'))
       OR (parte ? 'situacion_libertad' AND jsonb_typeof(parte->'situacion_libertad') NOT IN ('string', 'null'))
       OR (parte->>'situacion_libertad' IS NOT NULL AND parte->>'situacion_libertad' NOT IN (
         'libre', 'detenido', 'prision_preventiva', 'prision_domiciliaria', 'excarcelado'
       )) THEN
      RAISE EXCEPTION 'Persona de la ficha inválida' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF p_adjunto IS NOT NULL THEN
    prefijo := p_usuario_id::text || '/' || p_id::text || '/';
    IF jsonb_typeof(p_adjunto) <> 'object'
       OR (p_adjunto->>'mime_type') IS DISTINCT FROM 'application/pdf'
       OR jsonb_typeof(p_adjunto->'filename') IS DISTINCT FROM 'string'
       OR length(btrim(p_adjunto->>'filename')) = 0
       OR jsonb_typeof(p_adjunto->'storage_path') IS DISTINCT FROM 'string'
       OR left(p_adjunto->>'storage_path', length(prefijo)) IS DISTINCT FROM prefijo
       OR length(p_adjunto->>'storage_path') <= length(prefijo)
       OR position('..' IN p_adjunto->>'storage_path') > 0
       OR position(E'\\' IN p_adjunto->>'storage_path') > 0
       OR lower(right(p_adjunto->>'storage_path', 4)) <> '.pdf'
       OR jsonb_typeof(p_adjunto->'size_bytes') IS DISTINCT FROM 'number'
       OR jsonb_typeof(p_adjunto->'descripcion') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Adjunto PDF inválido' USING ERRCODE = '22023';
    END IF;
    IF (p_adjunto->>'size_bytes')::numeric NOT BETWEEN 1 AND 10485760
       OR (p_adjunto->>'size_bytes')::numeric <> trunc((p_adjunto->>'size_bytes')::numeric) THEN
      RAISE EXCEPTION 'Tamaño PDF inválido' USING ERRCODE = '22023';
    END IF;
    -- Persistir sólo los metadatos admitidos, aunque el caller enviara más.
    p_adjunto := jsonb_build_object(
      'filename', p_adjunto->>'filename', 'storage_path', p_adjunto->>'storage_path',
      'mime_type', 'application/pdf', 'size_bytes', p_adjunto->'size_bytes',
      'descripcion', p_adjunto->>'descripcion'
    );
  END IF;

  INSERT INTO public.casos (
    id, usuario_id, titulo, caso_descripcion, rol, contexto,
    ejecucion_origen_id, estrategia_seleccionada_rol, estrategia_seleccionada_idx, estrategia_snapshot,
    caratula, expediente_numero, organismo, secretaria, juez, fiscalia, delitos, fuero, estado_seguimiento
  ) VALUES (
    p_id, p_usuario_id, btrim(p_ficha->>'titulo'), btrim(p_ficha->>'caso_descripcion'), p_ficha->>'rol',
    jsonb_build_object('carga_inicial', jsonb_build_object('huella', p_huella)),
    NULL, NULL, NULL, NULL,
    p_ficha->>'caratula', p_ficha->>'expediente_numero', p_ficha->>'organismo',
    p_ficha->>'secretaria', p_ficha->>'juez', p_ficha->>'fiscalia',
    ARRAY(SELECT jsonb_array_elements_text(p_ficha->'delitos')), p_ficha->>'fuero', p_ficha->>'estado_seguimiento'
  );
  INSERT INTO public.partes_caso (caso_id, nombre, rol, es_cliente, situacion_libertad, documento)
    SELECT p_id, btrim(p->>'nombre'), p->>'rol', (p->>'es_cliente')::boolean,
           p->>'situacion_libertad', p->>'documento'
      FROM jsonb_array_elements(p_ficha->'partes') p;
  INSERT INTO public.eventos_caso (caso_id, tipo, categoria, descripcion, ocurrido_en, estado, adjuntos)
    VALUES (p_id, 'sistema', NULL,
      'Causa incorporada al estudio a partir de la ficha revisada por el abogado.', now(), 'sucedido',
      CASE WHEN p_adjunto IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(p_adjunto) END);
  -- No se crea mapa ni etapa: la etapa procesal siempre la deriva el mapa.
  RETURN p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.crear_causa_importada(uuid, uuid, jsonb, jsonb, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crear_causa_importada(uuid, uuid, jsonb, jsonb, text, boolean)
  TO service_role;

COMMIT;
