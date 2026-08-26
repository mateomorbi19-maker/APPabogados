# Auditoría del subsistema de CHAT CON IA por caso — APPabogados

> Punto de partida antes de empezar a trabajar sobre el chat. Fecha: 2026-07-14.
> Método: auditoría multi-agente (5 lectores en paralelo + síntesis) sobre backend de rutas,
> agente/RAG, frontend, DB/contexto y producto. Verificación cruzada de los archivos núcleo
> (backend, agente, context builder, prompt) hecha directamente en la sesión principal.

## 0. Verificación adicional (sesión principal)

- **Backend, agente, context builder y prompt leídos y confirmados directamente** (no solo por los agentes): `run-agent-consulta.ts`, `mensajes/route.ts`, `conversaciones/route.ts`, `build-contexto-conversacion.ts`, `SYSTEM_PROMPT_CONSULTA`. Las referencias `file:line` de este documento están validadas contra el código real.
- **DB verificada vía REST API** (2026-07-14, tras despausar el proyecto). El MCP de Supabase sigue bloqueado a nivel de cuenta (management endpoint sin privilegios), pero los conteos y la secuencia real de mensajes se obtuvieron con la `service_role` key contra `/rest/v1/`. **§5 ahora tiene datos reales, incluida una conversación brickeada en producción (bug A-1 reproducido) y ejecuciones huérfanas de una conversación borrada.**

---

## 1. Resumen ejecutivo

El **chat con IA por caso** es el asistente conversacional, persistente y multi-turno que acompaña a cada caso *después* del análisis inicial (`analizar-caso`). El abogado escribe una consulta (opcionalmente con PDF/imagen/DOCX), y un agente RAG sobre el corpus penal argentino responde en dos modos que decide el propio modelo: prosa conversacional o análisis estructurado (tesis + fundamento legal + recomendaciones priorizadas). Cada turno persiste en `mensajes_conversacion` y cada ejecución (tokens reales + costo) en `ejecuciones`. Está en **beta interna** (3 usuarios) y es funcional, pero arrastra deuda de robustez y de costo.

Los 4 puntos más importantes, todos corroborados por más de un informe:

1. **Fragilidad transaccional que puede "brickear" una conversación** (alta): el mensaje del usuario se inserta *antes* de llamar al agente; si el turno falla a mitad, queda un mensaje huérfano que rompe la alternancia `user/assistant` y puede dejar la conversación permanentemente inusable.
2. **Costo mal contabilizado y sin optimizar** (alta): no hay *prompt caching* en ningún call (se re-factura todo el PDF base64 + contexto + historial en cada iteración del loop), y `calcularCosto` aplica el tier long-context (2x) sobre tokens *sumados* del loop en lugar de por request → **sobreestima sistemáticamente el `costo_usd`**, que es una feature central de la app.
3. **Contexto que crece sin poda, O(N²)** (alta): historial completo + timeline completo + estrategia se re-envían en cada turno, sin windowing ni resumen; además las respuestas conversacionales previas del agente se replayean vacías (`{analisis:null,recomendaciones:null}`), degradando la coherencia multi-turno justo en el modo más frecuente.
4. **UX de chat pobre** (alta): sin optimistic update (el usuario no ve su propio mensaje por 30-90s), estado del cliente que queda stale al cambiar de conversación, y ausencia de streaming.

---

## 2. Objetivo y rol en la app

**Para qué sirve.** `analizar-caso` es *one-shot* (sin historial): en la ingesta genera 3 estrategias por rol (conservadora / moderada / agresiva) para soportar la **decisión** de intake. Pero un caso penal evoluciona (audiencias, resoluciones, dictámenes, escritos de la contraparte). El chat es el asistente **continuo** que soporta la **litigación**: responde consultas puntuales ("¿qué hago ahora?", "evaluá esta resolución del fiscal") viendo el estado completo del caso más RAG legal.

**User journey.**
1. **Origen:** el abogado corre `analizar-caso`, elige una estrategia y `POST /api/casos` crea el caso con `estrategia_snapshot` congelado (`casos/route.ts:127`) + un evento inicial de sistema (`casos/route.ts:144-151`).
2. **Detalle del caso** (`detalle-caso.tsx:24-84`): expone tres bloques hermanos y **desconectados entre sí** — CTA "Chat con el agente", CTA "Mapa procesal" y TimelineProcesal.
3. **Entrada al chat** (`chat/page.tsx:62-177`): resuelve la conversación a mostrar (`?conv=` → activa → lazy-init de una nueva con título auto-fecha).
4. **Conversación:** el abogado escribe/adjunta, el agente responde, y puede gestionar múltiples conversaciones por caso (1 activa + N archivadas, con renombrado).

**Relación con las otras superficies.** El chat **lee** el timeline (`eventos_caso`) y la `estrategia_snapshot` como contexto, pero **no escribe de vuelta**: sus recomendaciones no se convierten en eventos ni en nodos del mapa. Los adjuntos se reutilizan del mismo bucket que los eventos (`eventos-caso-adjuntos`). Es la contraparte de "seguimiento" del análisis de "intake", pero hoy funciona como **silo unidireccional**.

