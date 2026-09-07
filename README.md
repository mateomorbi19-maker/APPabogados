# LEXSTRATEGY

App interna del estudio para analizar causas penales con IA. Un abogado describe
un caso, completa un formulario que la IA genera a medida, y recibe estrategias
fundamentadas con citas del Código Penal, el Código Procesal Penal Federal y
manuales de litigación argentinos. Alrededor de eso están la ficha de la causa,
el mapa procesal, la agenda, la bandeja de correo, el repositorio de
jurisprudencia, la redacción de escritos y el simulador de audiencias.

Repo `APPabogados`, paquete `estrategialegal`. Beta interna, **no está en
producción**. Tres usuarios fijos por whitelist: el email tiene que estar cargado
a mano en la tabla `usuarios` de Supabase o la app manda a `/forbidden`.

## Stack

- **Next.js 16.2.4** (App Router) + **React 19.2.4**, TypeScript strict
- **Clerk v7** para auth, solo Google OAuth. Los scopes de Calendar, Gmail y
  Drive se configuran en el dashboard de Clerk, no por variable de entorno: los
  access tokens de Google salen del vault de Clerk ([token.ts](src/lib/google/token.ts))
- **Supabase** (Postgres + pgvector) como base y vector store. El server entra
  con `service_role`, así que la RLS no aplica: la autorización real la hace
  `casoEsDelUsuario` ([propiedad.ts](src/lib/casos/propiedad.ts))
- **Anthropic SDK** para el análisis, el chat, LEXIE, los escritos y el
  simulador. **OpenAI** solo para embeddings (`text-embedding-3-small`)
- **Tailwind v4** (sin `tailwind.config.js`: el tema vive en
  [globals.css](src/app/globals.css)) + shadcn/ui estilo `base-nova`
- `@xyflow/react` + `dagre` para el mapa procesal, `pdf-lib` para los escritos,
  `zod` para validar el borde de cada API route

## Arranque

```bash
npm install
cp .env.example .env.local     # y completar las 11 variables
npm run dev                    # http://localhost:3000
```

Hace falta:

- **Node.js 20 o superior.** El Dockerfile usa `node:20-bookworm-slim`; si
  desarrollás con una versión más nueva, tenelo presente porque producción
  compila con la 20.
- Un `.env.local` completo. [env.ts](src/lib/env.ts) valida las 11 variables con
  Zod al arrancar y **la app no levanta** si falta una.
- Acceso al proyecto de Supabase. Hay uno solo: dev y prod comparten base.

## Variables de entorno

Las 11 son obligatorias. Ver [.env.example](.env.example).

| Variable | Para qué sirve |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clave pública de Clerk, la usa el `ClerkProvider` en el browser |
| `CLERK_SECRET_KEY` | Clave server-side: valida sesiones y pide el token de Google del usuario |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Ruta de login |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Ruta de registro (el alta real es manual, por whitelist) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | A dónde vuelve después de loguearse |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | Ídem después de registrarse |
| `NEXT_PUBLIC_SUPABASE_URL` | Host raíz del proyecto. **Solo el host**: con `/rest/v1/` al final supabase-js rompe con PGRST125 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anon, para el cliente |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio (bypassa RLS), la usa el server y toda la ingesta |
| `ANTHROPIC_API_KEY` | Claude: análisis, chat, LEXIE, escritos, simulador |
| `OPENAI_API_KEY` | Embeddings para RAG, en runtime y en la ingesta |

Dos más que **solo usan los scripts** y no están en `.env.example`:
`VERIFICAR_EMAIL` (acota los verificadores a las causas de un abogado; su
default está hardcodeado al mail del admin, así que conviene setearla para no
escribir sobre expedientes ajenos) y `VER_HTML` (debug de
`verificar-lexie-tarjetas.tsx`).

## Estructura

