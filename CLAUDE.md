# APPabogados — EstrategiaLegal

## Descripción

App web para 3 abogados penales argentinos (Lautaro, Gonzalo, Mateo). Cada uno describe un caso, completa un formulario dinámico generado por IA y recibe estrategias legales fundamentadas con citas del Código Penal, código procesal y manuales de litigación argentinos. Cada análisis se trackea en Supabase con tokens reales del SDK y costo en USD.

**Estado:** beta interna en ~10% del desarrollo deseado. Tres usuarios fijos por whitelist, sin multi-tenancy. No está en producción.

## Stack

- **Frontend / Backend:** Next.js 16.2.4 App Router con TypeScript strict.
- **Auth:** Clerk v7 (solo Google OAuth, UI en español, dark theme).
- **DB + vector store:** Supabase (Postgres 17.6 + pgvector v0.8.0). Tabla `documentos` cargada con embeddings del Código Penal, Código Procesal Penal Federal y manuales de litigación — **inmutable para esta app** (el corpus no es completamente reproducible desde el repo; ver sección RAG).
- **LLM:** Anthropic SDK (`@anthropic-ai/sdk`), modelo `claude-sonnet-4-5-20250929` con tool-use loop y RAG.
- **Embeddings:** OpenAI `text-embedding-3-small`, 1536 dimensiones. Se usa en runtime para embeddear queries de búsqueda RAG, y en los scripts offline de ingesta del corpus.
- **UI:** shadcn/ui sobre Tailwind v4. Dark-only, clase `.dark` siempre en `<html>`.
- **Validación:** Zod en el borde de cada API route.
- **Deploy:** Easypanel manual (Dockerfile en raíz, **pendiente de Fase 5.4**). Dominio objetivo: `lexstrategy.teotec.org`. Sin CI, sin auto-deploy.

## Estructura del repo

```
src/
  proxy.ts                        # Clerk middleware (Next 16 lo llama "proxy.ts")
  app/
    layout.tsx                    # ClerkProvider con esES + baseTheme shadcn
    page.tsx                      # Dashboard (tabs: Nuevo análisis / Mi consumo)
    globals.css                   # Paleta dark
    sign-in/, sign-up/, forbidden/
    api/
      analizar-caso/route.ts      # POST: tool-use loop + RAG, maxDuration=120
      pre-analisis/route.ts       # POST: single-shot sin RAG, maxDuration=60
      consumo/route.ts            # GET: consumo del mes + historial drill-down
      casos/
        route.ts                  # GET/POST: lista y creación de casos
        [id]/
          conversaciones/
            route.ts              # GET/POST: lista y crea conversaciones del caso
            [conv_id]/
              route.ts            # GET detalle, PATCH renombrar
              mensajes/route.ts   # GET/POST: chat persistente (tool-use loop + RAG)
  components/
    app-shell.tsx, header/, consumo/, nuevo-analisis/, ui/
  lib/
    agent/                        # run-agent.ts, run-agent-consulta.ts, prompts, parse, pricing, tools
    auth/                         # whitelist, enforce-rate
    rag/                          # embed, match-documents
    supabase/server.ts            # cliente con service_role key (server-side)
    schemas.ts                    # Zod input/output schemas
    anthropic.ts, openai.ts, env.ts, http.ts, format.ts, utils.ts
    hooks/use-consumo.tsx

supabase/migrations/              # SQL aplicado vía SQL Editor (ver MIGRATION_LOG.md)
scripts/
  ingestar-cppf.ts                # ingestor del CPPF (PDF local → documentos). Destructivo: delete-before-insert.
  test-agent.ts                   # smoke test del agente RAG end-to-end
  count-system-tokens.ts          # mide tokens del system prompt + tool descriptions

legacy/                           # Sistema viejo (Express + index.html + n8n).
                                  # Apagado, queda por referencia histórica.
notas-migracion/                  # Gitignored. Datos sensibles + workflow n8n de ingesta original.
```

## Auth y whitelist

[src/proxy.ts](src/proxy.ts) protege todo excepto `/sign-in/*` y `/sign-up/*`. Adentro de cada API route, `requireUsuarioOr403()` ([src/lib/auth/whitelist.ts](src/lib/auth/whitelist.ts)) hace lazy-sync Clerk→Supabase:

1. Toma el primary email de Clerk, lo lowercasea.
2. Busca `usuarios` por `email = LOWER(clerk_email)`.
3. Si no hay match → **403** ("Email no está en la whitelist").
4. Si match con `clerk_user_id IS NULL`, lo setea (con guard `.is('clerk_user_id', null)` contra concurrencia).
5. Si match con un `clerk_user_id` distinto al actual → **403** ("Email reclamado por otro usuario").