```
analizar-caso ──selección──> casos.estrategia_snapshot (CONGELADO)
                                   │
        ┌──────────────────────────┼───────────────────────────┐
   TimelineProcesal          Chat (conversaciones)         Mapa procesal
   (eventos_caso)      (conversaciones_caso/mensajes)     (nodos del mapa)
        │                          │                            │
        └───► el chat LEE timeline+estrategia como contexto ◄───┘
        (pero NO escribe de vuelta: silos unidireccionales)
```

---

## 3. Cómo funciona hoy (end-to-end de un turno)

**Frontend — envío.** `InputMensaje` (`input-mensaje.tsx:100-203`) hace un único `fetch` **bloqueante** a `POST /api/casos/[id]/conversaciones/[conv_id]/mensajes` (`input-mensaje.tsx:120-128`). Al enviar, `loading=true` y aparece un banner estático "entre 30 y 90 segundos" (`input-mensaje.tsx:237-242`). **La lista de mensajes no cambia** — no hay optimistic insert. Los adjuntos se suben antes vía signed URL directa al bucket; el envío solo se habilita cuando todos están `done`.

**Backend — orquestación** (`.../mensajes/route.ts:139-490`, `maxDuration = 120`):
1. Valida UUIDs y body con Zod (`crearMensajeInputSchema`: `contenido` 1..5000, `adjuntos` max 20) — `route.ts:160-166`, `schemas.ts:368-371`.
2. `requireUsuarioOr403` (whitelist Clerk→Supabase) + `validarConversacionActiva` (409 si archivada, `route.ts:78-122`) + valida que cada `storage_path` empiece con `${usuario_id}/${casoId}/` (`route.ts:188-196`).
3. `enforceTokenLimit` — pre-check del cupo mensual, 429 si sin cupo (`route.ts:199-210`). **No corta mid-loop.**
4. **Inserta el mensaje `rol='usuario'` ANTES de llamar al agente** (`route.ts:216-227`), para dejar registro aunque el agente falle. *(Este orden es la raíz del hallazgo A-1.)*
5. `buildContextoConversacion(casoId, convId, {excluirMensajeId})` (`route.ts:247`) arma el `contextoMarkdown` (caso original + formulario + estrategia elegida + timeline completo) y reconstruye `mensajesPrevios` = **todos** los mensajes de la conversación menos el recién insertado (`build-contexto-conversacion.ts:108-138`).
6. Baja los adjuntos **nuevos** del turno y los prepara como content blocks nativos: PDF/imagen → base64, DOCX → texto extraído por mammoth (`route.ts:266-284`, `descargar-adjunto.ts`).
7. `runAgentConsulta` corre el loop (`route.ts:291-313`).

**Agente — loop tool-use + RAG** (`run-agent-consulta.ts:182-366`):
- `messages = [...mensajesPrevios, {role:'user', content: buildPrimerUserContent()}]` (`:195-198`); el último user content es `contextoMarkdown + "## PREGUNTA DEL ABOGADO" + pregunta`, precedido por los adjuntos nuevos.
- Primer `messages.create` con `tools:[buscarDocumentosTool]`, `max_tokens:16000`, **SIN `tool_choice`** (`:211-217`): el RAG **no está forzado** en el chat (a diferencia de `analizar-caso`, `run-agent.ts:178`).
- `while (stop_reason==='tool_use' && iterations<maxIterations)`, `maxIterations=12` (`:185,225-228`). Cada búsqueda: `embedQuery` (OpenAI `text-embedding-3-small`) → `buscarDocumentos(embedding, 5)` (K=5 hardcodeado) → RPC `match_documents`. Los docs se serializan crudos como `tool_result`, sin re-ranking. Cap duro `HARD_CAP_BUSQUEDAS=10`.
- Al agotar el cap, el siguiente call se hace **sin `tools`** para forzar síntesis (`:296-312`). Tokens: acumula los 4 campos reales del SDK en `totalUsage` (`:218-223,323-328`).
- Errores → `AgentError` (`API_ERROR`, `CAP_EXCEEDED_NO_SYNTHESIS`, `MAX_ITERATIONS`) con tokens parciales.

**Backend — persistencia.** `parseWithRecovery` (3 intentos, `parse.ts`); si falla, fallback conversacional con el texto crudo y `parser_fallback:true` (`route.ts:371-450`). Inserta la fila en `ejecuciones` (`tipo='consulta_caso'`, tokens reales + `calcularCosto`, metadata rica) e inserta el mensaje `rol='agente'` con `respuesta_estructurada` (`route.ts:382-479`). Devuelve 200 `{ok:true, mensaje_usuario, mensaje_agente, respuesta}`. Si hubo `AgentError`: **502** sin insertar mensaje del agente (`route.ts:317-357`).

**Frontend — render.** El cliente hace `onMensajesNuevos([mensaje_usuario, mensaje_agente])` — **ambos juntos, al final** (`input-mensaje.tsx:188`). `MensajeAgente` valida contra `respuestaConsultaSchema` y renderiza `conversacional` (prosa) o `analisis` (tesis/fundamento/consideraciones/recomendaciones con badges de prioridad), más badges `degraded_response`/`parser_fallback` y un `Collapsible` cerrado con las búsquedas RAG (`mensaje-agente.tsx:81-273`). Auto-scroll al fondo (`lista-mensajes.tsx:22-24`).