```
src/app/           App Router: 17 pages, 6 layouts, 49 route.ts
  page.tsx           Inicio (casos + próximos eventos)
  analisis/          Nuevo análisis        consumo/   Mi consumo
  dashboard/         mis-casos · agenda · bandeja · repositorio (con shell)
  dashboard/{chat,mapa-procesal,simulador}/[id]/   vistas inmersivas, sin shell
  admin/             panel admin
  api/               ~90 handlers
src/proxy.ts       clerkMiddleware: todo protegido salvo /sign-in y /sign-up
src/lib/           capa de dominio, una carpeta por feature
  agent/             motor de tool-use + runners + tools (RAG, mapa, LEXIE)
  lexie/             protocolo de LEXIE: acciones, confirmación por sha256
  casos/ escritos/ mapa-procesal/ simulador/ agenda/ gmail/ repositorio/ admin/
  supabase/ auth/ google/ rag/    infraestructura transversal
src/components/    UI por feature. ui/ son primitivas shadcn: no editar a mano
scripts/           ingesta de corpus y verificadores manuales (no hay tests)
supabase/          23 migraciones, aplicadas a mano en el SQL Editor
legacy/            sistema anterior (Express + n8n), congelado, fuera del build
public/            íconos PWA + sw.js
```

## Comandos

```bash
npm run dev          # Next dev en :3000
npm run build        # next build
npm run start        # next start
npm run lint         # eslint — arrastra una baseline de errores preexistentes
npx tsc --noEmit     # type-check (esto sí está limpio)
npm run repo:ingesta # ingesta incremental Drive → embeddings del Repositorio
```

**No hay tests automatizados ni CI.** La red de seguridad son los scripts de
`scripts/`, que corren **contra la base real** con `service_role`. Casi todos
necesitan este combo, porque los módulos de `src/lib` llevan `import "server-only"`:

```bash
DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server --import dotenv/config scripts/<script>.ts
```

Tres rompen esa convención: `verificar-lexie-tarjetas.tsx` y
`verificar-agenda-servicio.ts` van **sin** `--conditions=react-server`, y
`verificar-gmail-texto.ts` no necesita entorno ni red
(`npx tsx scripts/verificar-gmail-texto.ts`).

Varios verificadores aceptan `--sin-modelo` para saltear el turno pago. Los
ingestores de normativa (`ingestar-cp.ts`, `ingestar-cppf-html.ts`) son
**destructivos**: borran y reescriben el corpus del tipo que tocan, y leen sus
HTML de `notas-migracion/`, que está gitignoreada.

## Deploy

Manual a **Easypanel**, sin CI ni auto-deploy, con el `Dockerfile` de la raíz
(multi-stage sobre `node:20-bookworm-slim`, `output: "standalone"`, corre como
usuario no-root en el 3000). Dominio objetivo: `lexstrategy.teotec.org`.

Lo que ya rompió una vez y está resuelto en el Dockerfile:
`NODE_OPTIONS=--max-old-space-size=4096` (el builder se quedaba sin heap) y
`npm run build -- --webpack` (la imagen slim no trae el binario nativo de SWC
que Turbopack necesita).

**Las 11 variables se pasan como build args**, no solo como entorno de runtime.
Next hornea las 7 `NEXT_PUBLIC_*` en el bundle del browser durante el build: si
van vacías, la app levanta igual pero Clerk y Supabase fallan en el browser sin
un error claro. Las otras 4 también se declaran como `ARG` porque `next build`
prerenderiza rutas que importan `env.ts`.

El runbook paso a paso está en [DEPLOY_5.6.md](DEPLOY_5.6.md).

## Dónde está el resto

| | |
|---|---|
| [CLAUDE.md](CLAUDE.md) | **El manual vivo.** Todo lo que hace la app, en detalle. Empezá por acá |
| [MIGRATION_LOG.md](MIGRATION_LOG.md) | Qué SQL está realmente aplicado en la base. Ninguna migración se aplica por CLI, así que este archivo es la única prueba |
| [SETUP_GOOGLE_BANDEJA_REPOSITORIO.md](SETUP_GOOGLE_BANDEJA_REPOSITORIO.md) | Scopes de Google y carpeta de Drive. Sin esto la Bandeja muestra datos de ejemplo |
| [docs/](docs/README.md) | Planes, auditorías y briefings de fases ya cerradas |