Nunca pisa `nombre` ni `email`. El identificador lógico del sistema es `usuarios.nombre` (alimenta la vista de consumo y los colores del UI).

**Whitelist actual:**
- Mateo: `mateomorbi19@gmail.com` (role: admin)
- Gonzalo: `gonzalo.ezequiel.brandoni@gmail.com` (role: user)
- Lautaro: `lautiicardoso@gmail.com` (role: user)

## API routes

### `POST /api/pre-analisis`
Single-shot, **sin RAG, sin tool-use**. Puro conocimiento paramétrico del modelo. `maxDuration = 60`.

Body: `{ caso: string >= 20 chars }`
Response: `{ ok: true, resumen_preliminar, datos_detectados, preguntas[] }`

### `POST /api/analizar-caso`
Tool-use loop con RAG. `maxDuration = 120` (latencia medida ~87-90s).

Body: `{ caso, rol: "defensor" | "querellante" | "ambos", contexto: {...} }`
Response: `{ ok: true, defensor?, querellante?, metadata, busquedas[] }`

El loop ([src/lib/agent/run-agent.ts](src/lib/agent/run-agent.ts)):
- `maxIterations = 12` por defecto (HARD_CAP + 2 de margen para garantizar iteración final sin tools).
- Tool `buscar_documentos_legales` → embed (OpenAI, 1536 dims) → `match_documents` (RPC pgvector, top K=5 hardcodeado en el call site).
- Cap duro `HARD_CAP_BUSQUEDAS = 10` en código. El system prompt pide "entre 3 y 6 búsquedas, con tope absoluto en 10".
- **El RAG no está forzado:** no se usa `tool_choice`; el modelo puede decidir responder sin buscar.
- Al agotar el cap, el loop hace un `messages.create` sin `tools` (quita la herramienta del parámetro) para forzar síntesis y marca `degraded_response = true`.
- Si la API de Anthropic falla mid-loop o se exceden los caps, lanza `AgentError` (`API_ERROR`, `CAP_EXCEEDED_NO_SYNTHESIS`, `MAX_ITERATIONS`) con tokens parciales que **sí** se persisten en `ejecuciones`.

### `POST /api/casos/:id/conversaciones/:conv_id/mensajes` — chat persistente
Tool-use loop con RAG sobre el historial multi-turno del caso. `maxDuration = 120`.

Body: `{ contenido: string, adjuntos?: [...] }`

El agente de chat ([src/lib/agent/run-agent-consulta.ts](src/lib/agent/run-agent-consulta.ts)) usa el mismo loop que `analizar-caso` (`HARD_CAP_BUSQUEDAS = 10`, `maxIterations = 12`, tool `buscar_documentos_legales`). La única diferencia es el primer user message: incluye adjuntos como content blocks. El historial se reconstruye desde `mensajes_conversacion` antes de cada turno.

**Deuda técnica:** el loop está duplicado casi verbatim entre `run-agent.ts` y `run-agent-consulta.ts`.

Rutas relacionadas del chat:
- `GET/POST /api/casos/[id]/conversaciones` — lista y crea conversaciones.
- `GET/PATCH /api/casos/[id]/conversaciones/[conv_id]` — detalle y renombrar.
- Máximo 1 conversación activa por caso (enforced por partial unique index en DB; la ruta archiva la activa previa antes de crear una nueva).

### `GET /api/consumo`
Sin maxDuration custom. Devuelve consumo del mes en curso + historial (top 20 por `ejecutado_en DESC`).

Response:
```json
{
  "consumo": { "nombre", "tokens_usados_mes", "gasto_usd_mes", "ejecuciones_mes",
               "tokens_restantes", "limite_tokens_mensual" },
  "historial": [{ "id", "tipo", "modelo", "input_tokens", "output_tokens",
                  "total_tokens", "costo_usd", "ejecutado_en", "metadata" }]
}
```

`metadata` es jsonb laxo; el cliente lo valida con Zod en el modal de detalle (drill-down 5.1).

## Schema en Supabase

Proyecto: `xvdlnevcvcsgxbngwliv` (región us-west-2, Postgres 17.6). RLS habilitada en las 9 tablas; el server siempre accede con `service_role` key.

