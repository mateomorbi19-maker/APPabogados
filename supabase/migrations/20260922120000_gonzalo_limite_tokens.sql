-- Gonzalo se quedó sin cupo mensual el 2026-09-22 y la app le devuelve 429
-- en todo lo que gasta tokens (análisis, chat, LEXIE, escritos, reportes,
-- simulador). El cupo es `usuarios.limite_tokens_mensual` (1.000.000 desde
-- el schema original) y lo aplica `enforceTokenLimit` leyendo
-- `v_consumo_mensual`: tokens_restantes <= 0 → 429.
--
-- Se le sube el tope a 3.000.000 en vez de marcar sus ejecuciones como
-- `refunded`: el consumo fue real y tiene que seguir viéndose en «Mi consumo»
-- y en el panel admin. `refunded` es para ejecuciones que fallaron por un bug
-- nuestro (ver 20260507180000 y 20260508000000), no para uso legítimo.
--
-- Efecto inmediato: la vista no es materializada y el server la consulta en
-- cada request, así que al aplicar esto Gonzalo vuelve a tener cupo en el
-- próximo pedido (con recargar la página alcanza). Es permanente: si en
-- octubre se lo quiere volver a 1.000.000 es el mismo UPDATE con ese número.
--
-- Se identifica por email, que es el identificador de la whitelist
-- (idx_usuarios_email_lower). Idempotente: sólo sube, nunca baja.

UPDATE usuarios
   SET limite_tokens_mensual = 3000000
 WHERE LOWER(email) = 'gonzalo.ezequiel.brandoni@gmail.com'
   AND limite_tokens_mensual < 3000000;

-- Verificación (debe devolver a Gonzalo con limite 3000000 y
-- tokens_restantes > 0):
--
-- SELECT nombre, limite_tokens_mensual, tokens_usados_mes, tokens_restantes,
--        ejecuciones_mes, gasto_usd_mes
--   FROM v_consumo_mensual
--  WHERE nombre = 'Gonzalo';