**Recovery post-502.** Si el POST devuelve 502, el cliente hace **polling** a `GET .../mensajes?desde=<iso>` durante 60s buscando un mensaje `rol==='agente'` que el server pudo alcanzar a insertar (`input-mensaje.tsx:40-72`, `route.ts:501-588`).

---

## 4. Arquitectura y contratos

### Endpoints

| Método / ruta | Propósito | Respuestas clave |
|---|---|---|
| `POST /api/casos/:id/conversaciones` | Crea conversación (archiva la activa antes) | 201 `{ok:true, conversacion}` · 400/401/403/404/500 |
| `GET /api/casos/:id/conversaciones` | Lista (activa arriba: `estado ASC, creada_en DESC`) | 200 `{conversaciones:[...]}` (**sin `ok`**) |
| `GET /api/casos/:id/conversaciones/:conv_id` | Detalle + **todos** los mensajes (`creado_en ASC`, sin límite) | 200 `{conversacion, mensajes[]}` (sin `ok`) |
| `PATCH /api/casos/:id/conversaciones/:conv_id` | Renombra (`titulo` 1..200) | 200 `{ok:true, conversacion}` |
| `POST /api/casos/:id/conversaciones/:conv_id/mensajes` | **Chat** (`maxDuration=120`) | 200 `{ok:true, mensaje_usuario, mensaje_agente, respuesta}` · **502** AgentError (ejecución parcial persistida) · 429 cupo · 409 archivada · 400 adjunto ajeno |
| `GET .../mensajes?desde=<iso>` | Polling de recovery (max 20, `creado_en >= desde`) | 200 `{mensajes[]}` |

**Contrato de la respuesta del agente** (`respuestaConsultaSchema`, unión discriminada por `modo`, `schemas.ts:316-348`):
- `conversacional`: `{modo, respuesta: string, analisis: null, recomendaciones: null}`
- `analisis`: `{modo, respuesta: null, analisis:{tesis_central, fundamento_legal[≥1], consideraciones}, recomendaciones:[{prioridad, accion, plazo, fundamento}][≥1]}`
- Enriquecido ortogonalmente con `degraded_response`, `parser_fallback`, `ejecucion_id`, `busquedas[]`.

**Invariante crítico** (documentado en `run-agent-consulta.ts:190-198`): `mensajesPrevios` **debe** terminar en `assistant` o estar vacío, para que `messages` alterne y el último sea `user`. Este invariante se **viola** en cualquier turno que inserte el mensaje `usuario` pero no llegue a insertar el `agente` (ver A-1).

### Schema de las tablas de chat

*(Fuente: migración `20260507180000_chat_persistente_cleanup_pr3_y_refunded.sql`, contrastada contra los `SELECT` del código. No verificable en vivo — DB pausada.)*

**`conversaciones_caso`**: `id uuid PK`, `caso_id uuid NOT NULL FK casos ON DELETE CASCADE`, `titulo text NOT NULL`, `estado text CHECK IN ('activa','archivada') DEFAULT 'activa'`, `creada_en/actualizada_en/archivada_en timestamptz`.
- Índice parcial único **`uq_conversacion_activa_por_caso ON (caso_id) WHERE estado='activa'`** (garantiza ≤1 activa por caso).
- `idx_conversaciones_caso ON (caso_id, creada_en DESC)`.
- Trigger `mensajes_bump_conv` (AFTER INSERT/UPDATE/DELETE en mensajes) que bumpea `actualizada_en`.

**`mensajes_conversacion`**: `id uuid PK`, `conversacion_id uuid NOT NULL FK ON DELETE CASCADE`, **`rol text CHECK IN ('usuario','agente')`** (la columna real es `rol`, no `tipo` como dice CLAUDE.md), `contenido text NOT NULL`, `adjuntos jsonb DEFAULT '[]'`, `respuesta_estructurada jsonb NULL`, `ejecucion_id uuid NULL FK ejecuciones ON DELETE SET NULL`, `creado_en timestamptz`.
- `idx_mensajes_conv_orden ON (conversacion_id, creado_en ASC)` — **cubre la ruta caliente; no hay índices faltantes en el path del chat.**

**Integridad:** las FK `ON DELETE CASCADE` hacen imposibles los orphans clásicos. Sí es posible (y esperado por diseño) tener conversaciones con un mensaje de usuario y **sin** respuesta del agente (502 tras insertar el user msg).

### Estado del frontend

**Sin SWR / react-query / Context: todo es `useState` + `fetch` crudo**, con invalidación manual vía `router.refresh()`/`router.push()`. `ChatShell` (`chat-shell.tsx:20`) es el único dueño del estado local (`mensajes`, `conversacion` sembrados desde props del server component, `:29-30`). Cambiar de conversación **navega** (`router.push`) en vez de mutar estado (`conversaciones-dropdown.tsx:51-58`). Es 100% request bloqueante, sin streaming.

---

## 5. Estado real de los datos

*(Verificado el 2026-07-14 vía REST API con `service_role`, tras despausar el proyecto.)*

**Conteos:**

