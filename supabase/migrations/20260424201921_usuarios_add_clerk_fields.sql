-- Fase 2 APPabogados — integración de Clerk sobre la tabla `usuarios`.
--
-- Contexto:
--   * Hasta Fase 1 la tabla `usuarios` se identificaba por `nombre UNIQUE` (Lautaro, Gonzalo, Mateo).
--   * Al migrar a Clerk agregamos dos columnas nuevas:
--       - `email`: para matching contra `primaryEmailAddress` de Clerk (whitelist).
--       - `clerk_user_id`: lo rellena lazy-sync en el primer login de cada usuario.
--   * `nombre` sigue siendo el identificador lógico del sistema (alimenta v_consumo_mensual,
--     los colores del UI y el tracking histórico). NO se toca.
--
-- Decisiones explícitas de Fase 1:
--   * `email` es NULLABLE. Lautaro entra al sistema con email NULL hasta que confirme.
--     Mientras siga NULL, `requireUsuarioOr403()` devuelve 403 para Lautaro.
--   * NO aplicar `ALTER COLUMN email SET NOT NULL` en esta migración (ver fila de Lautaro).
--     Cuando las 3 filas tengan email, se puede agregar el NOT NULL en una migración posterior.
--   * `email` se guarda en minúsculas porque el matching en whitelist.ts hace
--     `.eq('email', clerkEmail.toLowerCase())`.
--   * El lazy-sync SÓLO escribe `clerk_user_id` con guard `.is('clerk_user_id', null)`.
--     Nunca pisa `nombre` ni `email`.
--
-- Idempotente: se puede volver a correr sin romper nada.

BEGIN;

-- Agregar columnas (nullable).
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;

-- Unicidad case-insensitive del email, sólo para filas que ya tienen email.
-- Esto permite que Lautaro quede con email NULL sin chocar con el índice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email_lower
  ON usuarios (LOWER(email))
  WHERE email IS NOT NULL;

-- Unicidad de clerk_user_id, sólo para filas con sync completado.
-- Evita que dos cuentas de Clerk reclamen la misma fila de usuarios.
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_clerk_user_id
  ON usuarios (clerk_user_id)
  WHERE clerk_user_id IS NOT NULL;

-- Seteo inicial de emails (en minúsculas).
-- Lautaro queda con email NULL intencionalmente.
UPDATE usuarios
   SET email = LOWER('mateomorbi19@gmail.com')
 WHERE nombre = 'Mateo';

UPDATE usuarios
   SET email = LOWER('gonzalo.ezequiel.brandoni@gmail.com')
 WHERE nombre = 'Gonzalo';

COMMIT;

-- Verificación sugerida post-migración (correr aparte):
--   SELECT nombre, email, clerk_user_id FROM usuarios ORDER BY nombre;
--
-- Resultado esperado:
--   Gonzalo  | gonzalo.ezequiel.brandoni@gmail.com | NULL
--   Lautaro  | NULL                                | NULL
--   Mateo    | mateomorbi19@gmail.com              | NULL
