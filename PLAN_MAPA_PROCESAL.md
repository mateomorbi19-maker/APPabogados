# Plan de acción — Mapa procesal fuero-aware + simulación con IA

> Documento de trabajo para implementar el rediseño del **mapa procesal**. Fuente
> legal: 3 diagramas HTML validados por Gonzalo y Lautaro (Nación / PBA / Federal).
> Estado del análisis: cerrado. Este plan traduce esos diagramas + las decisiones
> de producto a fases de implementación concretas.

## 0. Decisiones de producto (LOCKED)

| Decisión | Elegido |
|---|---|
| **Fuero** | La IA **sugiere** el fuero (Nación / PBA / Federal) y el abogado **confirma** al inicializar. Editable. |
| **Simulación IA (MVP)** | **Esqueleto por fuero (determinista)** + botón **"Simular con IA"** sobre un nodo que propone ramas `predicción` que el abogado acepta/descarta. |
| **Densidad del grafo** | **Macro**: ~13-16 nodos en el canvas (6 etapas + desenlaces/bifurcaciones clave). Sub-etapas, artículos y detalle → en el **panel lateral**. |
| **Estilo visual** | **Mantener el dark actual** (orbes, glow, partículas) y **sumar color por etapa** (paleta de 6 colores de los HTML) como acento, sin pisar el sistema semántico de estado. |
| **Persistencia del layout** | **Auto-guardado** de cada cambio, incluida la **posición** de los nodos (sin botón de "Guardar"). Al reabrir, el mapa queda exactamente como lo dejó el abogado. Botón "Reordenar automáticamente" como escape hatch. |

## 1. Principios rectores (no violar)

1. **Congruencia limita a la IA, no al abogado.** El abogado tiene libertad total para
   editar/agregar/borrar cualquier nodo ("T de Taylor a full"). Las reglas de
   congruencia (§6) restringen lo que la **IA** genera, no lo que el humano hace a mano.
2. **El esqueleto es determinista, viene de las plantillas curadas — NO del RAG.**
   El corpus (`documentos`) solo tiene el CPPF federal (Ley 27.063); **no** tiene el
   CPPN Ley 23.984 (Nación) ni el CPP Ley 11.922 (PBA). Los 3 HTML son la verdad
   validada y se hornean como plantilla. La IA solo propone ramas case-specific.
3. **Migración antes que código.** Nunca agregar una columna a un `SELECT` (`COLS`,
   types, schemas) antes de correr la migración en Supabase. Ya pasó con `riesgo_alto`
   (500 en todos los reads). Ver memoria `feedback_migracion_antes_de_deploy`.
4. **Un solo fuero por mapa, sin fuga de vocabulario.** Prohibido "procesamiento" en un
   mapa federal; prohibido "formalización"/"IPP"/"control de la acusación" en uno de Nación.
5. **Convenciones del repo:** TS strict, Zod en el borde, commits en español prefijados
   por fase, stage explícito archivo por archivo, no pushear sin OK, nunca `--no-verify`.
   La app está en beta con datos de prueba → refactor limpio, sin backwards-compat inútil.

## 2. Estado actual (punto de partida)

- Tabla [`mapa_procesal_nodos`](supabase/migrations/20260610130000_mapa_procesal_nodos.sql):
  árbol por caso, self-FK `padre_id`, `tipo` (raiz|real|prediccion), `estado`
  (ocurrido|desbloqueado|bloqueado), `riesgo_alto`, cascade, índice único de raíz por caso.
  **El schema ya soporta todo lo del MVP — no requiere cambios.**
- **Una** plantilla hardcodeada en [`plantilla-base.ts`](src/lib/mapa-procesal/plantilla-base.ts)
  (`FLUJO`, 11 nodos, vocabulario CPPF). Fuero-agnóstica. Bug latente: un caso de
  Nación recibe hoy vocabulario federal equivocado.
