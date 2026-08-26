# Instrucción para Fable 5 — Sesión 1 de mejoras del chat con IA por caso

> Contexto previo obligatorio: leé [AUDITORIA_CHAT_IA_2026-07-14.md](AUDITORIA_CHAT_IA_2026-07-14.md) (cómo funciona el chat hoy, end-to-end, con file:line) y [CLAUDE.md](CLAUDE.md) (stack, convenciones). Este documento asume ese contexto.
>
> Sos un modelo muy capaz: esto es una **guía**, no un dictado línea por línea. Te doy el QUÉ, el DÓNDE, el POR QUÉ, las decisiones a tomar y las trampas a evitar. Elegí la mejor implementación dentro de esos rieles.

## Decisiones ya tomadas por el dueño (locked)

Estas están resueltas — implementá con estas, no las re-abras:

1. **Modelos**: Bajo = **Haiku 4.5**, Medio = **Sonnet 4.5** (el que la app usa hoy), Alto = **Opus 4.6**. IDs conocidos: Haiku 4.5 = `claude-haiku-4-5-20251001`, Sonnet 4.5 = `claude-sonnet-4-5-20250929`. **Opus 4.6: confirmá el ID exacto contra la API de Anthropic antes de shippear** (no lo adivines).
2. **Layout**: **inmersivo, estilo Mapa Procesal** (mover la ruta fuera de `mis-casos`, full-height, sin sidebar de casos).
3. **Audio**: **grabar con micrófono + subir archivo** (ambos).
4. **Scope extendido**: además de los 3 features, entran **el bug A-1 (conversación brickeada)** y **el fix de costo A-3** (este último se hace junto con el pricing del Feature 1).

## Reglas globales (no negociables)

- **TS strict**, sin `any` de conveniencia. Validá TODO input con **Zod en el borde** de cada API route.
- **Nunca aceptes del cliente un valor que el server deba controlar** (ej: un model ID crudo). El cliente manda un nivel/enum; el server mapea.
- Paleta **dark-only**: `--background #0a0e17`, `--card #0f172a`, acento `#8b5cf6`, fuente Inter. Formato **es-AR** (números `toLocaleString('es-AR')`, fechas DD/MM/YYYY HH:MM).
- **No toques** `documentos` (vector store), `/legacy/`, ni `notas-migracion/`.
- **Commits en español**, uno por feature, prefijados (ej: `"chat: selector de modelo Bajo/Medio/Alto"`). **Stage explícito archivo por archivo** (nunca `git add .`). **No pushear sin OK** tras QA manual. **Nunca `--no-verify`**.
- La beta tiene **3 usuarios y datos de prueba** → refactorizá limpio, sin backwards-compat innecesaria.
- La DB Supabase (`xvdlnevcvcsgxbngwliv`) está **activa**. El MCP de Supabase está bloqueado por privilegios; si necesitás inspeccionarla, usá el REST API con la `service_role` key de `.env.local` (`curl` a `/rest/v1/` con headers `apikey` + `Authorization: Bearer`).
- Verificación mínima antes de dar por cerrado cada feature: `npx tsc --noEmit`, `npm run lint`, y **QA manual real en el browser** (`npm run dev`). No alcanza con que compile.

---

## FEATURE 1 — Selector de modelo "Bajo / Medio / Alto" en el chat

### Objetivo
Que el abogado elija, por cada consulta del chat, entre 3 niveles de modelo. **La UI muestra "Bajo / Medio / Alto"**, nunca los nombres oficiales. El server mapea (decisión locked):
- **Bajo → Haiku 4.5** — `claude-haiku-4-5-20251001` (rápido/barato)
- **Medio → Sonnet 4.5** — `claude-sonnet-4-5-20250929` (default, = comportamiento actual)
- **Alto → Opus 4.6** — confirmá el ID exacto contra la API antes de shippear (máxima calidad)

