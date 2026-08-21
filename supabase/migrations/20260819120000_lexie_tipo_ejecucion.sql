-- 8.0 — LEXIE: el asistente global necesita su propio tipo de ejecución.
--
-- ESTE ARCHIVO NO FUE EJECUTADO por Claude Code. Lo corre Mateo a mano en el
-- SQL Editor de Supabase (ver MIGRATION_LOG.md).
--
-- Por qué esta migración va PRIMERO, antes de una sola línea de código: el
-- CHECK de `ejecuciones.tipo` es lo único que separa un turno de LEXIE de un
-- 500. La ruta persiste la ejecución DESPUÉS de cobrarle los tokens al
-- usuario, así que un INSERT rechazado por el constraint no es un error
-- cosmético: son tokens facturados por Anthropic que no quedan registrados en
-- ninguna fila, y por lo tanto no descuentan del cupo mensual ni aparecen en
-- /api/consumo. Ya pasó con `riesgo_alto` del mapa (leer un SELECT antes de
-- correr la migración = 500 en todos los reads).
--
-- El tipo es 'lexie' y no 'consulta_global' o 'asistente' a propósito: los
-- otros cinco valores nombran la ACCIÓN (pre_analisis, analizar_caso), pero
-- LEXIE no es una acción, es un interlocutor. Un turno suyo puede haber sido
-- una consulta a la agenda, una búsqueda de jurisprudencia o las dos cosas;
-- lo que tienen en común es quién lo atendió, no qué se pidió. El desglose
-- fino de qué hizo el turno vive en metadata.tools_usadas.

-- ============================================================
-- ejecuciones.tipo — sumar 'lexie'
-- ============================================================
-- Mismo patrón defensivo que 20260706190000 y 20260721120000: el DO block
-- busca y borra el CHECK vigente de `tipo` POR DEFINICIÓN (el nombre puede
-- diferir del default por el drift repo↔DB) y lo recrea con el set completo.
-- Idempotente: correrlo N veces deja siempre el mismo constraint.
--
-- Los cinco valores previos están verificados contra la base real
-- (2026-08-19, proyecto xvdlnevcvcsgxbngwliv), no copiados del repo:
--   pre_analisis 62 · analizar_caso 48 · consulta_caso 19 ·
--   simular_audiencia 7 · simular_mapa 6
-- Los cinco están EN USO, así que ninguno se puede omitir al recrear el CHECK.

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'ejecuciones'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%tipo%'
  LOOP
    EXECUTE format('ALTER TABLE ejecuciones DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE ejecuciones ADD CONSTRAINT ejecuciones_tipo_check
  CHECK (tipo IN (
    'pre_analisis',
    'analizar_caso',
    'consulta_caso',
    'simular_mapa',
    'simular_audiencia',
    'lexie'
  ));

-- ============================================================
-- Verificación (correr después, debe devolver el CHECK con los 6 valores)
-- ============================================================
-- SELECT pg_get_constraintdef(con.oid)
-- FROM pg_constraint con
-- JOIN pg_class rel ON rel.oid = con.conrelid
-- WHERE rel.relname = 'ejecuciones' AND con.contype = 'c'
--   AND pg_get_constraintdef(con.oid) ILIKE '%tipo%';

-- ============================================================
-- CONVERSACIONES DE LEXIE
-- ============================================================
-- LEXIE es un interlocutor GLOBAL: sus conversaciones no cuelgan de ninguna
-- causa. Van en tablas propias y no reusando `conversaciones_caso` con
-- `caso_id` nullable, por tres motivos concretos:
--
--   1. `conversaciones_caso` tiene un partial unique index que garantiza UNA
--      conversación activa por caso. Con caso_id NULL ese índice no aplica y
--      la invariante que protege se pierde en silencio para las filas nuevas.
--   2. `mensajes_conversacion` guarda `respuesta_estructurada` con las
--      `acciones` del mapa procesal, que es un concepto que en LEXIE no existe.
--   3. Los dos agentes van a evolucionar por separado: el del caso hacia la
--      escritura del mapa, LEXIE hacia agenda y correo. Compartir tabla los
--      ata sin que nada lo pida.
--
-- El costo es duplicar dos tablas chicas. El beneficio es que ninguna de las
-- dos features puede romper a la otra por schema.

CREATE TABLE IF NOT EXISTS conversaciones_lexie (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  -- Lo pone el servidor con las primeras palabras del abogado. Nullable
  -- porque la conversación existe antes del primer mensaje.
  titulo         text,
  archivada      boolean NOT NULL DEFAULT false,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

-- El caso de uso real: "traeme la conversación abierta de este abogado".
CREATE INDEX IF NOT EXISTS idx_conv_lexie_usuario_activa
  ON conversaciones_lexie (usuario_id, actualizado_en DESC)
  WHERE archivada = false;

CREATE TABLE IF NOT EXISTS mensajes_lexie (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id uuid NOT NULL REFERENCES conversaciones_lexie(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN ('usuario', 'agente')),
  contenido       text NOT NULL,
  -- Del lado del agente: busquedas, consultas_repositorio, herramientas_usadas,
  -- degraded_response. Del lado del usuario: {} .
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en       timestamptz NOT NULL DEFAULT now()
);

-- El historial se lee siempre completo y en orden para rearmar el contexto.
CREATE INDEX IF NOT EXISTS idx_mensajes_lexie_conv
  ON mensajes_lexie (conversacion_id, creado_en ASC);

-- Hardening consistente con la Fase 5.5: deny-by-default y sin acceso desde
-- los roles públicos. El server entra siempre con la service_role key, que
-- bypassa RLS; esto cierra la puerta de PostgREST.
ALTER TABLE conversaciones_lexie ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensajes_lexie ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON conversaciones_lexie FROM anon, authenticated;
REVOKE ALL ON mensajes_lexie FROM anon, authenticated;
