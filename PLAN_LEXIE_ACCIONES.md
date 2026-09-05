# Fase 11 — LEXIE con manos

Fecha: 2026-09-05. **Aprobado por Mateo el mismo día** («ejecutá todo, dejá todo
funcionando»), con las recomendaciones de la sección 9 como decisiones
tomadas. El estado de cada sub-paso vive en CLAUDE.md (Fase 11).

Cómo se armó: ocho lectores sobre el código real (LEXIE, motor, agenda, Gmail,
escritos, ficha, UI, docs), tres diseños independientes (seguridad primero,
Jarvis primero, mínimo diff), tres jueces, una síntesis y un crítico de
completitud. El diseño "seguridad" ganó en dos jueces de tres; se le injertó
el botón Confirmar del diseño "Jarvis" y las lecturas baratas del diseño
"reuso". Las tres fallas altas que encontró el crítico están corregidas acá.

---

## 1. Qué entendí

LEXIE deja de ser una asistente que sólo lee y explica cómo hacer las cosas, y
pasa a hacerlas dentro de la app. Le hablás en lenguaje natural, resuelve de
qué causa, evento o correo estás hablando, ejecuta lo que puede ejecutar sola,
te muestra exactamente qué hizo, y te pide una confirmación sólo cuando la
acción sale de la app, no se puede deshacer o cuesta plata.

Cuatro frentes:

1. **Correo.** Buscar y leer hilos de tu Gmail, responder un hilo, escribir un
   correo nuevo, archivar, marcar leído, destacar, mandar a papelera. Nunca
   borrado permanente.
2. **Agenda.** Crear, modificar y eliminar eventos y tareas, con el mismo push
   a Google Calendar que hacen hoy las rutas.
3. **Escritos.** Además de recomendar modelos y guardar los que redacta,
   generar el escrito de una causa a partir de un modelo, con los datos del
   expediente, por el mismo servicio que usa el botón "Generar escrito".
4. **Ficha de causa.** Completar y corregir la ficha de una causa que ya
   existe (carátula, expediente, organismo, secretaría, juez, fiscalía,
   delitos, fuero), cargar, editar o quitar personas, y completar el perfil
   profesional del abogado (matrícula, domicilios), sin el cual todo escrito
   sale con marcas [COMPLETAR].

**Interpretación de "crear fichas de causa":** en esta app la ficha no es una
entidad aparte. Son ocho columnas nullable de `casos` más la tabla
`partes_caso`, y toda causa nace con la ficha vacía. "Crear la ficha" es
completarla sobre una causa existente. Si nombrás una causa que no existe,
LEXIE te manda a Nuevo análisis.

## 2. Qué queda afuera

- **Crear un caso nuevo.** Regla tuya. Coincide con la app: `POST /api/casos`
  exige una ejecución de análisis con estrategia elegida y no existe un
  "caso vacío". No habrá ninguna tool que inserte en `casos`.
- **Marcar un escrito como presentado.** Certifica un acto del portal judicial
  que LEXIE no puede verificar, no es transaccional y mueve la última
  actuación de la ficha. LEXIE informa cuántas marcas quedan y manda al
  detalle del escrito. Si lo querés igual, se diseña como tool confirmable.
- **Mapa procesal.** Sigue exclusivo del chat del caso. No lo pediste.
- **Plazos procesales.** LEXIE carga el vencimiento con la fecha que le dictes.
- **Correo:** CCO, adjuntos salientes, leer PDFs adjuntos, HTML de salida.
- **Ficha:** `titulo` y `estado_seguimiento` no se tocan desde LEXIE;
  autocompletar desde el relato sigue prohibido.
- **Escritos:** nivel fijo "medio" (Sonnet); un escrito por turno.
- **Motor:** queda intacto en v1. Migrar `run-agent.ts` sigue siendo 8.1b.

## 3. Principios

