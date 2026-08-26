# AUDITORÍA READ-ONLY — Viabilidad del módulo HearSim

**Fecha:** 2026-07-21 · **Alcance:** relevamiento puro, sin modificaciones al código.
**Método:** 47 agentes de lectura (mapeo por capa + verificación adversarial de cada afirmación fuerte + 3 lentes independientes sobre la pregunta de jurisprudencia). Todo lo afirmado acá está anclado a `archivo:línea`.

> **Nota de método.** No se consultó la base de datos: el token del MCP de Supabase está scopeado a otra organización y el proyecto `xvdlnevcvcsgxbngwliv` devuelve *access denied*. Todo el schema sale de `supabase/migrations/` + código. Dado el drift repo↔DB que documenta [CLAUDE.md](CLAUDE.md), la ausencia de una columna en las migraciones **no prueba** su ausencia en la DB — pero sí prueba que ningún `SELECT` del código la lee (verificado: todos los SELECT enumeran columnas explícitamente).

---

## 1. Estado del repo (Paso 0)

| | |
|---|---|
| **Branch** | `main` |
| **Sincronía con `origin/main`** | `git rev-list --left-right --count origin/main...HEAD` → `0  0` (sincronizado, sin commits por delante ni por detrás) |
| **Working tree** | **Limpio en lo trackeado.** Solo untracked: `.agents/`, `.claude/skills/find-skills/`, `AUDITORIA_2026-05-07.md`, `AUDITORIA_CHAT_IA_2026-07-14.md`, `BRIEFING_DISENO_MAPA_PROCESAL.md`, `INSTRUCCION_FABLE_CHAT_SESION1.md` |

Últimos 10 commits:

```
a138bd8 chat: envio optimista + burbuja "Pensando..." (adios banner de 30-90s)
a0754c1 chat: fixes post-review adversarial (7 hallazgos confirmados)
e1ee1e9 chat: nivel guardado via useSyncExternalStore (fix lint set-state-in-effect)
33a1e5d chat: selector de modelo Bajo/Medio/Alto + fix costo por-request (A-3)
3bfde60 chat: adjuntos robustos + WEBP/HEIC + notas de voz transcritas con Whisper
3707e1c chat: layout inmersivo full-height estilo mapa procesal
11dd16f chat: fix conversacion brickeada (A-1) y replay conversacional vacio (A-5)
6175609 mapa v3: rediseno visual "dossier holografico" (100% frontend)
f1639d6 mapa: pan con Ctrl + click izquierdo (fix estilo n8n)
125767c Merge branch 'feat/mapa-procesal-fueros': mapa procesal fuero-aware + simulacion IA + UX n8n
```

---

## 2. Resumen ejecutivo

| Capa | Campos pedidos | existe | parcial | derivable | no existe |
|---|---|---|---|---|---|
| **A — datos crudos del caso** | 60 | **1** | 8 | 20 → *17 tras corrección* | 31 → *34* |
| **B — análisis estratégico** | 32 | 0 | 4 | 0 | **28** |
| **C — mapa procesal** | 18 | **1** | 7 | 4 → *2 tras corrección* | 6 → *8* |

Tres conclusiones que condicionan cualquier diseño posterior:

