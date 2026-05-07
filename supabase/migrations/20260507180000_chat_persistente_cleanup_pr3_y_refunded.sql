-- PR4 sub-PR2: pivot a chat persistente.
--
-- Esta migración hace TODO en una transacción (Supabase apply_migration
-- envuelve el bloque en un BEGIN/COMMIT implícito):
--   1. Cleanup del flujo viejo del PR3 (validado por director: ya no
--      sirve, se reemplaza por el chat persistente).
--   2. Tighten constraints de eventos_caso (sacar los valores del
--      agente que ya no se usan más).
--   3. Tablas nuevas para el chat: conversaciones_caso + mensajes_conversacion.
--   4. Triggers de actualizada_en sobre conversaciones_caso.
--   5. Refunded: marcar las 4 ejecuciones fallidas históricas (3 del
--      1-may con error='LIMITE_BUSQUEDAS_EXCEDIDO', 1 del 7-may con
--      error_code='CAP_EXCEEDED_NO_SYNTHESIS') como reembolsadas.
--   6. Modificar v_consumo_mensual para excluir refunded del agregado.

-- ============================================================
-- 1. CLEANUP del flujo PR3 viejo
-- ============================================================

-- Borramos los 2 eventos del par consulta_agente/respuesta_agente
-- (1 caso afectado, sin adjuntos asociados — verificado pre-flight).
DELETE FROM eventos_caso
  WHERE categoria IN ('consulta_agente', 'respuesta_agente');

-- Borramos la 1 ejecución 'consulta_caso' del QA del director.
DELETE FROM ejecuciones
  WHERE tipo = 'consulta_caso';

-- ============================================================
-- 2. TIGHTEN constraints de eventos_caso
-- ============================================================

-- Sacamos 'agente' de tipo (origen): después del cleanup nadie lo
-- escribe más. El chat vive en sus propias tablas.
ALTER TABLE eventos_caso DROP CONSTRAINT IF EXISTS eventos_caso_tipo_check;
ALTER TABLE eventos_caso ADD CONSTRAINT eventos_caso_tipo_check
  CHECK (tipo IN ('manual', 'sistema'));

-- Sacamos 'consulta_agente' y 'respuesta_agente' de categoria.
ALTER TABLE eventos_caso DROP CONSTRAINT IF EXISTS eventos_caso_categoria_check;
ALTER TABLE eventos_caso ADD CONSTRAINT eventos_caso_categoria_check
  CHECK (categoria IS NULL OR categoria IN (
    'audiencia',
    'escrito_presentado',
    'resolucion_recibida',
    'prueba_incorporada',
    'otro'
  ));

COMMENT ON COLUMN eventos_caso.tipo IS
  'Origen del evento: manual (lo crea el abogado) o sistema (lo crea el server, ej: creación del caso). El antiguo valor "agente" se removió en PR4 sub-PR2 cuando el chat pasó a tablas dedicadas (conversaciones_caso + mensajes_conversacion).';

COMMENT ON COLUMN eventos_caso.categoria IS
  'Categoría procesal del evento (audiencia, escrito_presentado, resolucion_recibida, prueba_incorporada, otro). NULL para eventos previos al feature simulación procesal v1 y para eventos del sistema sin categoría procesal específica. Los antiguos valores consulta_agente/respuesta_agente se removieron en PR4 sub-PR2.';

-- ============================================================
-- 3. TABLAS NUEVAS — chat persistente
-- ============================================================

CREATE TABLE conversaciones_caso (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id         uuid NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  titulo          text NOT NULL,
  estado          text NOT NULL DEFAULT 'activa'
                    CHECK (estado IN ('activa', 'archivada')),
  creada_en       timestamptz NOT NULL DEFAULT now(),
  actualizada_en  timestamptz NOT NULL DEFAULT now(),
  archivada_en    timestamptz NULL
);

CREATE UNIQUE INDEX uq_conversacion_activa_por_caso
  ON conversaciones_caso (caso_id)
  WHERE estado = 'activa';

