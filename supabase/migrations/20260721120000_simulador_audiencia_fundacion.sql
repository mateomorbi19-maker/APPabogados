-- Paso 1 del Simulador de Audiencias (HearSim): fundación de datos.
--
-- Agrega el tipo de tracking `simular_audiencia` y las dos tablas del módulo:
-- la SESIÓN (simulaciones_audiencia) y su TRANSCRIPT (turnos_simulacion).
--
-- Precedente seguido: conversaciones_caso / mensajes_conversacion
-- (20260507180000). Igual que allá:
--   · el ownership NO se denormaliza — se resuelve por join
--     turnos_simulacion -> simulaciones_audiencia -> casos.usuario_id;
--   · la tabla hija tiene FK nullable a `ejecuciones` para linkear el turno
--     con su fila de tracking de tokens;
--   · un trigger bumpea `actualizada_en` de la sesión ante cualquier
--     INSERT/UPDATE/DELETE de turnos.
--
-- DIFERENCIA DELIBERADA con aquel precedente: `turnos_simulacion` SÍ tiene
-- columna `metadata jsonb`. `mensajes_conversacion` no la tiene y eso obligó a
-- meter toda la metadata de cada corrida en `ejecuciones.metadata`, dejando el
-- mensaje sin lugar propio para datos del turno (objeciones, fase de la
-- audiencia, scoring parcial). Acá se reserva desde el día uno.
--
-- ESTE ARCHIVO NO FUE EJECUTADO por Claude Code. Lo corre Mateo a mano en el
-- SQL Editor de Supabase (ver MIGRATION_LOG.md).

-- ============================================================
-- 1. ejecuciones.tipo — sumar 'simular_audiencia'
-- ============================================================
-- Mismo patrón defensivo que 20260706190000: el DO block busca y borra el
-- CHECK vigente de `tipo` POR DEFINICIÓN (el nombre puede diferir del default
-- por el drift repo↔DB) y lo recrea con el set completo. Idempotente: correrlo
-- N veces deja siempre el mismo constraint.

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
    'simular_audiencia'
  ));

-- ============================================================
-- 2. TABLA DE SESIÓN — simulaciones_audiencia
-- ============================================================

CREATE TABLE simulaciones_audiencia (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id            uuid NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  -- Allowlist que crece con cada tipo de audiencia soportado. Arranca con la
  -- única implementada; agregar un tipo nuevo es recrear este CHECK.
  tipo_audiencia     text NOT NULL DEFAULT 'prision_preventiva'
                       CHECK (tipo_audiencia IN ('prision_preventiva')),
  -- Rol que asume el ABOGADO USUARIO dentro de la simulación. NO confundir
  -- con casos.rol, que es la perspectiva desde la que se pidió el análisis
  -- ('defensor' | 'querellante' | 'ambos') y no admite 'fiscal'.
  rol_usuario        text NOT NULL
                       CHECK (rol_usuario IN ('defensa', 'fiscal', 'querellante')),
  dificultad         text NOT NULL DEFAULT 'b_estandar'
                       CHECK (dificultad IN ('a_guiada', 'b_estandar', 'c_adversarial')),
  magistrado_perfil  text NOT NULL DEFAULT 'neutro'
                       CHECK (magistrado_perfil IN ('garantista', 'restrictivo', 'neutro')),
  estado             text NOT NULL DEFAULT 'en_curso'
                       CHECK (estado IN ('en_curso', 'finalizada', 'abandonada')),
  -- Devolución post-audiencia generada al cerrar la sesión. NULL mientras
  -- `estado = 'en_curso'`.
  debriefing         jsonb NULL,
  creada_en          timestamptz NOT NULL DEFAULT now(),
  actualizada_en     timestamptz NOT NULL DEFAULT now(),
  finalizada_en      timestamptz NULL
);

-- Listado de simulaciones de un caso, más reciente primero (mismo patrón que
-- idx_conversaciones_caso).
CREATE INDEX idx_simulaciones_caso
  ON simulaciones_audiencia (caso_id, creada_en DESC);

-- ============================================================
-- 3. TABLA DE TRANSCRIPT — turnos_simulacion
-- ============================================================

CREATE TABLE turnos_simulacion (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulacion_id  uuid NOT NULL REFERENCES simulaciones_audiencia(id) ON DELETE CASCADE,
  -- Quién habla. 'usuario' es el abogado real; el resto son personajes que
  -- encarna el modelo. 'sistema' queda para acotaciones de sala / marcas de
  -- fase que no son diálogo de nadie.
  emisor         text NOT NULL
                   CHECK (emisor IN (
                     'usuario',
                     'juez',
                     'secretario',
                     'fiscal',
                     'querellante',
                     'defensor',
                     'imputado',
                     'testigo',
                     'perito',
                     'sistema'
                   )),
  -- Nombre del personaje cuando el `emisor` no lo identifica solo (p. ej.
  -- varios testigos en la misma audiencia). NULL si no aplica.
  emisor_nombre  text NULL,
  contenido      text NOT NULL,
  -- Datos propios del turno (fase de la audiencia, objeciones, scoring
  -- parcial, etc.). Ver la nota de cabecera: es la corrección explícita a la
  -- ausencia de `metadata` en mensajes_conversacion.
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ejecucion_id   uuid NULL REFERENCES ejecuciones(id) ON DELETE SET NULL,
  creado_en      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_turnos_simulacion
  ON turnos_simulacion (simulacion_id, creado_en);

COMMENT ON TABLE simulaciones_audiencia IS
  'Sesión del Simulador de Audiencias (HearSim) sobre un caso. Guarda la configuración elegida (tipo de audiencia, rol del abogado, dificultad, perfil del magistrado), el estado del ciclo de vida y el debriefing final. El ownership se resuelve por join a casos.usuario_id, sin denormalizar.';
COMMENT ON TABLE turnos_simulacion IS
  'Transcript de una simulación: un turno por intervención, con el emisor (el abogado usuario o un personaje encarnado por el modelo) y metadata jsonb propia del turno. Linkea a ejecuciones por ejecucion_id para el tracking de tokens.';

-- ============================================================
-- 4. TRIGGER: bump actualizada_en de la simulación
-- ============================================================
-- Réplica de trg_mensajes_bump_conv_actualizada (20260507180000:102-125).

CREATE OR REPLACE FUNCTION trg_turnos_bump_sim_actualizada()
RETURNS TRIGGER AS $$
DECLARE
  sim_id_target uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    sim_id_target = OLD.simulacion_id;
  ELSE
    sim_id_target = NEW.simulacion_id;
  END IF;
  UPDATE simulaciones_audiencia
    SET actualizada_en = now()
    WHERE id = sim_id_target;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER turnos_bump_sim
  AFTER INSERT OR UPDATE OR DELETE ON turnos_simulacion
  FOR EACH ROW
  EXECUTE FUNCTION trg_turnos_bump_sim_actualizada();

-- ============================================================
-- 5. RLS deny-by-default
-- ============================================================
-- Consistente con el hardening de Fase 5.5 (eventos_agenda 20260610120000:42,
-- mapa_procesal_nodos 20260610130000:34): habilitada SIN policies. El server
-- accede siempre con service_role (bypassa RLS); ningún rol anon/authenticated
-- puede leer ni escribir directo.
--
-- NOTA: conversaciones_caso / mensajes_conversacion no traen este ALTER en su
-- migración porque son anteriores a la Fase 5.5. Se sigue la convención
-- vigente, no la de aquel archivo.

ALTER TABLE simulaciones_audiencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE turnos_simulacion ENABLE ROW LEVEL SECURITY;