- Render ReactFlow + dagre; sistema de color por **estado** (ejecutada verde > riesgo
  rojo > decisión amarillo > posible azul) en [`layout.ts`](src/lib/mapa-procesal/layout.ts).
- **Cero IA en el mapa.** El agente ([`run-agent.ts`](src/lib/agent/run-agent.ts) /
  [`run-agent-consulta.ts`](src/lib/agent/run-agent-consulta.ts)) no toca `mapa_procesal_nodos`.
- El pre-análisis ya infiere `jurisdiccion_inferida` (texto libre) pero nunca llega al mapa.
- El fuero **no existe como dato tipado** en ninguna tabla (vive como texto en `casos.contexto.jurisdiccion`).

## 3. Modelo de datos

### 3.1. `type Fuero` y persistencia

```ts
// src/lib/mapa-procesal/types.ts
export type Fuero = "nacion" | "pba" | "federal";
export const FUEROS: readonly Fuero[] = ["nacion", "pba", "federal"] as const;
export const FUERO_LABEL: Record<Fuero, string> = {
  nacion: "Nación (CPPN Ley 23.984)",
  pba: "Prov. Buenos Aires (CPP Ley 11.922)",
  federal: "Federal (CPPF Ley 27.063)",
};
```

**El fuero vive en `casos`** (es una propiedad de la competencia del caso, no solo del mapa;
así lo pueden usar también el análisis y el chat). Migración aditiva:

```sql
-- supabase/migrations/<ts>_casos_fuero.sql
ALTER TABLE casos ADD COLUMN fuero TEXT
  CHECK (fuero IN ('nacion', 'pba', 'federal'));  -- nullable: se setea al inicializar el mapa
```
> ⚠️ Correr esta migración en Supabase **antes** de deployar el código que la SELECTea.

### 3.2. `FLUJO_POR_FUERO` (el corazón del cambio)

En [`plantilla-base.ts`](src/lib/mapa-procesal/plantilla-base.ts): reemplazar el `FLUJO`
único por `FLUJO_POR_FUERO: Record<Fuero, NodoTemplate[]>` y cambiar la firma a
`generarPlantillaBase(casoId: string, fuero: Fuero)`. Extender `NodoTemplate` con
`descripcion?: string` (para poblar el panel lateral desde la plantilla) y mantener
`riesgoAlto`. Cada árbol tiene **una sola raíz** (`padre: null`, arranca `ocurrido`);
el resto nace `prediccion`/`desbloqueado`.

**Convención del árbol (macro):** cada etapa troncal es hija de la etapa anterior; sus
desenlaces terminales/salidas cuelgan como **hojas** de esa etapa (así la etapa con ≥2
hijos se pinta "decisión pendiente" amarillo, que `layout.ts` ya deriva solo). Los
desenlaces de riesgo (prisión preventiva, condena) van con `riesgoAlto: true`.

#### Plantilla FEDERAL (CPPF Ley 27.063 — acusatorio)

