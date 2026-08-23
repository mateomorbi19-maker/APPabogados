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
  ingestar-cp.ts                  # ingestor del Código Penal (HTML Infoleg → documentos). Destructivo. VIGENTE.
  ingestar-cppf-html.ts           # ingestor del CPPF (HTML Infoleg, Dto 118/2019). Destructivo. VIGENTE.
  ingestar-cppf.ts                # ingestor viejo del CPPF (PDF Infojus 2014). SUPERADO por el de arriba.
  ingestar-repositorio.ts         # Drive → texto → ficha (IA) → embeddings → repositorio_*. Incremental, no destructivo.
  construir-catalogo-repositorio.ts # drive-catalogo.json → catalogo.ts (módulo generado)
  test-agent.ts                   # smoke test del agente RAG end-to-end
  verificar-ficha-causa.ts        # valida la Fase 9 contra la base (migración, nombres, etapa, RLS)
  count-system-tokens.ts          # mide tokens del system prompt + tool descriptions
  verificar-coherencia-mapa.ts    # valida las 12 reglas del mapa contra la base (read-only)
  verificar-lexie.ts              # smoke de LEXIE (--sin-modelo saltea el turno pago)
  verificar-motor.ts              # smoke del tool-use loop genérico

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
Response: `{ ok: true, resumen_preliminar, datos_detectados, flags_detectados, preguntas[] }`

**Protocolo de nudos de diagnóstico** (redactado por Gonzalo, vive en
`PRE_ANALISIS_SYSTEM_PROMPT`): extracción silenciosa → identificar nudos →
preguntar con propósito. El criterio no es completitud de formulario sino
diagnóstico: solo se pregunta lo que, si falta, hace que la estrategia cambie de
**dirección**. El test es "si me contesta A recomiendo una cosa, si me contesta
B recomiendo otra"; si las dos respuestas llevan a la misma estrategia, no es un
nudo.

**De 0 a 8 preguntas.** Cero es un resultado válido y preferible cuando el
relato ya alcanza: el schema no tiene piso (`preguntas` sin `.min()`) y el
formulario se renderiza con una tarjeta "No hacen falta más datos" que conserva
el paso de autorización del repositorio antes de disparar el análisis.

**Ninguna pregunta es de respuesta única.** Solo hay dos tipos, `opciones`
(multi-selección) y `texto`; el formulario agrega siempre una opción "Otro" con
campo libre, y el prompt le prohíbe al modelo generarla para que no se duplique.
Un caso real tiene situaciones superpuestas (dos imputados con distinta
situación de libertad, dos vicios en la misma detención) y obligar a elegir una
opción fuerza al abogado a mentir o a no contestar. El estado de cada respuesta
y su serialización viven en
[src/lib/nuevo-analisis/respuestas.ts](src/lib/nuevo-analisis/respuestas.ts).

`preguntaSchema` mapea los cuatro tipos del modelo viejo
(`select`/`radio`/`checkbox`/`text`) a los dos nuevos, para que las ejecuciones
ya guardadas se sigan abriendo en el historial.

### `POST /api/analizar-caso`
Tool-use loop con RAG. `maxDuration = 120` (latencia medida ~87-90s).

Body: `{ caso, rol: "defensor" | "querellante" | "ambos", contexto: {...}, usar_repositorio?: boolean }`
Response: `{ ok: true, defensor?, querellante?, metadata, busquedas[], consultas_repositorio[] }`

`usar_repositorio` (default `false`) es la **autorización del abogado** para que el
agente funde las estrategias en el Repositorio interno. Sin ella las tools de
jurisprudencia ni se le declaran al modelo y el prompt le prohíbe citar fallos de
memoria. El formulario del análisis la ofrece marcada, pero la decisión viaja en
el body y queda registrada en `ejecuciones.metadata.usar_repositorio`.

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

El agente de chat ([src/lib/agent/run-agent-consulta.ts](src/lib/agent/run-agent-consulta.ts)) usa el mismo loop que `analizar-caso` (`HARD_CAP_BUSQUEDAS = 10`, `HARD_CAP_REPOSITORIO = 6`, `maxIterations = 22`, tools `buscar_documentos_legales` + las del repositorio + las del mapa). La única diferencia es el primer user message: incluye adjuntos como content blocks. El historial se reconstruye desde `mensajes_conversacion` antes de cada turno.

**El chat siempre tiene acceso al Repositorio** (a diferencia del análisis, que
lo pide por autorización explícita): la pregunta que motivó la feature —
"¿qué jurisprudencia se puede aplicar a este caso?"— es del chat, y pedir un
permiso por mensaje sería fricción sin sentido. Las fuentes efectivamente
consultadas se devuelven en `fuentes_repositorio` de la respuesta, **armadas por
el servidor** (mismo criterio que `acciones`): el modelo no puede sumar a esa
lista un fallo que no existe, y el abogado tiene el link para verificarlo.

**Deuda técnica:** el loop está duplicado casi verbatim entre `run-agent.ts` y `run-agent-consulta.ts`.

**El chat puede mutar el mapa procesal del caso.** El contexto incluye una sección
`## Mapa procesal` con el árbol actual y el esquema canónico del fuero, y el agente
tiene 5 tools de escritura (`mapa_crear_nodo`, `mapa_editar_nodo`, `mapa_eliminar_nodo`,
`mapa_marcar_ocurrido`, `mapa_simular_ramas`) declaradas en
[src/lib/agent/mapa-tools.ts](src/lib/agent/mapa-tools.ts). Invariantes:

