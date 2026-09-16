# Fase 12 — Reportería al cliente

**Fecha:** 15 de septiembre de 2026
**Pedido:** Mateo, sobre la ficha «Sistema de Reportería al Cliente v1.0» del estudio
(Google Doc, seis plantillas P-01…P-06 + instrucciones para el agente).
**Antecedente:** [REPORTERIA_AL_CLIENTE_PARA_DECIDIR.md](REPORTERIA_AL_CLIENTE_PARA_DECIDIR.md)
(12/8/2026), que dejó seis preguntas sin contestar y fijó el orden: primero la ficha
(Fase 9, cerrada), después las plantillas.

## 1. Qué se construye

Un bloque **«Reportes al cliente»** dentro de la ficha de cada causa, al lado de
«Escritos». El abogado elige a quién le escribe (una persona marcada como cliente),
qué plantilla usa (el sistema sugiere una según lo último que pasó en la causa) y
por qué canal. La app arma el borrador con lo que ya sabe (etapa, último movimiento,
próximos eventos, juez, carátula, firma), el abogado completa lo que es criterio
profesional, la IA pule la prosa, y el mensaje **se envía sólo después de leerlo
entero**: por correo desde su Gmail, o copiándolo para pegarlo en WhatsApp.

Todo queda registrado: el texto que generó el sistema, el que finalmente salió, a
quién, cuándo y por qué canal.

## 2. Las seis preguntas, contestadas por defecto

Los socios no contestaron el documento de agosto. Se toma la recomendación de Mateo
donde la había, y se decide lo demás. **Cualquiera de estas se cambia en una
línea de configuración**; están marcadas para que Gonzalo y Lautaro las revisen.

| # | Pregunta | Decisión | Dónde vive |
|---|---|---|---|
| 1 | ¿Por causa o por persona? | **Por persona.** Sólo se reporta a partes con `es_cliente = true`; el server rechaza las demás con 409. `partes_caso` suma `telefono` y `email`. | `generar-reporte.ts`, migración |
| 2 | ¿WhatsApp? | **Link directo.** Sin API de Meta ni proveedor no oficial. El botón abre `wa.me` con el mensaje ya escrito en el chat del cliente; él toca enviar adentro de WhatsApp y después vuelve a registrarlo. El número se normaliza a E.164 y el que no se puede interpretar se rechaza en vez de adivinarse. | `telefono.ts`, `enviar-reporte.ts`, `reporte-detalle-dialog.tsx` |
| 3 | ¿Cuánto escribe la IA? | **(b): el sistema arma el esqueleto, la IA lo pule.** El borrador se renderiza determinísticamente (datos + criterio del abogado + marcas de faltante) y el modelo lo reescribe en lenguaje coloquial **sin agregar un solo hecho**. Se puede generar sin IA. | `render.ts`, `prompt.ts`, `run-reporte.ts` |
| 4 | ¿Se guarda lo enviado? | **Sí, las dos versiones**: `contenido_generado` (lo que produjo el sistema) y `contenido_enviado` (lo que salió), más `enviado_a` con la dirección o el teléfono exactos. Un reporte enviado es inmutable. | tabla `reportes_cliente` |
| 5 | ¿Querella? | **Se usa igual**, con la perspectiva ajustada: el prompt recibe el rol del estudio en la causa y «favorable» significa favorable para NUESTRO cliente (la víctima). Las plantillas no se duplican; Gonzalo puede escribir las espejadas cuando quiera. | `prompt.ts` |
| 6 | Prisión preventiva y condena | **(b): sin IA.** En las variantes `prision_preventiva` (P-02) y `condenatoria` (P-04) la app escribe el encabezado y los datos, y el cuerpo queda como `[REDACTAR: …]` para que lo escriba el abogado. No se llama al modelo, cuesta cero. | `plantillas.ts` (`sin_ia`) |

## 3. Reglas duras (las que no dependen del prompt)

1. **Nada sale sin que el abogado lo lea.** Generar y enviar son dos rutas
   distintas, dos botones distintos, y el de enviar muestra la **dirección completa**
   (o el teléfono) antes de confirmar.
2. **La regla del dato faltante, al revés del documento del estudio.** La
   instrucción 3 de la ficha decía «si falta un dato, usá una frase neutral». Acá es
   lo contrario: el borrador escribe `[FALTA: fecha de la audiencia]` y **el envío se
   rechaza (409) mientras quede una marca** `[FALTA: …]` o `[REDACTAR: …]`.
3. **La IA no agrega hechos.** Recibe el borrador ya armado y los datos crudos, y
   tiene prohibido sumar fechas, nombres, plazos o promesas que no estén ahí. En
   particular **no calcula plazos**: `PLAZO_RECURSO` es un campo que tipea el abogado
   (la tabla por fuero que firma Gonzalo todavía no existe).
4. **La promesa de recurrir sale de una decisión, no de la plantilla.** P-02 y
   P-04 tienen el bloque «vamos a apelar/recurrir» detrás de la condición
   `SE_RECURRE`, que es un checkbox del formulario. Es la única modificación al texto
   de las plantillas del estudio, y está documentada acá porque el documento de
   agosto la pidió (riesgo 2).
5. **Un reporte no es un acto procesal.** Enviarlo NO crea un evento del timeline ni
   bumpea `casos.actualizado_en`: la «última actuación» de la ficha es el
   expediente, no la comunicación con el cliente. El registro vive en su tabla.
6. **Aislamiento**: `usuario_id` va en la tabla y en el predicado de cada escritura;
   `parte_id` se verifica contra `caso_id`; el correo sale del token de Clerk del
   abogado autenticado, nunca de otro.

