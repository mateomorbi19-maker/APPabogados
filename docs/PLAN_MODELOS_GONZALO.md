# Fase 13 — Los modelos de escritos de Gonzalo

**Fecha:** 15 de septiembre de 2026
**Pedido:** Mateo, sobre la carpeta de Drive que compartió Gonzalo: «modelos de
escritos complejos, para agregar a los que ya existen hoy».
**Resultado:** el catálogo del estudio pasa de 50 a **136 modelos**.

## 1. Qué había en la carpeta

94 documentos de Google Docs, escritos por Gonzalo entre el 13 y el 14 de
septiembre de 2026. **No son plantillas: son escritos reales**, presentados en
causas concretas, con nombres, DNI, números de expediente y fechas adentro.
Cinco eran duplicados exactos (el mismo texto con dos nombres de archivo), así
que quedaron **89 distintos**.

Eso los hace mucho más valiosos que los 50 que ya estaban —traen la
argumentación completa, con sus citas y sus fallos— y, a la vez, imposibles de
usar tal cual: un modelo con el nombre de otra persona adentro es una fuga de
datos esperando a pasar.

## 2. Qué se hizo con ellos

Cuatro pasos, todos reproducibles desde `scripts/data/modelos-estudio-drive/`:

1. **Bajada verbatim** de los 94 documentos por la API de Drive, sin tocar una
   coma.
2. **Deduplicación** por hash del texto normalizado: 94 → 89.
3. **Anonimización y limpieza.** Cada dato de la causa original se reemplazó
   por un placeholder del mismo vocabulario que usan los 50 modelos
   (`{{IMPUTADO}}`, `{{DNI}}`, `{{NRO_CAUSA}}`, `{{TRIBUNAL}}`, `{{FECHA_HECHO}}`…),
   y se sacaron el markdown, los links a eldial y las notas al pie. Los blancos
   que ya venían en el original (`xxxx`, `…`, `___`) también quedaron como
   placeholder.
4. **Clasificación**: título, suma, cuándo se presenta, base normativa, claves,
   categoría, rol sugerido y fuero.

Los pasos 3 y 4 los hizo un fan-out de agentes sobre 64 documentos; los 25
restantes, un normalizador determinístico más clasificación a mano, porque la
corrida de agentes se quedó sin créditos a mitad. **Los dos caminos dejan el
mismo formato**, pero no la misma calidad, y eso salió caro. Ver §5.

## 2.bis. El incidente, y por qué ahora hay un verificador

La primera versión de esta fase se commiteó con un archivo sin anonimizar: el
modelo de «particular damnificada» conservaba el nombre completo de la abogada
patrocinante, su tomo y folio, su CUIT dentro de la dirección de notificaciones
de la SCBA, y el relato de una causa real de **abuso sexual contra una menor**
—iniciales de la nena, su fecha de nacimiento, el vínculo familiar, la
localidad, el juzgado y la UFI interviniente—. Con ese conjunto, la nena es
reidentificable.

Se descubrió antes de pushear, y la causa es clara: **el normalizador
determinístico sólo reemplaza blancos** (`xxxx`, `…`, `___`). Un dato real
escrito con naturalidad en medio de un relato no es un blanco, así que pasó
intacto. Los 64 que revisaron agentes sí estaban bien, porque un agente lee.

Lo que se hizo a partir de ahí:

1. Ese archivo **se sacó del corpus**. No se parcheó: anonimizarlo de verdad
   implica reescribir la sección de hechos, y eso es criterio de un abogado.
   El original sigue intacto en Drive.
2. Se rehízo el commit para que **no quedara en el historial de git**, que es
   lo que se pushea.
3. Se pasaron los 88 restantes por una revisión de dos vueltas: un agente lee
   cada documento entero y corrige, y un segundo agente independiente relee
   buscando lo que se le escapó al primero. **66 estaban limpios, 20 se
   corrigieron y 2 más se declararon irrecuperables**: son relatos en primera
   persona de víctimas de abuso sexual infantil, y el conjunto —trayectoria
   escolar año por año, vínculo familiar, localidad, fuero— sigue
   identificando a la persona aunque los nombres ya estén reemplazados. En los
   dos casos la trayectoria temporal ES el objeto de la discusión jurídica, así
   que no hay reemplazo que preserve a la vez el anonimato y el valor del
   modelo. Quedaron **86**.
4. Se escribió [`scripts/verificar-anonimizacion.ts`](../scripts/verificar-anonimizacion.ts),
   que ahora corre siempre que se toque el corpus.

**La lección, que vale para cualquier corpus que entre al repo desde afuera:**
un reemplazo por expresión regular sirve para normalizar formato, no para
anonimizar. Anonimizar es leer.

### El placeholder de escape

Donde el original tenía un blanco cuyo contenido no se podía deducir (`xxxx`
suelto, sin contexto), quedó `{{DATO_A_COMPLETAR}}`. Son 259 en total. El
prompt del redactor tiene una regla explícita para eso: se reemplaza por el
dato de la causa si existe, y si no por `[COMPLETAR: qué dato falta]` — nunca
se copia tal cual al escrito final.

