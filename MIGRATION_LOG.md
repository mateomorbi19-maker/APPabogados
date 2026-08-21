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

---

## 2026-07-06 — `20260706120000_casos_fuero.sql` · ✅ APLICADA

**Contexto:** Fase A del mapa procesal fuero-aware (ver `PLAN_MAPA_PROCESAL.md`). El fuero (Nación / PBA / Federal) pasa a ser propiedad del caso: define qué plantilla procesal instancia el mapa y, a futuro, lo consumen análisis y chat.

**Cambios:**

- `casos.fuero TEXT NULL` con `CHECK (fuero IN ('nacion', 'pba', 'federal'))` — nueva columna. Nullable a propósito: se setea recién cuando el abogado confirma el fuero al inicializar (o reiniciar) el mapa.

**Aplicación:** la corrió Mateo a mano vía SQL Editor (el MCP de Supabase de esta sesión no tiene privilegios ni de escritura ni de lectura sobre esos endpoints). Verificada vía REST con service_role: `GET /rest/v1/casos?select=id,fuero` → 200, los 2 casos existentes con `fuero: null`.

**Riesgo:** nulo para los reads existentes — la columna es nullable sin default y ninguna query la SELECTeaba antes del código de Fase A.

---

## 2026-07-06 — `20260706190000_ejecuciones_tipo_simular_mapa.sql` · ✅ APLICADA

**Contexto:** Fase C del mapa procesal (simulación de ramas con IA, ver `PLAN_MAPA_PROCESAL.md`). Cada simulación se trackea en `ejecuciones` con `tipo='simular_mapa'` (tokens reales + costo, patrón idéntico a pre_analisis).

**Cambios:**

- Recrea el CHECK de `ejecuciones.tipo` agregando `'simular_mapa'` al set (`pre_analisis | analizar_caso | consulta_caso | simular_mapa`). El DO block dropea el constraint vigente buscándolo por definición (el nombre puede diferir del default por drift repo↔DB) y lo recrea con nombre canónico `ejecuciones_tipo_check`.

**Aplicación:** la corrió Mateo vía SQL Editor. Verificada por sondeo REST: INSERT con `tipo='simular_mapa'` aceptado (fila de prueba insertada y borrada inmediatamente).

**Riesgo:** nulo para los tipos existentes (el set nuevo es superset del viejo). Sin esta migración, el INSERT de la simulación falla con violación de CHECK → el endpoint devuelve 500 "Error persistiendo ejecución".

**Pendiente (próxima palanca, NO incluida acá):** el threshold **0.55** hardcodeado en el RPC `match_documents` rechaza matches correctos top-ranked. Ej.: "femicidio homicidio agravado art 80" → el art 80 rankea #1 a **0.5466 < 0.55** → la RPC devuelve vacío. Bajar/adaptar el threshold es una migración separada al RPC que afecta a todo el corpus (CP + CPPF + manuales).

**No se tocaron** los corpus `codigo_procesal` (CPPF, 370 chunks) ni `manual` (2974 chunks).

---

## 2026-06-03 · re-ingest del Código Procesal Penal Federal — `scripts/ingestar-cppf-html.ts`

**Contexto:** el corpus `tipo_documento='codigo_procesal'` venía del PDF Infojus **2014** (ingestado por `scripts/ingestar-cppf.ts`, que se **conserva** como referencia histórica). Este re-ingest lo reemplaza desde el HTML oficial de Infoleg, **consolidado Decreto 118/2019** (reformas hasta 2019 — más actualizado que el PDF).

**No es una migración SQL de schema** — operación de DATOS (delete + insert sobre `documentos`) vía el script versionado `scripts/ingestar-cppf-html.ts` con service_role (`tsx`, sin MCP).

**Fuente:** `notas-migracion/CPPF.html` (Infoleg, charset windows-1252). Gitignored. Markup distinto al del CP: `<br>`-delimitado, `ARTÍCULO` con tilde sin `<b>`, jerarquía `PARTE > LIBRO > TÍTULO > Capítulo` (arábigo), sin Sección, sin sufijos bis/ter.

**Operación (idempotente, embed-first):**

