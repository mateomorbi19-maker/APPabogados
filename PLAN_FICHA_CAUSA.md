# Plan — Ficha de causa

**Fecha:** 22 de agosto de 2026
**Origen:** mockup HTML `lexstrategy_ficha_causa` + el orden de construcción que ya fijó
[REPORTERIA_AL_CLIENTE_PARA_DECIDIR.md](REPORTERIA_AL_CLIENTE_PARA_DECIDIR.md) §6
("hay que empezar por la ficha, no por las plantillas").
**Estado:** aprobado. Las cuatro decisiones de alcance están tomadas (§3).

---

## 1. Qué es y para qué

Hoy la app conoce la **historia** de una causa (el relato, la estrategia elegida, el mapa
procesal, los eventos cargados a mano) y no conoce su **identidad**: cómo se llama
oficialmente, qué número tiene, ante qué juzgado tramita, quién es el juez, quién el fiscal,
quién está imputado. La ficha es esa cédula de identidad.

No es una pantalla nueva: es lo que le falta a la que ya existe. Y sirve para tres cosas
distintas, que conviene no mezclar:

1. **Identificar.** Que en tres segundos sepas qué causa estás mirando.
2. **Operar.** La carpeta digital: qué pasó dentro del expediente y qué pasó afuera.
3. **Alimentar al resto del sistema.** Buscador, LEXIE, chat del caso y —después— la
   reportería al cliente. Este tercer punto es el que más rinde y el que menos se ve en
   el mockup.

---

## 2. Estado real medido (2026-08-22, contra la base, no contra el repo)

| Hecho | Medición |
|---|---|
| Columnas de `casos` | 13. No existe `caratula`, `expediente`, `organismo`, `juez`, `fiscalia`, `imputado`, `cliente`, `etapa` ni un `estado` de la causa. |
| Causas cargadas | 8. **4 de 8** tienen como nombre un pedazo del relato (una es `"El 3 de julio de 2026, cerca de las 04:15"`). |
| `casos.fuero` | NULL en 3 de 8. Lo escribe **sólo** el mapa procesal. |
| `casos.titulo` | Inmutable: no hay `PATCH`/`PUT` sobre casos en ninguna ruta. Se fija en el `POST` inicial con los primeros 60 chars del relato. |
| Eventos de caso | 10 en total: **8 los creó el sistema, 2 un abogado**. Cero adjuntos. |
| Eventos de agenda | 7, **ninguno** vinculado a una causa. |
| Lista de columnas de `casos` | Copiada a mano en **13 call sites**. Los tres principales omiten `fuero` desde julio. |
| `repositorio_documentos` / `conversaciones_lexie` | **Existen** (345 y 2 filas). `CLAUDE.md` y `MIGRATION_LOG.md` las dan por pendientes: la documentación está stale, no la base. |

> **Regla que gobierna todo el plan:** un `.sql` versionado no prueba que esté aplicado, y
> el `MIGRATION_LOG` tampoco. El drift corta para los dos lados. Se verifica por PostgREST
> antes de tocar TypeScript.

---

## 3. Decisiones tomadas

| # | Decisión | Elegido | Por qué |
|---|---|---|---|
| 1 | Alcance de la tanda | **Cabecera + partes (F0–F8)** | Prueba, honorarios, gastos y escritos son cuatro features de dominios distintos. Cinco de las seis tabs del mockup arrancarían vacías. |
| 2 | Modelo de las partes | **Tabla `partes_caso`, sin datos de contacto** | La cardinalidad 1:N funciona igual con las dos respuestas posibles de la P1 de REPORTERIA. Lo que sí es apuesta es el contacto, y eso espera. |
| 3 | Creación de la causa | **Pide carátula y expediente** | Es el único momento en que el abogado tiene el expediente delante. Si no, cada causa nace con la ficha vacía. |
| 4 | Working tree | **La tanda de tema claro se commitea primero** | 85 archivos modificados, entre ellos `header-caso.tsx`, `detalle-caso.tsx` y `globals.css` — exactamente los que toca la ficha. |

---

## 4. Las fases

Cada fase es un commit y **sirve sola** aunque las siguientes nunca se hagan.

### F0 — Limpiar la mesa
Commitear la tanda de tema claro (lo hace el usuario) y corregir `CLAUDE.md` +
`MIGRATION_LOG.md` con el estado real de §2. **Sin código de la ficha.**

*Sirve sola:* la próxima sesión deja de leer que LEXIE devuelve 500 por una migración que
está aplicada hace semanas.

### F1 — La migración, sola, sin una línea de TypeScript