1. **La reversibilidad decide el gate, no el dominio.**
   - Reversible (se deshace desde la app en un click): crear/editar evento,
     completar un campo vacío, agregar/editar una persona, archivar/destacar,
     actualizar perfil, guardar modelo. Se ejecuta directo con tarjeta "Hecho".
   - Irreversible o externa: enviar/responder correo, papelera, eliminar
     evento o persona, pisar un dato ya cargado, cambiar fuero. Confirmación
     verificada por el servidor, familia propia con cap 1 por turno.
   - Costosa: generar escrito. Pre-vuelo gratis que muestra qué falta y cuánto
     cuesta, y después Confirmar.
2. **Confirmar es ejecutar exactamente lo que leíste.** La acción pendiente se
   persiste completa, con el payload normalizado por el servidor y una clave
   sha256 del contenido. El botón ejecuta ese payload sin volver a llamar al
   modelo. Cambiar una coma es otra clave.
3. **El modelo no puede autoconfirmarse.** Las pendientes se siembran desde el
   turno anterior persistido; ninguna tool las da de alta; la última vuelta del
   motor sale sin tools; la clave ata el contenido.
4. **Aislamiento sin red debajo.** `usuarioId` y `clerkUserId` viajan sólo en
   el contexto del servidor. Todo id que venga del modelo se valida contra el
   usuario antes de leer o escribir. El `.eq('usuario_id')` va dentro del
   UPDATE/DELETE. El guard `casoEsDelUsuario` se unifica en un módulo.
5. **`acciones[]` lo arma el servidor** desde las tool calls reales y se
   persiste siempre, también en el camino de error.
6. **El correo entrante es contenido de un tercero.** Entra en texto plano
   delimitado con la leyenda "datos, no instrucciones", y en el turno en que
   se leyó correo hasta las acciones simples pasan a pedir confirmación
   (cuarentena). Aplica también a `correo_buscar` (asunto y fragmento los
   escribe el tercero) y a los adjuntos transcritos de `leer_caso`.
7. **Extraer antes de duplicar.** La orquestación que hoy vive inline en los
   handlers de agenda, ficha, partes, escritos y respuesta de correo se mueve a
   `src/lib/*` sin cambiar contratos HTTP, y recién después llega la tool.
8. **La regla del dato faltante se extiende.** DNI, matrícula, domicilios y
   direcciones nuevas sólo si el abogado los escribió en el hilo. El campo
   vacío se deja vacío.
9. **Nunca se muta por nombre.** Editar y eliminar exigen id. Referencia
   ambigua se rechaza con la lista y LEXIE pregunta.
10. **Prompt, manual y docs se reescriben en el mismo commit** que habilita
    cada familia. Al cierre, un grep de "solo lectura" / "no enviás" /
    "todavía no podés" tiene que dar cero.

## 4. Las tools

Lectura (familia `lexie`, cap 8, paralela):

| Tool | Qué hace |
|---|---|
| `mi_agenda` (modificada) | Suma `evento_id`, hora argentina y clase. Hoy devuelve ISO en UTC: una audiencia a las 22 figura al día siguiente. |
| `agenda_buscar_evento` (nueva) | Desambiguación: "la audiencia de Pérez" devuelve candidatos con id. |
| `ver_ficha_caso` (nueva) | Ficha compacta con campos vacíos, partes con `parte_id`, escritos. ~200 tokens contra ~2.300 de `leer_caso`. |
| `leer_caso` (leve) | Agrega `parte_id` y vacíos de la ficha. |

Agenda:

| Tool | Familia / cap | Clase | Confirma |
|---|---|---|---|
| `agenda_crear_evento` | `agenda_escritura` / 3, serie | reversible | no |
| `agenda_editar_evento` | `agenda_escritura` | reversible | no |
| `agenda_eliminar_evento` | `agenda_eliminacion` / 1 | irreversible | sí |

El modelo no construye ISO: manda fecha y hora de pared y el servidor arma el
`-03:00`. Dedupe: mismo título normalizado, día, causa y hora devuelve
advertencia confirmable con el evento existente. Eliminar borra en Google
primero; 404/410 se tratan como borrado exitoso; ante error real no borra local
y ofrece "sólo en la app". Antes de mutar corre un pull de Google.

Ficha y partes:

| Tool | Familia / cap | Clase | Confirma |
|---|---|---|---|
| `ficha_editar` | `ficha_escritura` / 4, serie | reversible | sólo si pisa un valor cargado o cambia fuero |
| `parte_agregar` | `ficha_escritura` | reversible | no |
| `parte_editar` | `ficha_escritura` | reversible | sólo si pisa un DNI cargado |
| `parte_eliminar` | `ficha_eliminacion` / 1 | irreversible | sí |

Completar vacíos ejecuta directo. Las sobrescrituras del turno se agrupan en
una sola pendiente con diff multi-campo y se aplican en un solo UPDATE.
`delitos` se mergea (el PATCH actual reemplaza el array). Fuero reusa el 409
del mapa armado. DNI sólo si sus dígitos están en un mensaje del abogado.

Escritos:

| Tool | Familia / cap | Clase | Confirma |
|---|---|---|---|
| `generar_escrito_causa` | `escritos_generacion` / 1 | costosa | sí, con pre-vuelo |
| `actualizar_perfil_profesional` | `escritos_escritura` / 2 | reversible | no |
| `guardar_modelo_escrito` (endurecida) | `escritos_escritura` | reversible | no |

Pre-vuelo gratis: modelo, causa, datos que se van a usar, faltantes con la
marca que saldrá, perfil incompleto, instrucciones exactas, costo ~USD 0,09 y
duración 40-90 s. La generación corre **sólo por el botón**, sin las vueltas
de LEXIE encima. Contabilidad: fila `generar_escrito` propia (drill-down y FK
del escrito), sin doble conteo. El resultado no trae el texto entero: id,
título, cantidad de marcas, extracto y link `?escrito=`.

Correo (familias habilitadas sólo si hay token con scope; sin scope no se
declaran y LEXIE explica cómo reconectar):

| Tool | Familia / cap | Clase | Confirma |
|---|---|---|---|
| `correo_buscar` | `correo_lectura` / 4, paralela | lectura | no |
| `correo_leer` | `correo_lectura` | lectura | no |
| `correo_organizar` | `correo_organizar` / 4, serie | reversible | no (salvo cuarentena) |
| `correo_papelera` | `correo_envio` / 1, serie | reversible con confirmación | sí |
| `correo_responder` | `correo_envio` | irreversible | sí |
| `correo_enviar` | `correo_envio` | irreversible | sí |

- `correo_leer` aplana el HTML que ve el abogado descartando elementos ocultos,
  con text/plain como fallback. Recorte por mensaje y por hilo. Nunca expone
  headers de threading.
- `correo_responder`: el modelo aporta sólo el cuerpo. Para, CC, asunto y
  padre los calcula el servidor con la misma regla que la Bandeja, respetando
  Reply-To. Si Reply-To difiere del From, la vista previa lo dice
  explícitamente. Exige que el hilo se haya leído en este turno o el anterior.
- `correo_enviar`: destinatarios sólo si (a) aparecen en un mensaje escrito
  por el abogado en el hilo, o (b) el abogado ya les escribió (`to:`/`cc:`
  en SENT). Nunca `from:` de INBOX: el remitente de un correo inyectado no
  puede volverse destinatario por ser "corresponsal". Rechazo duro, no
  confirmable. Requiere hacer `labelIds` opcional en `listarHilos` y sumar el
  buzón TODOS a `correo_buscar` (hoy un hilo archivado es inalcanzable).
- Sin CCO ni adjuntos en v1.

`maxIterations` sube de 14 a 18, por debajo de la suma de caps a propósito.

## 5. Protocolo de confirmación

**Modelo de datos, sin migración.** `AccionLexie` en `src/lib/lexie/acciones.ts`
(módulo puro, lo importa la UI) y `accionLexieSchema` en `schemas.ts`:
`{ tool, estado: ok|rechazada|pendiente|en_curso|descartada|error, clave?,
resumen, motivo?, vista_previa?, payload? (sólo pendiente), datos? {ids, href},
antes?, confirmado_por?: click|texto, error? }`. Se persiste en
`mensajes_lexie.metadata.acciones` (jsonb, verificado en la base) y en
`ejecuciones.metadata`.