### Estado actual
- El modelo está **hardcodeado**: `MODEL_ID = "claude-sonnet-4-5-20250929"` en [src/lib/anthropic.ts:13](src/lib/anthropic.ts#L13).
- Se usa en **dos** `messages.create` de [run-agent-consulta.ts:211-217 y :297-312](src/lib/agent/run-agent-consulta.ts#L211), y para el costo + `ejecuciones.modelo` en [mensajes/route.ts:319-342 (path AgentError) y :382-408 (path éxito)](src/app/api/casos/[id]/conversaciones/[conv_id]/mensajes/route.ts#L382).
- **Pricing** en [pricing.ts:12-30](src/lib/agent/pricing.ts#L12) SOLO tiene Sonnet 4.5. `calcularCosto` **tira `Error("Pricing desconocido para modelo")`** si el modelo no está en la tabla ([pricing.ts:46-48](src/lib/agent/pricing.ts#L46)).

### Enfoque propuesto
1. **Fuente única de verdad** en un archivo nuevo (ej. `src/lib/agent/modelos.ts`): un mapa `nivel → { modelId, labelUI }` para `'bajo' | 'medio' | 'alto'`. Todo lo demás lo consume de ahí.
2. **Zod**: agregá `nivel` (enum `['bajo','medio','alto']`, `.default('medio')`) a `crearMensajeInputSchema` en [schemas.ts:368-371](src/lib/schemas.ts#L368).
3. **Threading**: `mensajes/route.ts` toma `nivel` del body validado → resuelve `modelId` server-side vía `modelos.ts` → se lo pasa a `runAgentConsulta` (nuevo param `model`) **y** lo usa en `calcularCosto(modelId, ...)` y en `ejecuciones.modelo`, **en ambos paths (éxito y AgentError)**.
4. **run-agent-consulta.ts**: aceptá `model: string` en el input y usalo en los **dos** `messages.create` (no dejes ningún `MODEL_ID` colgado).
5. **Pricing OBLIGATORIO**: agregá a `pricing.ts` las entradas (normal + long-context) de **Haiku y Opus** (y del Sonnet que uses). Si no, la primera consulta con ese modelo **rompe el turno** al insertar la ejecución.
6. **UI**: un selector compacto (shadcn `Select` o segmented control) en [input-mensaje.tsx](src/components/mis-casos/chat/input-mensaje.tsx) o en el header del chat. Muestra Bajo/Medio/Alto, default **Medio**, y agrega `nivel` al body del POST. Recordá la última elección en `localStorage` (nice-to-have). Considerá un tooltip que explique en una línea qué implica cada nivel (velocidad vs profundidad), sin nombrar el modelo.
7. **Persistí `metadata.nivel`** en la ejecución (jsonb laxo, seguro) para observabilidad y para poder mostrar Bajo/Medio/Alto en consumo sin depender del ID.
8. **Display sin nombres oficiales**: el mapa `MODELOS`/`fmtModelo` en [format.ts:29-33](src/lib/format.ts#L29) solo mapea Sonnet 4.5; se usa en consumo y admin ([admin/queries.ts](src/lib/admin/queries.ts), [use-consumo.tsx](src/lib/hooks/use-consumo.tsx)). Con IDs nuevos mostraría el ID crudo (filtrando el nombre que el dueño quiere ocultar). Mapeá a "Bajo/Medio/Alto" vía `metadata.nivel`, o al menos agregá los IDs nuevos al map.

### Gotchas
- **`calcularCosto` tira si falta el pricing** ([pricing.ts:46-48](src/lib/agent/pricing.ts#L46)): exponer un nivel sin agregar su pricing rompe TODO el chat de ese nivel con 500. Mismo patrón que ya mordió antes ("migración antes del deploy": agregar el consumidor sin el dato primero).
- **No rompas los otros flujos**: `pricing.ts`/`calcularCosto`/`MODEL_ID` los comparten `pre-analisis`, `analizar-caso`, `mapa/simular`, `simulacion.ts` y `run-agent.ts` — todos deben **seguir en Sonnet** con el mismo costo. Dejá el path Sonnet idéntico.
- Son **3 usos** de `MODEL_ID` en el loop (:212, :300, :306) y **2 inserts** a `ejecuciones` en el route (:322/325 error y :387/390 éxito). Cambialos **todos**, o quedará modelo/costo mezclado dentro del mismo turno.
- Antes de escribir IDs nuevos en `ejecuciones.modelo`, verificá (vía REST) que la columna **no tenga un CHECK/enum** que los rechace.

### Decisiones (resueltas + las que quedan)
- **[RESUELTA] Mapeo de niveles**: Haiku 4.5 / Sonnet 4.5 / Opus 4.6 (ver arriba). Lo único abierto: **confirmar el ID exacto de Opus 4.6** contra la API de Anthropic antes de cerrar (un ID inválido = 404 en runtime + `calcularCosto` tira). Fijá los 3 IDs en `modelos.ts` y validá que respondan.
- **max_tokens por modelo.** El código usa `max_tokens: 16000` en las 3 llamadas ([run-agent-consulta.ts:213,301,307](src/lib/agent/run-agent-consulta.ts#L213)). Si el Haiku elegido tiene un cap de output menor (ej. 8192), la API tira 400. Definí `maxTokens` por nivel en el mapa y clampeá.
- **`maxDuration` vs Opus.** El route tiene `maxDuration=120` (Sonnet mide ~87-90s). Opus es más lento por token; con hasta 10 búsquedas + 12 iteraciones "Alto" puede pasar 120s → 502. Decidí si subir `maxDuration` para Alto o aceptar el riesgo (el recovery-polling de 60s mitiga a medias).
- **Persistencia de la elección**: por-mensaje (recomendado, con `localStorage` recordando la última) vs default fijo del usuario.
- **[EN SCOPE] Fix de costo A-3.** Corregí el **bug A-3**: `calcularCosto` decide el tier long-context (2x) sobre los tokens **sumados del loop**, no por request → sobreestima el costo. Hacelo acá, junto con el pricing por modelo (computá el costo por-respuesta y sumá). Beneficia también a `analizar-caso`. Dejá el resultado de Sonnet idéntico para inputs < 200K.

### Verificación
Enviar una consulta en cada nivel; confirmar en el modal de detalle del historial (o en `ejecuciones` vía REST) que `modelo` y `costo_usd` reflejan el modelo elegido y que no hubo error de pricing.

---

## FEATURE 2 — Layout del chat sólido y fijo (ocupando más pantalla)

### Objetivo
Chat con estructura clásica y **fija**: header arriba, **área de mensajes que scrollea sola** en el medio, input fijo abajo. Que se vea trabajado, cómodo, usando **más ancho y alto** de la pantalla. Hoy hay que scrollear el body para ver el input.

### Causa raíz (confirmada leyendo el código)
El chat está **anidado y sin altura acotada**:
- `mis-casos/layout.tsx` envuelve TODO en `NavShell` (TopBar) + `MisCasosShell` (sidebar de casos) → [layout.tsx:23-29](src/app/dashboard/mis-casos/layout.tsx#L23).
- `NavShell` usa `min-h-screen` y mete el contenido en `<div class="mx-auto max-w-6xl px-4 py-6">` → [nav-shell.tsx:22-27](src/components/nav/nav-shell.tsx#L22) (limita ancho y agrega padding).
- La página del chat encima renderiza **su propio** `min-h-screen flex flex-col` con **su propio header** "Volver al caso" → [chat/page.tsx:147-176](src/app/dashboard/mis-casos/[id]/chat/page.tsx#L147).
- Resultado: **nada acota la altura al viewport** (`min-h-screen` permite crecer). `ListaMensajes` **ya tiene bien** `flex-1 min-h-0 overflow-y-auto` ([lista-mensajes.tsx:39](src/components/mis-casos/chat/lista-mensajes.tsx#L39)), pero como ningún ancestro le da una altura fija, ese `overflow` nunca se activa → la lista crece con el contenido → **scrollea el `<body>`** y el input cae abajo del fold.

### Enfoque propuesto
El fix es **arquitectónico**, no un ajuste de clases. Hacé el chat **inmersivo, como el Mapa Procesal**, que ya resuelve esto en el repo: vive en su **propio árbol de rutas** ([src/app/dashboard/mapa-procesal/[id]/page.tsx](src/app/dashboard/mapa-procesal/[id]/page.tsx)), **fuera** del `mis-casos/layout.tsx`, así escapa del NavShell + sidebar + `max-w-6xl`. **Mirá cómo lo hace el mapa y seguí ese patrón.**

La receta exacta ya existe en [mapa-procesal-view.tsx:712](src/components/mapa-procesal/mapa-procesal-view.tsx#L712): `flex h-screen flex-col bg-background`. Usá esa como referencia.

Concretamente:
- **Mové la ruta** fuera de `dashboard/mis-casos/` (ej. `src/app/dashboard/chat/[id]/page.tsx`, espejando dónde vive el mapa) para no heredar NavShell + MisCasosShell. En App Router los layouts **siempre** anidan: un layout hijo bajo `mis-casos` no puede escapar de `mis-casos/layout.tsx`.
- Altura **acotada al viewport** con `h-dvh` (usá `dvh`, no `vh`, por el chrome de los browsers móviles) + `overflow-hidden`. Sacá el `min-h-screen` de [page.tsx:148](src/app/dashboard/mis-casos/[id]/chat/page.tsx#L148) y aplaná el doble anidado `<main>` + `container max-w-5xl` ([page.tsx:165-166](src/app/dashboard/mis-casos/[id]/chat/page.tsx#L165)) a un solo track.
- Columna flex de 3 filas: header `shrink-0` (compacto, con "Volver al caso" + título + selector de modelo del F1 + dropdown de conversaciones — quitá el `sticky top-0` de [page.tsx:149](src/app/dashboard/mis-casos/[id]/chat/page.tsx#L149), ya sobra), área de mensajes `flex-1 min-h-0 overflow-y-auto` (el `ListaMensajes` actual ya sirve), input `shrink-0` abajo.
- **Ancho**: sacá el doble cap (`max-w-6xl` de NavShell + `max-w-5xl` del page). Shell full-width; header e input full-bleed con `px-4 md:px-6`; pero **centrá el track de mensajes en `mx-auto w-full max-w-4xl`** (burbujas > 800px cansan la lectura). Alineá header/input al mismo track. Respetá la paleta y shadcn.
- **Actualizá los 3+ call-sites** que apuntan al path viejo, o quedan en 404: el CTA "Abrir chat" en [detalle-caso.tsx:33](src/components/mis-casos/detalle-caso.tsx#L33), el `router.push` de [nueva-conversacion-modal.tsx:61](src/components/mis-casos/chat/nueva-conversacion-modal.tsx#L61), y los dos de [conversaciones-dropdown.tsx:54 y :56](src/components/mis-casos/chat/conversaciones-dropdown.tsx#L54).

### Decisiones
- **[RESUELTA] Inmersivo** (como el mapa): propio route tree / layout mínimo full-height, sin sidebar de casos. Máximo espacio, coherente con el mapa. Acordate de actualizar los call-sites de navegación (ver arriba) y el back link "Volver al caso". *(La alternativa in-shell quedó descartada.)*
- Qué va en el header compacto (título editable, dropdown de conversaciones, selector de modelo del F1). Pensalo junto con el F1 para no duplicar barras.
- ¿100% inmersiva (sin nada del shell) o dejar solo el TopBar global (h-14) y darle al chat `h-[calc(100dvh-3.5rem)]`? Menor: elegí lo que se vea mejor; la recomendación es inmersiva pura para ganar pantalla.

### Gotchas
- **`min-h-0` es obligatorio** en el hijo scrolleable (ya está en [lista-mensajes.tsx:39](src/components/mis-casos/chat/lista-mensajes.tsx#L39)) — no lo saques. Y **ningún** eslabón entre el root acotado y el `overflow-y-auto` puede tener `min-h-*` o quedar sin altura: alcanza un wrapper mal puesto para romper todo el scroll interno.
- `dvh` no `vh`. Mantené el **auto-scroll** al fondo que ya existe ([lista-mensajes.tsx:22-24](src/components/mis-casos/chat/lista-mensajes.tsx#L22)); verificá que scrollee el contenedor, no el viewport.
- **NO toques el `body`** (`min-h-full` en [layout.tsx:63](src/app/layout.tsx#L63)) ni el NavShell si vas por la vía inmersiva (Opción B): volverlos `h-full`/`overflow-hidden` rompería el scroll de TODAS las páginas normales (inicio, consumo, detalle de caso). El `overflow-hidden` debe quedar acotado al subárbol del chat.
- La zona del input crece cuando hay adjuntos/preview: dale su propio scroll interno o cap de altura para que no empuje la lista.
- No rompas el estado **read-only de conversaciones archivadas** ni el flujo de "nueva conversación".
- Ojo con el **stale state** (hallazgo A-7 de la auditoría): si tocás `ChatShell`, aprovechá para keyearlo por `conversacion.id`.
- **[polish opcional]** Hoy las burbujas están **invertidas** respecto de la convención: el mensaje del usuario va a la izquierda ([mensaje-usuario.tsx:15](src/components/mis-casos/chat/mensaje-usuario.tsx#L15)) y el del agente a la derecha con `ml-auto` ([mensaje-agente.tsx:99](src/components/mis-casos/chat/mensaje-agente.tsx#L99)). Ya que buscás "bien trabajado", considerá corregir a usuario-derecha / agente-izquierda.

### Verificación
En una ventana chica y una grande: el header y el input quedan fijos, **solo scrollea la lista**, y no aparece scroll del body. Probar con conversación vacía, con pocos mensajes y con muchos.

---

## FEATURE 3 — Adjuntos que funcionen (PDF / fotos) + AUDIOS

### Objetivo
Que adjuntar **PDF y fotos** funcione de verdad (hoy "se ve pero no funciona"), y **sumar audios**.

### Estado actual — IMPORTANTE
El flujo de adjuntos está **completo y correcto en análisis estático** para PDF/JPG/PNG/DOCX. La cadena es coherente:
`AdjuntosUploader` ([adjuntos-uploader.tsx](src/components/mis-casos/adjuntos-uploader.tsx)) → POST `eventos/upload-url` genera `storage_path = {usuario_id}/{casoId}/{ts}_{safe}` en bucket `eventos-caso-adjuntos` ([upload-url/route.ts:84-90](src/app/api/casos/[id]/eventos/upload-url/route.ts#L84)) → PUT directo al bucket → al enviar, [input-mensaje.tsx:109-125](src/components/mis-casos/chat/input-mensaje.tsx#L109) manda los adjuntos → `adjuntoInputSchema` valida ([schemas.ts:255-261](src/lib/schemas.ts#L255)) → el route valida el prefijo `{usuario_id}/{casoId}/` ([mensajes/route.ts:188-196](src/app/api/casos/[id]/conversaciones/[conv_id]/mensajes/route.ts#L188)) → `descargarAdjuntoBytes` baja del mismo bucket ([descargar-adjunto.ts](src/lib/casos/descargar-adjunto.ts)) → `run-agent-consulta.ts` lo manda como content block (PDF=document, imagen=image, DOCX=texto).

**Conclusión: el "no funciona" NO es un flujo faltante.** Es probablemente uno de estos, y por eso tu **primer paso es REPRODUCIR, no adivinar.**

### Primer paso obligatorio: reproducir
Con `npm run dev`, adjuntá en el chat un PDF chico y un PNG, enviá, y **leé el error real** (respuesta HTTP + logs del server). Recién ahí diagnosticá. Candidatos por probabilidad:
1. **HEIC/HEIF de iPhone** (fuerte candidato para "fotos no funciona"): las fotos de iPhone son `image/heic`, que **el uploader rechaza** ([adjuntos-uploader.tsx:123-137](src/components/mis-casos/adjuntos-uploader.tsx#L123), allowlist en [adjuntos.ts:5-10](src/lib/casos/adjuntos.ts#L5)) con "Tipo no permitido". Además Anthropic **no acepta HEIC** — solo jpeg/png/gif/webp.
2. **Fallo de runtime** solo visible en vivo: signed upload URL, permisos del bucket, o la descarga en `descargarAdjuntoBytes`.
3. **La DB estuvo pausada** hasta hace poco: pudo haber hecho fallar TODO envío. Re-testear ahora que está activa — parte del "no funciona" puede haber sido eso.
4. PDF > 10 MB o base64 grande golpeando límites/latencia (`maxDuration=120`).

### Enfoque propuesto
- **Arreglá la causa raíz que encuentres al reproducir.**
- **Ampliá formatos de imagen** para cubrir el mundo real: aceptá **HEIC** (convertí server-side a JPEG/PNG con `sharp`/`heic-convert` antes de mandarlo a Anthropic, porque Anthropic no lo acepta) y evaluá `image/webp`. Tené UN solo lugar de verdad: `MIME_TYPES_PERMITIDOS` + `TAMANO_MAX_POR_MIME` + `MIME_LABEL` en [adjuntos.ts](src/lib/casos/adjuntos.ts), el enum de `adjuntoInputSchema`, y el mapeo de `mediaType` en `run-agent-consulta.ts` (que hoy solo permite `image/jpeg`/`image/png`).
- **Mejorá el surface de errores**: hoy un rechazo en el envío se ve como "HTTP 400" genérico. Que el usuario entienda qué pasó (formato, tamaño, etc.).

### AUDIO — decisión de arquitectura clave
**La Messages API de Anthropic NO acepta audio como content block.** El modelo **no puede "escuchar"** un audio. Por lo tanto: hay que **transcribir el audio a texto ANTES** de mandarlo al modelo, y mandar la transcripción (no el audio). Dejá esto explícito en la UI para no generar la expectativa de que el modelo oye el audio.

Flujo propuesto (reutilizando lo que ya hay):
1. **Capturar** el audio en el browser: botón de micrófono con `MediaRecorder` (→ `audio/webm;codecs=opus`) y/o subir un archivo de audio. Subilo al bucket como cualquier adjunto (agregá los mime de audio al allowlist: `audio/webm`, `audio/mpeg`, `audio/mp4`, `audio/wav`, `audio/ogg`).
2. **Transcribir** server-side: ya existe `getOpenAI()` con `OPENAI_API_KEY` configurada ([openai.ts](src/lib/openai.ts)). Usá Whisper (`whisper-1` o `gpt-4o-transcribe`) — `openai.audio.transcriptions.create({ model, file })`.
3. **Inyectar** la transcripción como bloque de texto etiquetado en `buildPrimerUserContent` (ej: `Audio adjunto "nota.webm" — transcripción: «...»`). Extendé el tipo `AdjuntoModelo` con un `kind: 'audio'` que lleve el `transcript`, y hacé la transcripción en `prepararAdjuntoParaModelo` ([mensajes/route.ts:47-74](src/app/api/casos/[id]/conversaciones/[conv_id]/mensajes/route.ts#L47)).
4. **Persistir** la transcripción (en el adjunto/mensaje) para mostrarla en el UI y poder reusarla en el historial sin re-transcribir.

Decisiones de audio:
- **[RESUELTA] Ambos**: botón de grabar con micrófono (MediaRecorder) **y** poder subir un archivo de audio. Empezá por el botón de grabar.
- Modelo de transcripción (`whisper-1` es barato y suficiente; `gpt-4o-transcribe` es mejor pero más caro).
- ¿La transcripción cuenta para el cupo/costo? Whisper se factura aparte (OpenAI). Decidí si querés trackearlo en `ejecuciones`/metadata.

Gotchas de audio:
- Límite de Whisper: **25 MB** por archivo. Validá tamaño/duración.
- La transcripción **suma latencia** al turno (ya de por sí 30-90s). Consideralo.
- Soporte de `MediaRecorder` y formatos por browser (Safari difiere).
- Dejá clarísimo en la UI: **el agente lee la transcripción, no escucha el audio.**

### Verificación
Adjuntar y enviar, uno por uno: un PDF, una foto (incluida una HEIC de iPhone si vas a soportarla), y un audio. Confirmar que el modelo referencia el contenido de cada uno en su respuesta. Revisar que el `contexto_usado`/adjuntos queden bien persistidos.

---

## EN SCOPE — arreglar el bug A-1 (conversación "brickeada")

**Por qué acá:** los features 1 y 3 van a generar más turnos que fallan (modelos nuevos, formatos nuevos, transcripción). El bug A-1 de la auditoría —**confirmado en producción** (conversación `639abf52`, ver §5 de la auditoría)— hace que, si un turno falla dejando un mensaje de usuario sin respuesta, la conversación quede **permanentemente rota** (el próximo turno reconstruye `[user, user]` → Anthropic 400 → falla siempre). Es un fix chico y de alto valor mientras vas a estar probando fallos.

**Qué hacer:** al reconstruir `mensajesPrevios` en [build-contexto-conversacion.ts:108-138](src/lib/casos/build-contexto-conversacion.ts#L108), si el último mensaje reconstruido es de rol `usuario` (huérfano de un turno fallido), **colapsalo/omitilo** para que el array siempre alterne y termine válido. Alternativa/complemento: al fallar un turno, insertar un placeholder de agente. Elegí lo más simple que garantice el invariante documentado en [run-agent-consulta.ts:190-198](src/lib/agent/run-agent-consulta.ts#L190). Verificá reabriendo la conversación `639abf52` (hoy archivada) o reproduciendo el patrón.

---

## Micro-decisiones que te quedan a vos (Fable), menores

Las grandes ya están lockeadas arriba. Solo quedan detalles chicos:
- Confirmar el **ID exacto de Opus 4.6** contra la API.
- **Precios exactos** (input/output/cache USD por MTok) de Haiku 4.5 y Opus 4.6, y si cada uno tiene tier long-context >200K (Sonnet sí; confirmá los otros dos — no asumas el mismo 2x).
- Modelo de transcripción: `whisper-1` (barato, alcanza) vs `gpt-4o-transcribe` (mejor, más caro).
- Si trackeás el costo de la transcripción (Whisper factura aparte en OpenAI) en `metadata`.
- Subir o no `maxDuration` para "Alto" (Opus, más lento).

## Orden sugerido y entrega
1. **A-1** (chico, te protege durante todo el testing que sigue — hay una conversación real rota, `639abf52`, para validar).
2. **F2 layout inmersivo** (hace cómodo probar el resto).
3. **F3 adjuntos + audio** (reproducí primero el "no funciona").
4. **F1 selector de modelo + A-3 costo** (juntos, ambos tocan pricing).

Un commit por feature (A-1, F2, F3, F1+A-3), en español, con stage explícito archivo por archivo. QA manual real de cada uno antes de avanzar. **No pushear sin OK del dueño.**
