# Reportería al cliente — qué se puede hacer y qué hay que decidir

**Para:** Gonzalo y Lautaro
**De:** Mateo
**Fecha:** 12 de agosto de 2026
**Tema:** el documento de las 6 plantillas de comunicación con el cliente

---

## En una línea

**Se puede hacer, funciona, y vale la pena — pero no como está escrito en el documento.**
Hay tres cosas que hay que sacar y una decisión de fondo que cambia todo el resto.
Necesito que lean esto y me contesten las 6 preguntas del final.

---

## 1. Qué entendí que quieren

Un módulo que redacta el mensaje que le mandamos al cliente para contarle cómo va su causa.
Seis situaciones: novedades generales, una resolución del juez, la previa del juicio oral,
la sentencia, un recurso presentado, y el resumen mensual.

Lo mejor del documento no son las plantillas. Es la **tabla de traducción**: convertir
"art. 306 CPPN" en "estás procesado, la investigación sigue". Eso es lo que hace que el
mensaje sirva, y es exactamente la parte que la app puede sostener bien.

El problema que ataca también está bien elegido: reportarle al cliente es trabajo repetitivo
que no se hace, y cuando se hace sale con jerga, sin decir qué viene después y sin aclarar
si el cliente tiene que hacer algo.

---

## 2. La cuestión de fondo: la app no sabe casi nada de sus causas

El documento arranca diciendo *"el agente lee la ficha de causa y autocompleta"*.

**Esa ficha no existe.** Hoy la app, de una causa, guarda: el relato que escribimos al crearla,
la estrategia elegida, el mapa procesal, los eventos que cargamos a mano y la agenda.

No guarda: **carátula, número de expediente, juzgado, juez, fiscalía, ni el nombre del cliente.**
Ni el de los imputados. Ni un teléfono. Nada.

Eso no es un impedimento — es trabajo. Pero cambia el orden: **no se puede empezar por las
plantillas, hay que empezar por la ficha.** Y la ficha sirve igual aunque la reportería nunca
se construya: hoy una causa en la app se llama por las primeras palabras del relato, no por
su carátula.

---

## 3. De las 35 variables del documento, en qué situación está cada una

Esto es lo más importante del análisis. Las agrupé en tres.

### Las que el sistema ya puede escribir solo (unas 8)

En qué etapa está la causa y qué significa esa etapa · cuál fue el último movimiento y
cuándo pasó · el resumen de movimientos del mes · fecha y hora del debate · el mes y la
fecha del reporte.

### Las que hay que cargar una vez y después se reusan (unas 12)

Nombre del cliente y cómo contactarlo · carátula · juzgado · juez · tribunal de alzada ·
qué tipo de resolución fue · plazo del recurso según el fuero · dónde queda la sede del
debate · nuestro apellido, matrícula y el nombre del estudio.

Son datos que se cargan al abrir la causa o al anotar un evento. Una vez cargados, el
sistema los usa para siempre.

### Las que **nunca** va a poder escribir solo (unas 15)

Y acá está el punto que hay que discutir antes de construir nada:

> Por qué la resolución es buena noticia · qué vamos a hacer frente a un fallo adverso ·
> el fundamento del recurso · qué tiene que hacer el cliente · **cuál es el próximo paso** ·
> cómo tiene que ir vestido · dónde nos encontramos · cuál es el argumento central de la
> defensa · qué pruebas tenemos · qué testigos declaran · qué implica la pena en la práctica ·
> qué efectos concretos tiene la resolución.

**Eso no es un dato: es criterio profesional.** No está en ninguna base de datos y no lo va
a estar nunca, porque depende del caso, del cliente y de lo que ustedes decidieron.

Un ejemplo que lo deja claro: después de la investigación preparatoria hay **seis caminos
posibles** en el mapa. Cuál es "el próximo paso" no es un dato que se consulte — es una
decisión estratégica de ustedes.

> **Conclusión práctica:** esto no va a ser un botón "generar y enviar".
> Va a ser **un formulario corto con un borrador editable**: la app arma el andamiaje y el
> encabezado, ustedes ponen el criterio, y recién ahí se manda.
> Si esperan un botón mágico, van a quedar decepcionados el primer día. Si esperan
> "me ahorra el 70% del tipeo y no me deja olvidarme de nada", eso sí lo entrega.

