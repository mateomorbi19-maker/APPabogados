# Auditoría APPabogados — 2026-05-07

> **Aclaración importante:** el prompt de auditoría original describía el sistema **legacy** (`index.html` + `server.js` + n8n). Ese stack ya no es el actual. Se movió a `/legacy/` en la Fase 5.2 y no se ejecuta más. Esta auditoría se reformuló contra el stack vigente: **Next.js 16 + Clerk + Anthropic SDK directo + Supabase**.

## 1. Resumen ejecutivo

- La app **funciona end-to-end** en local: login Clerk → whitelist Supabase → pre-análisis → formulario dinámico → análisis profundo con RAG → tracking → drill-down de historial → creación de "Mis casos" con timeline procesal.
- **Fases 1-5.4 cerradas**; falta **5.5 (pre-deploy checks)** y **5.6 (deploy a Easypanel)**. El Dockerfile multi-stage ya existe en raíz.
- 27 ejecuciones reales en DB acumulando ~219K tokens y ~$1.38 USD. Solo 2 usuarios activos (Mateo, Gonzalo); Lautaro nunca logueó.
- **3 hallazgos críticos pre-deploy**:
  1. **RLS DESACTIVADA** en `usuarios`, `ejecuciones`, `casos`, `eventos_caso`. La app pasa por service_role (la bypassea de todos modos), pero el `anon` key es público y permite leer/modificar todo.
  2. **3 fallos consecutivos `LIMITE_BUSQUEDAS_EXCEDIDO`** el 2026-05-01 (cobrados al usuario, sin resultado). Patrón recurrente, no caso aislado.
  3. **Lautaro tiene `email = NULL`** en whitelist; cualquier intento suyo de login devuelve 403 hasta que se cargue manualmente.

## 2. Stack y estructura del repo

- **Framework:** Next.js 16.2.4 App Router + React 19.2.4 + TypeScript strict.
- **Auth:** `@clerk/nextjs` v7.2.5 (solo Google OAuth, UI `esES`, `baseTheme: shadcn`).
- **DB:** `@supabase/supabase-js` v2.104.1 con `service_role` server-side. Postgres 17.6 + pgvector 0.8.0 (schema `public`).
- **LLM:** `@anthropic-ai/sdk` v0.91.0 — modelo `claude-sonnet-4-5-20250929`.
- **Embeddings:** `openai` v6.34.0 — `text-embedding-3-small`.
- **UI:** shadcn/ui v4.4.0 sobre Tailwind v4. Dark-only (`<html class="dark">`).
- **Validación:** `zod` v4.3.6 en cada API route + en cliente (defense in depth).
- **Archivos en repo:** 287 tracked totales; **82 en [src/](src/)**.
- **Estructura clave:**
  - [src/proxy.ts](src/proxy.ts) — middleware Clerk (Next 16 lo nombra "proxy.ts", no "middleware.ts")
  - [src/app/](src/app/) — `page.tsx`, `layout.tsx`, `sign-in/`, `sign-up/`, `forbidden/`, `dashboard/mis-casos/`, `api/` (6 routes)
  - [src/lib/agent/](src/lib/agent/) — `run-agent.ts`, `prompts.ts`, `tools.ts`, `parse.ts`, `pricing.ts`
  - [src/lib/auth/](src/lib/auth/) — `whitelist.ts`, `enforce-rate.ts`
  - [src/lib/rag/](src/lib/rag/) — `embed.ts`, `match-documents.ts`
  - [src/components/](src/components/) — `app-shell.tsx`, `header/`, `consumo/`, `nuevo-analisis/`, `mis-casos/`, `ui/` (shadcn)
  - [supabase/migrations/](supabase/migrations/) — 5 SQL migrations versionadas
  - [scripts/](scripts/) — `test-agent.ts`, `count-system-tokens.ts`, `ingestar-cppf.ts`
  - [legacy/](legacy/) — sistema viejo (Express + index.html + n8n) congelado, no se ejecuta

