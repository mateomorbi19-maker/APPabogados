-- Agrega columna `role` a la tabla `usuarios` para distinguir admin del resto.
-- Consumido server-side por requireAdminOr404() en el panel /admin.
-- RLS sigue desactivada por decisión del director de proyecto (beta interna).

ALTER TABLE usuarios
  ADD COLUMN role text NOT NULL DEFAULT 'user'
  CHECK (role IN ('user', 'admin'));

-- Mateo arranca como único admin.
UPDATE usuarios
  SET role = 'admin'
  WHERE email = 'mateomorbi19@gmail.com';