## 4. Qué sabe el sistema y qué pone el abogado

De las 35 variables del documento (§3 del análisis de agosto):

- **Sistema** (sin tipear): nombre de pila del cliente, etapa procesal (derivada del
  mapa, con su traducción coloquial del glosario), último movimiento y su fecha,
  movimientos del mes, próximos eventos de agenda de la causa (fecha y hora del
  debate si hay una audiencia cargada), juez, tribunal, carátula, delitos, nombre
  del abogado (perfil profesional o nombre de usuario), estudio, fecha y mes.
- **Criterio** (formulario corto, distinto por plantilla): próximo paso, si el cliente
  tiene que hacer algo, ritmo de la causa, tipo de resolución, por qué es buena o
  mala noticia, qué va a hacer la defensa, si se recurre y con qué argumento, pena y
  plazo del recurso, pruebas, testigos, punto de encuentro, indicaciones de
  presentación, fundamentos del recurso, etc.

Lo que no está en ninguna de las dos listas queda como `[FALTA: …]`.

## 5. Selección de plantilla (sugerencia, no decisión)

`sugerirPlantilla()` mira el último evento sucedido del expediente y la agenda:

| Señal | Sugiere |
|---|---|
| Audiencia de debate/juicio en la agenda dentro de los próximos 20 días | P-03 |
| Último evento `resolucion_recibida` que menciona sentencia, condena o absolución | P-04 |
| Último evento `resolucion_recibida` que menciona procesamiento, sobreseimiento, falta de mérito o elevación | P-02 |
| Último evento `escrito_presentado` que menciona apelación, casación, queja, extraordinario o recurso | P-05 |
| Nada de lo anterior | P-01 |

P-06 no se sugiere: es la elección para causas largas y la toma el abogado. La
sugerencia se muestra con su motivo y se puede cambiar.

## 6. Envío periódico: memoria, no automatismo

No hay cron ni envío automático (la app no se despierta sola, y un mensaje sobre
una causa penal no debería salir sin que un abogado lo lea). En su lugar, el Inicio
muestra la tarjeta **«Clientes sin novedades»**: causas activas con cliente cargado a
las que hace más de 30 días que no se les manda un reporte (o nunca). El abogado
entra, genera, revisa y manda.

## 7. Piezas

```
supabase/migrations/20260915120000_reporteria_cliente.sql
src/lib/reporteria/
  types.ts        tipos, estados, canales, marcas [FALTA]/[REDACTAR]     (puro)
  plantillas.ts   las 6 plantillas, variables, condiciones, variantes,
                  campos de criterio, glosario de traducción            (puro)
  render.ts       render determinístico: variables + bloques condicionales (puro)
  datos.ts        el esqueleto de datos desde caso/partes/eventos/agenda (puro)
  sugerir.ts      la sugerencia de plantilla                            (puro)
  telefono.ts     teléfono argentino → E.164 + link de wa.me            (puro)
  prompt.ts       system prompt + mensaje del turno                     (server)
  run-reporte.ts  single-shot al modelo, sin tools, con caché           (server)
  queries.ts      acceso a reportes_cliente + sondeo de migración       (server)
  generar-reporte.ts  prevuelo (gratis) + generación (paga o sin IA)   (server)
  enviar-reporte.ts   email vía Gmail | whatsapp | copia                (server)
src/app/api/casos/[id]/reportes/{route,preparar/route,[reporte_id]/route,[reporte_id]/enviar/route}.ts
src/app/api/reportes/pendientes/route.ts
src/components/mis-casos/reportes/{reportes-causa,nuevo-reporte-dialog,reporte-detalle-dialog}.tsx
src/lib/agent/reporteria-tools.ts   dominio de LEXIE (preparar → generar → enviar, con confirmación)
scripts/verificar-reporteria.ts     --puro (sin base ni modelo) | --sin-modelo | completo
```

## 8. Lo que queda afuera, a propósito

- WhatsApp por API de Meta (destruye el lenguaje coloquial; ver §4 del documento de agosto).
- WhatsApp por proveedor no oficial tipo Rapiwa: manda de verdad desde la app y
  trae acuses de entrega, pero un tercero pasa a relayar la estrategia de una
  causa penal (secreto profesional, art. 156 CP; datos sensibles, Ley 25.326),
  con riesgo de baneo del número y una sesión por QR que se cae sola. Si algún
  día se evalúa, el orden es: aviso por WhatsApp + contenido por correo,
  primero con un solo número de prueba.
- Acuses de entrega y respuestas del cliente: el link directo no los puede dar.
  La app sabe que el abogado dijo «ya lo mandé», no que el cliente lo leyó.
- Envío automático y periódico (§6).
- Plantillas espejadas para querella escritas por Gonzalo (§2, pregunta 5).
- Tabla de plazos de recurso por fuero (la firma Gonzalo; hasta entonces el plazo lo tipea el abogado).
- Glosario de traducción completo por fuero: el que va en el prompt es el de la ficha del
  estudio (cinco filas, CPPN) más lo que se deriva del mapa. Se amplía cuando Gonzalo lo escriba.

## 9. Pendiente de Mateo al despertarse

1. Aplicar `20260915120000_reporteria_cliente.sql` en el SQL Editor (ver MIGRATION_LOG.md).
2. Correr `scripts/verificar-reporteria.ts` contra la base (el `--puro` ya corrió acá).
3. QA en el navegador: cargar el mail de un cliente en Partes → «Nuevo reporte» → P-01 →
   generar → leer → «Enviar por correo» (ver la dirección completa) → confirmar → Enviados.
4. Que Gonzalo y Lautaro lean la tabla del §2 y digan si cambian algo.