---

## 4. Tres cosas del documento que no van a funcionar como están escritas

### WhatsApp — hay que sacarlo de la primera versión

El documento asigna WhatsApp a tres de las seis plantillas. Para que la app mande WhatsApp
sola hay que usar el canal oficial de Meta, y ahí los mensajes tienen que ser **textos fijos
aprobados por Meta con anticipación**, sin saltos de línea y sin variantes. O sea: se pierde
el lenguaje coloquial y los párrafos que aparecen o no según el caso — que es toda la gracia
del documento. Además, el número que se registra **deja de funcionar como WhatsApp normal**.

**Alternativa:** el sistema genera el texto y un botón lo copia. Ustedes lo pegan en su
WhatsApp de siempre. Cero fricción, cero costo, y el mensaje sale igual.

### El envío automático y periódico — no existe todavía

El documento habla de envíos "semanales, quincenales o mensuales". Hoy la app **no tiene
forma de despertarse sola**: solo hace cosas cuando alguien la abre. Y honestamente:
un mensaje sobre una causa penal saliendo solo, sin que un abogado lo lea, es algo que
no deberíamos construir aunque pudiéramos.

**Alternativa:** en la pantalla de Inicio aparece una tarjeta que dice
*"hace 34 días que no le reportás a Fulano"*. Ustedes entran, generan, revisan y mandan.
La memoria la pone el sistema; la decisión la ponen ustedes.

### "Si falta un dato, poné una frase neutral" — hay que darlo vuelta

La instrucción 3 del documento dice que el agente nunca deje una variable sin completar, y
que si falta un dato use una frase neutral.

Eso es **exactamente lo contrario** de la regla que ya escribimos para la jurisprudencia:
si no hay fallo aplicable, el sistema no fuerza una cita — lo declara. Lo hicimos porque a
un modelo al que le pedís que funde con jurisprudencia siempre le encuentra algo que citar.

Acá el riesgo es peor, porque el texto sale para afuera. **Si falta un dato, el borrador
tiene que mostrar `[FALTA: fecha de la audiencia]` bien visible y no dejar mandar el mensaje
hasta que alguien lo complete.**

---

## 5. Cuatro riesgos que conviene mirar de frente

**1. El mensaje sale firmado por ustedes.**
Suena escrito por el abogado de confianza — esa es la idea. Entonces nadie manda nada sin
leerlo entero. El botón de enviar no puede estar a un click del de generar.

**2. Dos plantillas prometen un recurso.**
La de resolución adversa trae "vamos a apelar porque…" y la de sentencia trae "vamos a
presentar casación dentro de los X días". Eso sale solo, por el tipo de resolución. Pero
puede pasar que todavía no hayan decidido recurrir, que no estén acordados los honorarios,
o que el cliente no quiera. **La promesa tiene que salir de una decisión cargada en el
sistema, no de la plantilla.**

**3. Los plazos.**
El sistema no puede inventar plazos procesales: un plazo de casación mal dicho hace daño
real. Van a salir de una tabla fija por fuero que **firma Gonzalo**, no de la búsqueda de
la IA. Y si la causa no tiene el fuero cargado, esas plantillas directamente no se generan.

**4. El destinatario equivocado.**
Un mail mal tipeado manda la estrategia de defensa a un tercero, y de eso no se vuelve.
La pantalla de envío va a mostrar **la dirección completa**, no el nombre.

Hay una quinta cosa, más de fondo: **las seis plantillas están escritas para el defensor.**
"Presentamos", "recurrimos", "es una buena noticia". Si actuamos como querellantes, el
destinatario es otro y "favorable" significa lo contrario. Hay que decidir qué hacemos
(pregunta 5).

---

## 6. Cómo se construiría

Por partes, y cada parte sirve sola:

1. **La ficha de la causa** — carátula, expediente, juzgado, juez, fiscalía.
   *Sirve aunque la reportería no exista: hoy las causas no se llaman por su carátula.*
2. **Las partes del caso** — cliente, imputados, contacto.
   *De paso, el buscador pasa a encontrar "Juan Pérez — imputado" en vez de un pedazo de relato.*
