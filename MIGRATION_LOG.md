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

---

## 2026-05-07 · 00:00:00 UTC — `20260507000000_add_role_to_usuarios.sql`

**Contexto:** Feature `admin-panel-v1`. Habilita verificación server-side de admin sin tocar RLS (sigue desactivada por decisión del director).

**Cambios aplicados:**

- `usuarios.role TEXT NOT NULL DEFAULT 'user'` — nueva columna con `CHECK (role IN ('user', 'admin'))`.
- `UPDATE` Mateo → `role = 'admin'` (single admin inicial).

**Filas afectadas:** 1 update.

**Estado verificado post-migración:**

| nombre   | email                                 | role  |
|----------|---------------------------------------|-------|
| Gonzalo  | gonzalo.ezequiel.brandoni@gmail.com   | user  |
| Lautaro  | NULL                                  | user  |
| Mateo    | mateomorbi19@gmail.com                | admin |

**Efectos colaterales:** ninguno. La columna es opt-in y `requireUsuarioOr403()` no la lee.

---

## 2026-05-07 · 12:00:00 UTC — `20260507120000_eventos_caso_categoria_adjuntos_y_bucket.sql`

**Contexto:** PR1 de `feature/simulacion-procesal-v1`. Habilita categoría procesal y adjuntos en eventos para que las próximas iteraciones (PR2 + PR3) puedan agregar archivos y consultar al agente con contexto.

**Cambios aplicados:**

- `eventos_caso.categoria TEXT NULL` con `CHECK` que admite `audiencia | escrito_presentado | resolucion_recibida | prueba_incorporada | consulta_agente | respuesta_agente | otro`. Eventos viejos quedan con `categoria = NULL` (compatible).
- `eventos_caso.adjuntos JSONB NOT NULL DEFAULT '[]'`.
- `COMMENT ON COLUMN` para `tipo`, `categoria`, `adjuntos` clarificando la semántica de cada uno.
- Bucket de Storage `eventos-caso-adjuntos` (privado, 10 MB cap, mime types: PDF / JPEG / PNG / DOCX).

**Mapeo con el spec del prompt** (decisiones del director registradas):

| Spec del prompt | Schema real |
|---|---|
| `casos.analisis_original_id` | reusamos `casos.ejecucion_origen_id` (FK a ejecuciones existente) |
| `casos.estrategia_elegida_numero` (1-3) | reusamos `casos.estrategia_seleccionada_idx` (0-2) |
| `casos.estrategia_elegida_snapshot` | reusamos `casos.estrategia_snapshot` |
| `eventos_caso.origen` (manual/agente) | reusamos `eventos_caso.tipo` (manual/sistema/agente) |
| `eventos_caso.tipo` (procesal) | NUEVO `eventos_caso.categoria` |

**Filas afectadas:** 0 (los 3 eventos existentes quedan con `categoria=NULL`, `adjuntos=[]`).

**Pendiente para PR2:**

- RLS policies del bucket `eventos-caso-adjuntos` (path: `{usuario_id}/{caso_id}/...`). Hoy el server usa service_role que bypassea cualquier policy, así que esto es defensivo para cuando se active RLS en pre-producción.
- Endpoint de signed URLs para upload directo cliente → Storage.

---

## 2026-05-07 · 18:00:00 UTC — `20260507180000_chat_persistente_cleanup_pr3_y_refunded.sql`

**Contexto:** PR4 sub-PR2 (`feature/pr4-chat-persistente`). Pivote estructural: el modelo de "consultas pareadas en el timeline" del PR3 se reemplaza por chat persistente en tablas dedicadas. La migración hace TODO en una transacción.

**Cambios aplicados:**

1. **Cleanup PR3:**
   - `DELETE FROM eventos_caso WHERE categoria IN ('consulta_agente','respuesta_agente')` → 2 filas borradas (par del QA del director del 7-may 21:59).
   - `DELETE FROM ejecuciones WHERE tipo='consulta_caso'` → 1 fila borrada ($0.0758, 15.522 tokens).

2. **Tighten constraints `eventos_caso`:**
   - `tipo` CHECK ahora `IN ('manual','sistema')` — sacamos `'agente'`.
   - `categoria` CHECK saca `'consulta_agente'` y `'respuesta_agente'`.
   - `COMMENT ON COLUMN` actualizado para reflejar el modelo nuevo.

3. **Tablas nuevas:**
   - `conversaciones_caso (id, caso_id FK, titulo, estado [activa|archivada], creada_en, actualizada_en, archivada_en)`. Partial unique index `(caso_id) WHERE estado='activa'` garantiza ≤1 activa por caso.
   - `mensajes_conversacion (id, conversacion_id FK, rol [usuario|agente], contenido, adjuntos jsonb, respuesta_estructurada jsonb NULL, ejecucion_id FK NULL, creado_en)`.

4. **Trigger `mensajes_bump_conv`:** AFTER INSERT/UPDATE/DELETE en `mensajes_conversacion` actualiza `conversaciones_caso.actualizada_en` del conversation padre.

5. **Refunded:** 4 ejecuciones `analizar_caso` históricas marcadas con `metadata.refunded=true`, `refunded_at`, `refund_reason`:
   - 3 del 2026-05-01 con `metadata.error='LIMITE_BUSQUEDAS_EXCEDIDO'`.
   - 1 del 2026-05-07 con `metadata.error_code='CAP_EXCEEDED_NO_SYNTHESIS'`.

6. **`v_consumo_mensual` modificada:** el JOIN ahora incluye `AND COALESCE((e.metadata->>'refunded')::boolean, false) = false`. Ejecuciones reembolsadas no cuentan para el consumo del mes ni para rate-limit.

**Estado verificado post-migración:**

| Verificación | Esperado | Real |
|---|---|---|
| `eventos_caso WHERE categoria IN ('consulta_agente','respuesta_agente')` | 0 | 0 ✅ |
| `ejecuciones WHERE tipo='consulta_caso'` | 0 | 0 ✅ |
| `ejecuciones WHERE metadata.refunded=true` | 4 | 4 ✅ |
| `conversaciones_caso` y `mensajes_conversacion` existen | sí | sí ✅ |
| Vista `v_consumo_mensual` excluye refunded del agregado | sí | sí (Mateo: 17 ejec / 379K tokens / $1.81 en mayo, sin las 1 refunded del 7-may) |

**Efectos colaterales:** los archivos del bucket `eventos-caso-adjuntos` que apuntaban a los eventos consulta/respuesta borrados quedan huérfanos. **Pre-flight verificó que no hay archivos de ese flujo (0 adjuntos en los 2 eventos del par)** — sin huérfanos reales en el bucket.

**Pendiente para iteraciones futuras:**

- RLS policies de `conversaciones_caso` y `mensajes_conversacion`: por ahora sin policies (RLS habilitada por default → deny all anon). Server-side con service_role bypassea, igual que el resto del modelo de auth Clerk-only.
- Prompt caching del agente: los SYSTEM_PROMPT crecieron con el modelo nuevo y el chat acumula history en cada mensaje. Activar caching es la próxima optimización de costo (D7 del plan PR4: diferida intencionalmente para PR independiente).