1. Parse del HTML → **424 chunks / 397 artículos distintos** (rango 1-397, sin huecos). Saltea el preámbulo (decreto aprobatorio con su propio ARTÍCULO 1º-3º) arrancando en "PRIMERA PARTE". Dos inyecciones de `<br>` corrigieron headers glued: art 387 (pegado al 386) y el Título I del Libro Segundo (pegado al nombre del libro).
2. Embedding de los 424 chunks (`text-embedding-3-small`, 1536 dims). ~72.530 tokens, **~USD 0.0015**.
3. Backup del CPPF viejo → `notas-migracion/backup-codigo_procesal-2026-06-03.json` (370 filas, sin embeddings; gitignored).
4. `DELETE FROM documentos WHERE tipo_documento='codigo_procesal'` → **370 filas borradas** (FK-safe; el CP `'codigo'` NO se tocó).
5. INSERT de los 424 chunks nuevos (batches de 100).

**Estado verificado post-carga:**

| Verificación | Antes (PDF 2014) | Ahora (HTML 2019) |
|---|---|---|
| chunks `codigo_procesal` | 370 | 424 |
| artículos distintos | — | 397 (rango 1-397, 0 huecos) ✅ |
| art 135 ("Reglas sobre la prueba") | — | presente, recupera a 0.705 ✅ |
| anti-dup (no-particionados con >1 chunk) | — | 0 ✅ |
| longitudes min/max/avg | — | 118 / 1518 / 645 |

**Campos por chunk:** `tipo_documento='codigo_procesal'` (reusado), `libro` con la PARTE plegada ("PRIMERA PARTE - … / LIBRO PRIMERO - …"), `titulo`/`capitulo` poblados, `seccion=NULL`, `articulo` (número simple, sin sufijos), `pagina=NULL`, `fuente_id=NULL`.

**Pendiente (mismo que el CP):** el threshold 0.55 del RPC rechaza matches correctos top-ranked — reforzado por el CPPF: "control de la detención" → arts 215/216/245 (detención/aprehensión/arresto) rankean al tope a 0.52-0.55 → la RPC devuelve vacío.

**No se tocaron** los corpus `codigo` (CP, 425 chunks) ni `manual` (2974 chunks).

---

## 2026-06-27 · 00:39:11 — `20260627003911_match_documents_threshold_param.sql`

**Contexto:** baja del umbral de similaridad del RAG de **0.55 → 0.50**, parametrizándolo en vez de volver a hardcodearlo. Resuelve además el drift de bitácora detectado en la auditoría (la palanca "threshold 0.55" venía marcada como pendiente en las dos entradas de re-ingesta del corpus).

**Tipo:** migración SQL de schema (redefinición de función). `CREATE OR REPLACE FUNCTION public.match_documents(...)` **sin DROP**, aplicable sin downtime.

**Cambios:**

1. Se agrega el parámetro **`match_threshold float8 DEFAULT 0.5`** al final de la firma del RPC (requisito de PostgreSQL para `CREATE OR REPLACE`: parámetro nuevo, con default, agregado al final, sin alterar los existentes `query_embedding` / `match_count` / `filter`).
2. La condición hardcodeada `1 - (embedding <=> query_embedding) > 0.55` pasa a `> match_threshold`.
3. Todo lo demás de la firma y el cuerpo queda **intacto** (tipo de retorno, `jsonb_build_object` de metadata, `order by`, `limit match_count`).

**Motivo:** con 0.55 se descartaban matches correctos **top-ranked** por márgenes chicos. Ej.: la consulta **"femicidio art 80"** rankea el artículo correcto en el puesto #1 con score **0.5466 < 0.55** → el RPC devolvía vacío. Mismo patrón en CPPF ("control de la detención" → arts 215/216/245 a 0.52-0.55). 0.50 recupera esos casos.

**Fuente de verdad operativa:** a partir de ahora el umbral lo fija la constante TS **`RAG_SIMILARITY_THRESHOLD = 0.5`** en [src/lib/rag/match-documents.ts](src/lib/rag/match-documents.ts), que se pasa como `match_threshold` en la llamada al RPC (`buscarDocumentos`, único call site — lo usan tanto `analizar-caso` como el chat). Recalibrar el umbral = cambiar esa constante, **sin nueva migración SQL**. El `DEFAULT 0.5` del parámetro SQL es solo el fallback si algún caller no lo pasa.

**Pendiente — aplicación manual:** esta migración **NO fue ejecutada** por Claude Code. Mateo la corre en el SQL Editor de Supabase. Post-aplicación: verificar que "femicidio art 80" ahora devuelva el art. 80 y que no entre ruido evidente por el umbral más bajo.

---