- **Toda mutación pasa antes por [coherencia.ts](src/lib/mapa-procesal/coherencia.ts)**,
  un validador puro de 12 reglas (R1–R12) derivadas del briefing del mapa y de
  `FLUJO_POR_FUERO`. Un rechazo no es una excepción: vuelve como `tool_result` para que
  el agente se lo explique al abogado y proponga la alternativa correcta.
- Los rechazos con `requiere_confirmacion` solo se levantan con `confirmar: true`, y
  eso **solo se acepta si el mismo rechazo ya se emitió en un turno anterior** (se
  siembra desde las `acciones` persistidas del último mensaje del agente). Sin eso el
  modelo podría auto-confirmarse y saltear la advertencia.
- `casoId` y `usuarioId` salen del contexto del servidor, **nunca del input del
  modelo**: el chat de un caso no puede tocar el mapa de otro.
- El array `acciones[]` lo arma el servidor desde las tool calls reales (no lo emite el
  modelo) y se persiste en `mensajes_conversacion.respuesta_estructurada` y en
  `ejecuciones.metadata`. Se re-inyecta al historial para que el agente no duplique
  nodos en el turno siguiente.
- Cap de 8 acciones de mapa por turno, `maxIterations = 20`, y la última iteración sale
  siempre sin tools para garantizar la síntesis final.

Verificación contra la base real (solo lectura):
`DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server --import dotenv/config scripts/verificar-coherencia-mapa.ts`

Rutas relacionadas del chat:
- `GET/POST /api/casos/[id]/conversaciones` — lista y crea conversaciones.
- `GET/PATCH /api/casos/[id]/conversaciones/[conv_id]` — detalle y renombrar.
- Máximo 1 conversación activa por caso (enforced por partial unique index en DB; la ruta archiva la activa previa antes de crear una nueva).

### Bandeja de entrada — `/api/bandeja/*` (Gmail)

Cliente de correo sobre la Gmail API. **No usa secretos nuevos**: el token sale del
OAuth de Google que administra Clerk, igual que la Agenda (helper compartido en
[src/lib/google/token.ts](src/lib/google/token.ts)). Requiere los scopes
`gmail.modify` y `gmail.send` — ver [SETUP_GOOGLE_BANDEJA_REPOSITORIO.md](SETUP_GOOGLE_BANDEJA_REPOSITORIO.md).

- `GET /api/bandeja/estado` — `{conectado, vinculado, email}`.
- `GET /api/bandeja/hilos` — lista por buzón (`INBOX|SENT|STARRED|TRASH`) con búsqueda y paginación.
- `GET|PATCH /api/bandeja/hilos/[id]` — detalle del hilo / flags (leído, destacado, archivar).
- `POST /api/bandeja/hilos/[id]/papelera` — `threads.trash`. **Nunca hay borrado permanente.**
- `POST /api/bandeja/mensajes` — enviar o responder (MIME armado a mano en `gmail/parse.ts`).
- `GET /api/bandeja/adjuntos/[mensaje_id]/[adjunto_id]` — stream del adjunto.

Sin scopes concedidos, las lecturas devuelven datos de ejemplo con `demo: true` y las
escrituras 409. El HTML de cada correo se sanitiza server-side por allowlist y se
renderiza en un `<iframe srcDoc>` con CSP propia y sin `allow-scripts`; las imágenes
remotas se bloquean por defecto (tracking pixels). **La IA no tiene ninguna tool de
email**: enviar siempre es una acción manual del abogado.

### Repositorio — `/api/repositorio/*` (jurisprudencia y doctrina)

Biblioteca de 345 documentos (fallos y doctrina penal) alojados en una carpeta de
Google Drive del estudio. El catálogo **no vive en Supabase**: es un módulo generado y
versionado ([src/lib/repositorio/catalogo.ts](src/lib/repositorio/catalogo.ts)), así que
la sección funciona sin migraciones y la búsqueda es en memoria. El PDF se streamea
desde Drive con el token del usuario (scope `drive.readonly`); sin ese scope la app
ofrece abrir el archivo en Drive.

- `GET /api/repositorio/documentos` — búsqueda + filtros + facetas.
- `GET /api/repositorio/documentos/[id]/archivo` — stream del PDF (`?descargar=1` para bajarlo).
- `GET /api/repositorio/estado` — `{conectado, vinculado, total_documentos, documentos_indexados}`.

Regenerar el catálogo: `npx tsx scripts/construir-catalogo-repositorio.ts` (lee
`scripts/data/drive-catalogo.json`).

### RAG del Repositorio — la IA cita jurisprudencia

El catálogo de arriba sólo conoce NOMBRES DE ARCHIVO. Para que el agente conteste
"¿qué jurisprudencia aplica a este caso?" hace falta el CONTENIDO de los PDF, y eso
vive en dos tablas propias (migración `20260807120000_repositorio_rag.sql`,
**aplicada** — verificado contra la base el 2026-08-22: 345 documentos y 7.439 chunks):

- `repositorio_documentos` — una fila por documento con una **ficha** generada
  offline por Claude al ingerir: `holding` (la regla que sienta), `sumario`,
  `temas`, `normas`, `utilidad_defensa`, `utilidad_acusacion`, y su embedding.