## 3. Frontend (Next.js)

### Pantallas implementadas

| Ruta | Contenido | Notas |
|---|---|---|
| `/` | Dashboard con tabs **Nuevo análisis** + **Mi consumo** | [app-shell.tsx:18-29](src/components/app-shell.tsx#L18-L29) |
| `/sign-in/[[...sign-in]]` | Clerk SignIn (solo Google) | esES + baseTheme shadcn |
| `/sign-up/[[...sign-up]]` | Idem `/sign-in` (mismo flow Google) | |
| `/forbidden` | 403 cuando email no está en whitelist | |
| `/dashboard/mis-casos` | Sidebar con lista de casos del usuario | Empty state si no hay nada — y hoy no hay (0 casos en DB) |
| `/dashboard/mis-casos/[id]` | Detalle: header + caso original + estrategia + timeline + placeholder agente | [mis-casos/[id]/page.tsx](src/app/dashboard/mis-casos/[id]/page.tsx) |

### Tab "Nuevo análisis" — flujo dinámico

5-fase state machine en [nuevo-analisis-panel.tsx:43-72](src/components/nuevo-analisis/nuevo-analisis-panel.tsx#L43-L72):

`input → loading-pre → form → analizando → resultado` (con ramas `error-pre` y `error-analisis`).

- **Caso input** → POST `/api/pre-analisis` → respuesta con preguntas dinámicas.
- **Form dinámico** → renderiza preguntas (select / radio / text / checkbox) + selector de rol (defensor / querellante / ambos).
- **Analizando** → POST `/api/analizar-caso`, ProgresoAnalisis con cancelación vía AbortController, **recuperación post-502** vía polling a `/api/ejecuciones/buscar` (Easypanel/Traefik puede cortar antes de que termine el server).
- **Resultado** → `ResultadosAnalisis` con cards de estrategias (defensor / querellante) + RAG colapsable + botón "Seleccionar estrategia" → modal `SeleccionarEstrategiaModal` → POST `/api/casos`.

### Tab "Mi consumo"

Provider `ConsumoProvider` ([use-consumo.tsx](src/lib/hooks/use-consumo.tsx)) con in-flight guard + AbortController. Componentes:

- **MetricCards** — 4 cards: tokens usados / cupo / costo USD / ejecuciones.
- **HistorialTable** — top 20 del mes, click abre `HistorialDetalle` (modal con drill-down: caso, contexto, resultado, búsquedas RAG, parseo, errores).
- Botón **Actualizar** con `disabled={isLoading}` + ref para evitar doble fetch.

### Header

- Sticky con `EstrategiaLegal` (DM Serif Display) + nombre del usuario.
- Nav: links **Análisis** (`/`) y **Mis casos** (`/dashboard/mis-casos`).
- **ConsumoBar** — barra de progreso de tokens del mes (lee del `ConsumoProvider`).
- **UserButton** de Clerk a la derecha.

### Issues detectados (frontend)

- **Inconsistencia menor de UX:** la pestaña principal vive en `/` con tabs Tabs(Nuevo / Consumo), pero **Mis casos** vive bajo `/dashboard/mis-casos`. El header tiene los dos primeros como tabs internos y "Mis casos" como link de nav — el modelo mental dual puede confundir; o todo van como tabs, o todo como rutas.
- En [seleccionar-estrategia-modal.tsx:107-110](src/components/nuevo-analisis/seleccionar-estrategia-modal.tsx#L107-L110) hay un comentario `TODO Fase 5: cuando exista /dashboard/mis-casos/[id], redirigir ahí`. La página ya existe (Fase 5b) pero el redirect sigue yendo a la lista. Debería ir a `/dashboard/mis-casos/{caso_id}`.

## 4. Backend (API routes)

| Route | Método | maxDuration | Descripción |
|---|---|---|---|
| [/api/pre-analisis](src/app/api/pre-analisis/route.ts) | POST | 60s | Single-shot sin RAG. Devuelve `resumen_preliminar`, `datos_detectados`, `preguntas[]`. |
| [/api/analizar-caso](src/app/api/analizar-caso/route.ts) | POST | 120s | Tool-use loop con RAG. `maxIterations=10`, `HARD_CAP_BUSQUEDAS=6`. |
| [/api/consumo](src/app/api/consumo/route.ts) | GET | default | Consumo del mes (vista) + historial (top 20). |
| [/api/ejecuciones/buscar](src/app/api/ejecuciones/buscar/route.ts) | GET | default | Polling para recuperar análisis tras 502 del proxy. |
| [/api/casos](src/app/api/casos/route.ts) | POST / GET | default | Crea caso desde una ejecución / lista casos del usuario. |
| [/api/casos/[id]](src/app/api/casos/[id]/route.ts) | GET / DELETE | default | Detalle / cascade delete. |
| [/api/casos/[id]/eventos](src/app/api/casos/[id]/eventos/route.ts) | POST | default | Agrega evento manual al timeline. |
| [/api/casos/[id]/eventos/[evento_id]](src/app/api/casos/[id]/eventos/[evento_id]/route.ts) | DELETE | default | Borra evento. |

**Patrón consistente:**
1. Parse del body con Zod.
2. `requireUsuarioOr403()` (Clerk → whitelist Supabase).
3. `enforceTokenLimit()` para los endpoints LLM (lee `v_consumo_mensual`).
4. Llamada a Anthropic / Supabase.
5. INSERT en `ejecuciones` con tokens reales del SDK + `costo_usd` calculado.
6. Response con `ok: true/false`. En `isDev()` agrega `detail` con el mensaje del error.

### Agente RAG ([run-agent.ts](src/lib/agent/run-agent.ts))

- Tool única `buscar_documentos_legales` ([tools.ts:6-21](src/lib/agent/tools.ts#L6-L21)).
- Tool flow: `embedQuery(OpenAI text-embedding-3-small)` → `match_documents` RPC en pgvector (top 5).
- En cada iteración: pushea `assistant` content y `user` con tool_results, re-llama Claude.
- **`AgentError`** con `partialUsage` para que aún si el loop falla mid-way los tokens cobrados se persistan en `ejecuciones`.

### Pricing ([pricing.ts](src/lib/agent/pricing.ts))

- Sonnet 4.5: input $3 / output $15 por MTok. Cache write 5m $3.75, cache read $0.30.
- **Long-context tier** (>200K input): input $6, output $22.50. Detectado correctamente sumando input + cache_create + cache_read.
- **No usa prompt caching activamente** (no hay `cache_control` en el system prompt ni en las tools). Toda ejecución reciente tiene `cache_creation_input_tokens = 0` y `cache_read_input_tokens = 0`. Hay margen de optimización del 30-90% en input cost.

### Issues detectados (backend)

- **`HARD_CAP_BUSQUEDAS = 6` se viola por construcción.** En [run-agent.ts:176-183](src/lib/agent/run-agent.ts#L176-L183) el check pasa *después* de pushear todas las búsquedas de la iteración. Si una iteración tiene 4 tool_use blocks y ya había 4 acumuladas, queda en 8 antes del check → throw. Las 3 ejecuciones fallidas del 2026-05-01 cayeron exactamente acá (`n_busquedas=8, iterations=2, error=LIMITE_BUSQUEDAS_EXCEDIDO`).
- **El system prompt es text plain string** ([prompts.ts:3-4](src/lib/agent/prompts.ts#L3-L4)) — no array con `cache_control`. Para activar prompt caching habría que migrar a `system: [{ type: "text", text: ..., cache_control: { type: "ephemeral" }}]` y igual con tools. Es la mejora más alta de ROI antes de deploy si crece volumen.
- **El system prompt es enorme y monolítico**: 1 string con todas las instrucciones + reglas de fundamentación + advertencia CPPF vs CPP viejo. Es candidato directo a caching.
- **`repairJSON` defensivo en [parse.ts:15-25](src/lib/agent/parse.ts#L15-L25)** — limpia backticks aunque el system prompt diga "JSON puro sin backticks". Trade-off OK pero indica que el modelo a veces igual los pone.
- **No hay test automatizado** — `scripts/test-agent.ts` es smoke manual. Sin CI.

## 5. Auth y whitelist

- [src/proxy.ts](src/proxy.ts): `clerkMiddleware`, public routes `/sign-in(.*)`, `/sign-up(.*)`. Resto pasa por `auth.protect()`.
- [whitelist.ts:24-81](src/lib/auth/whitelist.ts#L24-L81): lazy-sync Clerk→Supabase. Match por `email = LOWER(clerk_email)`. Si `clerk_user_id IS NULL`, lo setea con guard `.is('clerk_user_id', null)`. Si ya está seteado a otro userId → 403.
- [enforce-rate.ts](src/lib/auth/enforce-rate.ts): consulta `v_consumo_mensual.tokens_restantes`. Si <= 0 → 429.

### Issues detectados (auth)

- **Lautaro:** `email = NULL`, `clerk_user_id = NULL`. Cualquier login suyo → 403 ("Email no está en la whitelist"). Bloqueo intencional según `MIGRATION_LOG.md`. Antes de deploy, decidir: cargar email confirmado o asumir que no la usará todavía.
- **No hay revocación.** Si un email se va del equipo, hay que borrar manualmente la fila en `usuarios`. No hay UI ni endpoint admin.

## 6. Supabase

### Tablas (schema `public`)

| Tabla | Filas | RLS | Notas |
|---|---|---|---|
| `usuarios` | 3 | ❌ | Mateo, Gonzalo, Lautaro |
| `ejecuciones` | 27 | ❌ | tracking de tokens |
| `casos` | 0 | ❌ | feature recién implementada, sin uso aún |
| `eventos_caso` | 0 | ❌ | timeline procesal |
| `documentos` | 3934 | ✅ | RAG vector store, **inmutable** |
| `casos_analizados` | 0 | ✅ | residuo del schema viejo |
| `fuentes_legales` | 0 | ✅ | residuo del schema viejo |

### Whitelist actual

| nombre | email | clerk_user_id | limite |
|---|---|---|---|
| Mateo | mateomorbi19@gmail.com | `user_3CoohlGc6kd0hiVyD7rMS1mbHcz` | 1.000.000 |
| Gonzalo | gonzalo.ezequiel.brandoni@gmail.com | `user_3D6MdeezeeIiH4QVL7KsXUZMKXV` | 1.000.000 |
| Lautaro | NULL | NULL | 1.000.000 |

### Consumo total acumulado (toda la vida, no solo el mes)

| Usuario | Ejecuciones | Input tok | Output tok | Total tok | Costo USD |
|---|---|---|---|---|---|
| Mateo | 20 | 115.212 | 50.391 | 165.603 | $1.10 |
| Gonzalo | 7 | 43.907 | 10.034 | 53.941 | $0.28 |
| Lautaro | 0 | 0 | 0 | 0 | $0 |
| **Total** | **27** | **159.119** | **60.425** | **219.544** | **$1.38** |

### Vista `v_consumo_mensual`

- Filtra por `date_trunc('month', e.ejecutado_en AT TIME ZONE 'America/Argentina/Buenos_Aires') = date_trunc('month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires')`.
- Hoy 2026-05-07 reporta 0 tokens / 0 ejecuciones para los 3 usuarios — **es correcto**: la última ejecución es del `2026-05-01 00:06:43 UTC` (= 2026-04-30 21:06:43 ART → cae en abril zona AR). Toda la actividad del proyecto fue en abril hora argentina.

### Vector store `documentos`

- **3.934 chunks**, embedding pgvector 0.8.0, ~1.000 chars promedio por chunk.
- 349 artículos distintos con `articulo` poblado; 2.984 sin (ej: chunks de manuales).
- **Composición:**

| tipo_documento | libro | chunks |
|---|---|---|
| `manual` | NULL | **2.974** |
| `codigo` | varios (CP) | 590 (suma de 6 entries con etiquetas distintas) |
| `codigo_procesal` | LIBRO PRIMERO/SEGUNDO/... (CPPF Ley 27.063) | **370** |

> **Inconsistencia notable:** los chunks de tipo `codigo` están etiquetados con `libro` heterogéneo: `"libro o periódico"` (300 chunks, parece error de extracción), `"LIBRO SEGUNDO"`, `"libro segundo"`, `"libro\nSegundo"`, `"Libro II"`, `"LIBRO PRIMERO"`. Esto solo afecta filtrado/observabilidad, no la búsqueda vectorial.

- Función `match_documents(query_embedding vector, match_count int=5, filter jsonb='{}')` → cosine similarity, threshold 0.55 (último ajuste en migración `20260501001033`, commit `37abbef`).
- **Schema columnas:** `id`, `contenido`, `embedding`, `fuente_id`, `tipo_documento`, `libro`, `titulo`, `capitulo`, `articulo`, `seccion`, `pagina`, `metadata`, `created_at`. La RPC mapea `contenido → content` en su firma de retorno.

### Issues detectados (Supabase)

- **🔴 RLS DESACTIVADA en 4 tablas críticas** (`usuarios`, `ejecuciones`, `casos`, `eventos_caso`). El advisory crítico de Supabase recomienda habilitarla, pero **no hay políticas escritas todavía** — habilitarla a secas bloquearía la app. La app usa `service_role` server-side (que bypassea RLS), así que en teoría seguiría funcionando, pero el `anon` key sigue siendo público. Pre-deploy: o se rotan las claves y se cierra el `anon`, o se escriben políticas RLS apropiadas.
- **2 tablas zombi**: `casos_analizados` y `fuentes_legales` (0 filas, RLS habilitada). Restos del schema legacy. Candidatas a `DROP`.
- **3 ejecuciones de error costaron $0.14** sin entregar resultado al usuario (todos `LIMITE_BUSQUEDAS_EXCEDIDO`, una serie consecutiva el 2026-05-01).

## 7. Últimos commits relevantes

```
ed70ca2 fix: recuperar análisis tras 502 del proxy via polling al server
a1273e1 feat(fase 5b): timeline interactivo + modales del caso
2646889 feat(fase 5a): vista detalle del caso - header + secciones estáticas
f397493 feat(fase 1-3): tablas casos+eventos, API routes, botón seleccionar estrategia
37abbef fix: bajar threshold RAG a 0.55 + arreglar timezone de consumo mensual
7db4373 fix: endurecer prompt contra alucinación + subir threshold RAG a 0.6
088e932 feat: actualizar prompts para incluir CPPF en corpus
1607061 ingesta: agregar CPPF (Ley 27.063, edición Infojus 2014) al vector store
b05817d parche: alinear prompts y tool con corpus real (sin CPP)
77a78bd 5.4: Dockerfile Next 16 standalone + script de build local
```

> Los commits "feat(fase 1-3)/(fase 5a)/(fase 5b)" son de una **feature interna nueva ("Mis casos")**, no del roadmap de migración. Conviven con las fases 5.x del deploy.

## 8. Estado vs roadmap conocido

### ✅ Hecho
- Sistema de usuarios sin password (Clerk Google OAuth + whitelist por email).
- Tracking de tokens reales del SDK + costo USD con tier long-context.
- Tab "Mi consumo" con métricas + historial top-20 + drill-down con metadata jsonb completo.
- Pre-análisis con preguntas dinámicas + form dinámico tipado (select/radio/text/checkbox).
- Análisis profundo con tool-use loop, RAG, parser con 3 intentos de recovery, recuperación post-502.
- Cancelación de análisis vía AbortController.
- Feature **"Mis casos"**: crear caso desde estrategia → snapshot → timeline procesal con eventos manuales.
- Migración SQL versionada en `supabase/migrations/` + bitácora `MIGRATION_LOG.md`.
- Dockerfile Next 16 standalone multi-stage en raíz (Fase 5.4).
- Legacy aislado en `/legacy/`.

### ⚠️ A medias / con bugs
- **`HARD_CAP_BUSQUEDAS=6` rompe ejecuciones en producción** (3 casos reales el mismo día) — arreglar el orden de check antes de deploy.
- **Modal "Seleccionar estrategia" redirige a `/dashboard/mis-casos`**, no al caso recién creado (TODO de Fase 5 quedó vivo).
- **No hay prompt caching activado** — sería la mejora de costo más alta de ROI.

### ❌ No empezado
- **Pre-deploy checks (Fase 5.5)** — sin docs de qué chequear.
- **Deploy a Easypanel (Fase 5.6)** reemplazando el servicio legacy en `lexstrategy.teotec.org`.
- **Email de Lautaro** — bloquea su login.
- **RLS policies** — ninguna tabla operativa tiene RLS habilitada.
- **Limpieza de tablas zombi** (`casos_analizados`, `fuentes_legales`).
- **CI** — no hay GitHub Actions ni hooks pre-push (solo lo que esté en husky/lint-staged si aplica).
- **Tests automáticos** — solo smoke `scripts/test-agent.ts`.
- **Backlog del corpus** según memoria: ingestar Código Aduanero (Tanda 2), threshold adaptativo si 0.55 sigue dejando queries vacías.
- **Branding "BraCar"**, simulación procesal, exactitud de tokens, ingesta de nuevo contenido — mencionado en el prompt original pero no aparece en el roadmap actual.

## 9. Recomendaciones priorizadas pre-deploy

1. **Bloqueador**: arreglar el orden de chequeo del `HARD_CAP_BUSQUEDAS` para no cobrar al usuario fallos sistemáticos de tool-use. O bajar `maxIterations`, o capear *antes* de ejecutar las búsquedas.
2. **Bloqueador**: definir política para RLS antes de cerrar deploy. Mínimo: rotar `anon key` y dejar la nueva expuesta solo si tiene 0 permisos sobre tablas operativas.
3. **Alto**: activar prompt caching en system + tools del agente. Sonnet 4.5 con cache read = 0.1× input → ahorro real con 10 ejecuciones por día.
4. **Alto**: redirect del modal `SeleccionarEstrategiaModal` a `/dashboard/mis-casos/{caso_id}`.
5. **Medio**: cargar email de Lautaro o documentar que no la usa todavía.
6. **Medio**: drop `casos_analizados` + `fuentes_legales` (tablas vacías del schema viejo).
7. **Bajo**: normalizar `documentos.libro` (llevar todas las variantes a uppercase canónico) si se planea filtrar por código en el futuro.

## 10. Preguntas abiertas para el director

1. **RLS:** ¿la postura es "mantener arquitectura service_role + cerrar el anon" o "escribir policies row-level"? La primera es más rápida y matchea el modelo actual; la segunda es más defensiva si en el futuro se expone supabase-js al cliente.
2. **Fase 5.6 (deploy):** ¿se hace coexistencia (URL temporal beta + swap DNS) o el reemplazo directo en `lexstrategy.teotec.org` que dice CLAUDE.md? Cualquier rollback con reemplazo directo implica re-deployar el legacy desde `/legacy/`.
3. **Lautaro:** ¿bloqueamos el deploy hasta tener su email confirmado o sale a prod con 2 usuarios?
4. **Prompt caching:** ¿lo metemos antes del deploy 5.6 (1-2h de trabajo + verificación de pricing) o lo dejamos como mejora post-deploy?
5. **Feature "Mis casos":** está hecha y testeada en local pero sin un solo caso creado en DB. ¿Querés que el deploy incluya esta feature o se hace flag-off hasta validar?