1. **El "objeto de caso" no existe como objeto.** Lo que hoy consume la IA es un **string markdown** armado en runtime por [build-contexto-caso.ts:161-256](src/lib/casos/build-contexto-caso.ts#L161-L256). La tabla `casos` tiene 13 columnas y solo **dos** son vocabulario procesal cerrado: `fuero` y `rol`. Todo lo demás vive en `caso_descripcion` (texto libre) y `contexto` (jsonb plano **sin claves estables** — las inventa el LLM en cada pre-análisis).
2. **No hay jurisprudencia en ninguna capa** (ver §4.1). Confirmado por 3 lentes independientes + 22 veredictos de refutación.
3. **El chat no tiene modelo de sesión reutilizable.** `conversaciones_caso` tiene un solo campo de estado (`activa|archivada`) y ninguna columna jsonb. Estado de turno, rol asumido, tipo de audiencia y dificultad **no tienen dónde vivir hoy**.

---

## 3. CAPA A — Datos crudos del caso

**Dónde aterrizan las respuestas del pre-análisis:** las 4 categorías de preguntas (A universales / B procesales del imputado / C querellante / D flags) existen **únicamente como prosa** del `PRE_ANALISIS_SYSTEM_PROMPT` en [prompts.ts:120-134](src/lib/agent/prompts.ts#L120-L134). `preguntaSchema` ([schemas.ts:26-34](src/lib/schemas.ts#L26-L34)) **no tiene campo `categoria`**: mirando una respuesta guardada es imposible saber a qué categoría pertenecía. Las respuestas se aplastan a `Record<string, string|boolean>` en [serializar-respuestas.ts:31-52](src/lib/nuevo-analisis/serializar-respuestas.ts#L31-L52) y se copian a `casos.contexto`.

### Tabla de mapeo — Capa A

| campo | estado | ubicación | notas |
|---|---|---|---|
| `expediente_numero` | **no existe** | — | Ningún prompt lo pide. Los hits de "expediente" son metáforas en comentarios de UI ([detalle-caso.tsx:23](src/components/mis-casos/detalle-caso.tsx#L23)) |
| `caratula` | derivable | pregunta A4 → `casos.contexto[clave_arbitraria]` | Único hit de "Carátula" en el repo: [prompts.ts:123](src/lib/agent/prompts.ts#L123), enunciado de una pregunta *sugerida*. Sin columna ni schema |
| `jurisdiccion` | parcial | `casos.contexto['jurisdiccion']` ([casos/route.ts:239-242](src/app/api/casos/route.ts#L239-L242)) · `datos_detectados.jurisdiccion_inferida` ([schemas.ts:52](src/lib/schemas.ts#L52)) | Tres capas incoherentes. El tipado vive en la ejecución de `pre_analisis`, **huérfana** (ver hallazgo ⚠️). La lectura por clave literal es best-effort: el propio repo documenta que las claves son arbitrarias ([sugerir-fuero.ts:14-17](src/lib/mapa-procesal/sugerir-fuero.ts#L14-L17)) |
| `codigo_procesal` | derivable | pregunta A5 → `casos.contexto` · consumidor: [sugerir-fuero.ts:85](src/lib/mapa-procesal/sugerir-fuero.ts#L85) | Heurística regex sobre claves arbitrarias; colapsa el string a un `Fuero` de 3 valores y descarta el texto |
| **`fuero`** | **existe** | `casos.fuero` — [20260706120000_casos_fuero.sql:4-5](supabase/migrations/20260706120000_casos_fuero.sql#L4-L5) | `TEXT CHECK IN ('nacion','pba','federal')`, **nullable**. Se setea recién al inicializar el mapa ([queries.ts:105](src/lib/mapa-procesal/queries.ts#L105)). Gap: el tipo `Caso` no lo declara y **ningún GET de `/api/casos` lo devuelve** |
| `etapa_procesal_actual` | parcial | `datos_detectados.etapa_procesal` ([schemas.ts:55](src/lib/schemas.ts#L55)) · proxy vivo: `mapa_procesal_nodos.estado` | String libre y snapshot congelado del pre-análisis (huérfano). El sustituto real es el **grafo del mapa**, no un campo del caso |
| `tribunal.nombre` / `.tipo` / `.numero` | **no existe** | — | Cero captura. El vocabulario de órganos existe solo como prosa estática de plantilla por fuero ([plantilla-base.ts:212,319,347](src/lib/mapa-procesal/plantilla-base.ts#L212)) — igual para todos los casos |
| `imputado.nombre` | parcial | `ejecuciones.metadata.resultado[rol].imputados_identificados` ([schemas.ts:141-146](src/lib/schemas.ts#L141-L146)) | `z.array(z.string())` — array plano, no sub-objeto. Alcanzable vía `casos.ejecucion_origen_id`, pero **`buildContextoCaso` nunca lo lee**: el agente jamás ve la lista estructurada |
| `imputado.edad` | derivable | flag `menores` ([schemas.ts:40-47](src/lib/schemas.ts#L40-L47)) / texto libre | Solo el *bit*, no la edad. Y el bit queda en la ejecución huérfana |
| `imputado.situacion_actual` | parcial | `datos_detectados.hay_detenidos` ([schemas.ts:54](src/lib/schemas.ts#L54)) + categoría B → `contexto` | Único vocabulario cerrado (`Sí\|No\|null`), pero **a nivel caso, no por imputado** — con 2 coimputados en situaciones distintas se pierde |
| `imputado.antecedentes` | **no existe** ⚠️*(corregido de "derivable")* | — | **Falso positivo desarmado:** los 2 hits de "antecedente" ([prompts.ts:9](src/lib/agent/prompts.ts#L9), [:130](src/lib/agent/prompts.ts#L130)) son sobre **conexidad de causas**, no antecedentes penales ni reincidencia. Eso no se pide en ningún lado |
| `imputado.arraigo` | **no existe** | — | 0 matches de "arraigo" en `src/` y `supabase/`. B4 pregunta por la *resolución* judicial sobre peligro de fuga, no por los datos de arraigo |
| `imputado.datos_relevantes` | derivable | `casos.caso_descripcion` (text NOT NULL) + `casos.contexto` | El catch-all real de toda la capa |
| `partes.fiscal.nombre` / `.perfil` | **no existe** | — | No hay tabla de partes ni concepto de "perfil" de un actor. *Matiz:* el fiscal **sí** está modelado como actor procesal en ~13 líneas de [plantilla-base.ts](src/lib/mapa-procesal/plantilla-base.ts) — pero es prosa estática por fuero, no un dato del caso |
| `partes.querellante.presente` | derivable | pregunta C3 → `contexto` | **Trampa:** `casos.rol` NO indica si hay querella constituida — es la *perspectiva* desde la que el abogado pidió el análisis. Y si el rol es `defensor`, la categoría C **ni se pregunta** ([prompts.ts:143](src/lib/agent/prompts.ts#L143)) |
| `partes.querellante.nombre` | derivable (débil) | pregunta C1 → `contexto` | ⚠️ C1 pide la identidad de la **víctima**, que no es necesariamente el querellante constituido. Mapeo forzado |
| `partes.querellante.tipo` | **no existe** | — | Nada distingue particular damnificado / querellante particular / fiscal |
| `partes.defensor.nombre` / `.tipo` | **no existe** | — | "defensor" es solo valor del enum `rolSchema`. La app asume implícitamente que el defensor es el usuario logueado, y ni eso se persiste en el caso |
| `relato_hechos.version_defensa` | derivable | `casos.caso_descripcion` | **Un solo relato libre**, sin bifurcación por parte |
| `relato_hechos.version_acusacion` | **no existe** ⚠️*(corregido)* | — | Apunta a la **misma** columna que `version_defensa`. Ningún campo, parser ni clave separa las dos versiones: no hay materia prima que derivar |
| `relato_hechos.discrepancias_clave[]` | **no existe** | — | Nada pide contrastar versiones. Sin dos versiones, no es derivable |
| `relato_hechos.fecha_hecho` | derivable | pregunta A3 → `contexto[clave_arbitraria]` | **Asimetría reveladora:** `eventos_caso.ocurrido_en` es `timestamptz` con Zod `.datetime({offset:true})` + refine 2020-2050 ([schemas.ts:269-276](src/lib/schemas.ts#L269-L276)), pero la fecha del hecho — que el flag de prescripción *necesita* — es string libre en un blob |
| `relato_hechos.lugar_hecho` | **no existe** | — | A1 pide dónde **tramita** la causa, no dónde ocurrió el hecho |
| `relato_hechos.modalidad` | **no existe** | — | No hay concepto de modalidad comisiva |
| `calificacion_legal.provisional_acusacion` | parcial | `delitos_posibles` ([schemas.ts:53](src/lib/schemas.ts#L53), huérfano) · `delitos_imputables` ([schemas.ts:144](src/lib/schemas.ts#L144), alcanzable) | Dos arrays de strings libres. `delitos_imputables` es "imputables según el análisis", no la calificación del fiscal — y **no se copia a `casos`** |
| `calificacion_legal.propuesta_defensa` | parcial | `casos.estrategia_snapshot` (jsonb NOT NULL) | El único jsonb tipado a nivel caso. Pero es la *estrategia elegida* (narrativa), no una calificación legal. **El INSERT no valida con Zod** ([casos/route.ts:100,127](src/app/api/casos/route.ts#L100)) |
| `calificacion_legal.pena_en_abstracto` | **no existe** | — | El RAG puede recuperar el chunk con la escala penal, pero nada la extrae ni persiste |
| `calificacion_legal.agravantes_invocados[]` | **no existe** | — | "agravante" aparece 2 veces, ninguna como campo |
| `calificacion_legal.atenuantes_disponibles[]` | **no existe** | — | 0 matches de "atenuante" en todo el repo |
| `prueba_de_cargo[].tipo` · `prueba_de_descargo[].tipo` | **no existe** | — | No hay taxonomía de medio de prueba (testimonial/documental/pericial/material) |
| `prueba_de_cargo[].descripcion` · `prueba_de_descargo[].descripcion` | derivable | `eventos_caso` con `categoria='prueba_incorporada'` | **Indistinguibles entre sí**: comparten la misma categoría del enum. La única separación posible es leer la prosa (20-2000 chars) |
| `prueba_de_cargo[].solidez` / `.vulnerabilidad` | **no existe** | — | Lo más cercano es `estrategia_snapshot.fortalezas[]`/`riesgos[]` — prosa a nivel *estrategia*, no por pieza de prueba |
| `prueba_de_descargo[].estado` | derivable | `eventos_caso.estado` | Enum tipado de 2 valores (`sucedido\|pendiente`), pero es el estado del **evento**, no de producción de la prueba (ofrecida/admitida/producida/rechazada) |
| `testigos_cargo[].*` (5 campos) | **no existe** (salvo `resumen_declaracion`: derivable muy débil) | `eventos_caso.descripcion`/`adjuntos` | **No hay entidad testigo.** Único hit de "testigo" en todo `src/`: [prompts.ts:125](src/lib/agent/prompts.ts#L125) (C5), y es sobre *protección*, no identidad. C2 es sobre la **víctima**, no testigos |
| `testigos_descargo[].*` (4 campos) | **no existe** (ídem) | ídem | Peor: la categoría C es exclusiva del rol querellante, así que del lado de la defensa no hay ni pregunta tangencial |
| `peritos[].*` (4 campos) | **no existe** | — | **0 matches de "perito" y "pericia"** en todo `src/` y `supabase/`. Familia 100% inexistente |
| `medidas_cautelares.vigentes` | derivable | preguntas B1/B2 → `contexto` · bit: `hay_detenidos` | Los 2 únicos matches de "cautelar" del repo son prosa estática de plantilla del mapa ([plantilla-base.ts:179](src/lib/mapa-procesal/plantilla-base.ts#L179)), no datos del caso |
| `medidas_cautelares.pedidos_pendientes` | derivable | pregunta B3 · `eventos_caso` con `estado='pendiente'` | Nada vincula un pedido con la medida a la que se refiere |
| `medidas_cautelares.historial` | derivable (débil) | `eventos_caso` ORDER BY `ocurrido_en` | Es un historial de *eventos de 5 categorías genéricas*, no de medidas cautelares. Reconstruible por LLM leyendo el markdown, no consultable |
| `audiencias_anteriores[].tipo` | parcial | `eventos_caso.categoria='audiencia'` · `eventos_agenda.tipo='audiencia'` | Hay valor de enum en dos tablas, pero **ninguna discrimina el tipo de audiencia** (formalización, control de detención, preliminar, debate, cesura) — justo lo que HearSim necesita para elegir el guion |
| `audiencias_anteriores[].fecha` | parcial | `eventos_caso.ocurrido_en` · `eventos_agenda.fecha_inicio` | El único dato tipado y validado de toda la familia. Pero no hay entidad `audiencia` con identidad propia, y la misma audiencia puede duplicarse entre agenda y timeline sin vínculo |
| `audiencias_anteriores[].resultado` | derivable | `eventos_caso.descripcion` + `.estado` | No existe columna `resultado`. `estado` solo dice si pasó o está pendiente |
| `audiencias_anteriores[].notas` | derivable | `eventos_agenda.notas` (TEXT tipado, nullable) | Pero es la agenda del abogado, no el expediente, y `caso_id` es nullable |

### Hallazgos clave — Capa A

- **⚠️ DESCONEXIÓN CRÍTICA (el hallazgo más importante).** El único vocabulario cerrado que produce el pipeline — `datos_detectados {jurisdiccion_inferida, delitos_posibles, hay_detenidos, etapa_procesal}` + `flags_detectados[5 enums]` — **nunca llega al caso**. Tres eslabones lo cortan: (1) `analizarCasoInputSchema` solo acepta `{caso, rol, contexto}` ([schemas.ts:19-24](src/lib/schemas.ts#L19-L24)) y la route solo usa esos 3 ([analizar-caso/route.ts:55-56](src/app/api/analizar-caso/route.ts#L55-L56)); (2) se persisten solo en `ejecuciones(tipo='pre_analisis').metadata.resultado`; (3) `casos.ejecucion_origen_id` apunta a la ejecución de **`analizar_caso`**, y no existe ninguna FK a la de pre-análisis. Esos datos quedan en una fila irrecuperable desde el caso.
- **`casos.contexto` no tiene claves estables.** Los ids de pregunta son snake_case inventados por el LLM. El propio repo lo documenta y por eso `sugerirFuero` matchea por **regex sobre las claves** ([sugerir-fuero.ts:14-17,63-75](src/lib/mapa-procesal/sugerir-fuero.ts#L14-L17)). Contradicción interna: [casos/route.ts:239-242](src/app/api/casos/route.ts#L239-L242) lee la clave *literal* `'jurisdiccion'` con un `in` check — best-effort, degrada a null en silencio. **Consumir `contexto` por nombre de campo no es viable.**
- **Las 4 categorías de preguntas no se persisten.** Toda la semántica A/B/C/D se pierde al serializar.
- **`eventos_caso` modela hechos, no entidades.** Es el vehículo más rico post-creación (categoría, descripción 20-2000, `ocurrido_en` validado, `estado`, `adjuntos[]`), pero no hay ninguna fila que sea "un testigo", "una prueba" o "una audiencia" con campos propios. Además **el contenido de los adjuntos históricos nunca se lee**: se listan solo por filename ([build-contexto-caso.ts:14-18](src/lib/casos/build-contexto-caso.ts#L14-L18)).
- **La app sabe tipar cuando le importa** — `eventos_agenda` tiene 17 columnas y 3 enums; `eventos_caso.ocurrido_en` está validado con rango. El modelado estructurado se aplicó al **calendario**, no al **expediente**.

---

## 4. CAPA B — Análisis estratégico

### 4.1 PUNTO CRÍTICO — Jurisprudencia: **NO**

**La generación de estrategia no produce ni persiste jurisprudencia.** Verificado en 6 capas por 3 lentes independientes (corpus RAG / prompt+schema+parser / persistencia+UI), con 22 veredictos de refutación y 0 confirmaciones en contra:

| Capa | Evidencia |
|---|---|
| **Prompt** | El bloque JSON de salida ([prompts.ts:69-101](src/lib/agent/prompts.ts#L69-L101)) no tiene ninguna clave de jurisprudencia. Las 3 menciones a la palabra ([prompts.ts:13-15](src/lib/agent/prompts.ts#L13-L15)) son **adjetivos del perfil de riesgo**: "jurisprudencia mayoritaria / firme / minoritaria". La regla de fundamentación pide **exclusivamente** artículos: *"usá EXACTAMENTE el número y nombre del artículo tal como aparece en el chunk (…) NUNCA inventes números de artículo"* ([prompts.ts:4](src/lib/agent/prompts.ts#L4)) |
| **Zod** | `baseEstrategiaSchema` ([schemas.ts:89-107](src/lib/schemas.ts#L89-L107)) tiene exactamente 10 campos, ninguno de fallos. `analisisOutputSchema` solo admite `defensor`/`querellante`/`metadata` |
| **Parser** | `extractResult` ([parse.ts:27-39](src/lib/agent/parse.ts#L27-L39)) copia **solo** `defensor`, `querellante` y `metadata`. Una clave hermana `jurisprudencia` se descartaría silenciosamente |
| **DB** | Grep de `jurisprudencia\|fallo\|caratula\|tribunal\|holding\|precedente` sobre `supabase/migrations/` → **0 matches** |
| **Corpus RAG** | Los 3 ingestores versionados declaran `TIPO_DOCUMENTO` hardcodeado: `"codigo"` ([ingestar-cp.ts:24](scripts/ingestar-cp.ts#L24)), `"codigo_procesal"` ([ingestar-cppf.ts:19](scripts/ingestar-cppf.ts#L19), [ingestar-cppf-html.ts:22](scripts/ingestar-cppf-html.ts#L22)). La metadata que devuelve la RPC son 6 claves normativas: `tipo_documento, libro, titulo, capitulo, articulo, seccion` ([20260627003911:32-39](supabase/migrations/20260627003911_match_documents_threshold_param.sql#L32-L39)). **Estructuralmente el corpus no puede representar un fallo.** No existe ingestor de jurisprudencia |
| **UI** | Ningún componente renderiza carátula/tribunal/año |

**Dos matices honestos que hay que registrar:**

1. **La UI le promete al abogado algo que el sistema no tiene.** [busquedas-rag.tsx:20](src/components/nuevo-analisis/busquedas-rag.tsx#L20) muestra *"Búsquedas en jurisprudencia y código penal (N)"* y [progreso-analisis.tsx:10](src/components/nuevo-analisis/progreso-analisis.tsx#L10) muestra *"Buscando jurisprudencia…"*. Lo que se busca es CP + CPPF + manuales. Es un mislabel, no un bug funcional, pero induce a error sobre la fundamentación del output.
2. **Hay un hueco de guardrail.** `fundamento_legal: string[]` y `doctrina_aplicable: string` son strings libres sin validación de contenido. La guardrail del prompt cubre **números de artículo**, no carátulas de fallos. Nada en el código impide que el modelo escriba *"CSJN, Fallos 328:3399, Casal"* ahí de memoria paramétrica: se persistiría en `casos.estrategia_snapshot` y se renderizaría como bullet, **indistinguible de una cita normativa verificada**. `NO CONFIRMADO` si ocurre en la práctica (requiere query a la DB).

*(Única mención a un fallo por nombre en todo el repo: `'Casal'` en [plantilla-base.ts:139](src/lib/mapa-procesal/plantilla-base.ts#L139) — literal hardcodeado por un humano en una plantilla estática del mapa, ni generado ni recuperado.)*

### 4.2 Shape exacto que produce y persiste el motor

```jsonc
// PROMPT (prompts.ts:69-101) — contrato pedido al modelo
{
  "defensor": {                       // solo si se pidió defensa
    "rol": "Defensor",
    "imputados_identificados": ["nombre1"],
    "delitos_imputables": ["delito1"],
    "estrategias": [
      { "numero": 1, "tipo": "conservadora",
        "nombre": "...", "resumen_ejecutivo": "60-120 palabras",
        "tesis_central": "2-3 oraciones",
        "fundamento_legal": ["Art. X CP - explicación"],
        "doctrina_aplicable": "Doctrina relevante del manual",
        "fortalezas": [...], "riesgos": [...], "pasos_procesales": [...] },
      { "numero": 2, "tipo": "moderada",  /* mismo shape */ },
      { "numero": 3, "tipo": "agresiva",  /* mismo shape */ }
    ]
  },
  "querellante": { /* misma estructura, rol "Querellante/Fiscal" */ },
  "metadata": { "conceptos_extraidos": [], "articulos_consultados": ["Art. 79"], "timestamp": "" }
}
```

```ts
// ZOD (schemas.ts:82-163) — se aplica SOLO en lectura, nunca antes de escribir
export const tipoEstrategiaSchema = z.enum(["conservadora", "moderada", "agresiva"]);

const baseEstrategiaSchema = z.object({
  numero: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  nombre: z.string(),
  tipo: tipoEstrategiaSchema,
  resumen_ejecutivo: z.string().min(1).max(1500),
  tesis_central: z.string(),
  fundamento_legal: z.array(z.string()).default([]),
  doctrina_aplicable: z.string().default(""),
  fortalezas: z.array(z.string()).default([]),
  riesgos: z.array(z.string()).default([]),
  pasos_procesales: z.array(z.string()).default([]),
});
// + z.preprocess (schemas.ts:121-138) que rellena `tipo` y `resumen_ejecutivo` de snapshots viejos
```

**Persistencia:** `ejecuciones.metadata.resultado` (jsonb crudo, [analizar-caso/route.ts:182](src/app/api/analizar-caso/route.ts#L182)) y `casos.estrategia_snapshot` (**un solo elemento** del array, [casos/route.ts:100,127](src/app/api/casos/route.ts#L100)).

### Tabla de mapeo — Capa B

| campo | estado | ubicación | notas |
|---|---|---|---|
| `teoria_del_caso_defensa.narrativa` | **no existe** | — | 0 ocurrencias de `teoria_del_caso` y `narrativa` en el repo. Análogo NO equivalente: `tesis_central`, que es *por estrategia* (3 por rol), no una teoría única |
| `teoria_del_caso_defensa.mensaje_central` | **no existe** | — | 0 ocurrencias |
| `teoria_del_caso_defensa.hechos_a_probar[]` | **no existe** | — | 0 ocurrencias. No hay ningún campo de hechos estructurados en ninguna capa |
| `teoria_del_caso_defensa.hechos_a_destruir[]` | **no existe** | — | 0 ocurrencias |
| `teoria_del_caso_defensa.duda_razonable_en[]` | **no existe** | — | 0 ocurrencias; tampoco el concepto en ningún prompt |
| `teoria_del_caso_acusacion.narrativa` | **no existe** | — | La rama `querellante` existe pero con el **mismo shape** que `defensor` |
| `teoria_del_caso_acusacion.puntos_fuertes[]` | **no existe** | — | Existe `fortalezas[]`, pero es *por estrategia* y con otra semántica |
| `teoria_del_caso_acusacion.vulnerabilidades_de_la_acusacion[]` | **no existe** | — | Existe `riesgos[]` *de esa estrategia*, no un mapeo de vulnerabilidades |
| `estrategias_recomendadas[].nombre` | parcial | [schemas.ts:91](src/lib/schemas.ts#L91) | **Renombre:** el contenedor `estrategias_recomendadas` no existe (0 matches); el array se llama `estrategias` y cuelga de `defensor`/`querellante` |
| `estrategias_recomendadas[].descripcion` | parcial | `resumen_ejecutivo` ([:100](src/lib/schemas.ts#L100)) + `tesis_central` ([:101](src/lib/schemas.ts#L101)) | No hay campo `descripcion`; su función se reparte entre dos campos |
| `estrategias_recomendadas[].momento_procesal` | **no existe** | — | 0 ocurrencias. `pasos_procesales[]` es prosa libre sin campo de etapa |
| `estrategias_recomendadas[].norma_habilitante` | parcial | `fundamento_legal[]` ([:102](src/lib/schemas.ts#L102)) | La norma vive **embebida en strings libres** (`"Art. X CP - explicación"`). Extraerla requiere parsear texto con regex. Sin sub-campos de código/artículo/inciso |
| `estrategias_recomendadas[].probabilidad_exito` | **no existe** | — | 0 ocurrencias. Lo más cercano es el enum `tipo`, que es **perfil de riesgo**, no probabilidad |
| `estrategias_recomendadas[].riesgos` | parcial | [schemas.ts:105](src/lib/schemas.ts#L105) | Existe con ese nombre literal, pero cuelga de `estrategias[]`. Array de strings libres, sin severidad ni tipo |
| `puntos_criticos_del_caso[].punto` / `.tipo` / `.para_quien` / `.impacto` | **no existe** | — | **Concepto prompt-only:** [prompts.ts:5](src/lib/agent/prompts.ts#L5) dice que los 5 flags "deben tratarse como PUNTO CRÍTICO en cada estrategia", pero ordena reflejarlo *dentro* de `fundamento_legal`/`pasos_procesales`/`fortalezas`/`riesgos`. **No hay clave de salida.** El enum `flags_detectados` existe pero pertenece a `/api/pre-analisis`, en otra fila de DB, y el motor de estrategia **no lo recibe** ([prompts.ts:11](src/lib/agent/prompts.ts#L11): "Re-detectalos vos mismo") |
| `garantias_en_juego[]` (4 campos) | **no existe** | — | 0 ocurrencias en todo el repo. Ninguna capa modela garantías constitucionales |
| `exclusiones_probatorias_disponibles[]` (4 campos) | **no existe** | — | 0 ocurrencias. **No existe entidad "prueba"** en ninguna capa: sin tabla, sin id, sin array. Concepto adyacente prompt-only: flag F3 nulidades ([prompts.ts:8](src/lib/agent/prompts.ts#L8)) |
| `jurisprudencia_identificada[]` (6 campos) | **no existe** | — | Ver §4.1. 0 ocurrencias de todos los sub-campos |

**Campos reales que sí existen (para contraste):** `numero`, `tipo` (enum de 3), `nombre`, `resumen_ejecutivo`, `tesis_central`, `fundamento_legal[]`, `doctrina_aplicable`, `fortalezas[]`, `riesgos[]`, `pasos_procesales[]`, + `metadata.articulos_consultados[]` (ruta real: `ejecuciones.metadata.resultado.metadata.articulos_consultados` — doble `metadata`) y `metadata.chunks_recuperados[]` (`{articulo, tipo_documento, similarity}`, sin el texto).

### Hallazgos clave — Capa B

- **De los 32 campos pedidos, 28 tienen cero ocurrencias en todo el repo.** Los 4 "parciales" son **renombres**, no equivalencias.
- **El parser es un filtro destructivo.** [parse.ts:31-38](src/lib/agent/parse.ts#L31-L38) construye un objeto nuevo copiando solo `defensor`/`querellante`/`metadata`. **Agregar campos nuevos al prompt requiere tocar el parser**, no solo el prompt.
- **La validación Zod pre-escritura es inconsistente**, no inexistente: 2 de 4 rutas validan antes del INSERT (`pre-analisis` y `mapa/simular`); `analizar-caso` y `casos` escriben jsonb crudo.
- **El RAG sí está forzado en `analizar-caso`.** [run-agent.ts:207](src/lib/agent/run-agent.ts#L207) usa `tool_choice: { type: "tool", name: BUSCAR_DOCUMENTOS_TOOL_NAME }` en el primer call. **Esto contradice CLAUDE.md**, que afirma que "el RAG no está forzado". Es cierto solo para el chat.

---

## 5. CAPA C — Mapa procesal

**Respuesta directa: el Mapa Procesal persiste SOLO el grafo. Cero datos procesales estructurados.** Y ni siquiera el grafo entero: los **edges** se derivan de `padre_id` en cada render, la **etapa (1-6)** se deriva por match de string del título contra 13 anclas hardcodeadas, y la categoría **"decisión"** es un booleano calculado en runtime.

```sql
-- Única tabla del módulo (20260610130000:6-21 + 20260627013506:7-8) — 13 columnas
CREATE TABLE mapa_procesal_nodos (
  id UUID PRIMARY KEY, caso_id UUID NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL, descripcion TEXT,
  tipo   TEXT NOT NULL DEFAULT 'prediccion' CHECK (tipo   IN ('raiz','real','prediccion')),
  estado TEXT NOT NULL DEFAULT 'bloqueado'  CHECK (estado IN ('ocurrido','desbloqueado','bloqueado')),
  padre_id UUID REFERENCES mapa_procesal_nodos(id) ON DELETE CASCADE,
  posicion_x FLOAT DEFAULT 0, posicion_y FLOAT DEFAULT 0,
  metadata JSONB DEFAULT '{}',            -- ⚠️ NUNCA se escribe
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
);
ALTER TABLE mapa_procesal_nodos ADD COLUMN riesgo_alto boolean NOT NULL DEFAULT false;
-- NO hay tabla de edges. NINGUNA columna de fecha procesal, plazo, probabilidad, objetivo ni preparación.
```

### Tabla de mapeo — Capa C

| campo | estado | ubicación | notas |
|---|---|---|---|
| `estado_actual.etapa` | derivable | [etapas.ts:14-63](src/lib/mapa-procesal/etapas.ts#L14-L63) + [layout.ts:200-214](src/lib/mapa-procesal/layout.ts#L200-L214) | **No se persiste** — el propio código lo dice ([etapas.ts:8](src/lib/mapa-procesal/etapas.ts#L8)). Se resuelve por match de string contra 13 títulos ancla, con herencia del ancestro. Deriva la etapa **de cada nodo**, no la del caso: `max(etapa)` sobre nodos `ocurrido` sería el cálculo, y **no existe en el código** |
| `estado_actual.posicion` | **no existe** ⚠️*(corregido de "derivable")* | — | **Falso amigo crítico:** `posicion_x`/`posicion_y` que sí existen son **coordenadas de canvas en píxeles** (ReactFlow, sembradas por dagre). Ninguna línea del repo deriva una "posición procesal" |
| `proxima_audiencia.tipo` | parcial | `eventos_agenda.tipo='audiencia'` ([20260610120000:16-25](supabase/migrations/20260610120000_eventos_agenda.sql#L16-L25)) | **En el mapa no existe.** `mapa_procesal_nodos.tipo` NO es tipo de audiencia — es procedencia del nodo (raíz/real/predicción) |
| `proxima_audiencia.fecha_estimada` | parcial | `eventos_agenda.fecha_inicio` | El mapa **no tiene ninguna columna de fecha** salvo `created_at`/`updated_at`. La derivación (`min(fecha_inicio) WHERE caso_id=? AND tipo='audiencia' AND fecha_inicio>=now()`) **no existe en el código** |
| `proxima_audiencia.objeto_procesal` | **no existe** | — | Solo prosa libre (`descripcion`, tope 2000) |
| `proxima_audiencia.preparacion_requerida[]` | **no existe** | — | **No hay arrays en el módulo.** La única jsonb (`metadata`) nunca se escribe |
| `ruta_critica[].paso` | **no existe** ⚠️*(corregido)* | — | Sin noción de ruta crítica (0 hits de `ruta_critica`) y sin ordinal. El modelo es un **árbol con ramas múltiples**, no una secuencia |
| `ruta_critica[].audiencia_o_acto` | parcial | `mapa_procesal_nodos.titulo` | El título ES el acto procesal, pero es string libre sin taxonomía |
| `ruta_critica[].objetivo` | **no existe** | — | `descripcion` mezcla sub-etapas, artículos y órganos en un solo TEXT |
| `ruta_critica[].riesgos[]` | parcial | `mapa_procesal_nodos.riesgo_alto` | **Un booleano por nodo.** Sin array, sin severidad, sin texto. Se setea en 3 lugares: plantilla curada, simulación IA y toggle manual |
| `ruta_critica[].decisiones_clave[]` | derivable | [layout.ts:222-223](src/lib/mapa-procesal/layout.ts#L222-L223) | **No persiste.** Es un booleano derivado en cada render (`>=2 hijos && ninguno ocurrido`). No es un array de decisiones: es solo un color |
| `escenarios_posibles[].nombre` | parcial | `titulo` + `tipo='prediccion'` | Un nodo `prediccion` ES conceptualmente un escenario, pero sin entidad propia. Y `tipo` **se pisa** a `'real'` al marcarlo ocurrido |
| **`escenarios_posibles[].descripcion`** | **existe** | `mapa_procesal_nodos.descripcion` | **El único campo de los 18 que persiste tal cual.** Validado por `ramasSimuladasSchema` con `.min(1).max(2000)` |
| `escenarios_posibles[].probabilidad` | **no existe** | — | **Gap explícito:** el prompt PIDE probabilidad como criterio de orden ([simulacion.ts:32](src/lib/mapa-procesal/simulacion.ts#L32): "ordenadas de más probable a menos probable") pero `ramasSimuladasSchema` no tiene el campo. El orden se traduce a `posicion_x` escalonada y **se pierde en cuanto el abogado arrastra un nodo** |
| `escenarios_posibles[].condiciones` | **no existe** | — | La única "condición" es binaria y estructural (`bloqueado`→`desbloqueado` al marcar el padre). De facto muerta: la plantilla crea todo en `desbloqueado` |
| `plazos_criticos[].descripcion` | parcial | `eventos_agenda.tipo='vencimiento_procesal'` | **Falso positivo a desarmar:** los plazos SÍ aparecen en el mapa, pero como **prosa estática** en las descripciones curadas por fuero ([plantilla-base.ts:63,171,271](src/lib/mapa-procesal/plantilla-base.ts#L63)) — texto legal de referencia idéntico para todos los casos, no un plazo del caso concreto |
| `plazos_criticos[].vencimiento` | parcial | `eventos_agenda.fecha_inicio` | Precedente de derivación existe pero solo client-side en el módulo agenda ([agenda-view.tsx:308](src/components/agenda/agenda-view.tsx#L308), ventana de 7 días). El mapa no lo consume |
| `plazos_criticos[].consecuencia_de_incumplimiento` | **no existe** | — | En ninguna tabla del sistema |

### El gap: "grafo visual" vs "datos procesales estructurados"

El mapa es un **diagrama editable**, no un modelo de datos del proceso:

1. **No hay ninguna columna temporal** fuera de `created_at`/`updated_at` → el mapa no sabe *cuándo* pasó ni *cuándo* va a pasar nada.
2. **Los plazos legales son prosa estática por fuero**, iguales para todos los casos.
3. **La única jsonb que podría alojar datos estructurados (`metadata`) nunca se escribe** — verificado en los 6 insert/update de `queries.ts`; `NodoProcesalInsert` ni la declara.
4. **Toda la riqueza legal vive en un TEXT libre** (`descripcion`) que mezcla sub-etapas, artículos y órganos en el mismo string.
5. **Hay TRES modelos temporales/procesales sin conexión entre sí**: `mapa_procesal_nodos` (grafo sin fechas), `eventos_caso` (timeline con `ocurrido_en`, ligado al caso) y `eventos_agenda` (calendario con `fecha_inicio`, ligado a usuario + caso opcional).

**`eventos_agenda` cubre parcialmente `proxima_audiencia` y `plazos_criticos` pero está desconectada del mapa.** SÍ hay FK (`caso_id UUID REFERENCES casos(id) ON DELETE SET NULL`, nullable, con índice parcial) y el CHECK incluye literalmente `'audiencia'` y `'vencimiento_procesal'`. **Pero:** 0 referencias a `eventos_agenda` en `src/lib/mapa-procesal/` y en `src/app/api/casos/[id]/mapa/`, y `buildContextoCaso` —el contexto que alimenta la simulación IA— **tampoco la lee**. Comparten la FK y nada más.

*Deuda documentada:* `reiniciarMapa` hace DELETE + INSERT en dos round-trips **sin transacción** ([queries.ts:425-433](src/lib/mapa-procesal/queries.ts#L425-L433)); si el insert falla tras el delete, el mapa queda con 0 nodos.

---

## 6. Infra del chat per-case y modelo de sesión (Tarea 4)

### 6.1 Persistencia — hay contenedor de sesión, pero con estado mínimo

```sql
-- 20260507180000_chat_persistente_cleanup_pr3_y_refunded.sql:59-91
CREATE TABLE conversaciones_caso (
  id uuid PK, caso_id uuid NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','archivada')),
  creada_en timestamptz, actualizada_en timestamptz, archivada_en timestamptz NULL
);
CREATE UNIQUE INDEX uq_conversacion_activa_por_caso
  ON conversaciones_caso (caso_id) WHERE estado = 'activa';   -- 1 activa por caso, enforced en DB

CREATE TABLE mensajes_conversacion (
  id uuid PK, conversacion_id uuid NOT NULL REFERENCES conversaciones_caso(id) ON DELETE CASCADE,
  rol text NOT NULL CHECK (rol IN ('usuario','agente')),
  contenido text NOT NULL,
  adjuntos jsonb NOT NULL DEFAULT '[]',
  respuesta_estructurada jsonb NULL,
  ejecucion_id uuid NULL REFERENCES ejecuciones(id) ON DELETE SET NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
-- + trigger mensajes_bump_conv que actualiza conversaciones_caso.actualizada_en
```

- **`conversaciones_caso` tiene 7 columnas y un solo campo de estado (`activa|archivada`). No tiene columna jsonb.** No hay dónde guardar estado de turno, rol asumido, tipo de audiencia ni nivel de dificultad.
- **El estado de turno hoy es implícito**: se deriva releyendo los mensajes y saneando la alternancia en [build-contexto-conversacion.ts:166-197](src/lib/casos/build-contexto-conversacion.ts#L166-L197) (colapso de roles consecutivos, descarte de assistant inicial, pop del user huérfano reinyectado al markdown). Ese saneo existe por un incidente real que dejó una conversación **permanentemente brickeada** con 400 de Anthropic.
- **Dos INSERTs por turno:** el del usuario **antes** de llamar al agente (para que quede registro si falla), el del agente después. `mensajes_conversacion` **no tiene columna `metadata`** — toda la metadata de la corrida vive en `ejecuciones.metadata`, linkeada por `ejecucion_id`.
- **No hay endpoint de archivar**: el único camino es crear otra conversación, que archiva la activa antes de insertar. Postear a una archivada → 409.
- **No hay límite ni ventana del historial**: el SELECT trae **todos** los mensajes sin LIMIT.

### 6.2 Streaming — **NO existe, en ninguna capa**

Grep de `messages.stream`, `.stream(`, `ReadableStream`, `text/event-stream`, `EventSource`, `TransformStream`, `getReader` sobre `src/` y `scripts/` → **0 matches**.

- **Server:** los 5 call sites usan `client.messages.create` bloqueante ([run-agent-consulta.ts:263,361,371](src/lib/agent/run-agent-consulta.ts#L263); [run-agent.ts:202,315](src/lib/agent/run-agent.ts#L202); [pre-analisis/route.ts:72](src/app/api/pre-analisis/route.ts#L72); [simulacion.ts:131](src/lib/mapa-procesal/simulacion.ts#L131)).
- **Transporte:** un único `JSON.stringify` al final ([http.ts:3-11](src/lib/http.ts#L3-L11)). El cliente hace `await fetch()` + `await res.json()`.
- **Lo que parece streaming no lo es:** envío optimista + burbuja "Pensando…" ([chat-shell.tsx:37-61](src/components/mis-casos/chat/chat-shell.tsx#L37-L61)).
- **Recovery en lugar de stream:** ante 502 con body no-JSON, el cliente pollea `GET /mensajes?desde=<iso>` hasta 60s.
- **Runtime: Node** (implícito). 0 matches de `export const runtime` — y no podría ser edge: `server-only` + SDK Anthropic + service_role + sharp/mammoth. `maxDuration` del chat = 180, pero **es inerte en Easypanel** (self-hosted), según el propio comentario de la route.

### 6.3 System prompt y armado de mensajes

- **`system` es un string plano**, no array de bloques: `system: input.systemPrompt` en los 3 call sites. El valor lo inyecta la route: `SYSTEM_PROMPT_CONSULTA`.
- **Array de mensajes:** `[...mensajesPrevios, { role: 'user', content: buildPrimerUserContent(input) }]` ([run-agent-consulta.ts:240-243](src/lib/agent/run-agent-consulta.ts#L240-L243)).
- **El historial se aplana a texto plano**, no a content blocks. Los adjuntos históricos **nunca se re-bajan** del bucket; solo se mencionan por nombre.
- **Solo el mensaje nuevo es array de content blocks**: PDF → `document` nativo; imagen → `image` nativo (HEIC/HEIF convertidos a JPEG server-side); DOCX → texto extraído con mammoth; audio → transcripción Whisper; adjunto fallido → text block explicativo (**un adjunto malo no tumba el turno**).
- **El contexto del caso va en el ÚLTIMO mensaje**, no en el system → **cada turno reenvía el markdown completo del caso otra vez**, a precio de input completo.

### 6.4 Modelo — **NO es Sonnet 4.5 en todo**

| Dónde | Modelo | Config |
|---|---|---|
| `analizar-caso`, `pre-analisis`, `mapa/simular` | `claude-sonnet-4-5-20250929` | **Constante hardcodeada** `MODEL_ID` ([anthropic.ts:13](src/lib/anthropic.ts#L13)) |
| **Chat por caso** (selector Bajo/Medio/Alto) | `claude-haiku-4-5-20251001` / `claude-sonnet-4-5-20250929` / `claude-opus-4-6` | [modelos.ts:35-47](src/lib/agent/modelos.ts#L35-L47), `maxTokens: 16000` en los 3. Default `medio` |
| Embeddings RAG | `text-embedding-3-small` | [openai.ts:13](src/lib/openai.ts#L13) |
| Transcripción de audio | `whisper-1` | [transcribir-audio.ts:19](src/lib/casos/transcribir-audio.ts#L19) — **su costo no pasa por `pricing.ts` ni se registra en `ejecuciones`** |

**Ninguno es configurable por env.** El cliente manda `nivel` (enum-allowlist Zod), **nunca un model ID crudo**; el server resuelve con `MODELO_POR_NIVEL[nivel]`.

⚠️ **Acoplamiento duro modelo↔pricing:** [modelos.ts:11-13](src/lib/agent/modelos.ts#L11-L13) advierte que todo `modelId` debe tener entrada en `pricing.ts` porque `calcularCosto` **tira Error y rompe el turno con 500**. `PRECIOS` tiene exactamente esos 3 IDs.

### 6.5 Prompt caching — **NO**

Grep de `cache_control`, `ephemeral`, `prompt-caching`, `betas` sobre `src/` y `scripts/` → **0 matches**.

Lo que sí existe es **solo contabilidad**: se leen y persisten `cache_creation_input_tokens` / `cache_read_input_tokens` del usage, y `pricing.ts` tiene tarifas de cache write/read por modelo. Como nunca se declara `cache_control`, **esos contadores son siempre 0**.

### 6.6 `tool_choice` — se fuerza en **un solo lugar**

| Flujo | tool_choice |
|---|---|
| `analizar-caso` | **SÍ**, primer call: `tool_choice: { type: "tool", name: BUSCAR_DOCUMENTOS_TOOL_NAME }` ([run-agent.ts:207](src/lib/agent/run-agent.ts#L207)) — único uso en `src/`. Los calls del loop usan `auto` |
| **Chat** | **NO** — `tools: [buscarDocumentosTool]` sin `tool_choice` → default `auto`. Coherente con el prompt, que le da permiso de no buscar |
| `pre-analisis`, `mapa/simular` | N/A — son single-shot, ni siquiera pasan `tools` |

⚠️ **Drift documental a corregir:** CLAUDE.md afirma que en `/api/analizar-caso` "el RAG no está forzado: no se usa `tool_choice`". **Es falso.** Solo aplica al chat.

**Hay exactamente UNA tool en todo el sistema** (`buscar_documentos_legales`). Cualquier tool nueva sería la primera, y hoy el branch de tool desconocida devuelve `is_error` ([run-agent-consulta.ts:336-341](src/lib/agent/run-agent-consulta.ts#L336-L341)).

### 6.7 Formato de prompts — **100% strings TypeScript**

Los 4 system prompts viven como constantes exportadas en dos archivos `.ts`: `SYSTEM_PROMPT`, `SYSTEM_PROMPT_CONSULTA`, `PRE_ANALISIS_SYSTEM_PROMPT` ([prompts.ts](src/lib/agent/prompts.ts)) y `SYSTEM_PROMPT_SIMULACION` ([simulacion.ts:23-33](src/lib/mapa-procesal/simulacion.ts#L23-L33)). **Nada migró a Markdown ni SKILL.md**: no hay `.md` dentro de `src/`, ni carpetas `prompts/` o `skills/` en la raíz. Los `SKILL.md` del árbol (`.claude/skills/*`, `.agents/skills/*`) son herramientas de Claude Code y la app no los lee.

Cambiar un prompt = editar TS + redeploy. **Para catálogos por escenario, el patrón más cercano no es `prompts.ts` sino [plantilla-base.ts](src/lib/mapa-procesal/plantilla-base.ts)**, que guarda contenido curado por fuero como estructuras de datos TS y lo serializa al prompt.

### 6.8 Patrones para un feature nuevo

**Protección con Clerk — dos capas, hay que aplicar las dos:**
1. **Middleware** ([proxy.ts:3-16](src/proxy.ts#L3-L16)): el matcher incluye `/(api|trpc)(.*)`, así que **toda ruta nueva queda protegida por defecto**. Solo garantiza sesión, no whitelist.
2. **Whitelist en el handler**: `requireUsuarioOr403()` ([whitelist.ts:25-83](src/lib/auth/whitelist.ts#L25-L83)) → unión discriminada con `{usuario_id, nombre, clerk_user_id, email, role}` o `{ok:false, status: 401|403}`.
3. **Rate limit** (rutas que gastan tokens): `enforceTokenLimit(usuario_id)` → 429.

**Orden canónico de un handler** (mensajes/route.ts:185-256): validar UUIDs → parsear body → Zod `safeParse` → `requireUsuarioOr403` → validar ownership → reglas de negocio → `enforceTokenLimit` → trabajar.
**Ownership:** siempre con join `!inner` contra `wl.usuario_id`, devolviendo **404 (no 403)** para no revelar existencia. *El server usa `service_role`, así que la RLS no protege — el ownership es 100% código.*

**Gating por rol (`/admin`) — CONFIRMADO: devuelve 404 a no-admins**, en las dos superficies:
- **Page:** `const result = await requireAdminOr404(); if (!result.ok) notFound();` ([admin/layout.tsx](src/app/admin/layout.tsx)) → 404 estándar de Next.
- **API:** `return jsonResponse({ ok:false, error:"Not found" }, 404)` ([api/admin/metricas/route.ts:6-9](src/app/api/admin/metricas/route.ts#L6-L9), [api/admin/ejecuciones/route.ts:24-27](src/app/api/admin/ejecuciones/route.ts#L24-L27)).
- El helper ([admin/auth.ts:26-57](src/lib/admin/auth.ts#L26-L57)) **no lleva mensaje en el branch de fallo**, por contrato: *"ni siquiera revelamos que la ruta existe"*. Incluso si la query a Supabase falla, devuelve 404 y loguea server-side.
- ⚠️ **Dos helpers no intercambiables:** `requireUsuarioOr403` devuelve `role` y las pages lo usan para decidir la UI; el gating **duro** usa `requireAdminOr404`, que hace su propia query.

**Registrar una ejecución — ⚠️ `ejecuciones.tipo` ES un CHECK constraint:**
```sql
-- 20260706190000_ejecuciones_tipo_simular_mapa.sql:21-22
ALTER TABLE ejecuciones ADD CONSTRAINT ejecuciones_tipo_check
  CHECK (tipo IN ('pre_analisis','analizar_caso','consulta_caso','simular_mapa'));
```
**Agregar un tipo nuevo requiere una migración SQL aplicada ANTES de deployar el código.** Sin eso, el INSERT viola el constraint y la ruta devuelve 500. Esa migración es además **el precedente exacto a copiar**: un DO block que dropea el CHECK vigente **por definición y no por nombre** (por el drift repo↔DB).

Payload: `{usuario_id, tipo, modelo, input_tokens, output_tokens, costo_usd, latencia_ms, metadata}` (`total_tokens` es GENERATED). Tokens **siempre reales del SDK**; costo acumulado **por request** dentro del loop (el tier long-context se decide por request, no sobre la suma). **Se persiste también en el camino de error** (AgentError → insert con `partialUsage` + 502). `refunded` **no es columna ni endpoint**: es una clave de metadata inyectada a mano por SQL que `v_consumo_mensual` excluye.

**Sidebar:** un solo lugar — agregar un objeto al array `ITEMS` en [app-sidebar.tsx:27-60](src/components/nav/app-sidebar.tsx#L27-L60) (`{href, label, icon, match, adminOnly?}`). El filtro `adminOnly` es **solo cosmético**. ⚠️ El sidebar **no es global**: cada página monta `<NavShell>` explícitamente (5 call sites). **El chat y el mapa procesal NO lo usan** — son vistas inmersivas full-height (`<div className="flex h-dvh flex-col overflow-hidden">`). Si HearSim es a pantalla completa, ese es el patrón, y su ruta debe vivir fuera del árbol con `NavShell`.

### 6.9 Veredicto de reuso

**Reusable tal cual (copiar el patrón):** prólogo de seguridad del handler · gating por rol · contabilidad en `ejecuciones` (incluido el camino de error) · loop de agente con cap de búsquedas y síntesis forzada · `parseWithRecovery` + Zod + fallback conversacional · shell inmersivo + burbuja optimista · entrada de sidebar.

**Requiere infra nueva:** **modelo de sesión** (no hay dónde poner turno/rol/tipo de audiencia/dificultad) · **transcript para debriefing** (hoy se aplana a texto descartando metadata; `respuesta_estructurada` ya está ocupada por el union `{conversacional|analisis}`; no hay columna `metadata` en mensajes) · **streaming** (cero, y `jsonResponse` solo sabe `JSON.stringify`) · **prompt caching** (cero; hay que pasar `system` de string a bloques) · **tipo en `ejecuciones`** (migración obligatoria antes del código) · **pricing** si el modelo es nuevo.

**Deuda a NO propagar:** el loop del agente está **duplicado casi verbatim** entre `run-agent.ts` y `run-agent-consulta.ts` (reconocido en el propio código). Un tercer loop serían tres. La lógica de título auto-fecha también está duplicada en dos lugares.

**El feature "simular mapa"** (route + migración de tipo + prompt + parseo + tracking) es **el ejemplo end-to-end más reciente y completo de "cómo se agrega un feature con IA"** en este repo.

---

## 7. GAPS Y PREGUNTAS ABIERTAS

### 7.1 Lo que falta (gaps de datos)

1. **No existe ninguna entidad procesal como fila con campos propios.** Ni `imputado`, ni `parte`, ni `prueba`, ni `testigo`, ni `perito`, ni `audiencia`, ni `medida_cautelar`. Todo es texto libre dentro de `casos.caso_descripcion`, `casos.contexto` o `eventos_caso.descripcion`.
2. **Familias con captura cero:** peritos (0 matches), arraigo (0), atenuantes (0), tribunal, expediente, partes (fiscal/defensor/querellante como identidades), pena en abstracto, discrepancias entre versiones.
3. **Toda la Capa B es nueva.** 28 de 32 campos no existen; los 4 "parciales" son renombres de campos con otra semántica.
4. **La Capa C persiste un diagrama, no un modelo procesal.** 1 de 18 campos existe. Sin fechas, sin plazos del caso, sin probabilidad, sin ruta crítica.
5. **El vocabulario cerrado del pre-análisis se pierde** antes de llegar al caso (desconexión de 3 eslabones).
6. **`casos.contexto` no es consultable por nombre de campo** — claves generadas por el LLM.
7. **Tres modelos temporales desconectados** (`mapa_procesal_nodos` / `eventos_caso` / `eventos_agenda`).
8. **Sin sesión, sin streaming, sin caching** para un flujo conversacional turno a turno.

### 7.2 Lo que NO pude confirmar

| # | Punto | Por qué |
|---|---|---|
| 1 | **Estado real de la DB** (columnas, contenido, filas históricas) | MCP de Supabase denegado (token scopeado a otra org). Todo el schema sale de migraciones. Mitigante: todos los SELECT del código enumeran columnas explícitamente y cubren las conocidas sin ninguna extra |
| 2 | **Si las migraciones `20260627013506` (riesgo_alto) y `20260706190000` (tipo simular_mapa) están aplicadas** | MIGRATION_LOG.md marca la primera como pendiente de aplicación manual |
| 3 | **Qué claves reales tiene `casos.contexto`** en las filas existentes | Requiere query. Dato útil: con qué frecuencia el LLM genera literalmente la clave `'jurisdiccion'`, la única que se lee por nombre exacto |
| 4 | **Si el corpus `manual` (2.974 chunks, ~76%) contiene fallos citados en su prosa** | No versionado (n8n gitignored). *Aunque los tuviera*, llegarían como prosa dentro de `contenido`, sin campos de carátula/tribunal/año, y ningún prompt instruye extraerlos |
| 5 | **Si el modelo cuela fallos en `fundamento_legal[]` / `doctrina_aplicable`** en la práctica | Strings libres sin validación; la guardrail solo cubre números de artículo |
| 6 | **Desglose real del corpus** | CLAUDE.md dice 3.934 chunks (`codigo`=590, `codigo_procesal`=370); MIGRATION_LOG.md registra `codigo`=425 y `codigo_procesal`=424 → ~3.823. **CLAUDE.md está stale.** No cambia ninguna conclusión |
| 7 | **Estado real de RLS en `conversaciones_caso` / `mensajes_conversacion`** | La migración que las crea no incluye `ENABLE ROW LEVEL SECURITY`; el hardening de Fase 5.5 no está versionado. Irrelevante en runtime (service_role bypassa) |
| 8 | **Timeout efectivo del chat** | `maxDuration=180` es inerte en Easypanel; lo impone el proxy, config remota |
| 9 | **Tamaño en tokens del `contextoMarkdown`** que se reenvía en cada turno | Dato clave para dimensionar el costo de no tener caching. No medido |
| 10 | **Si `mapa_procesal_nodos.metadata` tiene datos en alguna fila** | Ningún código del repo la escribe, pero no descarto escrituras manuales por SQL Editor |
| 11 | **Contenido de `PLAN_MAPA_PROCESAL.md` y `BRIEFING_DISENO_MAPA_PROCESAL.md`** | Podrían especificar estos campos como diseño **futuro**; sería documentación de intención, no código |
| 12 | **El crítico de completitud del workflow no llegó a correr** (el run abortó con 47/48 agentes completados) | Su tarea era buscar tablas/archivos que ningún track abrió. Los 4 mapeos + 43 verificadores sí completaron |

### 7.3 Contradicciones documentales detectadas (a corregir en CLAUDE.md)

1. **"El RAG no está forzado: no se usa `tool_choice`"** → **falso** para `analizar-caso` ([run-agent.ts:207](src/lib/agent/run-agent.ts#L207)). Cierto solo para el chat.
2. **Desglose del corpus** (3.934 / 590 / 370) → contradice MIGRATION_LOG.md (~3.823 / 425 / 424).
3. **"Sin integraciones externas"** → el repo sí llama a Google Calendar ([google-calendar.ts](src/lib/agenda/google-calendar.ts)). No aporta contenido legal, pero la afirmación es amplia de más.
4. **Modelo "Sonnet 4.5" a secas** → el chat tiene selector con Haiku 4.5 y **Opus 4.6**; y hay Whisper + embeddings OpenAI.
5. **Estructura del repo desactualizada** → existen `scripts/ingestar-cp.ts` e `ingestar-cppf-html.ts` no documentados, además de rutas `/api/admin/*`, `/api/agenda/*` y `/api/casos/[id]/mapa/*`.
6. **UI engañosa** (no es CLAUDE.md pero es del mismo tipo): la app le dice al abogado "Buscando jurisprudencia…" sobre un corpus que no tiene fallos.
