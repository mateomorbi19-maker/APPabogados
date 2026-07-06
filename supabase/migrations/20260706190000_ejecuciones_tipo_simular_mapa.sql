-- Fase C del mapa procesal: la simulación de ramas con IA se trackea en
-- ejecuciones con tipo='simular_mapa' (tokens reales + costo, como el resto).
-- El DO block busca y borra el CHECK vigente de `tipo` por definición (el
-- nombre puede diferir del default por el drift repo↔DB) y lo recrea con el
-- valor nuevo incluido.
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
  CHECK (tipo IN ('pre_analisis', 'analizar_caso', 'consulta_caso', 'simular_mapa'));