**Turno N.** La tool valida todo, arma el payload final exacto, registra la
acción `pendiente` con clave `${tool}:${sha256(payload canónico)}` y devuelve
`{ok:false, requiere_confirmacion:true, clave, vista_previa, sugerencia}` sin
`is_error`. El prompt exige mostrar la vista previa tal cual y no volver a
llamar en el mismo turno.

**Siembra en N+1.** La ruta toma las pendientes vivas del hilo y las carga en
`ContextoLexie` una vez por turno. Ninguna tool puede dar de alta; sólo
consumir. **Corrección del crítico:** cuando el botón inserta el par
"Confirmé / Hecho", ese mensaje nuevo **copia las pendientes que siguen
vivas y los `hilos_leidos`**, así el invariante "último mensaje del agente"
se mantiene y confirmar la primera tarjeta no mata la segunda.

**Dos caminos, un ejecutor** (`src/lib/lexie/ejecutar-accion.ts`):

1. **Botón Confirmar** (el común): `POST /api/lexie { confirmar_accion: clave }`.
   El servidor busca la clave entre las pendientes de la conversación activa
   del usuario autenticado; si no está, 409. **Corrección del crítico:**
   antes de ejecutar, reserva la clave con un UPDATE condicional que la pasa
   de `pendiente` a `en_curso`; sólo si ese UPDATE afectó una fila ejecuta.
   Doble click, dos pestañas o reabrir la ventana durante los 40 s del escrito
   no mandan dos correos ni cobran dos escritos. Al terminar pasa a `ok` o
   `error`. Cero tokens, no llama al modelo, no inserta fila `lexie` en
   `ejecuciones` (salvo la `generar_escrito` propia). "Cancelar" hace
   `descartar_accion`.
2. **Texto** ("dale, mandalo"): la tool acepta `{clave, confirmar:true}` sólo
   si la clave está sembrada y no consumida, y ejecuta el mismo payload
   persistido. Contenido nuevo produce otra clave y se rechaza: "el texto
   cambió, mostralo de nuevo". `confirmar:true` sin siembra se rechaza como
   en el mapa. Para escritos, el texto responde "usá el botón" hasta que
   exista el deploy y se mida el timeout del proxy.

**Concurrencia optimista.** El ejecutor relee la fila y compara con `antes`
para ficha, partes y evento; si cambió desde la vista previa, rechaza y emite
una pendiente nueva con el diff actual.

**Ventana:** un turno, como el mapa. `DELETE /api/lexie` descarta pendientes.
El techo de 24 mensajes no afecta la siembra.

**Camino de error.** `AgentLexieError` con `partialAcciones`. El catch inserta
la ejecución parcial con acciones y, si hubo alguna ejecutada, un mensaje de
corte **en par** (usuario con la pregunta original + agente con el corte), con
las mismas claves en ambas filas, porque `guardarTurno` inserta los dos juntos
y un `agente` suelto se fusiona con el anterior.

**Memoria entre turnos.** `reconstruirHistorial` pega al mensaje del agente una
nota del sistema con las acciones de ese turno, para que N+1 no duplique y
pueda confirmar por clave. Tras acciones ok de agenda o ficha, la ruta fuerza
el refresco del bloque de contexto.

## 6. Interfaz

- `src/components/lexie/acciones-lexie.tsx` (nuevo, molde `acciones-mapa.tsx`):
  tarjetas Hecha / Rechazada / Pendiente / En curso, vista previa completa
  (direcciones enteras, asunto, cuerpo colapsable), botones inline, nunca un
  Dialog z-50 que tape la ventana z-40. Color por token.
- `lexie-chat.tsx`: acciones en cada mensaje, GET y POST con acciones,
  confirmar/descartar, deshabilitar pendientes al llegar un mensaje nuevo,
  estado "Enviando… / Redactando…".
- Evento global `lexie-mutacion`: Agenda, Bandeja, detalle de causa y bloque
  de escritos escuchan y refrescan con su mecanismo propio. La ventana es no
  modal y flota sobre la sección que cambió.
- Toaster global en el layout raíz (arregla de paso los toasts perdidos de
  Mis casos).