## 3. Cómo quedaron en el repo

```
scripts/data/modelos-estudio-drive/<slug>.md    ← un archivo por modelo, con frontmatter
scripts/construir-catalogo-escritos.ts          ← lee las DOS fuentes
src/lib/escritos/catalogo-estudio.ts            ← 136 RESÚMENES (123 KB)
src/lib/escritos/catalogo-estudio-cuerpos.ts    ← los 136 textos (599 KB)
```

Un archivo por modelo, y no un documento único como los 50: son escritos de
5 a 47 KB cada uno, y con todo junto un cambio de una coma sería un diff
ilegible. Así Gonzalo corrige un modelo y el diff muestra ese modelo.

### Por qué el catálogo se partió en dos módulos

Los cuerpos suman 599 KB. El listado —la búsqueda del diálogo, la tool de
LEXIE, el filtro por categoría— no los necesita: hace falta el cuerpo de UN
modelo, el que se va a redactar. Con todo en un módulo, cada `listarModelos()`
arrastraba los 599 KB. Ahora el catálogo liviano se importa siempre y los
cuerpos se cargan con un `await import()` desde `obtenerModelo`.

Ninguno de los dos entra en el bundle del cliente: el único importador es
`queries.ts`, que es `server-only`, y el diálogo recibe los resúmenes por
`GET /api/escritos/modelos`.

## 4. Lo que cambió alrededor

| Qué | Por qué |
|---|---|
| `CategoriaEscrito` suma `extrajudicial` | Tres de los modelos son cartas documento e intimaciones: no se presentan en un tribunal, pero los redacta el mismo abogado con los mismos datos. La migración de la Fase 12 amplía el CHECK de `modelos_escrito.categoria` para que un modelo PROPIO también pueda usarla. |
| El prompt del redactor tiene una sección nueva | Un modelo que es un escrito real trae los hechos de OTRA causa. Sin decirlo, el redactor los copia. La regla es: del modelo se toman estructura, argumentación y citas; los hechos son los de esta causa, siempre. |
| `leer_modelo_escrito` recorta a 8.000 caracteres | El modelo más largo son 47 KB, unos 15.000 tokens metidos en un turno de LEXIE. Esa tool es para mostrar el modelo, no para redactar: el redactor recibe el cuerpo entero por su propio camino. |
| `numero` va de 1 a 136 | 1..50 los redactados, 51..136 los reales. Los 50 originales no se renumeraron: su número aparece en el UI y en la conversación. |

## 5. Verificación

```bash
npm run escritos:catalogo                             # regenera el catálogo
npx tsx scripts/verificar-anonimizacion.ts            # ¿quedó algún dato real?
npx tsx scripts/verificar-anonimizacion.ts --nombres  # + candidatos a nombre propio
npx tsx scripts/verificar-escritos.ts --sin-modelo    # integridad del catálogo
```

**`verificar-anonimizacion.ts` es el que importa y tiene dos niveles.**

Lo que hace fallar (sale con código 1): documentos, CUIT, correos, teléfonos,
matrículas con valor y blancos sin reemplazar. Son inequívocos.

Lo que sólo lista para mirar: candidatos a nombre propio y fechas `dd/mm/aa`.
Acá el ruido es inevitable y está bien que lo sea, porque la mayoría de los
aciertos son **legítimos**: los fallos citados llevan nombre («Díaz Bessone»,
«Casal»), la doctrina también («Dr. Julio Maier», «Devis Echandía»), y las
carátulas de los precedentes de la CSJN traen el nombre del imputado de *esa*
causa, que es pública. Distinguir eso de una parte del caso propio lleva dos
segundos a una persona y es imposible para un regex. Por eso lista en vez de
bloquear.

`verificar-escritos.ts` chequea aparte que el catálogo esté íntegro: 50 + los archivos del corpus, con
slug único y numeración correlativa, cada uno con cuerpo, sin cuerpos
huérfanos y sin blancos.

## 6. Lo que queda pendiente

- **Que Gonzalo los mire.** La clasificación (categoría, rol, cuándo se
  presenta, claves) la dedujo un modelo leyendo cada escrito. Es buena, pero
  son 86 y ninguna la revisó un abogado.
- **Y que mire la anonimización de los largos.** Pasaron dos revisiones
  independientes y el verificador no encuentra nada, pero el incidente del §2
  bis mostró que acá el margen de error importa. Los cuatro más largos (47, 43,
  42 y 34 KB) son los que más conviene leer.
- **Decidir qué hacer con los tres modelos descartados** («particular
  damnificada», «apelación de la querella con desarrollo completo de agravios»
  y «se presenta como querellante y denuncia abuso sexual»). Los tres son
  escritos útiles y ninguno está en el corpus. Para recuperarlos hay que
  reescribirles los hechos con un caso inventado: la estructura y el encuadre
  legal se conservan, el relato no.
- **Los `{{DATO_A_COMPLETAR}}`**: cada uno que se convierta en un placeholder
  con nombre es un hueco menos en un escrito generado.
- Un QA real: generar un escrito con uno de los modelos nuevos y leer la salida.