CREATE INDEX idx_conversaciones_caso
  ON conversaciones_caso(caso_id, creada_en DESC);

CREATE TABLE mensajes_conversacion (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id          uuid NOT NULL REFERENCES conversaciones_caso(id) ON DELETE CASCADE,
  rol                      text NOT NULL
                             CHECK (rol IN ('usuario', 'agente')),
  contenido                text NOT NULL,
  adjuntos                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  respuesta_estructurada   jsonb NULL,
  ejecucion_id             uuid NULL REFERENCES ejecuciones(id) ON DELETE SET NULL,
  creado_en                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mensajes_conv_orden
  ON mensajes_conversacion(conversacion_id, creado_en ASC);

COMMENT ON TABLE conversaciones_caso IS
  'Chat persistente entre el abogado y el agente sobre un caso. Una activa + N archivadas por caso (constraint via partial unique index).';
COMMENT ON TABLE mensajes_conversacion IS
  'Mensajes de una conversación, rol usuario o agente, adjuntos jsonb opcionales. Reemplaza el flujo viejo de eventos consulta_agente/respuesta_agente del PR3.';

-- ============================================================
-- 4. TRIGGER: bump actualizada_en de la conversación
-- ============================================================

CREATE OR REPLACE FUNCTION trg_mensajes_bump_conv_actualizada()
RETURNS TRIGGER AS $$
DECLARE
  conv_id_target uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    conv_id_target = OLD.conversacion_id;
  ELSE
    conv_id_target = NEW.conversacion_id;
  END IF;
  UPDATE conversaciones_caso
    SET actualizada_en = now()
    WHERE id = conv_id_target;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mensajes_bump_conv
  AFTER INSERT OR UPDATE OR DELETE ON mensajes_conversacion
  FOR EACH ROW
  EXECUTE FUNCTION trg_mensajes_bump_conv_actualizada();

-- ============================================================
-- 5. REFUNDED: 4 ejecuciones fallidas históricas
-- ============================================================

UPDATE ejecuciones
SET metadata = metadata
              || jsonb_build_object(
                   'refunded', true,
                   'refunded_at', now()::text,
                   'refund_reason', 'PR4 sub-PR2: ejecuciones fallidas historicas reembolsadas (LIMITE_BUSQUEDAS_EXCEDIDO / CAP_EXCEEDED_NO_SYNTHESIS)'
                 )
WHERE tipo = 'analizar_caso'
  AND (
    metadata->>'error_code' = 'CAP_EXCEEDED_NO_SYNTHESIS'
    OR metadata->>'error' = 'LIMITE_BUSQUEDAS_EXCEDIDO'
  );

-- ============================================================
-- 6. v_consumo_mensual: excluir refunded
-- ============================================================

CREATE OR REPLACE VIEW v_consumo_mensual AS
SELECT u.id AS usuario_id,
       u.nombre,
       u.limite_tokens_mensual,
       COALESCE(sum(e.total_tokens), 0::bigint) AS tokens_usados_mes,
       COALESCE(sum(e.costo_usd), 0::numeric) AS gasto_usd_mes,
       count(e.id) AS ejecuciones_mes,
       u.limite_tokens_mensual - COALESCE(sum(e.total_tokens), 0::bigint) AS tokens_restantes
  FROM usuarios u
       LEFT JOIN ejecuciones e
         ON e.usuario_id = u.id
        AND date_trunc('month'::text,
              (e.ejecutado_en AT TIME ZONE 'America/Argentina/Buenos_Aires'::text))
          = date_trunc('month'::text,
              (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'::text))
        AND COALESCE((e.metadata->>'refunded')::boolean, false) = false
 GROUP BY u.id, u.nombre, u.limite_tokens_mensual;

COMMENT ON VIEW v_consumo_mensual IS
  'Consumo mensual por usuario para el panel "Mi consumo" + rate-limit. Mes en zona Argentina (UTC-3). Excluye ejecuciones marcadas con metadata.refunded=true (reembolsos del director, ver MIGRATION_LOG.md).';