- Tarjeta "Modelo guardado" sin link: no existe una vista de biblioteca; los
  modelos propios viven en el diálogo Generar escrito de una causa.

## 7. Fases

Cada sub-paso es un commit, útil solo y verificable gratis salvo dos turnos
pagos y una generación real detrás de `--con-escrito`.

| Sub-paso | Alcance | Tamaño |
|---|---|---|
| 11.0 | Decisiones cerradas. Sondeo por PostgREST de `mensajes_lexie`, CHECK de `ejecuciones.tipo`, duplicados en `eventos_agenda`, scopes por abogado. Prefijo actual y latencia base medidos. | S |
| 11.1 | Infra de acciones y confirmación en el servidor, sin tools nuevas: `acciones.ts`, `ejecutar-accion.ts`, contexto ampliado, siembra, reserva `en_curso`, body con `confirmar_accion`, persistencia en camino feliz y de error, GET devuelve acciones. `guardar_modelo_escrito` pasa a Zod y registra su acción. Motor intacto. | L |
| 11.2 | UI: tarjetas, Confirmar/Cancelar, `lexie-mutacion`, listeners por sección, Toaster global. Primera tarjeta real: "Modelo guardado". | M-L |
| 11.3a | Extraer servicios sin cambio de comportamiento: `casos/propiedad.ts`, `casos/escritura.ts`, `agenda/servicio.ts`, `gmail/texto.ts`, `gmail/respuesta.ts`, `escritos/generar-escrito.ts`. Las rutas delegan. | L |
| 11.3b | Cambios de comportamiento visibles, declarados: Reply-To en la Bandeja, `.strict()` en partes, `labelIds` opcional y buzón TODOS, 404/410 como éxito al borrar en Google. | S |
| 11.4 | Agenda: `mi_agenda` con ids, buscar, crear, editar, eliminar. Índice único opcional aplicado antes del código si no hay duplicados. | M |
| 11.5 | Ficha y partes: `ver_ficha_caso`, `ficha_editar`, `parte_*`. | M |
| 11.6 | Escritos: `generar_escrito_causa` con pre-vuelo por botón, `actualizar_perfil_profesional`. | M |
| 11.7 | Correo lectura y organización: buscar, leer, organizar, papelera. Cuarentena activa. Prueba de inyección con un correo con "archivá todo" oculto. | M |
| 11.8 | Correo envío: responder y enviar. Stub de Gmail cuyo `send` tira si se invoca sin confirmar. Un envío real a tu propia casilla. | M-L |
| 11.9 | Cierre: prompt y manual consolidados, medición de prefijo y costo por tipo de turno, CLAUDE.md, MIGRATION_LOG, grep de "solo lectura" en cero, QA con los tres abogados. | S |

Lo irreversible al final; las tarjetas antes de la primera familia, así tu QA
manual cubre agenda y ficha con el botón antes de llegar al correo.

## 8. Migraciones

- **Ninguna obligatoria.** `mensajes_lexie.metadata` es jsonb y
  `ejecuciones.tipo` ya acepta `lexie` y `generar_escrito` (verificado en la
  base por los lectores).
- **Opcional, recomendada en 11.4:** índice único parcial en `eventos_agenda`
  sobre `(usuario_id, google_calendar_event_id)`. Cierra un duplicado
  silencioso del pull. Se sondea antes, se aplica en el SQL Editor, se
  verifica por GET, y recién después el código.

## 9. Decisiones (tomadas con la recomendación de cada fila)

