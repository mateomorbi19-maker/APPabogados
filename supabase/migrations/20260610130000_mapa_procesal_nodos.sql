-- Feature: Mapa procesal interactivo (Fase 1).
-- Árbol de nodos del proceso penal por caso. Cada nodo puede tener un padre
-- (self-FK); borrar un nodo cascadea a sus descendientes. Borrar el caso
-- cascadea todo el mapa.

CREATE TABLE mapa_procesal_nodos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  caso_id UUID NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  tipo TEXT NOT NULL DEFAULT 'prediccion'
    CHECK (tipo IN ('raiz', 'real', 'prediccion')),
  estado TEXT NOT NULL DEFAULT 'bloqueado'
    CHECK (estado IN ('ocurrido', 'desbloqueado', 'bloqueado')),
  padre_id UUID REFERENCES mapa_procesal_nodos(id) ON DELETE CASCADE,
  posicion_x FLOAT DEFAULT 0,
  posicion_y FLOAT DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mapa_procesal_caso ON mapa_procesal_nodos(caso_id);
CREATE INDEX idx_mapa_procesal_padre ON mapa_procesal_nodos(padre_id) WHERE padre_id IS NOT NULL;

-- Una sola raíz por caso: refuerza la invariante a nivel DB y vuelve segura la
-- race de inicializarMapa (dos POST concurrentes → el segundo insert falla acá
-- en vez de dejar dos árboles).
CREATE UNIQUE INDEX idx_mapa_procesal_raiz_por_caso
  ON mapa_procesal_nodos(caso_id) WHERE tipo = 'raiz';

-- RLS deny-by-default (consistente con Fase 5.5 + eventos_agenda): habilitada
-- sin policies. El server accede siempre con service_role (bypassa RLS).
ALTER TABLE mapa_procesal_nodos ENABLE ROW LEVEL SECURITY;