## 2026-06-27 · 01:35:06 — `20260627013506_mapa_riesgo_alto.sql`

**Contexto:** rediseño del Mapa Procesal (primera versión, a validar con experto legal). Se reescribió el template (`plantilla-base.ts`) de tres ramas paralelas a un tronco secuencial con bifurcaciones (vocabulario CPPF), se agregó un sistema de 4 colores por estado del nodo, y se sumó la marca de "riesgo alto".

**Tipo:** migración SQL de schema, **aditiva** (no rompe ni borra nada existente).

**Cambio:**

```sql
ALTER TABLE mapa_procesal_nodos
  ADD COLUMN riesgo_alto boolean NOT NULL DEFAULT false;
```

**Para qué:** marcar nodos de riesgo alto en el mapa (ej.: "Prisión preventiva"), que se renderizan en **rojo** y son toggleables desde el panel de detalle del nodo. `NOT NULL DEFAULT false` → los nodos de mapas viejos quedan en `false` automáticamente, sin migración de datos.

**Mapas existentes:** NO se migran automáticamente (siguen con la estructura vieja). Para ver el flujo nuevo en un caso de prueba: usar el botón **"Reiniciar"** de la toolbar del mapa (borra los nodos del caso y reinstancia el template nuevo) o crear un caso nuevo.

**Pendiente — aplicación manual:** esta migración **NO fue ejecutada** por Claude Code. Mateo la corre en el SQL Editor de Supabase.

---

## 2026-06-29 · 12:00:00 UTC — `20260629120000_eventos_agenda_clase_prioridad.sql`

**Contexto:** feature `agenda-tareas`. La agenda pasa de modelar solo EVENTOS (citas con franja horaria) a distinguir además TAREAS (to-do por fecha, sin hora, con prioridad). Decisiones del director: tareas y eventos conviven en `eventos_agenda` con un discriminador (no tabla nueva); son **personales** (sin asignación entre usuarios); se conserva la vista de lista actual (sin calendario mensual nuevo).

**Tipo:** migración SQL de schema, **aditiva** (no rompe ni borra nada existente).

**Cambio:**

```sql
ALTER TABLE eventos_agenda
  ADD COLUMN clase TEXT NOT NULL DEFAULT 'evento'
    CHECK (clase IN ('evento', 'tarea')),
  ADD COLUMN prioridad TEXT NOT NULL DEFAULT 'media'
    CHECK (prioridad IN ('alta', 'media', 'baja'));
```

- `clase`: `evento` (cita con hora, sincroniza con Google Calendar) | `tarea` (to-do por fecha, `todo_el_dia`, **sin** sync). `NOT NULL DEFAULT 'evento'` → las filas existentes quedan como eventos.
- `prioridad`: `alta | media | baja`, aplica a ambos. `NOT NULL DEFAULT 'media'`.
- Sin índice nuevo: el listado filtra por `usuario_id` + (opcional) `clase` ordenando por `fecha_inicio`; `idx_eventos_agenda_usuario_fecha` ya cubre ese acceso (clase tiene cardinalidad 2).

**Filas afectadas:** 0 de datos (solo defaults sobre filas existentes → todas quedan `clase='evento'`, `prioridad='media'`).

**Acoplamiento código ↔ migración (IMPORTANTE):** el código nuevo agrega `clase, prioridad` al `SELECT` de [src/lib/agenda/queries.ts](src/lib/agenda/queries.ts) (`COLS`). Si el código corre **antes** de aplicar esta migración, **todos los reads de la agenda dan 500** (columna inexistente — mismo patrón que el caso `riesgo_alto`). Aplicar la migración PRIMERO.

**Sync con Google:** las tareas no se pushean (`getEventosSinSincronizar` ahora filtra `clase='evento'`); el pull es update-only por `google_calendar_event_id`, que las tareas nunca tienen, así que tampoco las toca.

**Pendiente — aplicación manual:** esta migración **NO fue ejecutada** por Claude Code (el MCP de Supabase apunta a otra cuenta — proyectos `mqmbltvmhriibsabhtze` / `aybwzcuozzhcedfotdrh`, no el `xvdlnevcvcsgxbngwliv` de la app). Mateo la corre en el SQL Editor de Supabase.

---

## 2026-07-14 — Config del bucket `eventos-caso-adjuntos` (Storage API, no SQL)