| Tabla | Total | Desglose |
|---|---|---|
| `casos` | 5 | — |
| `conversaciones_caso` | 6 | 5 activas · 1 archivada |
| `mensajes_conversacion` | 12 | 7 usuario · 5 agente |
| `ejecuciones` (tipo `consulta_caso`) | 8 | 5 exitosas · 1 `degraded` · 2 `parser_fallback` (+ 1 de esas refunded) |

Volumen chico (beta, 3 usuarios). **3 de las 6 conversaciones están vacías** (sin ningún mensaje): el lazy-init de `chat/page.tsx` crea una conversación con solo entrar a la página, aunque no se envíe nada → clutter de conversaciones fantasma.

### Incidente 1 — Conversación brickeada en producción (bug A-1 reproducido)

Conversación `639abf52` ("Conversación del 24/06/2026", caso `cd8125e0`, hoy **archivada**):
- Contiene **2 mensajes de usuario consecutivos** (01:44:54 y 01:46:30 UTC), **cero mensajes de agente y cero ejecuciones**.
- Reconstrucción: el turno 1 falló con un **500 pre-loop** (o en el primer `messages.create`, que no está envuelto en el try/catch que emite `AgentError` — por eso no persistió ejecución). El turno 2 reconstruyó `mensajesPrevios = [user(turno1)]` y appendeó el nuevo user → `messages = [user, user]` → **Anthropic 400 por alternancia inválida** → 500 otra vez. La conversación quedó permanentemente rota.
- **45 segundos después** (01:47:15) el usuario creó una conversación nueva (`ff05b9df`) — que **archivó** la rota y quedó **vacía**. Es exactamente el "único escape: crear conversación nueva" que predijo la auditoría. Confirma A-1 como incidente real, no teórico. *(Matiz sobre el doc: en este caso los fallos fueron 500 sin ejecución, no 502 con `AgentError`; el resultado —conversación brickeada— es el mismo.)*

### Incidente 2 — Ejecuciones huérfanas de una conversación borrada (hallazgo nuevo, no visible en estático)

Existen **3 ejecuciones `consulta_caso` cuya `metadata.conversacion_id` (`63d2d61c`) no corresponde a ninguna fila de `conversaciones_caso`** (fue borrada). Dos de ellas tienen `parser_fallback=true` y **no** están refunded → siguen **cobradas y contando en el consumo mensual**. Causa: al borrar una conversación/caso, el `ON DELETE CASCADE` limpia `mensajes_conversacion` pero **`ejecuciones` no tiene FK a la conversación** (solo la guarda en `metadata` jsonb), así que sus cargos quedan colgados. Ver hallazgo **M-orphan-ejec** en §6.

**Pendiente antes del deploy:** confirmar que las migraciones `20260507120000` (columnas `eventos_caso.categoria/adjuntos`) y las de RLS de Fase 5.5 están aplicadas, y la firma real del RPC `match_documents` (ver B-10, O-9).

---

## 6. Hallazgos (fusionados, por severidad)

`x-conf.` = confirmado por más de un informe (mayor confianza).