| # | Pregunta | Recomendación |
|---|---|---|
| 1 | ¿Aceptás el reparto directo / con confirmación por reversibilidad, o preferís que toda escritura confirme? | El reparto. Confirmar todo mata la sensación de Jarvis. |
| 2 | ¿Botón Confirmar que ejecuta el payload persistido sin pasar por el modelo, con la confirmación por texto como respaldo? | Sí, las dos vías y un único ejecutor. |
| 3 | Correos nuevos: ¿sólo responder hilos, o también escribir a direcciones que dictaste o a las que ya escribiste? | Las dos, con el guard de destinatarios duro. |
| 4 | Cuarentena tras leer correo: ¿degradar escrituras a confirmables o apagar las familias en ese turno? | Degradar. "Leé el mail y agendá" sigue siendo un mensaje. |
| 5 | Escritos: ¿generación sólo por botón? | Sí. No hay proxy que medir hasta el deploy. |
| 6 | ¿Marcar presentado queda fuera? | Fuera. |
| 7 | Ficha: ¿fuero con confirmación; título y estado fuera; DNI y matrícula sólo dictados? | Sí a las tres. |
| 8 | Agenda: ¿Google primero al eliminar y pull antes de mutar? | Sí. |
| 9 | Lautaro no tiene ningún scope de Google. ¿Se despliega igual con degradación, y los tres tienen las mismas capacidades? | Sí y sí. |
| 10 | ¿Toaster global en el layout raíz? | Sí, es un arreglo pendiente de todos modos. |
| 11 | ¿Orden 11.0 a 11.9 como está? | Mantenerlo. |

Todas se tomaron con la recomendación. Sondeos del 11.0 contra la base:
`mensajes_lexie.metadata` es jsonb; `ejecuciones.tipo` tiene 25 filas `lexie`;
cero duplicados en `eventos_agenda` por `google_calendar_event_id`; ningún
abogado tiene el perfil profesional cargado.

## 10. Riesgos y mitigaciones

- **Destinatario equivocado.** Guard de origen (dictado o SENT), vista previa
  con direcciones completas, cap 1, confirmación.
- **Prompt injection desde un correo.** Texto plano delimitado, elementos
  ocultos descartados, cuarentena intra-turno, prompt que separa "lo que dice
  el correo" de "lo que te propongo".
- **Doble ejecución.** Reserva `en_curso` antes de ejecutar.
- **Doble cobro de escritos.** Fila `generar_escrito` propia; la tool no suma
  `usageExtra`.
- **Timeout de 120 s.** La generación corre por el botón, sin las vueltas del
  modelo encima. El par de mensajes se inserta antes de responder.
- **Huérfano en Google.** Google primero al eliminar; 404/410 como éxito.
- **Pisar un dato cargado a mano.** Sobrescribir siempre confirma, con antes y
  después; concurrencia optimista al ejecutar.
- **Caché.** Agotar una familia de cap 1 saca sus tools del request siguiente
  y rompe el caché de ahí en adelante. Con el botón las confirmaciones no
  consumen cap, así que es raro; se mide en 11.9.
- **Cuota de Gmail.** `correo_lectura` cap 4 y límite 10 por búsqueda.

## 11. Estimación

Diez u once commits. Entre 3.400 y 3.800 líneas nuevas o modificadas, de las
cuales ~1.100 son código que se mueve. Unos 11 módulos nuevos en `src/lib`,
un componente nuevo, ~25 archivos existentes tocados. Al ritmo del repo, 8 a
10 sesiones, con QA manual tuyo en el navegador al cierre de 11.2, 11.4, 11.6,
11.8 y 11.9. Costo de verificación del orden de USD 1 a 2 en total. Prefijo
cacheado estimado de 9.000 a 11.000 tokens contra los 5.930 actuales, o sea
un centavo más por apertura de hilo. Una confirmación por botón cuesta cero.

## 12. Decisiones de producto que se revierten

- "LEXIE es de solo lectura, con una única excepción."
- "La IA no tiene ninguna tool de email: enviar siempre es manual."
- "LEXIE no toca la agenda (v1 sin escrituras)."
- "LEXIE no genera el escrito de la causa: manda al botón."
- El invariante de la UI del mapa "confirmar por botón no es un flag del
  cliente": se desvía a propósito con `confirmar_accion`, que no es
  fabricable (sha256 de un payload que sólo el servidor generó y persistió,
  válido sólo contra la conversación propia, consumido al ejecutar).

Se conservan: crear la causa es manual; presentar es manual; nunca borrado
permanente; LEXIE no calcula plazos; el mapa se muta sólo desde el chat del
caso; el fuero se congela con el mapa armado; nada se autoenvía.