**Contexto:** feature `chat: adjuntos + audio`. El chat suma formatos de imagen (WEBP, HEIC/HEIF de iPhone — se convierten a JPEG server-side antes de ir al modelo) y audio (notas de voz grabadas en el browser o archivos; se transcriben con Whisper y el agente lee la transcripción).

**Tipo:** cambio de configuración del bucket vía Storage API (no es migración SQL). **Ya aplicado** el 2026-07-14 con la service_role key (`PUT /storage/v1/bucket/eventos-caso-adjuntos`).

**Cambio:** `allowed_mime_types` pasa de `[pdf, jpeg, png, docx]` a:

```json
["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic",
 "image/heif", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
 "audio/webm", "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/ogg"]
```

`file_size_limit` queda en 10485760 (10 MB).

**Acoplamiento código ↔ config (IMPORTANTE):** el allowlist del bucket debe ser superset de `MIME_TYPES_PERMITIDOS` en [src/lib/casos/adjuntos.ts](src/lib/casos/adjuntos.ts). Si se agrega un mime al código sin agregarlo al bucket, el PUT del upload falla con 4xx del storage.

---

## 2026-07-21 · 12:00:00 UTC — `20260721120000_simulador_audiencia_fundacion.sql` · ✅ APLICADA

**Contexto:** Paso 1 del **Simulador de Audiencias (HearSim)** — fundación de datos. La auditoría previa (`AUDIT-HEARSIM.md`) confirmó que el chat persistente no tiene modelo de sesión reusable: `conversaciones_caso` tiene un único campo de estado (`activa|archivada`) y ninguna columna jsonb, así que el rol asumido, el tipo de audiencia, la dificultad y el estado de turno no tienen dónde vivir. Este paso crea el modelo propio. **Sin ruta API ni UI todavía.**

**Tipo:** migración SQL de schema, **aditiva** (2 tablas nuevas + recreación de un CHECK existente como superset). No borra ni migra datos.

**Cambios:**

1. **`ejecuciones.tipo` — nuevo valor `'simular_audiencia'`.** Mismo patrón defensivo que `20260706190000`: un `DO` block dropea el CHECK vigente buscándolo **por definición** (no por nombre, por el drift repo↔DB) y lo recrea con el set completo:

```sql
CHECK (tipo IN ('pre_analisis','analizar_caso','consulta_caso','simular_mapa','simular_audiencia'))
```

2. **`simulaciones_audiencia`** — la sesión. `caso_id` FK a `casos` ON DELETE CASCADE; `tipo_audiencia` (allowlist que arranca con `prision_preventiva`), `rol_usuario` (`defensa|fiscal|querellante`), `dificultad` (`a_guiada|b_estandar|c_adversarial`), `magistrado_perfil` (`garantista|restrictivo|neutro`), `estado` (`en_curso|finalizada|abandonada`), `debriefing jsonb NULL`, timestamps. Índice `idx_simulaciones_caso (caso_id, creada_en DESC)`.

3. **`turnos_simulacion`** — el transcript. `simulacion_id` FK CASCADE, `emisor` (10 valores: `usuario` + 8 personajes + `sistema`), `emisor_nombre` nullable, `contenido`, **`metadata jsonb NOT NULL DEFAULT '{}'`**, `ejecucion_id` FK nullable ON DELETE SET NULL. Índice `idx_turnos_simulacion (simulacion_id, creado_en)`.

4. **Trigger `turnos_bump_sim`** — réplica de `trg_mensajes_bump_conv_actualizada`: cualquier INSERT/UPDATE/DELETE de turnos bumpea `simulaciones_audiencia.actualizada_en`.

5. **RLS deny-by-default** en ambas tablas (habilitada sin policies), consistente con `eventos_agenda` y `mapa_procesal_nodos`.

**Decisión — `metadata` en el transcript:** `mensajes_conversacion` **no** tiene columna `metadata`, y eso obligó a meter toda la metadata de cada corrida en `ejecuciones.metadata`, dejando al mensaje sin lugar propio para datos del turno. `turnos_simulacion` la incluye desde el día uno (fase de la audiencia, objeciones, scoring parcial).

**Decisión — ownership sin denormalizar:** ninguna de las dos tablas tiene `usuario_id`. La pertenencia se resuelve por join `turnos_simulacion → simulaciones_audiencia → casos.usuario_id`, igual que el par `conversaciones_caso` / `mensajes_conversacion`. (Contraste: `eventos_agenda` **sí** denormaliza `usuario_id`, porque su dueño es el abogado y el `caso_id` es opcional.)