| Sev. | Área | Título | Ubicación | Detalle / impacto |
|---|---|---|---|---|
| **Alta** | Backend / DB | Fallo mid-turn deja un mensaje `usuario` huérfano que puede brickear la conversación *(x-conf. 3 informes)* | `mensajes/route.ts:216-227,317-357`; `run-agent-consulta.ts:190-198`; `build-contexto-conversacion.ts:108-138` | El user msg se inserta antes de llamar al agente. Si el turno falla luego sin insertar el agente (502, o 500 de contexto/adjuntos/insert), queda un user colgado. El próximo turno reconstruye un historial que termina en `user` y le appendea otro `user` → viola la alternancia que Anthropic exige → 400 → nuevo `API_ERROR` → nuevo 502. La conversación queda **permanentemente inusable**; único escape: crear conversación nueva. Falta un fallback que colapse el user colgado o inserte un placeholder de agente al fallar. |
| **Alta** | Agente / Costos | Sin *prompt caching*: contexto + historial + adjuntos base64 se re-facturan en cada iteración y turno *(x-conf.)* | `run-agent-consulta.ts:211-217,297-312`; `build-contexto-conversacion.ts:100-138` | Cero `cache_control` en `src/`. Cada `messages.create` reenvía todo el array `messages`, incluido el `document`/`image` base64 y el `contextoMarkdown` completo. Con 5-10 búsquedas son 6-11 llamadas re-tokenizando todo. El system prompt + tools son prefijo perfecto para cache (~90% de ahorro con un breakpoint). **Mejora de mayor ROI en costo/latencia del chat.** |
| **Alta** | Costos / tracking | `calcularCosto` aplica el tier long-context (2x) sobre input **sumado** del loop, no por request | `pricing.ts:43-44`; `run-agent-consulta.ts:218-223,323-328`; `route.ts:390` | El tier se decide con `totalInput>200K`, pero `usage` es el agregado de ~11 iteraciones. Ej: 11 llamadas de 25K = 275K sumados → todo a $6/Mtok aunque ningún request individual pasó de 200K (debería ser $3). **Sobreestima sistemáticamente `ejecuciones.costo_usd`.** Fix: costo por-respuesta y sumar. Afecta también a `analizar-caso`. |
| **Alta** | DB / Contexto | Historial cargado y re-enviado sin límite → crecimiento O(N²) sin windowing ni resumen *(x-conf.)* | `build-contexto-conversacion.ts:108-112`; `run-agent-consulta.ts:195-198` | Se cargan TODOS los mensajes sin `.limit()` y se re-envían completos cada turno. El costo de una conversación crece cuadráticamente en turnos. Un turno con búsqueda intensa + adjuntos puede cruzar 200K input y disparar el tier 2x. TODO v2 reconocido en el código. |
| **Alta** | DB / Agente | Bug de reconstrucción: las respuestas conversacionales del agente se replayean vacías `{analisis:null,recomendaciones:null}` *(x-conf.)* | `build-contexto-conversacion.ts:76-91` | `textoMensajeAgente` reinyecta solo `{analisis, recomendaciones}` de `respuesta_estructurada`. En modo conversacional (y `parser_fallback`) el contenido real vive en `respuesta` y esos campos son `null` → el modelo **pierde toda su prosa previa** y ve ejemplos malformados de su propio output. Como el modo conversacional es el path común de follow-ups, rompe la coherencia multi-turno que el propio system prompt exige. |
| **Alta** | Frontend | Sin optimistic update: el mensaje del usuario no aparece hasta la respuesta (30-90s) | `input-mensaje.tsx:188`; `chat-shell.tsx:2-4` | `enviar()` llama `onMensajesNuevos` DESPUÉS de resolver el POST, con ambos mensajes juntos. Durante 30-90s la lista queda idéntica y el único feedback es un banner en el input: percepción de "no pasó nada". Fix: insertar user optimista con id temporal y reconciliar al recibir. |
| **Alta** | Frontend | Estado stale: `ChatShell` nunca re-sincroniza `mensajes`/`conversacion` con las props al cambiar/crear conversación | `chat-shell.tsx:26-30` | Estado sembrado por `useState` desde props, sin efecto ni `key` de reset. La soft-nav de Next no remonta el client component → la UI puede seguir mostrando la conversación anterior y `InputMensaje` postear al `conversacionId` viejo; si esa conv quedó archivada → 409. Fix: `key={conversacion.id}` en `ChatShell`. |
| Media | Backend | Ejecuciones fallidas/degradadas se cobran al cupo sin refund automático | `mensajes/route.ts:319-342,382-426` | AgentError, `parser_fallback` y `degraded_response` insertan ejecución con tokens reales **sin** `metadata.refunded`. `v_consumo_mensual` y `enforceTokenLimit` solo excluyen `refunded=true`. Una racha de errores puede agotar el cupo mensual sin entregar respuestas útiles. **Confirmado en prod: 2 ejecuciones `parser_fallback` cobradas sin refund.** |
| Media | DB / Costos | **M-orphan-ejec** · Borrar conversación/caso deja ejecuciones huérfanas que siguen cobradas (sin cascade) | `mensajes/route.ts:382-408`; schema `ejecuciones` (sin FK a conversación) | `ejecuciones` guarda `conversacion_id` solo en `metadata` jsonb, sin FK. Al borrar la conversación/caso, `mensajes_conversacion` se limpia por cascade pero las ejecuciones **quedan** y sus tokens/costo siguen contando en el consumo. **Confirmado en prod: 3 ejecuciones colgadas de la conversación borrada `63d2d61c` (2 cobradas).** Fix: al borrar, refundear/marcar sus ejecuciones, o agregar FK + cascade. |
| Media | Backend | Escrituras multi-paso sin transacción → estados parciales | `conversaciones/route.ts:89-149`; `mensajes/route.ts:410-479` | POST /conversaciones archiva y luego inserta sin transacción: si el insert falla, el caso queda con **cero** conversaciones activas. En /mensajes, si el insert del mensaje-agente falla tras cobrar la ejecución, queda una **ejecución huérfana cobrada** + respuesta perdida, y se devuelve **500 (no 502)** → el cliente NO dispara el polling de recovery. |
| Media | Backend | Sin control de concurrencia por conversación/caso | `mensajes/route.ts:139-490`; `conversaciones/route.ts:127-149` | Dos POST /mensajes simultáneos pasan ambos la validación e insertan ambos su user → historial interleaved que rompe la alternancia. Dos POST /conversaciones simultáneos chocan contra `uq_conversacion_activa_por_caso` → violación devuelta como 500 genérico en vez de 409. |
| Media | Backend | Rate-limit best-effort: pre-check sin reserva; un turno puede exceder el cupo | `enforce-rate.ts:13-38`; `mensajes/route.ts:199-210` | Solo comprueba `tokens_restantes>0` antes de llamar; no reserva ni acota el gasto. Un mensaje con contexto largo + varios PDFs puede consumir >>100K y dejar el cupo muy en negativo. |
| Media | Agente / RAG | RAG no forzado en el chat: respuestas legales pueden salir sin grounding y sin señal | `run-agent-consulta.ts:211-217,359-365`; `prompts.ts:118` | A diferencia de `analizar-caso` (`tool_choice`), el primer call del chat no fuerza búsqueda y el prompt habilita responder sin buscar. Una pregunta jurídica sustantiva puede contestarse 100% desde conocimiento paramétrico, sin citas. Además `runAgentConsulta` **no computa `sin_grounding`**, así que ni queda registrado cuándo se respondió sin recuperar nada. |
| Media | Agente / Deuda | ~150 líneas del loop tool-use duplicadas casi-verbatim entre `run-agent.ts` y `run-agent-consulta.ts` (ya divergieron) *(x-conf.)* | `run-agent-consulta.ts:68-102,195-366` vs `run-agent.ts:93-142,155-364` | `while` completo + type-guards + `ejecutarToolBuscar` + acumulación de tokens + AgentError son copia byte-a-byte. `HARD_CAP_BUSQUEDAS=10` declarado dos veces. Ya divergieron en `tool_choice` (RAG forzado solo en uno) y en `chunks_recuperados`/`sin_grounding`. Candidato a extraer `runAgentLoop` común. |
| Media | Frontend | Bloqueante ~120s + recovery 60s = ~180s sin streaming ni progreso real | `input-mensaje.tsx:237-242`; `route.ts:139` | El mismo banner "30-90 segundos" queda visible incluso durante el recovery post-502 (>90s), volviéndose inexacto. Sin contador de elapsed, sin indicador de etapa, sin skeleton. |
| Media | Frontend | No hay botón de cancelar un envío colgado | `input-mensaje.tsx:84-90,193-196` | Existe `AbortController` pero solo se dispara en el cleanup de unmount. El usuario no puede abortar un request de 90-180s salvo navegando fuera (pierde el hilo). |
| Media | Frontend / A11y | Loading y errores no se anuncian a lectores de pantalla; textarea sin label | `input-mensaje.tsx:216-248` | Banner de análisis y bloques de error sin `role='status'`/`aria-live`/`role='alert'`; textarea solo con placeholder. Bajo esfuerzo, alto impacto para quien espera 90s a ciegas. |
| Media | Frontend | Las búsquedas RAG solo se ven al final, colapsadas; cero feedback de progreso | `mensaje-agente.tsx:228-273` | Mientras el agente ejecuta el loop (3-6 búsquedas, hasta 90s) el usuario no ve nada de esa actividad. |
| Media | DB / Contexto | `contextoMarkdown` re-inyectado cada turno y crece sin tope con `eventos_caso` (TODO v2 no implementado) | `build-contexto-caso.ts:20,128-138,227-256`; `run-agent-consulta.ts:174-177` | El umbral de 15 eventos es aspiracional: no hay corte real. Un caso con timeline largo re-paga ese markdown en cada mensaje, encima del historial. |
| Media | Producto | El chat es un silo: sus recomendaciones no alimentan timeline ni mapa procesal | `detalle-caso.tsx:32-81`; `types.ts:10-14` | Las salidas (recomendaciones con `accion`/`plazo`/`fundamento`) no vuelven a ninguna superficie accionable. El abogado debe re-tipear manualmente. **Oportunidad de producto grande.** |
| Media | Producto | "Nueva conversación" pierde toda la memoria del chat previo | `build-contexto-conversacion.ts:108-112`; `nueva-conversacion-modal.tsx:74-83` | Solo reconstruye la conversación ACTUAL (filtra por `conversacion_id`). Archivar y empezar de nuevo arranca con contexto del caso pero cero historial de chat previo. |
| Media | Producto | El chat puede recomendar "pivotear" la estrategia pero no hay forma de accionarlo | `build-contexto-caso.ts:188-224`; `casos/route.ts:127` | `estrategia_snapshot` se congela al crear el caso e inyecta SOLO la elegida; las otras 2 quedan en `metadata.resultado` sin mostrarse. El prompt invita a "recomendar pivotear" pero no existe mecanismo para cambiarla desde el chat. |
| Media | Producto | El sidebar de casos ignora la actividad del chat para "último evento"; sin indicador de conversación en curso | `casos/route.ts:198-256` | `ultimo_evento`/`cantidad_eventos` se calculan solo desde `eventos_caso`. Un caso cuya actividad reciente es el chat muestra un evento viejo y ninguna señal de "conversación abierta". |
| Baja | Backend | GET detalle devuelve todos los mensajes sin límite ni paginación | `conv_id/route.ts:102-108` | Payload/memoria crecen sin cota para conversaciones largas. Aceptable en beta; conviene paginar. |
| Baja | Backend | Polling usa `>=` sobre `creado_en` → posible duplicado del mensaje boundary | `mensajes/route.ts:566-574` | Si el cliente pasa el timestamp exacto de su último mensaje, ese mismo se re-incluye. Fix: `.gt` o dedupe por id. |
| Baja | Backend | Auth ocurre después de parsear y validar el body | `conversaciones/route.ts:44-62`; `mensajes/route.ts:154-172` | Se procesa input de peticiones no autenticadas. No hay acceso a DB antes del auth (riesgo menor). Mejor: autenticar primero. |
| Baja | Frontend | No hay submit por teclado (Enter / Cmd+Enter) | `input-mensaje.tsx:216-223` | El usuario debe clickear el botón. Fricción esperable de resolver en un chat. |
| Baja | Frontend | Lista de conversaciones y timestamps quedan stale tras enviar o renombrar | `conversaciones-dropdown.tsx:60-118` | `conversaciones` es prop estática del render inicial; no se revalida al enviar (cambia `actualizada_en`) ni al renombrar. |
| Baja | Frontend | El frontend no limita adjuntos a 20; superarlo da un 400 genérico | `input-mensaje.tsx:97-118` | El server limita a 20 pero el uploader permite ilimitados. >20 → 400 "Body inválido" sin explicar el límite. |
| Baja | Frontend | En error no-502 se limpia el textarea aunque el agente falló (inconsistente con el catch de red) | `input-mensaje.tsx:167-199` | Si el body trae `mensaje_usuario` se limpia contenido y adjuntos; para reformular hay que reescribir todo. En error de red el contenido NO se limpia → inconsistente. |
| Baja | Producto | Conversaciones archivadas son read-only sin "desarchivar" | `input-mensaje.tsx:205-212`; `mensajes/route.ts:113-120` | Archivar es semi-irreversible por diseño v1. |
| Baja | Producto | Única entrada al chat es el CTA dentro del detalle del caso | `detalle-caso.tsx:32-53` | No hay acceso directo desde la lista/sidebar ni el header. |
| Baja | DB / Deploy | El chat depende de columnas de una migración fuera del backbone (`eventos_caso.categoria/adjuntos`) | `build-contexto-caso.ts:130-131`; `20260507120000_...:16-29` | Si la migración no está aplicada en la DB destino (hay drift documentado), tira **500 en CADA turno**. Verificar antes del deploy. |
| Baja | Agente | El parser reusado de `analizar-caso` inyecta un `metadata` espurio en cada respuesta de chat | `parse.ts:27-39,108-113`; `route.ts:446` | `extractResult` cae en `{...parsed, metadata}` agregando `metadata:{timestamp}`. Inofensivo pero cruft. |
| Obs. | Backend | Envelope de respuesta inconsistente entre GET (sin `ok`) y POST/PATCH (con `ok`) | `conversaciones/route.ts:223`; `conv_id/route.ts:132-138`; `mensajes/route.ts:587` | El cliente no puede discriminar éxito/error de un GET por la presencia de `ok`. |
| Obs. | Backend / Deuda | Tres chequeos de ownership casi duplicados (cada uno crea su propio cliente Supabase) | `conv_id/route.ts:12-68`; `mensajes/route.ts:78-122,535-564` | `validarPropiedad`, `validarConversacionActiva` y el chequeo inline del polling repiten casi la misma query. |
| Obs. | Backend / Seguridad | Validación de `storage_path` solo por prefijo, sin normalización de segmentos | `mensajes/route.ts:188-196`; `schemas.ts:255-262` | `startsWith` sin normalizar `..`. No explotable contra Supabase Storage (keys literales), pero validar el path canónico sería más defensivo. |
| Obs. | DB / Storage | `metadata.contexto_usado` guarda el markdown completo del caso en cada ejecución | `mensajes/route.ts:327-341,392-408` | Duplica el contexto en jsonb por cada fila. Útil para auditoría pero conviene truncar o referenciar. |
| Obs. | RAG / Deploy | Posible drift de la firma del RPC `match_documents` entre código y CLAUDE.md | `match-documents.ts:35-40`; `run-agent-consulta.ts:88`; CLAUDE.md | Confirmar la firma/threshold real de la función en la DB antes del deploy; si no acepta el parámetro que pasa el código, **toda búsqueda del chat fallaría**. |
| Obs. | Agente | Latencia: hasta ~12 calls secuenciales + hasta 10 round-trips embed/pgvector bajo `maxDuration=120s` | `route.ts:28,199`; `run-agent-consulta.ts:225-342` | `analizar-caso` mide ~87-90s; el chat con PDFs grandes y sin caching puede acercarse o superar 120s → 502 → recovery-polling. |
| Obs. | Frontend | Guards muertos en el render de modo `analisis` | `mensaje-agente.tsx:188-223` | Condiciona `.length>0` sobre campos que el schema exige `min(1)`: ramas nunca falsas cuando el parse tuvo éxito. |
| Obs. | DB / Ops | **DB inaccesible: proyecto Supabase pausado (NXDOMAIN); sin conteos reales** | MCP supabase (bloqueado) + DNS de `xvdlnevcvcsgxbngwliv.supabase.co` NXDOMAIN vía 8.8.8.8 | Despausar y verificar migraciones de RLS y `20260507120000` antes del deploy. |
| Obs. | DB / Seguridad | RLS de las tablas de chat no está en la migración versionada | `20260507180000_...` (sin `ENABLE RLS`) | La migración crea las tablas sin `ENABLE ROW LEVEL SECURITY`. El server usa service_role (bypass), pero como defensa en profundidad queda no verificable desde el repo. |
| Obs. | Doc / Deuda | Drift de documentación: comentarios referencian el endpoint viejo `/consultar` y `eventos_caso.respuesta_agente` | `prompts.ts:104-116`; `schemas.ts:292-298` | El chat persiste en `mensajes_conversacion` y `/consultar` ya no existe. Confunde a futuros devs. |
| Obs. | Producto | Adjuntos históricos solo se referencian por filename; el agente "olvida" un archivo enviado turnos atrás | `build-contexto-conversacion.ts:24-31`; `build-contexto-caso.ts:15-19` | Por costo, solo los adjuntos NUEVOS del turno van como contenido nativo; los previos se listan como texto. Si el abogado pregunta sobre un PDF de hace 2 mensajes debe re-adjuntarlo. |

