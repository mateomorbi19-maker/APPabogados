-- Cambia v_consumo_mensual para que el corte de "mes en curso" use hora
-- Argentina (UTC-3) en lugar de UTC. Antes: el contador se reseteaba a las
-- 21:00 hora local del último día del mes (cuando UTC pasaba a mes nuevo).
-- Ahora: se resetea a las 00:00 hora local Argentina, como espera el usuario.
--
-- Implementación: comparación de DATE_TRUNC('month', ...) en hora Argentina
-- en ambas puntas del JOIN (NOW() y ejecutado_en).

CREATE OR REPLACE VIEW public.v_consumo_mensual AS
SELECT
  u.id AS usuario_id,
  u.nombre,
  u.limite_tokens_mensual,
  COALESCE(SUM(e.total_tokens), 0::bigint) AS tokens_usados_mes,
  COALESCE(SUM(e.costo_usd), 0::numeric) AS gasto_usd_mes,
  COUNT(e.id) AS ejecuciones_mes,
  u.limite_tokens_mensual - COALESCE(SUM(e.total_tokens), 0::bigint) AS tokens_restantes
FROM usuarios u
LEFT JOIN ejecuciones e
  ON e.usuario_id = u.id
  AND DATE_TRUNC('month', e.ejecutado_en AT TIME ZONE 'America/Argentina/Buenos_Aires')
      = DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')
GROUP BY u.id, u.nombre, u.limite_tokens_mensual;