**Sin invariante de "1 sesión en curso por caso":** a diferencia de `uq_conversacion_activa_por_caso`, **no** se agregó un partial unique index. Es una decisión de producto todavía no tomada; agregarlo después es una migración de una línea.

**Acoplamiento código ↔ migración (IMPORTANTE):** este paso **no** agrega ningún `SELECT` nuevo, así que correr el código sin la migración no rompe nada hoy. En cuanto exista la ruta del simulador, el INSERT en `ejecuciones` con `tipo='simular_audiencia'` **falla con violación de CHECK** si la migración no se corrió antes (mismo patrón que `simular_mapa`). Aplicar la migración PRIMERO.

**Aplicación:** la corrió Mateo a mano vía SQL Editor el **2026-07-22** (Claude Code no la ejecutó: el MCP de Supabase de esa sesión no tenía privilegios sobre el proyecto `xvdlnevcvcsgxbngwliv` — el token estaba scopeado a otra organización).

**Nota de cronología:** entre la creación del archivo y su aplicación mediaron dos sesiones. La pasada del motor (`feat/simulador-motor`) arrancó bajo la premisa de que esta migración ya estaba aplicada, y no lo estaba — se detectó con el sondeo `information_schema.tables`, que devolvió 0 para ambas tablas. Se corrigió antes de cualquier prueba. Moraleja registrada: **verificar contra la DB, no contra el archivo en el repo** (el drift repo↔DB corta para los dos lados).

---

## 2026-07-21 · 14:00:00 UTC — `20260721140000_simulacion_unica_por_caso.sql` · ✅ APLICADA

**Contexto:** Pasada 1 del **Simulador de Audiencias (THÉMIS)** — motor backend. En la migración de fundación (`20260721120000`) se dejó explícitamente **sin** invariante de unicidad, por ser una decisión de producto no tomada. Ya está tomada: **una sola audiencia en curso por caso**, igual que el chat.

**Tipo:** migración SQL de schema, **aditiva** (un índice). No borra ni migra datos.

**Cambio:**

```sql
CREATE UNIQUE INDEX uq_simulacion_en_curso_por_caso
  ON simulaciones_audiencia (caso_id)
  WHERE estado = 'en_curso';
```

Calcado de `uq_conversacion_activa_por_caso` (`20260507180000:71-73`).

**Para qué:** refuerza en DB lo que la ruta ya hace en código — `POST /api/casos/[id]/simulacion` marca `abandonada` la sesión en curso antes de insertar la nueva (update primero, insert después). Sin el índice, dos POST concurrentes dejarían dos audiencias abiertas sobre el mismo expediente; con él, el segundo insert falla.

**Riesgo de aplicación:** falla si ya existieran dos filas `en_curso` para un mismo `caso_id`. Con las tablas recién creadas eso es improbable; el `.sql` incluye en un comentario el `UPDATE` correctivo por si pasara.

**Acoplamiento código ↔ migración:** **bajo, pero no nulo.** Las tres rutas del simulador funcionan igual sin el índice (la exclusión mutua ya está en código); lo que se pierde sin él es la protección contra la race de dos requests simultáneos. No hay `SELECT` nuevo de columnas, así que no aplica el patrón "500 en todos los reads" de `riesgo_alto` / `clase`.

**Aplicación:** la corrió Mateo a mano vía SQL Editor el **2026-07-22**, inmediatamente después de `20260721120000` (el índice referencia la tabla que crea aquella, así que el orden es obligatorio).

---

## 2026-08-07 · 12:00:00 UTC — `20260807120000_repositorio_rag.sql` · ⏳ PENDIENTE DE APLICAR

**Contexto:** el Repositorio de jurisprudencia y doctrina existía como **catálogo** (345 documentos en un módulo TS generado, `src/lib/repositorio/catalogo.ts`) construido a partir de los NOMBRES DE ARCHIVO de Drive. Eso alcanza para que el abogado navegue la biblioteca, pero no para que el agente conteste "¿qué jurisprudencia se puede aplicar a este caso?": para eso hace falta el CONTENIDO de los PDF. Esta migración crea las dos tablas donde vive ese contenido.

**Tipo:** migración SQL de schema, **puramente aditiva**. Dos tablas nuevas, dos RPC nuevas, cero cambios sobre lo existente. No toca `documentos` ni `match_documents`.

**Cambio:**