| key | título | padre | riesgo | descripción (panel) |
|---|---|---|---|---|
| `actos_iniciales` | Actos Iniciales | — (raíz) | | Notitia criminis: denuncia (244-249), prevención policial (90, 250), querella (82-89). El fiscal decide (251-253). Libro II · Tít. I. |
| `desestimacion` | Desestimación / Archivo | actos_iniciales | | Cierre temprano por el fiscal. |
| `oportunidad_1` | Criterios de oportunidad | actos_iniciales | | Art. 31 CPPF. |
| `ipp` | Investigación Penal Preparatoria | actos_iniciales | | Desformalizada, a cargo del fiscal, control del juez de garantías. Formalización (254-260), producción de prueba (134-198), plazo 1 año prorrogable (232-233). |
| `prision` | Prisión preventiva | ipp | ✔ | Medida de coerción excepcional, último recurso (210-226). |
| `sobreseimiento_2` | Sobreseimiento | ipp | | Cierre definitivo a favor del imputado. |
| `sjp` | Suspensión del juicio a prueba | ipp | | Probation, art. 76 bis CP. |
| `abreviado` | Juicio abreviado | ipp | | Acuerdo sobre hechos y pena (288 y conc.). |
| `conciliacion` | Conciliación / Reparación | ipp | | Art. 34 CPPF, extingue la acción. |
| `control_acusacion` | Control de la Acusación | ipp | | Etapa intermedia. Audiencia de control oral (279-289), auto de apertura a juicio. |
| `sobreseimiento_3` | Sobreseimiento | control_acusacion | | Cierre a favor del imputado sin llegar a juicio. |
| `juicio` | Juicio Oral y Público | control_acusacion | | Oral, público, contradictorio, continuo (290-320). Cesura de pena. |
| `absolucion` | Absolución | juicio | | Sentencia favorable. |
| `condena` | Condena | juicio | ✔ | Sentencia condenatoria; abre cesura y ejecución. |
| `recursos` | Control de las Decisiones Judiciales | juicio | | Impugnación ordinaria (doble conforme, "Casal"), extraordinaria, revisión (322-339). |
| `ejecucion` | Ejecución | recursos | | Firme la sentencia, juez de ejecución (340-358). Régimen progresivo, libertad condicional. |

#### Plantilla NACIÓN (CPPN Ley 23.984 — mixto)

| key | título | padre | riesgo | descripción (panel) |
|---|---|---|---|---|
| `actos_iniciales` | Actos Iniciales | — (raíz) | | Denuncia (174-177), prevención policial (183-187), querella. Juez de Instrucción / MPF. Libro II · Tít. I. |
| `desestimacion` | Desestimación / Incompetencia | actos_iniciales | | Art. 180; o remisión por incompetencia; o archivo. |
| `instruccion` | Instrucción (Sumario) | actos_iniciales | | Dirigida por el Juez de Instrucción (194), delegable al fiscal (196). Indagatoria (294-304), procesamiento (306). Plazo 4 meses prorrogable (207). |
| `prision` | Prisión preventiva | instruccion | ✔ | Medida cautelar (280-333). |
| `falta_merito` | Falta de mérito | instruccion | | Art. 309. |
| `sobreseimiento_2` | Sobreseimiento | instruccion | | Arts. 334-338. |
| `critica` | Crítica Instructoria y Elevación | instruccion | | Etapa intermedia, **escrita**. Requerimiento de elevación fiscal (347). Libro II · Tít. V. |
| `sobreseimiento_3` | Sobreseimiento | critica | | Art. 350. |
| `juicio` | Juicio Oral | critica | | Ante el Tribunal Oral. Debate oral, público, contradictorio (354-404). |
| `absolucion` | Absolución | juicio | | Arts. 398-404. |
| `condena` | Condena | juicio | ✔ | Sentencia condenatoria. |
| `recursos` | Recursos | juicio | | Reposición, apelación, casación, inconstitucionalidad, revisión (432-491). Hasta CSJN (art. 14 Ley 48). |
| `ejecucion` | Ejecución | recursos | | Juez de Ejecución Penal (490). Cómputo (493-494), libertad condicional. |

#### Plantilla PBA (CPP Ley 11.922 — acusatorio provincial)