- `repositorio_chunks` — los pasajes citables, con embedding.

**Búsqueda en dos etapas** ([src/lib/repositorio/rag.ts](src/lib/repositorio/rag.ts)):
primero se rankea sobre las ~345 fichas (decide QUÉ documento sirve), y sólo para
los 4 primeros se buscan pasajes textuales (decide QUÉ CITAR). Buscar directo
sobre los ~16.700 chunks rankearía peor —los "VISTOS" de todos los fallos se
parecen entre sí más que las ratios— y costaría ~8.000 tokens por búsqueda en vez
de ~1.500.

**Tools del agente** ([src/lib/agent/repositorio-tools.ts](src/lib/agent/repositorio-tools.ts)):
`buscar_jurisprudencia` y `leer_jurisprudencia`. Son distintas de
`buscar_documentos_legales` a propósito: la norma dice qué se puede hacer, el
precedente muestra que ya se hizo. La `cita` la formatea el servidor para que el
modelo no la invente, y cada resultado trae el `documento_id` con el que el UI
linkea al fallo.

**Ingesta** (`npm run repo:ingesta`, ver
[scripts/ingestar-repositorio.ts](scripts/ingestar-repositorio.ts)): baja cada PDF
de Drive con el token de Clerk, extrae texto con `pdfjs-dist`, chunkea por página,
genera la ficha y embeddea todo. **Incremental** por hash del texto y
**no destructiva** (a diferencia de `ingestar-cppf.ts`). Modos útiles:
`--dry-run`, `--con-ficha` (imprime la ficha sin escribir), `--limite N`,
`--solo <id>`, `--coleccion jurisprudencia|doctrina`, `--forzar`,
`--modelo preciso`, `--sin-ficha`.

**La ficha se genera con Haiku 4.5, no con Sonnet.** Es una tarea de extracción
—leer un fallo y decir qué resolvió y con qué regla—, no de razonamiento
estratégico. Medido sobre los mismos dos fallos: Haiku USD 0,011 por documento
(~USD 3,30 la corrida completa) contra Sonnet USD 0,043 (~USD 13), con fichas
equivalentes: mismo holding, mismas normas, misma utilidad por lado.
`--modelo preciso` vuelve a Sonnet.

Estado medido del corpus el 2026-08-22, sobre 345 documentos:
**155 `ok` (citables) · 145 `error` · 45 `sin_texto`.**

- Los **45 `sin_texto`** son escaneos sin OCR —varios leading cases de la CSJN— y
  3 `.doc` viejos. Siguen navegables en el Repositorio pero el agente no los puede
  citar. Pasarlos por OCR y volver a subirlos los incorpora en la próxima corrida.
- Los **145 `error`** tienen texto extraído pero se quedaron sin ficha: la ingesta
  se cortó cuando la cuenta de Anthropic llegó a saldo cero. **No es un bug del
  script** — se recuperan corriendo `npm run repo:ingesta` de nuevo (es incremental
  por hash) apenas haya crédito.

### Orden de construcción de las estrategias

Regla dura del system prompt, redactada por Gonzalo y espejada en la descripción
de la tool (`ORDEN_DE_CONSTRUCCION` en [src/lib/agent/prompts.ts](src/lib/agent/prompts.ts)):
**(1) hechos de la causa → (2) marco jurídico-dogmático → (3) hipótesis táctica →
(4) jurisprudencia que la respalda.** La jurisprudencia confirma y refuerza el
análisis; nunca lo reemplaza ni lo origina. Con acceso a una base de fallos el
modelo tiende a arrancar por ahí y acomodarle los hechos encima, que es cómo se
producen estrategias genéricas.

Complemento obligatorio (`SIN_JURISPRUDENCIA_APLICABLE`): si no hay precedente
aplicable, el agente **no** fuerza una cita tangencial — escribe la fórmula
acordada en `nota_jurisprudencia`. El mismo texto se le repite en el
`tool_result` cuando la búsqueda vuelve vacía, que es el momento en que la
tentación es máxima.

### `POST /api/transcribir` — dictado por voz del chat

Recibe el audio recién grabado (multipart, campo `audio`, ≤10 MB) y devuelve
`{ ok: true, texto }`. **No persiste nada**: transcribe en memoria con Whisper y
descarta el audio. Lo que queda en la conversación es el texto que el abogado
revisó y envió.

Es distinto del camino de los audios ADJUNTOS (que sí se suben al bucket y los
transcribe la ruta de mensajes): un adjunto de audio es un documento del caso
—la nota de voz que le mandó el cliente—, mientras que el dictado es sólo la
forma en que el abogado escribió el mensaje.

En el UI ([dictado-voz.tsx](src/components/mis-casos/chat/dictado-voz.tsx)) el
botón "Dictar" vive al lado de Enviar: grabás, y el texto se inserta en el
textarea para editarlo antes de mandarlo. **No se autoenvía**: Whisper se
equivoca con apellidos, carátulas y números de artículo, que es justo lo que más
importa en un mensaje sobre un expediente.

No pasa por `enforceTokenLimit` (Whisper no gasta tokens de Anthropic; se
factura aparte en OpenAI, ~USD 0,006 el minuto). El control es la whitelist, el
tope de tamaño y el corte automático de la grabación a los 10 minutos.

### Ficha de causa — `PATCH /api/casos/:id` y `/api/casos/:id/partes`