---

## 7. Deuda técnica destacada

1. **Loop tool-use + RAG duplicado casi verbatim** entre `run-agent.ts` y `run-agent-consulta.ts` (~150 líneas; `HARD_CAP_BUSQUEDAS=10` declarado dos veces). **Ya divergieron** en dos puntos con impacto funcional. Extraer `runAgentLoop(...)` común.
2. **Ausencia total de *prompt caching*.** Cero `cache_control` en `src/`. System prompt, tool definitions, `contextoMarkdown` y adjuntos base64 son prefijos estables idóneos. Las columnas `cache_*_input_tokens` ya se persisten pero siempre valen 0. Deuda de mayor impacto económico y de latencia.
3. **Crecimiento de contexto sin poda (O(N²)).** Historial completo + timeline + estrategia se re-envían cada turno; el TODO v2 de resumen no está implementado.
4. **Bug de fidelidad del historial** (A-5): las respuestas conversacionales del agente se replayean vacías. Corrompe la memoria del modelo en el modo más frecuente.
5. **Sin streaming.** Espera en bloque de 30-90s (hasta ~180s con recovery) con un banner estático. Gap grande frente a la expectativa de un chat moderno.
6. **Fragilidad transaccional** (A-1): escrituras multi-paso sin transacción ni reconciliación del user huérfano. Peor consecuencia (conversación brickeada) pese a no ser la más costosa de arreglar.
7. **Costeo por-loop en lugar de por-request** (A-3): el tracking de costo — feature vendida como "tokens reales y USD" — está sesgado al alza cuando el loop cruza los 200K sumados.
8. **Estado del cliente sin capa de sincronización** (A-6, A-7): fetch crudo + `useState` sembrado por props, sin `key` de reset ni revalidación. Keyear `ChatShell` por conversación resuelve varios bugs de una.