| key | título | padre | riesgo | descripción (panel) |
|---|---|---|---|---|
| `actos_iniciales` | Actos Iniciales | — (raíz) | | Denuncia (285-289), prevención policial (293-296), querella. **Agente Fiscal** dirige, **Juez de Garantías** controla. Libro II · Tít. I. |
| `desestimacion` | Desestimación / Archivo | actos_iniciales | | Art. 290; o remisión por incompetencia. |
| `oportunidad` | Criterios de oportunidad | actos_iniciales | | Art. 56 bis. |
| `ipp` | Investigación Penal Preparatoria | actos_iniciales | | A cargo del Agente Fiscal (56, 266), control del Juez de Garantías (23). Declaración del imputado (308). Plazo 4 meses prorrogable (282). |
| `prision` | Prisión preventiva | ipp | ✔ | Medida de coerción personal (144-208). |
| `sobreseimiento_2` | Sobreseimiento | ipp | | Arts. 321-326. |
| `sjp` | Suspensión del proceso a prueba | ipp | | Art. 404 CPP BA / 76 bis CP. |
| `abreviado` | Juicio abreviado | ipp | | Arts. 395-403. |
| `critica` | Crítica y Elevación a Juicio | ipp | | Etapa intermedia. Requerimiento fiscal (334), auto de elevación (337) del Juez de Garantías. |
| `sobreseimiento_3` | Sobreseimiento | critica | | Arts. 321 y ss. |
| `juicio` | Juicio Oral | critica | | Tribunal en lo Criminal (colegiado o unipersonal). Debate (338-375), cesura. |
| `jurados` | Juicio por Jurados | juicio | | Ley 14.543. Obligatorio en delitos con pena máx. > 15 años. Jurado popular de 12. |
| `absolucion` | Absolución | juicio | | Veredicto absolutorio. |
| `condena` | Condena | juicio | ✔ | Veredicto de culpabilidad; cesura (372-375). |
| `recursos` | Impugnaciones y Recursos | juicio | | Apelación (Cámara de Apel. y Gtías.), Casación (Tribunal de Casación bonaerense), SCBA, CSJN (401-467). |
| `ejecucion` | Ejecución Penal | recursos | | Juez de Ejecución (25). Ley 12.256, régimen progresivo (497-535). |

> **Íconos:** `ICONO_POR_TITULO` está acoplado por string de título. Como los títulos se
> comparten mucho entre fueros (Actos Iniciales, Sobreseimiento, Condena, Ejecución…), un
> único mapa de íconos por título cubre casi todo; los títulos nuevos caen a `ICONO_DEFAULT`.
> Mantener íconos + títulos editables en el mismo lugar (como hoy).

> **Institutos especiales / procedimientos paralelos:** para el MVP **no** entran como nodos
> del árbol (romperían el índice único de raíz y ensucian el grafo macro). Los que son
> salida de una etapa ya están como hojas (SJP, abreviado, conciliación). El catálogo
> completo (flagrancia, habeas corpus, acción privada, fuero juvenil, asuntos complejos,
> juicio directísimo, etc.) se muestra como **leyenda/referencia estática** por fuero,
> fuera del canvas. (Ampliable post-MVP.)

### 3.3. Persistencia del layout ("memoria del mapa")

**Requisito del director:** cada cambio —incluida la **posición** de los nodos— debe
persistir, y al reabrir el mapa debe quedar **exactamente como lo dejó el abogado**.

Estado actual: el contenido (título, descripción, estado, riesgo, nodos) **ya** persiste en
DB en cada mutación. Lo único que NO sobrevive al reload es la **posición**:
[`layout.ts`](src/lib/mapa-procesal/layout.ts) corre dagre en cada render y las columnas
`posicion_x`/`posicion_y` (que **ya existen** en el schema) están ignoradas (siempre 0).

**Diseño — auto-guardado (viable y barato para 3 usuarios; NO hace falta botón de "Guardar"):**
- `posicion_x`/`posicion_y` pasan a ser la **fuente de verdad** de la posición.
- Al **inicializar** (y al crear/simular nodos nuevos), dagre corre **una** vez para sembrar
  posiciones, y esas posiciones se **persisten** (batch). A partir de ahí el mapa carga desde
  las posiciones guardadas, sin re-correr dagre.
- Nodos arrastrables; en `onNodeDragStop` → PATCH de `posicion_x/y` de ese nodo (una fila por
  drag, opcional debounce). Mismo patrón que ya se usa para estado/riesgo.
- Botón **"Reordenar automáticamente"**: re-corre dagre y persiste (escape hatch si el abogado
  desordena el mapa y quiere volver al layout limpio).
