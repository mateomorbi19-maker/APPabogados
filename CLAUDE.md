# APPabogados — EstrategiaLegal

## Descripción

App web para 3 abogados penales argentinos (Lautaro, Gonzalo, Mateo). Cada uno describe un caso, completa un formulario dinámico generado por IA y recibe estrategias legales fundamentadas con citas del Código Penal, código procesal y manuales de litigación argentinos. Cada análisis se trackea en Supabase con tokens reales del SDK y costo en USD.

**Estado:** beta interna en ~10% del desarrollo deseado. Tres usuarios fijos por whitelist, sin multi-tenancy. No está en producción.

## Stack

- **Frontend / Backend:** Next.js 16.2.4 App Router con TypeScript strict.
- **Auth:** Clerk v7 (solo Google OAuth, UI en español, dark theme).
- **DB + vector store:** Supabase (Postgres + pgvector). Tabla `documentos` ya cargada con embeddings del Código Penal + manuales — **inmutable para esta app**.
- **LLM:** Anthropic SDK (`@anthropic-ai/sdk`), modelo `claude-sonnet-4-5-20250929` con tool-use loop y RAG.
- **Embeddings:** OpenAI `text-embedding-3-small` (solo para embeddear queries de RAG).
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
  components/
    app-shell.tsx, header/, consumo/, nuevo-analisis/, ui/
  lib/
    agent/                        # run-agent, prompts, parse, pricing, tools
    auth/                         # whitelist, enforce-rate
    rag/                          # embed, match-documents
    supabase/server.ts            # cliente con service_role key (server-side)
    schemas.ts                    # Zod input/output schemas
    anthropic.ts, openai.ts, env.ts, http.ts, format.ts, utils.ts
    hooks/use-consumo.tsx

supabase/migrations/              # SQL aplicado vía SQL Editor (ver MIGRATION_LOG.md)
scripts/                          # smoke tests de la app nueva
  test-agent.ts                   #   correr agente RAG end-to-end
  count-system-tokens.ts          #   medir tokens del system prompt + tool descriptions

legacy/                           # Sistema viejo (Express + index.html + n8n).
                                  # Apagado, queda por referencia histórica.
notas-migracion/                  # Gitignored. Datos sensibles del sistema viejo.
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
- Mateo: `mateomorbi19@gmail.com`
- Gonzalo: `gonzalo.ezequiel.brandoni@gmail.com`
- Lautaro: `email` NULL → si intenta loguear da 403 hasta que se cargue manualmente.

## API routes

### `POST /api/pre-analisis`
Single-shot, sin RAG, sin tool-use. `maxDuration = 60`.

Body: `{ caso: string >= 20 chars }`
Response: `{ ok: true, resumen_preliminar, datos_detectados, preguntas[] }`

### `POST /api/analizar-caso`
Tool-use loop con RAG. `maxDuration = 120` (latencia medida ~87-90s).

Body: `{ caso, rol: "defensor" | "querellante" | "ambos", contexto: {...} }`
Response: `{ ok: true, defensor?, querellante?, metadata, busquedas[] }`

El loop ([src/lib/agent/run-agent.ts](src/lib/agent/run-agent.ts)):
- `maxIterations = 10` por defecto.
- Tool `buscar_documentos` → embed (OpenAI) → `match_documents` (RPC pgvector, top 5).
- Cap duro `HARD_CAP_BUSQUEDAS = 6` en código (el system prompt pide ≤4 al modelo).
- Si la API de Anthropic falla mid-loop o se exceden los caps, lanza `AgentError` con tokens parciales que **sí** se persisten en `ejecuciones`.

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

## Tracking en Supabase

Tablas:
- `usuarios`: `id UUID, nombre UNIQUE, email, clerk_user_id, limite_tokens_mensual=1.000.000, created_at`.
- `ejecuciones`: `usuario_id FK, tipo, modelo, input_tokens, output_tokens, total_tokens (GENERATED), costo_usd, latencia_ms, ejecutado_en, metadata jsonb`.
- Vista `v_consumo_mensual`: agrega del mes en curso (UTC).
- `documentos` (vector store): **inmutable, no tocar**.

Tokens guardados: **reales del SDK** (`response.usage.input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`). El costo se calcula en [src/lib/agent/pricing.ts](src/lib/agent/pricing.ts) con tier de long-context (>200K input → 2x precio en Sonnet 4.5).

Bitácora de migraciones SQL: ver [MIGRATION_LOG.md](MIGRATION_LOG.md).

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
| `OPENAI_API_KEY` | Solo embeddings |

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
- **Tabla `documentos` inmutable** (vector store ya cargado).
- **`notas-migracion/` jamás se commitea** (gitignored, datos sensibles).
- **Paleta:** `--background: #0a0e17`, `--card: #0f172a`, acento `#8b5cf6`. Fuentes: IBM Plex Sans (UI) + DM Serif Display (display).
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

Migración del sistema viejo a este stack en 5 fases. Fases 1-4 cerradas; **Fase 5 en progreso**:

- 5.1 ✅ historial drill-down con modal de detalle.
- 5.2 ✅ legacy movido a `/legacy/`.
- 5.3 ← este documento.
- 5.4 ⏳ Dockerfile nuevo en raíz (Next 16 standalone, multi-stage).
- 5.5 ⏳ pre-deploy checks.
- 5.6 ⏳ deploy manual a Easypanel reemplazando el servicio legacy en `lexstrategy.teotec.org`. Sin coexistencia, sin URL temporal beta, sin swap DNS.

Pendientes conocidos:
- Email de Lautaro: NULL hasta que confirme; si intenta loguear da 403.
- Dockerfile en raíz: el viejo se movió a `/legacy/Dockerfile`, el nuevo se crea en 5.4.

El plan detallado de las fases vive en la memoria del proyecto, no en el repo.