```sql
ALTER TABLE casos
  ADD COLUMN caratula           text,
  ADD COLUMN expediente_numero  text,
  ADD COLUMN organismo          text,
  ADD COLUMN secretaria         text,
  ADD COLUMN juez               text,
  ADD COLUMN fiscalia           text,
  ADD COLUMN delitos            text[],
  ADD COLUMN estado_seguimiento text NOT NULL DEFAULT 'activa'
    CHECK (estado_seguimiento IN ('activa', 'en_espera', 'archivada'));
```

Más `partes_caso` (id, caso_id FK CASCADE, nombre, rol, es_cliente, situacion_libertad,
orden), con `RLS ENABLE` + `REVOKE ALL FROM anon, authenticated` — el patrón de
`20260819120000`, **no** el de `mapa_procesal_nodos`, al que se le olvidó el REVOKE.

Todo nullable salvo `estado_seguimiento`. **Sin** columna `portal` (se deriva del fuero).
**Sin** columna `etapa` (la calcula el mapa, §F8). **Sin** índices: sobre 8 filas el planner
los ignora.

*Una migración grande y no cuatro chicas:* cada corrida manual es una ventana de drift.

*Verificación antes de seguir:* `curl` al OpenAPI de PostgREST y confirmar las columnas.

### F2 — Una sola fuente de columnas + la ruta de escritura que no existe
- Extraer la lista de columnas de `casos` a `src/lib/casos/columnas.ts` y reemplazar los
  **13 call sites** (que además recuperan `fuero`, perdido desde julio).
- `PATCH /api/casos/[id]`: molde de `conversaciones/[conv_id]/route.ts`, Zod en el borde,
  `.eq("usuario_id", wl.usuario_id)` **dentro** del UPDATE, y **lista blanca explícita de
  columnas escribibles** — nunca derramar `parsed.data`, o un campo de más en el schema
  habilita mover `usuario_id` o `estrategia_snapshot`.

*Sirve sola:* por primera vez se puede editar una causa.

### F3 — La ficha se ve y se edita
Bloque `FichaCausa` arriba del detalle. `<dl>` en grid de **2 columnas** (la columna útil son
~740px, no el ancho completo del mockup). **Campo vacío = botón "Cargar"** que abre el
formulario enfocado ahí. Badges de rol / fuero / estado con el molde tema-aware de
`src/lib/casos/rol.ts` (**no** los mapas dark-only de `agenda/types.ts`). Los tokens `--el-*`
**no** están en `@theme`: van como `bg-[var(--el-surface-card)]`, nunca `bg-el-surface-card`.

En el mismo commit, la fila de accesos rápidos del mockup reemplaza las tres tarjetas
apiladas que hoy se comen media pantalla.

Probar en **tema claro**, que es donde se cae lo copiado del mapa.

### F4 — La carátula manda
Helper único `nombreCaso(c) = caratula ?? titulo`, aplicado en los **once** consumidores
(lista lateral, Inicio, agenda —incluido el embed `casos(titulo)`—, mapa, simulador, chat,
buscador, LEXIE). En el mismo commit, el diálogo de creación pide carátula y expediente,
y `crearCasoInputSchema` + el INSERT los aceptan.

Cerrar la fase con un `grep` de `.titulo` que no devuelva nada fuera del helper.

*Sirve sola:* es la mitad del valor de toda la feature.

### F5 — Partes en la ficha
Rutas GET/POST/PATCH/DELETE con ownership **por join a `casos`**, y el bloque de personas
con rol, chip "nuestro cliente" y situación de libertad. Sin contacto hasta que se conteste
la P1 de REPORTERIA.

### F6 — El buscador
Extender `CampoMatch` / `PESO_CAMPO` / el SELECT de `buscar.ts` con carátula, expediente y
partes. Dos arreglos que van sí o sí en el mismo commit:
- **Renombrar** `CAMPO_LABEL.titulo` de `"Carátula"` a `"Título"`, o quedan dos entradas
  rotuladas igual en el ⌘K.
- **`normalizar()` tiene que ignorar puntos, barras y guiones**, o buscar `12345/2026` nunca
  va a encontrar `12.345/2026` ni `IPP 08-00-012345-26`.

LEXIE mejora gratis: `buscar_mis_casos` usa la misma función.

### F7 — Los agentes leen la ficha
**Primero** arreglar la inyección one-shot del contexto de LEXIE
(`api/lexie/route.ts:131-135`): hoy se manda sólo en el primer mensaje del hilo y la
conversación activa nunca se archiva, así que una carátula corregida no llegaría nunca.
Después:
- `buildContextoCaso` suma `## Identificación de la causa` — hoy el chat del caso **ni
  siquiera ve el nombre de la causa**.
