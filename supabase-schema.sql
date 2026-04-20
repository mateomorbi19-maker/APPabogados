-- EstrategiaLegal — schema de tracking de usuarios y consumo
-- Idempotente: se puede correr varias veces sin romper nada.

CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL UNIQUE,
  limite_tokens_mensual INTEGER NOT NULL DEFAULT 1000000,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO usuarios (nombre, limite_tokens_mensual) VALUES
  ('Lautaro', 1000000),
  ('Gonzalo', 1000000),
  ('Mateo', 1000000)
ON CONFLICT (nombre) DO NOTHING;

CREATE TABLE IF NOT EXISTS ejecuciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  modelo TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
  costo_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  latencia_ms INTEGER,
  ejecutado_en TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_ejecuciones_usuario
  ON ejecuciones(usuario_id, ejecutado_en DESC);

CREATE OR REPLACE VIEW v_consumo_mensual AS
SELECT
  u.id AS usuario_id,
  u.nombre,
  u.limite_tokens_mensual,
  COALESCE(SUM(e.total_tokens), 0) AS tokens_usados_mes,
  COALESCE(SUM(e.costo_usd), 0) AS gasto_usd_mes,
  COUNT(e.id) AS ejecuciones_mes,
  u.limite_tokens_mensual - COALESCE(SUM(e.total_tokens), 0) AS tokens_restantes
FROM usuarios u
LEFT JOIN ejecuciones e
  ON e.usuario_id = u.id
  AND e.ejecutado_en >= DATE_TRUNC('month', NOW())
GROUP BY u.id, u.nombre, u.limite_tokens_mensual;

ALTER TABLE usuarios DISABLE ROW LEVEL SECURITY;
ALTER TABLE ejecuciones DISABLE ROW LEVEL SECURITY;