La identidad del expediente. Ver la Fase 9 más abajo y
[PLAN_FICHA_CAUSA.md](PLAN_FICHA_CAUSA.md).

- `PATCH /api/casos/[id]` — edita la ficha. **Es la primera ruta de escritura
  sobre el recurso `caso`**: hasta la Fase 9 sólo había `GET` y `DELETE`, o sea
  que `titulo` se fijaba en el `POST` inicial y no había forma de corregirlo.
- `GET|POST /api/casos/[id]/partes` y `PATCH|DELETE .../partes/[parte_id]`.

Tres invariantes de estas rutas, en orden de importancia:

1. **El `.eq("usuario_id", …)` va DENTRO del `UPDATE`**, no en un `SELECT`
   previo. El server entra con `service_role`, que bypassa RLS: ese filtro es el
   único control real de propiedad, y hacerlo en dos pasos abre una ventana
   entre el chequeo y la escritura. En `partes_caso` —que no tiene `usuario_id`
   propio— el guard es verificar el caso primero y filtrar por `caso_id` en
   todas las escrituras.
2. **Las columnas escribibles se enumeran a mano en el handler.** El schema Zod
   NO es la lista blanca: nunca se derrama `parsed.data` en el `.update()`, o un
   campo de más en el schema pasaría a poder mover `usuario_id`,
   `ejecucion_origen_id` o `estrategia_snapshot`.
3. **Body vacío es 400**, no un `UPDATE` sin columnas. Un `UPDATE` vacío igual
   dispara el trigger `casos_set_actualizado_en`, y esa columna ordena el
   Inicio, el buscador y el contexto de LEXIE: un guardado sin cambios saltearía
   la causa al tope de las tres listas.

El schema distingue `undefined` (el formulario no mandó el campo, no se toca) de
`null` (el abogado lo vació, se borra). Sin esa distinción, guardar desde un
formulario parcial borraría todo lo que ese formulario no muestra.

### `GET /api/buscar?q=` — buscador global

Alimenta la paleta ⌘K / Ctrl+K (montada en `NavShell`, así que se abre desde
cualquier sección) y la fila de búsqueda del Inicio. Busca **solo sobre los
casos del usuario**, en ocho campos con prioridad
([src/lib/casos/buscar.ts](src/lib/casos/buscar.ts)): carátula → expediente →
partes → título → delitos → organismo → formulario → relato. Cada resultado dice
en cuál pegó, y devuelve el fragmento cuando el campo es largo.

**Dos normalizaciones distintas, y no se pueden mezclar:**
- `normalizar()` baja a minúsculas y saca tildes, y **conserva la longitud** —
  de eso depende el cálculo del fragmento, que usa el índice del texto
  normalizado sobre el original.
- `normalizarIdentificador()` además borra todo lo que no sea letra o dígito, y
  se usa **solo para el número de expediente**: el mismo expediente se escribe
  `12345/2026`, `12.345/2026` o `IPP 08-00-012345-26`, y ninguna forma es la
  correcta. Como no conserva la longitud, no sirve para fragmentos — no hace
  falta, un expediente que pega se muestra entero.

"Buscar por imputado" ya no depende de que el nombre esté en el relato: sale de
`partes_caso` y el resultado dice el rol ("Rodríguez, Carlos — Imputado"). El
filtrado sigue siendo **en memoria** — con 3 usuarios sale más barato que
mantener un `tsvector` con su trigger e índice. No toca el LLM ni el RAG, así
que puede correr a cada tecla.

### LEXIE — `/api/lexie` (asistente global)

