-- Tablas para la feature "Mis casos" + selección de estrategia + timeline procesal manual.
-- Persiste el caso elegido por el abogado, la estrategia seleccionada (con snapshot
-- por si se borra la ejecución origen), y los eventos manuales del timeline procesal.
-- Eventos futuros podrán ser tipo 'sistema' o 'agente' (placeholders para próxima
-- iteración con conversación inteligente sobre el caso).

CREATE TABLE casos (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id                  uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo                      text NOT NULL,
  caso_descripcion            text NOT NULL,
  contexto                    jsonb,
  rol                         text NOT NULL CHECK (rol IN ('defensor', 'querellante', 'ambos')),
  ejecucion_origen_id         uuid REFERENCES ejecuciones(id) ON DELETE SET NULL,
  estrategia_seleccionada_rol text NOT NULL CHECK (estrategia_seleccionada_rol IN ('defensor', 'querellante')),
  estrategia_seleccionada_idx int  NOT NULL CHECK (estrategia_seleccionada_idx BETWEEN 0 AND 2),
  estrategia_snapshot         jsonb NOT NULL,
  creado_en                   timestamptz NOT NULL DEFAULT now(),
  actualizado_en              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_casos_usuario_creado ON casos(usuario_id, creado_en DESC);

CREATE TABLE eventos_caso (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id     uuid NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  tipo        text NOT NULL DEFAULT 'manual' CHECK (tipo IN ('manual', 'sistema', 'agente')),
  descripcion text NOT NULL,
  ocurrido_en timestamptz NOT NULL,
  estado      text NOT NULL DEFAULT 'sucedido' CHECK (estado IN ('sucedido', 'pendiente')),
  creado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_eventos_caso_caso_ocurrido ON eventos_caso(caso_id, ocurrido_en ASC);

-- Trigger 1: cualquier UPDATE sobre `casos` actualiza casos.actualizado_en.
CREATE OR REPLACE FUNCTION trg_casos_set_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER casos_set_actualizado_en
  BEFORE UPDATE ON casos
  FOR EACH ROW
  EXECUTE FUNCTION trg_casos_set_actualizado_en();

-- Trigger 2: INSERT/UPDATE/DELETE sobre eventos_caso bumpea casos.actualizado_en
-- del caso padre. Esto deja la columna casos.actualizado_en como "última actividad
-- del caso" (incluye agregar y borrar eventos), no solo edición de campos del caso.
CREATE OR REPLACE FUNCTION trg_eventos_bump_caso_actualizado()
RETURNS TRIGGER AS $$
DECLARE
  caso_id_target uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    caso_id_target = OLD.caso_id;
  ELSE
    caso_id_target = NEW.caso_id;
  END IF;
  UPDATE casos SET actualizado_en = now() WHERE id = caso_id_target;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER eventos_caso_bump_caso
  AFTER INSERT OR UPDATE OR DELETE ON eventos_caso
  FOR EACH ROW
  EXECUTE FUNCTION trg_eventos_bump_caso_actualizado();