- Extender `editarNodoSchema` (Zod) con `posicion_x`/`posicion_y` y el `PUT .../nodos/[nodoId]`;
  agregar un endpoint **batch** para el sembrado/reordenado (evita N PATCH sueltos).

> El guardado es automático en cada cambio (incluida la posición). El control útil para el
> abogado es **"Reordenar"**, no "Guardar".

## 4. Fases de implementación

### Fase A — Mapa fuero-aware (sin IA todavía)
**Objetivo:** que el esqueleto correcto se instancie según el fuero, elegido por el abogado.

1. Migración `casos.fuero` (§3.1) — **correr en Supabase primero**.
2. `types.ts`: `type Fuero`, `FUEROS`, `FUERO_LABEL`; extender `NodoTemplate` con `descripcion`.
3. `plantilla-base.ts`: `FLUJO_POR_FUERO` con las 3 plantillas (§3.2); `generarPlantillaBase(casoId, fuero)`.
4. `queries.ts`: los 2 call sites (`inicializarMapa`, `reiniciarMapa`) reciben/leen el `fuero`.
   `inicializarMapa` persiste `casos.fuero`; `reiniciarMapa` lee el ya guardado (idempotente).
   Poblar `descripcion` de los nodos desde la plantilla en el insert.
5. `api/casos/[id]/mapa/route.ts`: POST y PUT aceptan `{ fuero }` con Zod; validar contra `FUEROS`.
6. `mapa-procesal-view.tsx`: el estado "sin inicializar" muestra un **selector de fuero
   pre-cargado con la sugerencia** (§Fase B) + copy dinámica por fuero (hoy dice "federal (CPPF)" hardcodeado).
7. **Verificación:** crear 1 caso por fuero, inicializar, confirmar que cada uno instancia
   su vocabulario correcto y que "reiniciar" no cambia de fuero. `npx tsc --noEmit` + `npm run lint`.

**Commit:** `mapa: plantillas por fuero (Nación/PBA/Federal) + persistir fuero en casos`

### Fase B — Sugerencia de fuero por IA
**Objetivo:** que el fuero llegue pre-sugerido al abogado, sin fricción.

1. Cascada de sugerencia al inicializar (en orden, primera que resuelve gana):
   - a) `casos.fuero` si ya está seteado.
   - b) heurística sobre `casos.contexto.jurisdiccion` (texto libre): "federal"→`federal`;
     "buenos aires"/"provincia"/"la plata"…→`pba`; "caba"/"nacional"/"nación"→`nacion`.
   - c) fallback: extender `PRE_ANALISIS_SYSTEM_PROMPT` + el JSON de `armarPromptPreAnalisis`
     para emitir `datos_detectados.fuero_sugerido: "nacion"|"pba"|"federal"|null`, validado
     en [`schemas.ts`](src/lib/schemas.ts). (Aprovecha que el pre-análisis ya razona F2
     competencia y D5 menores.)
2. La sugerencia se muestra **pre-seleccionada** en el selector de la Fase A; el abogado
   confirma o cambia. Nunca se fija sola (decisión "IA sugiere + confirma").
3. **Verificación:** casos con jurisdicción clara (Federal, PBA, CABA) caen al fuero correcto;
   casos ambiguos muestran un default razonable y editable.

**Commit:** `mapa: sugerencia de fuero desde pre-análisis + heurística de jurisdicción`

### Fase C — Simulación de ramas con IA
**Objetivo:** botón "Simular con IA" sobre un nodo → propone ramas `predicción` congruentes.

1. **Migración:** ampliar el CHECK de `ejecuciones.tipo` para incluir `'simular_mapa'`
   (tracking de tokens/costo, como el resto). Correr primero en Supabase.
