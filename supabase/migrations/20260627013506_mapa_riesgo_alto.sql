-- Mapa procesal — rediseño del flujo (primera versión, a validar con experto).
-- Cambio ADITIVO: agrega una columna para marcar nodos de "riesgo alto" en el
-- mapa (ej.: "Prisión preventiva"). Se renderiza en rojo y es toggleable desde
-- el panel de detalle del nodo. NOT NULL DEFAULT false → los nodos existentes
-- (mapas viejos) quedan automáticamente en false, sin romper nada.

ALTER TABLE mapa_procesal_nodos
  ADD COLUMN riesgo_alto boolean NOT NULL DEFAULT false;
