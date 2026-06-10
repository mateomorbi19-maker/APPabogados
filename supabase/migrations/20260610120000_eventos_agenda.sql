-- Feature: Agenda con integración Google Calendar.
-- Tabla de eventos de agenda del abogado (audiencias, vencimientos, reuniones, etc.).
--
-- DECISIÓN DE MODELO: ownership por `usuario_id UUID` (FK a usuarios), NO por el
-- Clerk userId TEXT del prompt original. Se alineó con el patrón del resto de la
-- app (casos, ejecuciones usan usuario_id UUID vía requireUsuarioOr403). Esto hace
-- trivial validar que el `caso_id` asociado pertenece al mismo usuario, sin tener
-- que resolver Clerk userId -> usuario_id en cada request.

CREATE TABLE eventos_agenda (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  caso_id UUID REFERENCES casos(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  tipo TEXT NOT NULL DEFAULT 'otro'
    CHECK (tipo IN (
      'audiencia',
      'vencimiento_procesal',
      'presentacion_escrito',
      'reunion_cliente',
      'tramite_administrativo',
      'visita_detenido',
      'otro'
    )),
  fecha_inicio TIMESTAMPTZ NOT NULL,
  fecha_fin TIMESTAMPTZ,
  todo_el_dia BOOLEAN DEFAULT FALSE,
  google_calendar_event_id TEXT,
  notas TEXT,
  completado BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_eventos_agenda_usuario_fecha ON eventos_agenda(usuario_id, fecha_inicio);
CREATE INDEX idx_eventos_agenda_caso ON eventos_agenda(caso_id) WHERE caso_id IS NOT NULL;

-- RLS deny-by-default, consistente con el hardening de Fase 5.5: habilitada sin
-- policies. El server SIEMPRE accede con service_role (bypassa RLS); ningún rol
-- anon/authenticated puede leer ni escribir directo.
ALTER TABLE eventos_agenda ENABLE ROW LEVEL SECURITY;
