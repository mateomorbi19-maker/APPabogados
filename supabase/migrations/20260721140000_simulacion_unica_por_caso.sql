-- Simulador de Audiencias — invariante "1 simulación en curso por caso".
--
-- Calcado de uq_conversacion_activa_por_caso (20260507180000:71-73): partial
-- unique index sobre el estado vivo. Refuerza en DB lo que la ruta ya hace en
-- código (POST /simulacion abandona la sesión en curso antes de crear otra) y
-- vuelve segura la race de dos POST concurrentes: el segundo insert falla acá
-- en vez de dejar dos audiencias abiertas sobre el mismo expediente.
--
-- Se usa CREATE UNIQUE INDEX plano (sin IF NOT EXISTS) siguiendo el
-- precedente del repo: correrlo dos veces falla ruidosamente, que es la señal
-- correcta para una migración que se aplica a mano en el SQL Editor.
--
-- Si la creación fallara por datos preexistentes (más de una fila 'en_curso'
-- para un mismo caso_id), resolver primero con:
--   UPDATE simulaciones_audiencia SET estado = 'abandonada'
--     WHERE estado = 'en_curso' AND id NOT IN (
--       SELECT DISTINCT ON (caso_id) id FROM simulaciones_audiencia
--        WHERE estado = 'en_curso' ORDER BY caso_id, creada_en DESC);
--
-- ESTE ARCHIVO NO FUE EJECUTADO por Claude Code. Lo corre Mateo a mano en el
-- SQL Editor de Supabase (ver MIGRATION_LOG.md).

CREATE UNIQUE INDEX uq_simulacion_en_curso_por_caso
  ON simulaciones_audiencia (caso_id)
  WHERE estado = 'en_curso';
