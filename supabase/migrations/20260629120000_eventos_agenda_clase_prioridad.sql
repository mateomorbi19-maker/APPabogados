-- Feature: Tareas en la agenda (además de eventos).
-- Cambio ADITIVO sobre eventos_agenda. Introduce dos ejes nuevos:
--   * `clase`: distingue una TAREA (algo para hacer en una fecha, sin hora, con
--     prioridad, que NO sincroniza con Google) de un EVENTO (cita con franja
--     horaria, que es lo que la tabla modelaba hasta ahora y SÍ sincroniza).
--   * `prioridad`: aplica a ambos.
-- NOT NULL DEFAULT → las filas existentes quedan como eventos de prioridad media
-- automáticamente, sin migración de datos (mismo patrón que mapa.riesgo_alto).

ALTER TABLE eventos_agenda
  ADD COLUMN clase TEXT NOT NULL DEFAULT 'evento'
    CHECK (clase IN ('evento', 'tarea')),
  ADD COLUMN prioridad TEXT NOT NULL DEFAULT 'media'
    CHECK (prioridad IN ('alta', 'media', 'baja'));

-- El listado filtra por usuario_id + (opcional) clase y ordena por fecha_inicio.
-- El índice existente idx_eventos_agenda_usuario_fecha (usuario_id, fecha_inicio)
-- ya cubre ese acceso; con clase de cardinalidad 2 y 3 usuarios no hace falta un
-- índice nuevo.

COMMENT ON COLUMN eventos_agenda.clase IS
  'Discriminador: evento (cita con hora, sincroniza con Google Calendar) | tarea (to-do por fecha, todo_el_dia, sin sync).';
COMMENT ON COLUMN eventos_agenda.prioridad IS
  'Prioridad de presentación: alta | media | baja. Aplica a tareas y eventos.';
