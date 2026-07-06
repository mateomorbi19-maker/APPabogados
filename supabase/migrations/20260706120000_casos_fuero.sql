-- Fase A del mapa procesal fuero-aware. El fuero es propiedad del caso
-- (lo usan el mapa y, a futuro, análisis/chat). Nullable a propósito:
-- se setea recién cuando el abogado confirma el fuero al inicializar el mapa.
ALTER TABLE casos ADD COLUMN fuero TEXT
  CHECK (fuero IN ('nacion', 'pba', 'federal'));