**Tablas de tracking / usuario:**
- `usuarios`: `id UUID, nombre UNIQUE, email, clerk_user_id, role (admin|user), limite_tokens_mensual=1.000.000, created_at`.
- `ejecuciones`: `usuario_id FK, tipo (pre_analisis|analizar_caso|consulta_caso), modelo, input_tokens, output_tokens, total_tokens (GENERATED), costo_usd, latencia_ms, ejecutado_en, metadata jsonb`. Las ejecuciones con `metadata.refunded=true` se excluyen del consumo mensual.
- `casos`: vincula un análisis a un usuario.
- `eventos_caso`: eventos dentro de un caso (adjuntos, cambios de estado).
- `conversaciones_caso`: conversaciones de chat por caso (máx. 1 activa por vez).
- `mensajes_conversacion`: mensajes individuales de cada conversación (tipo `usuario` o `agente`).
- `fuentes_legales`: catálogo de 3 fuentes (CP Ley 11.179, CPPF Ley 23.984, Manual de Litigación). Existe en el schema pero no está operativa: `documentos.fuente_id` es NULL en todos los chunks (FK huérfana).
- `casos_analizados`: **deprecated, 0 filas.** Tabla del modelo viejo de análisis; no se usa en el código actual.

**Vistas:**
- `v_consumo_mensual`: agrega el mes en curso por usuario (timezone `America/Argentina/Buenos_Aires`), excluyendo ejecuciones con `metadata.refunded=true`.
- `estadisticas_base`: agrega chunks por fuente (`fuentes_legales LEFT JOIN documentos`). Hoy reporta 0 en todo porque `documentos.fuente_id` está NULL.

**Vector store (`documentos`):** ver sección RAG.

Tokens guardados: **reales del SDK** (`response.usage.input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`). El costo se calcula en [src/lib/agent/pricing.ts](src/lib/agent/pricing.ts) con tier de long-context (>200K input → 2x precio en Sonnet 4.5).

Bitácora de migraciones SQL: ver [MIGRATION_LOG.md](MIGRATION_LOG.md). **Nota:** hay drift entre el repo y la DB — algunas migraciones se aplicaron vía SQL Editor sin registrar el version stamp en `supabase_migrations`; otras existen en la DB pero no como archivo en `supabase/migrations/` (en particular las de RLS de Fase 5.5).

## RAG — Sistema de recuperación

### Corpus

La tabla `documentos` contiene **3.934 chunks** de derecho penal argentino, todos con embedding `vector(1536)`. Desglose por `tipo_documento`:
- `manual` = 2.974 chunks (manuales de litigación penal)
- `codigo` = 590 chunks (Código Penal)
- `codigo_procesal` = 370 chunks (CPPF Infojus 2014)

Columnas: `id bigint (PK)`, `contenido text`, `embedding vector(1536)`, `fuente_id uuid (FK nullable)`, `tipo_documento`, `libro/titulo/capitulo/articulo/seccion text`, `pagina int4`, `metadata jsonb DEFAULT '{}'`, `created_at`.

Índice vectorial: **HNSW cosine** (`documentos_embedding_idx USING hnsw (embedding vector_cosine_ops)`).

Limitación de metadata: solo el **~24% de los chunks** (950/3.934) tienen número de `articulo` en metadata. El system prompt exige citar el artículo exacto tal como aparece en el chunk, pero el ~76% del corpus no trae ese campo estructurado.

Sin integraciones externas: no hay SAIJ, no hay scraping, no hay segunda API legal. Las únicas llamadas en runtime son a Anthropic (LLM), OpenAI (embeddings) y Supabase (DB + vector store).

### Pipeline de ingestión

**No está completamente versionado en el repo.** El corpus tiene dos orígenes:

- **`codigo_procesal` (370 chunks):** generados por [scripts/ingestar-cppf.ts](scripts/ingestar-cppf.ts), el único ingestor en el repo. Lee `notas-migracion/cppf-2014.pdf` (PDF local, Infojus 2014), chunkea por artículo con cap de 1.500 caracteres (split por oración, sin overlap), embeddea con OpenAI `text-embedding-3-small` e inserta en `documentos`. Script manual (sin CI, sin pg_cron); es **destructivo** (delete-before-insert de los chunks previos del tipo).

- **`manual` + `codigo` (3.564 chunks, ~90% del corpus):** cargados en 2026-03-25 por el workflow n8n `notas-migracion/workflow-n8n-ingesta.json` (gitignored). Descargó PDFs desde Google Drive (`Codigo_Penal.pdf`, `Manual_Litigacion_1/2/3.pdf`), embeddeó vía OpenAI y los insertó directamente. **No reproducible desde el código versionado.**

El schema de `documentos` tampoco está en ninguna migración versionada (fue creado fuera del repo).

### Pipeline de recuperación

La RPC `match_documents(query_embedding vector, match_count int DEFAULT 5, filter jsonb DEFAULT '{}')` realiza la búsqueda vectorial en Postgres con:
- Distancia coseno (operador `<=>`)
- Umbral hardcodeado en la función SQL: `WHERE 1 - (embedding <=> query_embedding) > 0.55` (evolución: 0.5 → 0.6 → 0.55; con 0.6 el 50% de búsquedas daban 0 resultados)
- `LIMIT match_count` — el call site siempre pasa `match_count=5`
- El parámetro `filter jsonb` existe en la firma pero **no se usa en el cuerpo** — no hay filtrado por metadata.