2. **Generación (single-shot estructurado, sin loop RAG para el MVP):** una función en
   `src/lib/agent/` que reciba `{ fuero, casoContexto, nodosActuales, nodoObjetivo }` y
   devuelva JSON validado con Zod: `{ ramas: [{ titulo, descripcion, riesgo_alto, es_bifurcacion }] }`.
   El prompt **inyecta los desenlaces válidos del fuero** (§6) como restricción dura, y el
   estado actual del mapa (nodos `ocurrido`) como contexto. Persistir tokens en `ejecuciones`
   (tipo `simular_mapa`) con el patrón de pricing existente.
   - *No* hace falta des-duplicar el loop de `run-agent*.ts` para esto (es single-shot).
     Si más adelante se quiere simulación RAG-grounded (solo aporta en Federal), ahí sí
     conviene extraer el loop común primero — anotarlo como deuda, no hacerlo en el MVP.
3. **Persistencia batch:** nueva función en `queries.ts` que inserte el subárbol propuesto
   como `tipo: "prediccion"`, `estado: "desbloqueado"`, colgado del `nodoObjetivo`
   (reusar el patrón de UUID pre-generado de `generarPlantillaBase`). El cascade limpia
   solo si el abogado las descarta.
4. **Route:** `POST /api/casos/[id]/mapa/simular` con `{ nodo_id }`; corre la generación,
   valida congruencia, inserta las ramas, devuelve los nodos nuevos.
5. **UI:** botón "Simular con IA" en `nodo-detail-panel.tsx`; las ramas propuestas se
   renderizan como `predicción` (ya distinguibles) con acción aceptar/descartar. Loading state.
6. **Verificación:** simular sobre "IPP" en un caso federal propone desenlaces del set válido
   (sobreseimiento / SJP / abreviado / acusación…), nunca "procesamiento"; en un caso de
   Nación nunca aparece "formalización". Correr `scripts/test-agent.ts` como referencia de patrón.

**Commit:** `mapa: simulación de ramas con IA (esqueleto + predicción por nodo)`

### Fase D — Color por etapa (visual)
**Objetivo:** identidad visual por etapa sobre el dark actual, sin romper el sistema de estado.

1. **No pisar el color de estado.** El orbe sigue coloreado por **estado** (ejecutada/riesgo/
   decisión/posible) — es la info que el abogado usa. La **etapa** se codifica en un canal
   distinto: el badge del número de etapa / un anillo / un "riel" o agrupación de fase, con
   la paleta de 6 colores de los HTML (dark-adaptada):
   `E1 #d4553e · E2 #4a7fb5 · E3 #3fa89c · E4 #6bbf5a · E5 #8a6fc9 · E6 #d98a3d`.
   (Guardar la etapa de cada nodo en `metadata` o derivarla del key de plantilla.)
2. Aplicar en `nodo-procesal.tsx` (badge/anillo) y opcionalmente en `edge-procesal.tsx`.
3. **Pendiente externo:** conseguir de Lau el archivo de la **animación** ("es una bomba") —
   **no está en los 3 HTML** (son 100% estáticos, solo hover). Sin ese archivo, no se puede portar.

**Commit:** `mapa: color por etapa (6 fases) sobre el tema dark`

### Fase E — Persistencia del layout (memoria del mapa)
**Objetivo:** que la posición de cada nodo (y todo cambio) sobreviva al reload — el mapa
queda exactamente como lo dejó el abogado. Ver §3.3.
> Es independiente de B/C: conviene hacerla **inmediatamente después de la Fase A**.

1. `layout.ts`: `calcularLayout` usa las posiciones persistidas cuando existen; dagre solo
   para nodos sin posición sembrada (recién creados). No re-correr dagre en cada load.
2. Sembrado: al inicializar / crear / simular, correr dagre una vez y **persistir** posiciones (batch).
3. `editarNodoSchema` + `PUT .../nodos/[nodoId]`: aceptar `posicion_x`/`posicion_y`.
   Endpoint batch para sembrado/reordenado.
4. `mapa-procesal-view.tsx`: `nodesDraggable`; `onNodeDragStop` → PATCH de la posición.
   Botón "Reordenar automáticamente" (re-dagre + persistir).