---

## 8. Oportunidades / recomendaciones priorizadas

**P0 — Correctness / robustez (hacer primero, bajo esfuerzo, alto riesgo evitado)**
1. **Reconciliar el user huérfano** (A-1): al reconstruir `mensajesPrevios`, si el último es `user`, colapsarlo/omitirlo o insertar un placeholder de agente al fallar el turno. Elimina el modo "conversación brickeada".
2. **Arreglar el replay del historial conversacional** (A-5): en `textoMensajeAgente`, reinyectar `respuesta` cuando `modo==='conversacional'`. Una línea de fix con gran efecto en coherencia.
3. **Corregir el costeo** (A-3): calcular `calcularCosto` por-respuesta y sumar los costos, en vez de sumar tokens y decidir el tier.
4. **Verificar migraciones antes del deploy** (B-10, O-9): despausar Supabase; confirmar `20260507120000`, las de RLS de Fase 5.5, y la firma real del RPC `match_documents`.

**P1 — Costo / latencia (alto ROI)**
5. **Prompt caching**: un `cache_control` en el prefijo estable (system + tools + `contextoMarkdown`). ~90% de ahorro esperado; llena las columnas cache ya existentes.
6. **Podar el contexto** (A-4): ventana deslizante de historial + resumen de turnos/eventos viejos (implementar el TODO v2).
7. **Streaming (SSE)** o, como paso intermedio barato, elapsed-timer + indicador de etapa (buscando / redactando).