- LEXIE reemplaza el extracto de 160 chars del relato por la ficha, y el párrafo
  `OJO CON LAS CARÁTULAS` pasa a emitirse **sólo** si quedan causas sin cargar.

El contexto va en el primer user message, **nunca en el system prompt**: ese es el prefijo
cacheado que comparten los tres abogados.

### F8 — Etapa y última actuación, derivadas
- Badge de etapa leído del mapa (`etapasPorNodo`, ya exportada en `serializar.ts`): el nodo
  `ocurrido` más profundo. La regla R5 de coherencia garantiza que esa línea no tiene
  agujeros. Sin mapa → `"Sin mapa · Iniciar"`.
- "Última actuación" desde `MAX(eventos_caso.ocurrido_en)`, **no** desde `actualizado_en`:
  un trigger pisa esa columna en cada UPDATE, así que corregir una coma en la ficha diría
  "actualizado hoy" con el expediente quieto.

*Por qué derivada y no una columna:* una `etapa` declarada a mano se contradice con el mapa
el primer día.

### F9 — Condicional: sólo si el timeline empieza a usarse
Movimientos con `titulo`, `foja`, `organismo` y `ambito` (intra / externo), `PATCH` de evento
(hoy sólo se puede borrar y reescribir) y sincronizar los **cuatro** SELECT de `eventos_caso`
—uno de los cuales, `api/casos/[id]/route.ts:53`, ya está desactualizado hoy porque no trae
`categoria` ni `adjuntos`.

*Condicional a propósito:* con 2 movimientos cargados a mano en toda la base, el problema del
timeline no es que le falten campos.

---

## 5. Fuera de alcance, explícitamente

- **Honorarios y Gastos.** Es contabilidad del estudio: otro dominio, toca plata, y ningún
  consumidor de la app (buscador, LEXIE, chat, mapa, reportería) la usa.
- **Prueba como entidad con estados** y **Escritos generados** (la app no genera escritos).
- **Las 6 tabs del mockup.** `ui/tabs.tsx` existe con **cero consumidores** en toda la app;
  el patrón ya probado en esa pantalla es la pila vertical + `Collapsible`.
- **Autocompletar la ficha con IA.** Además bloqueado: la cuenta de Anthropic está en cero.
  Y si se hace, tiene que ser por extracción explícita del relato **con confirmación campo
  por campo** — nunca leyendo `casos.contexto` por nombre de clave, que las inventa el
  modelo en cada pre-análisis.
- **Integración con portales judiciales.** El `"Descargado del portal"` del mockup implicaría
  entrar solos al PJN o al MEV. No existe y no entra acá.
- **Índices nuevos** sobre 8 filas.

---

## 6. Riesgos vivos

1. **Migración antes que código.** Una columna nueva en un SELECT sin el SQL aplicado = 500
   en todos los reads. Ya pasó con `riesgo_alto` del mapa. Por eso F1 no lleva TypeScript.
2. **El guard de propiedad es el único control real.** El server entra con `service_role`,
   que bypassa RLS. Cualquier ruta o tool nueva sobre ficha o partes repite
   `.eq("usuario_id", …)` o `casoEsDelUsuario`. Con nombres reales de clientes e imputados,
   una fuga cruzada deja de ser un bug de UX y pasa a ser secreto profesional roto.
3. **Editar la ficha reordena las listas.** El trigger `casos_set_actualizado_en` bumpea
   `actualizado_en`, que es el `ORDER BY` del Inicio, del buscador y del contexto de LEXIE.
   Un backfill masivo reordenaría las causas de los tres abogados de golpe.
4. **La regla del faltante.** Si falta un dato se muestra faltante; no se rellena con una
   frase neutral. Es la misma regla que ya rige para la jurisprudencia
   (`SIN_JURISPRUDENCIA_APLICABLE`) y la contraria a la del simulador, que sí inventa un
   valor verosímil entre corchetes — son superficies distintas y no se copia el patrón.
5. **`casos.contexto` no es consultable por nombre de campo.** Las claves las inventa el LLM
   en cada pre-análisis. Cualquier backfill que lea `contexto['juzgado']` degrada a null en
   silencio; el precedente vivo es `casos/route.ts:239-242` leyendo `'jurisdiccion'`.

---

## 7. Lo que esto desbloquea

Con F0–F8 cerradas, la reportería al cliente deja de estar bloqueada por el punto 1 de su
propio orden de construcción, y las 12 variables "que hay que cargar una vez y después se
reusan" de REPORTERIA §3 pasan a existir. Las 6 preguntas de ese documento siguen sin
contestar, pero **sólo la P1 (¿el reporte es por causa o por persona?) toca la ficha**, y la
tabla `partes_caso` funciona igual con las dos respuestas.
