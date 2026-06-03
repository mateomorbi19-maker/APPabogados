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

---

## 2026-05-08 · 00:00:00 UTC — `20260508000000_refund_consulta_caso_parseo_error_pre_adaptable.sql`

**Contexto:** fix `fix/chat-respuesta-adaptable`. Bug post-deploy del PR4 sub-PR2: el system prompt forzaba JSON estructurado (tesis + fundamento + recomendaciones) para CUALQUIER pregunta. Cuando el director hizo una pregunta conversacional ("Hola, qué debo hacer ahora?"), el modelo respondió en prosa natural, el parser falló 3 veces, y la ejecución terminó como error sin entregar respuesta. El fix (en este branch) introduce dos modos adaptativos en el agente — `conversacional` para preguntas cortas y `analisis` estructurado para análisis legal profundo.

**Cambios aplicados:**

- `UPDATE ejecuciones SET metadata = metadata || jsonb_build_object('refunded', true, 'refunded_at', now()::text, 'refund_reason', 'CHAT_PARSEO_ERROR_PRE_FIX_ADAPTABLE')` para todas las filas `tipo='consulta_caso'` con `metadata.parseo_error` no nulo y aún no refunded.

**Filas afectadas:** 1 (la ejecución del QA del director, $0.0489 USD reembolsados).

**Vista `v_consumo_mensual`:** ya excluye `refunded=true` desde la migración 20260507180000. NO requiere modificación.

**Efectos colaterales:** ninguno. Otras ejecuciones `consulta_caso` (las del QA pre-cleanup ya borradas o las nuevas exitosas) no entran en el filtro.

---

## 2026-06-03 · re-ingest del Código Penal — `scripts/ingestar-cp.ts`

**Contexto:** la auditoría del corpus RAG detectó que `tipo_documento='codigo'` (Código Penal) estaba roto: 590 chunks con solo ~52 artículos distintos y duplicación ~10×, faltando artículos centrales (172 estafa, 173 defraudación, 210 asociación ilícita, 292 falsificación, 149 bis). El agente buscaba esos artículos y no recuperaba nada. Causa raíz: el corpus original (cargado por un workflow n8n perdido, no reproducible desde el repo) salió de un parser que solo capturaba la forma exacta `<b>ARTICULO N.-</b>` y perdía todas las variantes. Este re-ingest lo reemplaza desde el HTML oficial de Infoleg.

**No es una migración SQL de schema** — es una operación de DATOS (delete + insert sobre `documentos`) ejecutada por el script versionado `scripts/ingestar-cp.ts` con service_role (vía `tsx`, no MCP — que estaba desconectado). Se registra acá por su impacto sobre el corpus.

**Fuente:** `notas-migracion/CP-infoleg.html` (Infoleg, charset windows-1252, Ley 11.179, reformas confirmadas hasta Ley 26.791/2012). Gitignored.

**Operación (idempotente, embed-first):**

1. Parse del HTML → **425 chunks / 396 artículos distintos** (art 1-316 + variantes bis/ter/quáter/quinquies).
2. Embedding de los 425 chunks (OpenAI `text-embedding-3-small`, 1536 dims — idéntico al RAG). ~68.925 tokens, **~USD 0.0014**.
3. Backup del corpus viejo → `notas-migracion/backup-codigo-2026-06-03.json` (590 filas, sin embeddings; gitignored).
4. `DELETE FROM documentos WHERE tipo_documento='codigo'` → **590 filas borradas** (FK-safe: ninguna tabla referencia a `documentos`).
5. INSERT de los 425 chunks nuevos (batches de 100).

**Estado verificado post-carga:**

| Verificación | Antes (roto) | Ahora |
|---|---|---|
| chunks `codigo` | 590 | 425 |
| artículos distintos | 52 | 396 ✅ |
| 172/173/210/292/149 bis | ausentes | presentes ✅ |
| artículos no-particionados con >1 chunk (dup) | ~10× | 0 ✅ |
| longitudes min/max/avg | caóticas | 23 / 1527 / 560 |

Smoke de retrieval (`match_documents`): "estafa art 172" → art 172 (0.642); "art 173 inciso 7" → art 173 (0.643); "asociación ilícita art 210" → art 210/bis/ter. Antes los tres devolvían artículos no relacionados.

**Campos por chunk:** `tipo_documento='codigo'` (reusado), `libro`/`titulo`/`capitulo` poblados, `seccion=NULL` (el CP no tiene nivel Sección), `articulo` normalizado ("172", "149 bis", "41 quinquies", "268 (2)"), `pagina=NULL` (HTML sin paginación), `fuente_id=NULL` (consistente con CPPF y manuales). Artículos largos partidos con `splitLargo` + overlap, con marca "(parte i/m)" en el `contenido`.

**Pendiente (próxima palanca, NO incluida acá):** el threshold **0.55** hardcodeado en el RPC `match_documents` rechaza matches correctos top-ranked. Ej.: "femicidio homicidio agravado art 80" → el art 80 rankea #1 a **0.5466 < 0.55** → la RPC devuelve vacío. Bajar/adaptar el threshold es una migración separada al RPC que afecta a todo el corpus (CP + CPPF + manuales).

**No se tocaron** los corpus `codigo_procesal` (CPPF, 370 chunks) ni `manual` (2974 chunks).