| Objeto | Qué es |
|---|---|
| `repositorio_documentos` | Una fila por documento del catálogo. Guarda la **ficha** generada por IA durante la ingesta (holding, sumario, temas, normas, utilidad para cada lado) + su `embedding vector(1536)` + trazabilidad de la ingesta (`estado`, `texto_hash`, `paginas`). PK = el slug del catálogo (no un uuid nuevo): es el id con el que el frontend linkea a `/dashboard/repositorio/<id>`. |
| `repositorio_chunks` | Los pasajes citables de cada documento, con embedding. FK a `repositorio_documentos` con `ON DELETE CASCADE`. |
| `match_repositorio_documentos(...)` | Etapa 1 de la búsqueda: sobre las fichas. Decide QUÉ documentos sirven. |
| `match_repositorio_chunks(...)` | Etapa 2: sobre los pasajes, acotada por `filtro_documentos`. Decide QUÉ CITAR. |

Índices HNSW cosine en ambos embeddings, iguales a `documentos_embedding_idx`. RLS deny-by-default + `REVOKE` a `anon`/`authenticated`, consistente con el hardening de la Fase 5.5.

**Decisión — dos niveles y no uno:** buscar directo sobre los ~16.700 chunks sería más simple y peor por dos motivos. (1) Ranking: los párrafos de trámite de todos los fallos se parecen entre sí más que las ratios, así que dominan los resultados. (2) Tokens: devolver 20 chunks crudos son ~8.000 tokens por búsqueda. Con fichas + pasajes acotados una búsqueda entra en ~1.500 tokens y trae la información con la que un abogado realmente decide si un precedente aplica.

**Decisión — tabla nueva y no reusar `documentos`:** aquel corpus es NORMATIVA y su metadata es libro/título/artículo; un fallo tiene tribunal/año/carátula y una relación 1:N con sus pasajes que ese schema no modela. Además, mezclarlos rompería el RAG existente: `buscar_documentos_legales` empezaría a devolver sentencias donde se le piden artículos.

**Decisión — umbrales bajos (0.25 fichas / 0.2 pasajes):** la consulta del agente es una hipótesis jurídica y la ficha es una regla abstracta; la similitud coseno entre ambas rara vez pasa de 0.5 aunque el precedente sea el correcto. Lo que hace el trabajo es el ORDEN, no el corte. Subir el umbral devuelve cero resultados en consultas legítimas — el mismo error que dejó el RAG normativo mudo entre 2026-06-27 y 2026-07-29.

**Acoplamiento código ↔ migración:** **nulo en el sentido peligroso.** Ninguna ruta existente agrega un `SELECT` a estas tablas, así que la app corre igual sin la migración: `src/lib/repositorio/rag.ts` detecta `PGRST202`/`PGRST205`, lo cachea 5 minutos para no gastar embeddings contra un 404, y las tools del agente le contestan al modelo "el índice todavía no está construido". El chat y el análisis siguen funcionando sin repositorio.

**Costo de disco (medido en dry-run sobre el corpus real):** 300 documentos con texto (45 son escaneos sin OCR), ~16.700 chunks → **~100 MB de vectores + ~140 MB de índice HNSW**. Si el proyecto está en el plan Free (500 MB) conviene ingerir primero `--coleccion jurisprudencia` y medir antes de sumar la doctrina.

**Aplicación:** ⏳ **pendiente.** La tiene que correr Mateo a mano en el SQL Editor (Claude Code no la ejecutó: el MCP de Supabase de esta sesión sigue scopeado a otra organización — devuelve dos proyectos de `mateomrb19@gmail.com`, ninguno es `xvdlnevcvcsgxbngwliv`). Después de aplicarla hay que correr la ingesta:

```bash
npm run repo:ingesta
```

La ingesta genera la ficha de cada documento con **Haiku 4.5** (~USD 3,30 la
corrida completa). Es una tarea de extracción, no de razonamiento: comparada con
Sonnet sobre los mismos fallos dio fichas equivalentes por un cuarto del costo.
`--modelo preciso` fuerza Sonnet; `--sin-ficha` la saltea (centavos, pero la
etapa 1 de la búsqueda pierde su mejor señal).

Verificación: `GET /api/repositorio/estado` devuelve `documentos_indexados` (`null` = migración sin aplicar, un número = cuántos documentos puede citar el agente).

---

## 2026-08-19 · 12:00:00 UTC — `20260819120000_lexie_tipo_ejecucion.sql` · ⏳ PENDIENTE DE APLICAR