LEXIE es el agente conversacional GLOBAL de la app: a diferencia del chat del
caso, no cuelga de ninguna causa. Sabe quién es el abogado, qué causas tiene y
qué hay en su agenda, y contesta preguntas de trabajo diario ("¿qué tengo
mañana?", "¿de qué se trata la causa de Ferreyra?", "¿qué jurisprudencia tenemos
sobre requisa sin orden?").

- `GET /api/lexie` — saludo + hilo abierto. Lo llama el panel al abrirse.
- `POST /api/lexie` — un turno. Body `{ mensaje, nivel? }`. `maxDuration = 120`.

**La v1 es de SOLO LECTURA.** Cinco tools, ninguna escribe:
`mi_agenda`, `buscar_mis_casos`, `leer_caso`
([lexie-tools.ts](src/lib/agent/lexie-tools.ts)) más `buscar_jurisprudencia` /
`leer_jurisprudencia` y `buscar_documentos_legales`, reusadas tal cual. El
system prompt le prohíbe decir que hizo algo que no hizo y le pide mandar al
abogado a la sección correspondiente (Agenda, Bandeja, chat del caso).

**El aislamiento entre abogados es la regla dura de esta feature.** En el chat
del caso el `casoId` sale de la URL y ninguna tool tiene parámetro `caso_id`:
el modelo no puede elegir sobre qué causa opera. LEXIE rompe eso por diseño, y
abajo no hay red — el server usa `service_role`, que bypassa RLS. Por eso
**todo `caso_id` que venga del modelo pasa por `casoEsDelUsuario` antes de leer
nada**, y `usuarioId` viaja en el contexto del servidor, nunca en un
`input_schema`. `buildContextoCaso` no valida propiedad (está documentada
asumiendo que "el caller ya autenticó"), así que el caller que autentica es la
tool.

**El contexto va en el primer mensaje, no en el system prompt**
([contexto.ts](src/lib/lexie/contexto.ts)): causas con un extracto de 160
caracteres del relato, agenda de 7 días y fecha/hora argentina. La lista de
causas va completa en vez de detrás de una tool porque evita el viaje de ida y
vuelta más común (el abogado nombra una causa, LEXIE tiene que buscar su id). El
extracto existe porque **las carátulas reales son malas**: varias son la primera
línea del relato, así que sin él LEXIE no puede decir de qué se trata una causa
sin abrir el expediente entero (~2.300 tokens contra ~40).

**El saludo NO lo escribe el modelo** ([saludo.ts](src/lib/lexie/saludo.ts)):
son string templates sobre datos ya calculados, con la prioridad que fijó
Gonzalo — urgencias a 48 h > eventos de hoy > rapport personal. Cero tokens por
apertura de sesión, instantáneo, y la aritmética de plazos no queda en manos de
una inferencia.

**Lo que LEXIE dice que no puede hacer, y por qué:** no toca la agenda (v1 sin
escrituras), no manda correos (decisión de producto vigente), no calcula plazos
procesales (esos salen de una tabla por fuero que firma Gonzalo, que todavía no
existe) y **avisa que la agenda que ve es parcial** — el pull de Google es
update-only, así que un evento creado desde el celular no está en la app. Sin
ese aviso, "no tenés nada" sería correcto respecto de la base y falso respecto
de la realidad.

Verificación (lo gratis + un turno pago de ~USD 0,04; `--sin-modelo` saltea el pago):
`DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server --import dotenv/config scripts/verificar-lexie.ts`

### Motor del agente — [motor.ts](src/lib/agent/motor.ts)

El tool-use loop, sin dominio. Estaba duplicado casi verbatim entre
`run-agent.ts` y `run-agent-consulta.ts` y las dos copias ya habían divergido;
LEXIE habría sido la tercera. Hoy lo usan `run-agent-consulta.ts` (chat del
caso) y `run-lexie.ts`. **`run-agent.ts` (`/analizar-caso`) todavía tiene su
propio loop** — migrarlo es deuda pendiente.

La unidad de presupuesto es la **familia** de tools, no la tool suelta: "10
búsquedas" y "6 consultas al repositorio" son topes de grupo. Cada familia
declara su cap, si es paralelizable (lecturas sí, mutaciones NO) y qué decir
cuando se agota. Dos invariantes que no se pueden romper: ninguna ejecución de
tool puede tirar hacia afuera del loop, y la última vuelta sale siempre sin
tools (garantía estructural de síntesis).

**Prompt caching activo**, con dos breakpoints: uno sobre el system (que por el
orden canónico de la request cubre tools + system) y otro al final del historial
previo. Medido: un turno de chat con 3 búsquedas pasó de USD 0,0517 a 0,0362, y
una repregunta sobre ese hilo sale USD 0,0091.

**Contabilidad:** `ejecuciones` no tiene columnas de caché, así que
`input_tokens` guarda la SUMA de los tres buckets de entrada
(`inputTokensParaCuota` en [queries.ts](src/lib/lexie/queries.ts)). Si guardara
solo el bucket fresco, un turno que lee 10.000 tokens de caché registraría 128 y
el tope mensual de 1.000.000 dejaría de proteger de un día para el otro. El
desglose real queda en `metadata.usage`; el costo lo calcula `pricing.ts` con
los cuatro buckets por separado.

### App instalable (PWA)

La app se puede agregar a la pantalla de inicio en iPhone y Android y abre sin
barra de navegador. Piezas: [manifest.ts](src/app/manifest.ts) (`display:
standalone`, íconos 192/512 + uno `maskable` con padding porque Android recorta
hasta un 20% de cada borde), las meta de Apple en
[layout.tsx](src/app/layout.tsx) y [public/sw.js](public/sw.js).

**El service worker no cachea NADA a propósito.** Existe solo porque Chrome lo
exige para ofrecer "Instalar" en Android. Cachear sería peligroso: cada página
está detrás de Clerk y muestra expedientes penales de UN abogado; un SW que
guarde respuestas puede servir una vista de otra sesión o dejar el relato de una
causa en el disco del dispositivo después de cerrar sesión. Solo intercepta
navegaciones y, si la red falla, muestra un cartel de sin conexión.

`apple-mobile-web-app-capable` se agrega a mano vía `metadata.other`: Next 16
emite el nombre moderno del W3C (`mobile-web-app-capable`) y no el de Apple.
iOS 15.4+ ya respeta el `display` del manifest, pero en los anteriores esa meta
es lo único que separa una app de un acceso directo.

El middleware de Clerk ya deja pasar `/sw.js`, `/manifest.webmanifest` y los
`.png` (el matcher de [proxy.ts](src/proxy.ts) excluye esas extensiones), así
que la instalación no requiere sesión.

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

Proyecto: `xvdlnevcvcsgxbngwliv` (región us-west-2, Postgres 17.6). RLS habilitada en todas las tablas; el server siempre accede con `service_role` key.

**Tablas de tracking / usuario:**
- `usuarios`: `id UUID, nombre UNIQUE, email, clerk_user_id, role (admin|user), limite_tokens_mensual=1.000.000, created_at`.
- `ejecuciones`: `usuario_id FK, tipo (pre_analisis|analizar_caso|consulta_caso), modelo, input_tokens, output_tokens, total_tokens (GENERATED), costo_usd, latencia_ms, ejecutado_en, metadata jsonb`. Las ejecuciones con `metadata.refunded=true` se excluyen del consumo mensual.
- `casos`: la causa. Identidad + ficha + estrategia elegida. Las columnas de la
  **ficha** (`caratula`, `expediente_numero`, `organismo`, `secretaria`, `juez`,
  `fiscalia`, `delitos text[]`) son **todas nullable**; `estado_seguimiento` es el
  único NOT NULL, con default `'activa'`. `fuero` lo escriben el mapa procesal y
  la ficha. Ver la Fase 9 y la migración `20260822120000`.
- `partes_caso`: personas de una causa (imputado, víctima, querellante, testigo).
  `es_cliente` es **ortogonal al rol**: en una querella el cliente es la víctima.
  Sin datos de contacto hasta que se conteste la P1 de REPORTERIA.
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

La tabla `documentos` contiene **3.823 chunks** de derecho penal argentino, todos con embedding `vector(1536)`. Desglose por `tipo_documento` (medido contra la base el 2026-08-22):
- `manual` = 2.974 chunks (manuales de litigación penal)
- `codigo` = 425 chunks (Código Penal)
- `codigo_procesal` = 424 chunks (CPPF consolidado Decreto 118/2019, no el PDF Infojus 2014)

⚠️ **Estos números cambiaron respecto de lo que decía este documento** (3.934 / 590 / 370):
el CP y el CPPF fueron re-ingestados con `ingestar-cp.ts` e `ingestar-cppf-html.ts`.
El CP **ya no está roto**: tiene 396 artículos distintos (antes 52), incluidos 172,
173, 210 y 292, y la duplicación máxima bajó de 10x a 4x — y ese 4x es legítimo
(artículos largos partidos en varios chunks).

Columnas: `id bigint (PK)`, `contenido text`, `embedding vector(1536)`, `fuente_id uuid (FK nullable)`, `tipo_documento`, `libro/titulo/capitulo/articulo/seccion text`, `pagina int4`, `metadata jsonb DEFAULT '{}'`, `created_at`.

Índice vectorial: **HNSW cosine** (`documentos_embedding_idx USING hnsw (embedding vector_cosine_ops)`).

Limitación de metadata: solo el **~22% de los chunks** (849/3.823) tienen número de `articulo` en metadata. El system prompt exige citar el artículo exacto tal como aparece en el chunk, pero el ~76% del corpus no trae ese campo estructurado.

Sin integraciones externas: no hay SAIJ, no hay scraping, no hay segunda API legal. Las únicas llamadas en runtime son a Anthropic (LLM), OpenAI (embeddings) y Supabase (DB + vector store).

### Pipeline de ingestión

**Los dos códigos ya son reproducibles; los manuales no.** Hoy el corpus tiene tres orígenes:

- **`codigo` (425 chunks):** [scripts/ingestar-cp.ts](scripts/ingestar-cp.ts), desde el HTML de Infoleg (`notas-migracion/CP-infoleg.html`, charset windows-1252). Reemplazó al corpus roto que había cargado n8n (590 chunks con sólo ~52 artículos y duplicación ~10x). Destructivo: delete-before-insert del tipo. Modos `--dry-run` y `--validate` (read-only).

- **`codigo_procesal` (424 chunks):** [scripts/ingestar-cppf-html.ts](scripts/ingestar-cppf-html.ts), desde el HTML de Infoleg del CPPF **consolidado por Decreto 118/2019**. Reemplazó los 370 chunks del PDF Infojus 2014 que había cargado [ingestar-cppf.ts](scripts/ingestar-cppf.ts), que se conserva sólo como referencia histórica. Difiere en el parser: los artículos van en texto plano `ARTÍCULO N` delimitados por `<br>`, sin `<b>`, y la jerarquía suma un nivel PARTE que se pliega en el campo `libro`.

- **`manual` (2.974 chunks, ~78% del corpus):** cargados en 2026-03-25 por el workflow n8n `notas-migracion/workflow-n8n-ingesta.json` (gitignored). Descargó los PDFs `Manual_Litigacion_1/2/3.pdf` desde Google Drive, embeddeó vía OpenAI y los insertó directamente. **Esta parte sigue sin ser reproducible desde el código versionado.**

El schema de `documentos` tampoco está en ninguna migración versionada (fue creado fuera del repo).

### Pipeline de recuperación

La RPC `match_documents(query_embedding vector, match_count int DEFAULT 5, filter jsonb DEFAULT '{}')` realiza la búsqueda vectorial en Postgres con:
- Distancia coseno (operador `<=>`)
- Umbral hardcodeado en la función SQL: `WHERE 1 - (embedding <=> query_embedding) > 0.55` (evolución: 0.5 → 0.6 → 0.55; con 0.6 el 50% de búsquedas daban 0 resultados)
- `LIMIT match_count` — el call site siempre pasa `match_count=5`
- ⚠️ **El umbral es un parámetro `match_threshold` en el repo pero NO en la DB.** La
  migración `20260627003911` figura como aplicada en `MIGRATION_LOG.md` y no lo está:
  PostgREST devolvía `PGRST202` y el error se tragaba como "0 resultados", así que el
  RAG estuvo devolviendo cero chunks en silencio entre el 2026-06-27 y el 2026-07-29.
  [match-documents.ts](src/lib/rag/match-documents.ts) ahora reintenta con la firma vieja
  ante `PGRST202`. **Aplicar la migración en el SQL Editor sigue pendiente** para poder
  recalibrar el umbral desde el código.
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
npm run repo:ingesta -- --dry-run        # ingesta del Repositorio, sin escribir nada
npm run repo:ingesta                     # ingesta real (requiere la migración del RAG aplicada)

# mide system+tool tokens (decisión de prompt caching). Necesita el combo
# --conditions=react-server + dotenv preloaded (ver la nota de scripts abajo):
DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server --import dotenv/config scripts/count-system-tokens.ts
```

Medición al 2026-08-07 (Sonnet 4.5): system solo **2.181** tokens · con la tool de
RAG **3.043** · análisis con Repositorio autorizado **4.592** · chat del caso
**5.938**. El prefijo estático ya supera holgadamente el mínimo de caché (1.024),
así que **el prompt caching sigue siendo la optimización pendiente más obvia** —
hoy esos ~6.000 tokens se pagan enteros en cada turno del chat.

## Convenciones

- **Commits en español** prefijados por sub-paso (`"5.1: drill-down del historial..."`).
- **Stage explícito** archivo por archivo (`git add path/a.tsx path/b.tsx`); nunca `git add .`.
- **No pushear sin OK explícito** tras QA manual.
- **Nunca `--no-verify`** ni saltar hooks.
- TS strict siempre. Sin hardcodear credenciales.
- Validar todo input con Zod en el borde.
- **Tabla `documentos` inmutable** (vector store ya cargado; `ingestar-cppf.ts` es destructivo — no correrlo salvo que sea necesario recargar el corpus procesal explícitamente).
- **`notas-migracion/` jamás se commitea** (gitignored, datos sensibles y workflows de n8n).
- **Paleta:** dos temas en [globals.css](src/app/globals.css) — `:root` es el claro y `.dark` el oscuro. Oscuro es el **default**: `--background: #0a0e17`, `--card: #0f172a`, acento `#8b5cf6`. Fuente: Inter (UI y display, sin serif).
- **Tema:** el engranaje de la top bar abre Ajustes con dos opciones, **Oscuro** (default) y **Sistema**. Se guarda en `localStorage["el-tema"]` y lo aplica un script inline anti-flash antes del primer paint ([src/components/tema/](src/components/tema/)). El **Mapa procesal** y el **Simulador** se fuerzan siempre en oscuro (montan su propio `.dark` desde el `layout.tsx` de su ruta): su tratamiento visual —orbes con glow, vidrio, escenario iluminado— está construido sobre fondo negro.
- **Color por token, nunca por literal.** Todo lo que sea superficie, borde o texto va por `var(--el-*)` o por las vars de shadcn. Un literal de la paleta de Tailwind (`text-amber-400`, `bg-white/5`) sólo se acepta con su contraparte clara (`text-amber-700 dark:text-amber-400`). Excepción: los componentes del mapa y del simulador, que corren siempre en oscuro.
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
- 5.4 ✅ Dockerfile en raíz (Next 16 standalone, multi-stage). Ya sufrió deploys reales: tiene el `--max-old-space-size=4096` por el OOM del type-check en el builder de Easypanel y el `--webpack` porque Turbopack necesita el SWC nativo, que la imagen slim no instala.
- 5.5 ✅ pre-deploy checks (hardening RLS deny-by-default, revoke anon/authenticated, email Lautaro cargado en DB).
- 5.6 ⏳ deploy manual a Easypanel reemplazando el servicio legacy en `lexstrategy.teotec.org`. Sin coexistencia, sin URL temporal beta, sin swap DNS.

### Fase 8 — LEXIE (asistente global)

- 8.0 ✅ migración `20260819120000_lexie_tipo_ejecucion.sql` — **aplicada** (verificado el 2026-08-22: `conversaciones_lexie` y `mensajes_lexie` existen).
- 8.1 ✅ motor de agente genérico; `run-agent-consulta` migrado.
- 8.2 ✅ prompt caching (medido: turno de chat 0,0517 → 0,0362 USD).
- 8.3 ✅ las cinco tools de lectura, con el guard de ownership.
- 8.4 ✅ `GET`/`POST /api/lexie` + conversación global.
- 8.5 ✅ protocolo de saludo, server-side y sin tokens.
- 8.6 ✅ panel global (botón flotante + Ctrl/⌘+J).
- 8.7 ✅ PWA instalable en iOS y Android.

Pendientes conocidos:
- `run-agent.ts` (`/analizar-caso`) sigue con su propio loop; migrarlo al motor es 8.1b.
- Las **carátulas de las causas son malas** (4 de 8 son la primera línea del relato). Lo arregla la Fase 9.

> **Lección de esta fase, que vale para las próximas:** este bloque declaraba
> pendientes DOS migraciones que estaban aplicadas hacía semanas, y una de ellas
> supuestamente hacía que LEXIE devolviera 500. El drift entre el repo y la base
> corta para los dos lados: un `.sql` versionado no prueba que esté aplicado, y
> el `MIGRATION_LOG` tampoco prueba que no lo esté. **Se verifica con un GET a
> PostgREST antes de creerle a este documento.**

### Fase 9 — Ficha de causa

La identidad del expediente. Ver [PLAN_FICHA_CAUSA.md](PLAN_FICHA_CAUSA.md) para el
plan completo, las decisiones tomadas y lo que queda explícitamente afuera
(honorarios, gastos, prueba como entidad, escritos generados, las 6 tabs del
mockup, autocompletado con IA e integración con portales judiciales).

- 9.0 ✅ documentación sincerada contra la base.
- 9.1 ⏳ migración `20260822120000_ficha_de_causa.sql` — **la corre Mateo a mano.
  Hasta que se aplique, todo lo demás de esta fase devuelve 500.**
- 9.2 ✅ `src/lib/casos/columnas.ts` + `PATCH /api/casos/[id]`.
- 9.3 ✅ bloque de ficha en el detalle del caso, con formulario.
- 9.4 ✅ `nombreCaso()` en los once consumidores + carátula al crear la causa.
- 9.5 ✅ `partes_caso` + rutas + bloque de personas.
- 9.6 ✅ buscador por carátula, expediente, partes, delitos y organismo.
- 9.7 ✅ la ficha en el contexto del chat y de LEXIE.
- 9.8 ✅ etapa procesal derivada del mapa + última actuación real.

Verificación (solo lectura salvo un alta/baja de prueba en `partes_caso`;
`--sin-escritura` la saltea). Cero tokens:

```bash
DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server --import dotenv/config scripts/verificar-ficha-causa.ts
```

**Lo que cambia para el resto de la app:**

- **`casos.titulo` ya no es la identidad de la causa.** El nombre sale de
  `nombreCaso(c) = caratula ?? titulo` ([src/lib/casos/nombre.ts](src/lib/casos/nombre.ts)).
  Los dos conviven en la base a propósito: `titulo` es el nombre de trabajo (hoy,
  los primeros 60 chars del relato) y la carátula manda cuando existe. Ningún
  consumidor nuevo debe leer `.titulo` directo.
- **Ningún archivo escribe a mano una lista de columnas de `casos`.** Van en
  [src/lib/casos/columnas.ts](src/lib/casos/columnas.ts), como STRING LITERAL:
  supabase-js parsea el argumento de `.select()` en tipos y con un `string` ancho
  (por ejemplo un `array.join()`) colapsa la fila a `GenericStringError`.
- **La etapa procesal NO es un campo de la ficha.** La deriva
  [etapa-actual.ts](src/lib/mapa-procesal/etapa-actual.ts) del nodo `ocurrido` más
  profundo del mapa, reusando `etapasPorNodo`. Persistirla crearía dos verdades
  que se contradicen el primer día.
- **"Última actuación" sale de `MAX(eventos_caso.ocurrido_en)`, no de
  `actualizado_en`:** a esa columna la pisa un trigger en cada UPDATE, así que
  editar la ficha diría "actualizado hoy" con el expediente quieto.
- **El campo vacío se muestra vacío, con un botón "Cargar".** No se rellena con
  un valor verosímil, y a los agentes directamente **no se les emite**: una línea
  "juzgado: no informado" en el contexto le da al modelo un dato para repetir.
  La única excepción es la carátula ausente, que sí se declara — ahí el modelo
  tiene que saber que el nombre que lee es provisorio.
- **`partes_caso` no tiene `usuario_id`:** la propiedad se hereda del caso por la
  FK, y el server bypassa RLS con `service_role`. Las cuatro rutas verifican que
  el caso sea del usuario ANTES de tocar nada, y el UPDATE y el DELETE llevan
  `caso_id` además del `id` de la parte.
- **El contexto de LEXIE se refresca** cuando `MAX(casos.actualizado_en)` es
  posterior al último mensaje del hilo. Antes se inyectaba solo en el primer
  mensaje y la conversación activa no se archiva sola: una carátula corregida no
  llegaba nunca al modelo.
- **El fuero se congela cuando el mapa está armado.** La ficha lo deja editar
  sólo mientras `mapa_procesal_nodos` esté vacío; si no, el `PATCH` devuelve
  **409** y el selector aparece deshabilitado. `casos.fuero` no es descriptivo:
  la plantilla del mapa se instancia UNA vez con `generarPlantillaBase(casoId,
  fuero)` y no se regenera, así que cambiarlo dejaría el fuero de un código y el
  árbol de otro — los títulos canónicos de `coherencia.ts` degradarían cada nodo
  troncal a rama hipotética, cambiarían los nodos terminales, y el simulador
  (que sólo soporta PBA) se habilitaría sobre un mapa de Nación. El único camino
  para cambiar de fuero sigue siendo reiniciar el mapa, que es destructivo a
  propósito.
- **"Última actuación" cuenta sólo eventos `sucedido`.** Los `pendiente` son
  cosas agendadas con fecha futura: sin filtrar, cargar una audiencia para
  diciembre hacía que la ficha dijera que la causa se movió en diciembre.

**Pendiente de esta fase:** 9.9 (movimientos del expediente con título, foja,
organismo y ámbito intra/externo) queda **condicionado** a que el timeline se
empiece a usar. Al 2026-08-22 hay 10 eventos de caso en toda la base, 8 creados
por el sistema y 2 por un abogado, y cero adjuntos: el problema del timeline no
es que le falten campos.

El plan detallado de las fases vive en la memoria del proyecto, no en el repo.
