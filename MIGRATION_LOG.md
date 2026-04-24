# MIGRATION_LOG

Bitácora de migraciones SQL aplicadas manualmente contra Supabase durante la refactorización a Next.js + Clerk.

Este archivo se mantiene durante las Fases 2–5 para dejar registro humano de qué se corrió, cuándo, y qué estado dejó. En Fase 5 se revisa si se conserva o se mueve a `/legacy/`.

---

## 2026-04-24 · 20:19:21 UTC — `20260424201921_usuarios_add_clerk_fields.sql`

**Contexto:** Fase 2 / sub-paso 2.3. Primera migración de la integración con Clerk.

**Cambios aplicados:**

- `usuarios.email TEXT NULL` — nueva columna.
- `usuarios.clerk_user_id TEXT NULL` — nueva columna.
- `idx_usuarios_email_lower` — unique index parcial sobre `LOWER(email) WHERE email IS NOT NULL`.
- `idx_usuarios_clerk_user_id` — unique index parcial sobre `clerk_user_id WHERE clerk_user_id IS NOT NULL`.
- `UPDATE` de Mateo → `mateomorbi19@gmail.com` (lowercased).
- `UPDATE` de Gonzalo → `gonzalo.ezequiel.brandoni@gmail.com` (lowercased).

**Filas afectadas:** 3 (las 3 filas de `usuarios`).

**Estado inicial verificado post-migración:**

| nombre   | email                                 | clerk_user_id |
|----------|---------------------------------------|---------------|
| Gonzalo  | gonzalo.ezequiel.brandoni@gmail.com   | NULL          |
| Lautaro  | NULL                                  | NULL          |
| Mateo    | mateomorbi19@gmail.com                | NULL          |

**Efectos colaterales verificados:**

- `ejecuciones`: row count sin cambios.
- `v_consumo_mensual`: sigue operativa (la vista no referencia las columnas nuevas).

**Pendiente:**

- `clerk_user_id` se rellena vía lazy-sync en `src/lib/auth/whitelist.ts` la primera vez que cada usuario autentica.
- `email` de Lautaro queda NULL hasta que confirme cuál usar. Mientras tanto, `requireUsuarioOr403()` devuelve 403 para cualquier sesión que reclame ese slot.
- No aplicar `ALTER COLUMN email SET NOT NULL` hasta que las 3 filas tengan valor.