**P2 — UX del chat (bajo esfuerzo, muy visible para 3 usuarios)**
8. **Optimistic insert del user** + `key={conversacion.id}` en `ChatShell` (A-6, A-7): resuelve dos altas de frontend juntas.
9. Botón **Cancelar** (M-8), **Enter para enviar** (B-4), y **`aria-live`/labels** de accesibilidad (M-9).
10. Uniformar el **envelope de respuesta** (`ok` en todos) y validar el límite de 20 adjuntos en el cliente.

**P3 — Robustez de datos y RAG**
11. **Refund automático** de ejecuciones fallidas/degradadas (`metadata.refunded=true`).
12. **Transaccionalidad** en las escrituras multi-paso y manejo del 409 de unicidad en creación de conversación.
13. Evaluar **forzar al menos 1 búsqueda RAG** en preguntas jurídicas sustantivas y **computar `sin_grounding`** en el chat.

**P4 — Producto / integración (mayor esfuerzo, mayor valor a mediano plazo)**
14. **Romper el silo**: acción "convertir recomendación del chat → evento pendiente del timeline / nodo del mapa". Es la oportunidad de producto más grande.
15. **Continuidad entre conversaciones**: resumen persistido al archivar, para que "Nueva conversación" no pierda toda la memoria previa.
16. **Accionar el pivote de estrategia** desde el chat y **señal de actividad de chat en el sidebar**.
17. **Consolidar la deuda de duplicación**: extraer el loop RAG común — habilita aplicar los fixes de RAG una sola vez a ambos flujos.

---

*Nota de método: síntesis multi-agente (5 informes + verificación cruzada en sesión principal). Las referencias `file:line` de backend/agente/contexto/prompt están validadas contra el código real. No se pudo verificar la DB en vivo ni obtener conteos reales (§5, proyecto pausado); el schema proviene de las migraciones versionadas contrastadas contra el código.*