3. **El primer borrador** — la plantilla de novedades generales, armada con datos reales.
4. **La redacción** — la IA pule la prosa sobre ese esqueleto.
5. **El envío** — desde la bandeja de correo que ya está hecha, y queda registro de lo
   que se mandó, a quién y cuándo.
6. **Las plantillas de resolución, sentencia y recurso** — con plazos y tipos cargados.
7. **El reporte mensual y la previa del juicio.**

No tengo estimación en semanas todavía. La doy cuando estén contestadas las preguntas de
abajo, porque algunas cambian bastante el trabajo.

---

## 7. Lo que necesito que decidan

### 1. ¿El reporte es por causa o por persona?

Una causa con dos imputados de intereses contrapuestos no puede recibir el mismo texto.

- **(a)** Un destinatario por causa. Más simple.
- **(b)** Un destinatario por persona: cargamos las partes y eligen a quién le reportan.

*Mi recomendación: (b).* El pre-análisis ya les pregunta por coimputados con intereses
contrapuestos. Si el sistema ya sabe que existen, mandarles el mismo texto a los dos es un
problema de secreto profesional, no de comodidad.

### 2. ¿WhatsApp?

- **(a)** Botón "Copiar" y lo pegan ustedes.
- **(b)** Integración oficial con Meta, con las limitaciones de arriba.

*Mi recomendación: (a).* La (b) destruye el lenguaje coloquial, que es la premisa del documento.

### 3. ¿Cuánto escribe la IA?

- **(a)** Nada: el borrador se arma solo con los datos, sin IA. Sale más seco pero es exacto.
- **(b)** La IA redacta algunos párrafos sobre ese esqueleto. Suena más humano.
- **(c)** La IA escribe el mensaje entero.

*Mi recomendación: empezar por (a) y llegar a (b).* La (c) es donde aparecen las
invenciones, y acá el texto sale para afuera.

### 4. ¿Guardamos lo que se mandó?

- **(a)** Alcanza con la carpeta Enviados del correo.
- **(b)** El sistema guarda el texto generado **y** el texto que finalmente salió.

*Mi recomendación: (b).* La diferencia entre los dos es la mejor señal de qué plantilla
está fallando. Y si dentro de tres meses un cliente dice "ustedes me dijeron que salía en
enero", queremos poder ver qué se le dijo exactamente.

### 5. Cuando actuamos como querellantes, ¿qué hacemos?

- **(a)** El módulo no se usa en esas causas (solo defensa).
- **(b)** Gonzalo escribe una versión espejada de las seis plantillas.

*Sin recomendación: es decisión de ustedes según cuánta querella llevan.*

### 6. Las dos plantillas de peores noticias — prisión preventiva y condena

Son los mensajes donde un párrafo mal calibrado hace más daño, y donde el documento se
contradice solo: pide "sin eufemismos" y "sin generar ansiedad" al mismo tiempo.

- **(a)** Van igual que las demás.
- **(b)** En esas dos, la app arma el encabezado y los datos, pero **el cuerpo lo escriben
  ustedes de cero**. Sin IA.

*Mi recomendación: (b).*

---

## 8. Lo que necesito de Gonzalo puntualmente

Dos textos que van a quedar fijos en el sistema y que **no puede escribir la IA**:

1. **El glosario de traducción** — la tabla del documento (art. 306 → "estás procesado…")
   pero completa, y **por fuero**, no por número de artículo. Los ejemplos del documento
   están en el código viejo de Nación; nosotros trabajamos también en Federal y Provincia,
   donde la numeración es otra.

2. **La tabla de plazos de recurso por fuero** — apelación, casación, queja, extraordinario.
   Y si cada uno suspende o no la ejecución. Eso último es el dato de mayor daño posible:
   es decirle a alguien si va preso ahora o no.

---

## Resumen

- El sistema **sí se puede hacer** y aporta valor real.
- Sale **la mitad automático y la mitad criterio de ustedes** — y esa mitad no se puede
  automatizar nunca.
- Hay que **empezar por la ficha de la causa**, no por las plantillas.
- **WhatsApp automático y envíos periódicos quedan afuera** de la primera versión.
- **Nada se manda sin que un abogado lo lea.**

Contéstenme las 6 preguntas y arranco.