**Contexto:** Fase 8 / sub-paso 8.0. Primera pieza de LEXIE, el asistente global de la app. Va **antes** que cualquier línea de código del agente, a propósito.

**Tipo:** recreación de un CHECK constraint + dos tablas nuevas. Puramente aditiva sobre lo existente. Idempotente (`IF NOT EXISTS` en todo lo nuevo).

**Cambios:**

1. `ejecuciones.tipo` pasa a aceptar un sexto valor, `'lexie'`.
2. `conversaciones_lexie` — un hilo de conversación con la asistente global, por usuario. Sin `caso_id`: LEXIE no cuelga de ninguna causa.
3. `mensajes_lexie` — los mensajes de cada hilo (`usuario` | `agente`), con `metadata jsonb` para búsquedas, consultas al repositorio y herramientas usadas.

Más un índice por hilo activo, uno por conversación+fecha, RLS deny-by-default y `REVOKE` a `anon`/`authenticated` (consistente con el hardening de la Fase 5.5).

**Decisión — tablas propias y no reusar `conversaciones_caso` con `caso_id` nullable:** (a) esa tabla tiene un partial unique index que garantiza UNA conversación activa por caso, y con `caso_id NULL` esa invariante se pierde en silencio para las filas nuevas; (b) `mensajes_conversacion.respuesta_estructurada` guarda las `acciones` del mapa procesal, un concepto que en LEXIE no existe; (c) los dos agentes van a evolucionar por separado —el del caso hacia la escritura del mapa, LEXIE hacia agenda y correo— y compartir tabla los ata sin que nada lo pida. El costo es duplicar dos tablas chicas; el beneficio es que ninguna feature puede romper a la otra por schema.

**Por qué primero y no después:** el CHECK es lo único que separa un turno de LEXIE de un 500. La ruta persiste la ejecución *después* de que Anthropic ya facturó los tokens, así que un INSERT rechazado por el constraint no es cosmético: son tokens cobrados que no quedan en ninguna fila, no descuentan del cupo mensual y no aparecen en `/api/consumo`. El precedente exacto es `riesgo_alto` del mapa — agregar la columna al `SELECT` sin correr la migración primero dejó 500 en todos los reads.

**Por qué `'lexie'` y no `'consulta_global'`:** los otros cinco valores nombran la ACCIÓN (`pre_analisis`, `analizar_caso`). LEXIE no es una acción, es un interlocutor: un turno suyo puede haber sido una consulta a la agenda, una búsqueda de jurisprudencia, o las dos. Lo que tienen en común es quién lo atendió. El desglose de qué hizo el turno va en `metadata`.

**Estado previo verificado contra la base real** (2026-08-19, proyecto `xvdlnevcvcsgxbngwliv`, vía PostgREST con la service_role key — no copiado del repo):

| tipo | filas |
|---|---|
| `pre_analisis` | 62 |
| `analizar_caso` | 48 |
| `consulta_caso` | 19 |
| `simular_audiencia` | 7 |
| `simular_mapa` | 6 |

Los cinco están **en uso**, así que ninguno se puede omitir al recrear el CHECK. El `DO` block borra el constraint vigente **por definición** y no por nombre, igual que `20260706190000` y `20260721120000`: hay drift repo↔DB y el nombre puede no ser el default.

**Independiente de `20260807120000_repositorio_rag.sql`** (la otra pendiente): tocan objetos distintos y se pueden correr en cualquier orden.

**Aplicación:** ⏳ **pendiente.** La corre Mateo a mano en el SQL Editor. Claude Code no la ejecutó: el MCP de Supabase de esta sesión sigue scopeado a otra organización (devuelve dos proyectos de `mateomrb19@gmail.com`, ninguno es `xvdlnevcvcsgxbngwliv`).

**Bloquea:** `POST /api/lexie` y `GET /api/lexie` fallan con "relation does not exist" hasta que se aplique. El resto de la app no se entera: nada más consulta estas tablas, y `'lexie'` no se inserta desde ningún otro lado.

**Verificación** (el CHECK con los 6 valores + las dos tablas):

```sql
SELECT pg_get_constraintdef(con.oid)
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'ejecuciones' AND con.contype = 'c'
  AND pg_get_constraintdef(con.oid) ILIKE '%tipo%';

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('conversaciones_lexie', 'mensajes_lexie');
```