En la app ([src/lib/agent/run-agent.ts](src/lib/agent/run-agent.ts)): no hay re-ranking ni filtrado post-RPC. Los docs (ya ordenados y filtrados por Postgres) se serializan crudos como `tool_result` — JSON array de `{content, metadata, similarity}`. Si el RPC devuelve 0 resultados, se inyecta un array vacío y el modelo continúa sin fallback ni señal al usuario.

## Variables de entorno

Definidas en `.env.local` (gitignored). Ver [.env.example](.env.example) para el template.

| Variable | Propósito |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Cliente Clerk |
| `CLERK_SECRET_KEY` | Server Clerk |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-in` (sub-paso 4.6 redirige el sign-up al flow de Google del sign-in) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/` |
| `NEXT_PUBLIC_SUPABASE_URL` | Solo el host raíz, sin `/rest/v1/` (rompe con PGRST125 si lo lleva) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Server (write a `ejecuciones`, lazy-sync a `usuarios`) |
| `ANTHROPIC_API_KEY` | Claude |
| `OPENAI_API_KEY` | Embeddings (queries en runtime + ingesta offline) |

## Desarrollo local

```bash
npm install
npm run dev                              # :3000
npx tsc --noEmit                         # type-check
npm run lint                             # eslint
npx tsx scripts/test-agent.ts            # smoke test del agente RAG end-to-end
npx tsx scripts/count-system-tokens.ts   # mide system+tool tokens (decisión de prompt caching)
```

## Convenciones

- **Commits en español** prefijados por sub-paso (`"5.1: drill-down del historial..."`).
- **Stage explícito** archivo por archivo (`git add path/a.tsx path/b.tsx`); nunca `git add .`.
- **No pushear sin OK explícito** tras QA manual.
- **Nunca `--no-verify`** ni saltar hooks.
- TS strict siempre. Sin hardcodear credenciales.
- Validar todo input con Zod en el borde.
- **Tabla `documentos` inmutable** (vector store ya cargado; `ingestar-cppf.ts` es destructivo — no correrlo salvo que sea necesario recargar el corpus procesal explícitamente).
- **`notas-migracion/` jamás se commitea** (gitignored, datos sensibles y workflows de n8n).
- **Paleta:** `--background: #0a0e17`, `--card: #0f172a`, acento `#8b5cf6`. Fuente: Inter (UI y display, sin serif).
- **Formato es-AR:** números con `toLocaleString('es-AR')`, fechas `DD/MM/YYYY HH:MM`.
- **El prompt al modelo exige JSON puro** (sin markdown ni backticks). El parser limpia backticks defensivamente.

## Carpeta `/legacy/`

El sistema anterior — Express + `index.html` monolítico + 3 webhooks de n8n — vive en `/legacy/`. **No se ejecuta más**, queda por referencia histórica:

- `legacy/index.html`, `legacy/server.js`, `legacy/Dockerfile` — la app vieja servida por Express.
- `legacy/supabase-schema-original.sql` — schema inicial (ahora versionado vía `supabase/migrations/`).
- `legacy/workflows-template/consultar-consumo.json` — export del workflow n8n cuyo equivalente nuevo es `GET /api/consumo`.
- `legacy/scripts/setup-n8n.mjs`, `legacy/scripts/setup-supabase.mjs` — utilidades de setup del sistema viejo.

El servicio legacy en Easypanel se apagará al deployar la app nueva, sin coexistencia. La app nueva reemplaza directamente al legacy en `lexstrategy.teotec.org`.

## Estado de la migración

Migración del sistema viejo a este stack en 5 fases. Fases 1–5.5 cerradas; **Fase 5.6 pendiente**:

- 5.1 ✅ historial drill-down con modal de detalle.
- 5.2 ✅ legacy movido a `/legacy/`.
- 5.3 ✅ este documento + auditoría arquitectónica del RAG.
- 5.4 ⏳ Dockerfile nuevo en raíz (Next 16 standalone, multi-stage).
- 5.5 ✅ pre-deploy checks (hardening RLS deny-by-default, revoke anon/authenticated, email Lautaro cargado en DB).
- 5.6 ⏳ deploy manual a Easypanel reemplazando el servicio legacy en `lexstrategy.teotec.org`. Sin coexistencia, sin URL temporal beta, sin swap DNS.

Pendientes conocidos:
- Dockerfile en raíz: el viejo se movió a `/legacy/Dockerfile`, el nuevo se crea en 5.4.

El plan detallado de las fases vive en la memoria del proyecto, no en el repo.