5. **Verificación:** mover nodos → recargar (F5) → quedan donde se dejaron. Crear un nodo
   nuevo → aparece bien ubicado y su posición persiste. "Reordenar" re-alinea todo.

**Commit:** `mapa: persistir posiciones (auto-save de layout) + reordenar`

## 5. Reconciliación esqueleto ↔ ediciones del abogado

- **Init aplica el esqueleto una sola vez** (ya está: `inicializarMapa` es no-op si hay nodos).
- Las ediciones/nodos manuales del abogado **nunca se pisan** automáticamente.
- **"Reiniciar" queda como opt-in destructivo explícito** (ya tiene diálogo de confirmación) —
  usar solo para migrar un mapa viejo al flujo nuevo. Advertir que pierde el progreso.
- La simulación IA **solo agrega** nodos `predicción`; no toca los `real`/`ocurrido`.

## 6. Reglas de congruencia para la IA (inyectar en el prompt de simulación)

1. Un solo fuero por mapa; sin fuga de vocabulario entre códigos.
2. El mapa es un **árbol** (un padre, sin ciclos). La etapa siguiente cuelga del nodo-puente correcto.
3. **Orden de fases obligatorio:** Actos iniciales → Investigación → Etapa intermedia →
   Juicio oral → Recursos → Ejecución. Ningún hijo precede a su ancestro. No hay Ejecución
   que no descienda de una Condena; no hay Recursos sin sentencia previa.
4. **Desenlaces válidos por etapa y fuero** (ver tablas §3.2). Rechazar desenlaces no admitidos:
   p. ej. "criterios de oportunidad" y "conciliación" **no** existen en Nación (rige legalidad
   procesal estricta); "juicio por jurados" es propio de PBA.
5. **`riesgo_alto` solo en desenlaces gravosos para el imputado:** prisión preventiva, condena,
   ejecución de pena privativa. Nunca en desenlaces favorables (sobreseimiento, absolución, archivo).
6. Solo la raíz nace `ocurrido`; la IA nunca genera nodos `ocurrido`, solo `prediccion`.
7. Toda rama debe cerrar en un desenlace terminal (absolución/sobreseimiento/extinción/cumplimiento)
   o en un instituto que extingue la acción (probation cumplida, conciliación).

## 7. Riesgos técnicos (del inventario de código)

- **Índice único de raíz** (`WHERE tipo='raiz'`): toda plantilla mantiene 1 sola raíz; bloquea
  el patrón "insertar antes de borrar" en reiniciar (ya documentado).
- **`reiniciarMapa` no es transaccional** (delete+insert): plantillas más grandes agrandan la
  ventana de fallo. Fix anotado (RPC plpgsql con jsonb) — no bloqueante para el MVP.
- **Recarga full del mapa tras cada mutación** (`cargar()` + re-layout): O(mapa) por click.
  Aceptable para 3 usuarios; si molesta con simulación, considerar update local.
- **Loop de agente duplicado** (`run-agent.ts` / `run-agent-consulta.ts`): no des-duplicar para
  el MVP (la simulación es single-shot). Anotar como precondición si se hace simulación RAG.
- **`ejecuciones.tipo` CHECK** debe ampliarse antes de insertar `simular_mapa` (Fase C.1).

## 8. Pendientes fuera de este plan (para el director / Gonzalo y Lautaro)

1. **Archivo de la animación de Lau** — no está en los 3 HTML. Pedirlo para la Fase D.
2. **Institutos especiales completos como nodos navegables** (hoy: leyenda estática) — post-MVP.
3. **Ingesta del CPPN (Ley 23.984) y CPP BA (Ley 11.922) al RAG** — habilitaría simulación
   RAG-grounded para Nación y PBA (hoy solo Federal). Backlog de corpus.
4. **Validación del experto** sobre las 3 plantillas macro de §3.2 antes de considerarlas finales.
