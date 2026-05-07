-- Reembolso de las ejecuciones tipo='consulta_caso' que fallaron por
-- parseo_error antes del fix fix/chat-respuesta-adaptable. La causa
-- raíz era el system prompt que forzaba JSON estructurado para
-- preguntas conversacionales — el modelo respondía en prosa y el
-- parser fallaba. Post-fix el agente adapta el modo (conversacional
-- vs análisis estructurado).
--
-- v_consumo_mensual ya excluye filas con metadata.refunded=true (ver
-- migración 20260507180000). No requiere modificar la vista.

UPDATE ejecuciones
SET metadata = metadata || jsonb_build_object(
  'refunded', true,
  'refunded_at', now()::text,
  'refund_reason', 'CHAT_PARSEO_ERROR_PRE_FIX_ADAPTABLE'
)
WHERE tipo = 'consulta_caso'
  AND metadata->>'parseo_error' IS NOT NULL
  AND COALESCE((metadata->>'refunded')::boolean, false) = false;
