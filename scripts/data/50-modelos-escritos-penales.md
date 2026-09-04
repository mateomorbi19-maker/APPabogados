# 50 modelos de escritos judiciales — Fuero penal argentino

> **Advertencia de uso.** Son plantillas de trabajo, no asesoramiento legal. Las citas de artículos son **orientativas**: hay que verificarlas contra el texto vigente del código aplicable (CPPF federal, CPPN Ley 23.984 donde sigue rigiendo, o el código procesal provincial). La numeración cambia entre jurisdicciones. Todo escrito debe adaptarse al caso concreto, la jurisdicción y el estado procesal antes de presentarse.

## Convención de placeholders

Los campos variables van en `{{DOBLE_LLAVE}}` para que sean parseables por un sistema de plantillas:

`{{TRIBUNAL}}` · `{{CARATULA}}` · `{{NRO_CAUSA}}` · `{{IMPUTADO}}` · `{{DNI}}` · `{{DEFENSOR}}` · `{{TOMO_FOLIO}}` · `{{DOMICILIO_CONSTITUIDO}}` · `{{DOMICILIO_ELECTRONICO}}` · `{{FISCALIA}}` · `{{DELITO}}` · `{{FECHA_HECHO}}` · `{{FECHA}}` · `{{LUGAR}}`

---

## Bloque base reutilizable

Todos los modelos comparten esta estructura. En cada modelo se detalla solamente lo propio (**SUMA**, **OBJETO**, **FUNDAMENTOS**, **PETITORIO**).

**Encabezado**

```
{{SUMA_EN_MAYUSCULAS}}

Señor Juez / Señora Jueza / Excmo. Tribunal:

{{DEFENSOR}}, abogado/a, T° {{TOMO_FOLIO}} C.P.A.C.F., en mi carácter de defensor/a de
{{IMPUTADO}}, DNI {{DNI}}, en la causa N° {{NRO_CAUSA}} caratulada "{{CARATULA}}",
en trámite ante {{TRIBUNAL}}, con domicilio constituido en {{DOMICILIO_CONSTITUIDO}} y
domicilio electrónico {{DOMICILIO_ELECTRONICO}}, a V.S. respetuosamente digo:
```

**Cuerpo estándar**

```
I. OBJETO
II. ANTECEDENTES / HECHOS
III. FUNDAMENTOS DE DERECHO
IV. PRUEBA (si corresponde)
V. RESERVAS (caso federal — art. 14 Ley 48 — y de recurrir a instancias internacionales)
VI. PETITORIO
```

**Cierre**

```
Proveer de conformidad,
SERÁ JUSTICIA.
```

**Fórmulas de estilo frecuentes**

- "Vengo en legal tiempo y forma a…"
- "Dejo planteada la cuestión federal en los términos del art. 14 de la Ley 48, por hallarse en juego las garantías de los arts. 18 y 75 inc. 22 de la Constitución Nacional."
- "Sin perjuicio de lo expuesto, y para el hipotético caso de que V.S. no hiciera lugar a lo peticionado, subsidiariamente solicito…"

---

# I. Actos iniciales y constitución de partes

## 1. Aceptación de cargo de defensor y constitución de domicilio

**Suma:** ACEPTA CARGO. CONSTITUYE DOMICILIO. SOLICITA PARTICIPACIÓN.
**Cuándo:** primer acto de la defensa técnica, tras la designación en acta o por escrito.
**Base normativa (orientativa):** derecho de defensa, art. 18 CN; designación y aceptación del defensor, CPPF arts. 78/82; CPPN arts. 104/112.

**Objeto:** aceptar el cargo conferido, constituir domicilio procesal y electrónico, y solicitar ser tenido por parte con todas las facultades procesales.

**Cuerpo tipo:**
> Que vengo a aceptar el cargo de defensor/a de {{IMPUTADO}} para el que fui designado/a en autos, jurando desempeñarlo conforme a derecho. Constituyo domicilio procesal en {{DOMICILIO_CONSTITUIDO}} y domicilio electrónico en {{DOMICILIO_ELECTRONICO}}. Solicito se me tenga por parte, se me notifique de todos los actos procesales y se me permita el ejercicio pleno de las facultades que la ley acuerda a esta parte, incluyendo el acceso irrestricto al legajo, la asistencia a todos los actos de la investigación y la proposición de prueba.

**Claves:** pedir expresamente notificación de audiencias y actos definitivos e irreproducibles; solicitar copia digital del legajo en el mismo acto.

---

## 2. Solicitud de vista del legajo y extracción de copias

**Suma:** SOLICITA VISTA Y COPIAS DIGITALES.
**Cuándo:** apenas asumida la defensa, o cada vez que se incorpora prueba relevante.
**Base normativa:** arts. 18 CN y 8.2.c CADH (tiempo y medios adecuados para la defensa); CPPF art. 60 y ss.; CPPN art. 204.

**Cuerpo tipo:**
> Que solicito se conceda vista del legajo de investigación por el término de {{PLAZO}} días y se autorice la extracción de copias digitales íntegras, incluyendo los legajos reservados, actas de secuestro, informes periciales y registros audiovisuales. El conocimiento oportuno e íntegro de la imputación y de la prueba en que se sustenta es condición de posibilidad del ejercicio de la defensa (art. 8.2.b y c CADH). La denegatoria o el acceso parcial importaría una restricción inconstitucional al derecho de defensa.

**Claves:** individualizar qué piezas faltan; si hay reserva, pedir que se explicite el fundamento y el plazo de la reserva.

---

## 3. Denuncia penal

**Suma:** FORMULA DENUNCIA PENAL.
**Cuándo:** inicio de la persecución a instancia de la víctima o de un tercero.
**Base normativa:** CPPF arts. 235/240; CPPN arts. 174/179.

**Cuerpo tipo:**
> Que vengo a formular denuncia penal contra {{DENUNCIADO}} —o contra quien resulte responsable— por los hechos que a continuación se relatan, que prima facie encuadran en el delito de {{DELITO}} (art. {{ARTICULO_CP}} del Código Penal).
> **II. Hechos.** El día {{FECHA_HECHO}}, siendo aproximadamente las {{HORA}}, en {{LUGAR}}, ocurrió lo siguiente: {{RELATO_CIRCUNSTANCIADO}}.
> **III. Prueba.** Ofrezco: documental ({{DOCUMENTOS}}); testimonial ({{TESTIGOS_CON_DATOS}}); informativa ({{INFORMES_A_SOLICITAR}}); pericial ({{PERICIAS}}).
> **IV. Medidas urgentes.** Solicito se disponga con carácter urgente {{MEDIDAS}}, bajo riesgo de pérdida o alteración de la evidencia.

**Claves:** relato circunstanciado en tiempo, modo y lugar; pedir preservación inmediata de evidencia digital y cámaras (las grabaciones se sobrescriben en días).

---

## 4. Constitución de parte querellante

**Suma:** SE PRESENTA COMO QUERELLANTE. SOLICITA SER TENIDO POR PARTE.
**Cuándo:** desde el inicio del proceso y hasta la clausura de la investigación preparatoria.
**Base normativa:** CPPF arts. 82/86; CPPN arts. 82/84; Ley 27.372 de derechos de la víctima.

**Cuerpo tipo:**
> Que vengo a constituirme en parte querellante en representación de {{VICTIMA}}, DNI {{DNI_VICTIMA}}, por resultar particularmente ofendido/a por el delito de {{DELITO}}. Acredito personería con {{PODER_O_ACTA}}. Se encuentran reunidos los requisitos legales: legitimación activa, individualización del hecho, del imputado y de la prueba. Solicito se me tenga por parte querellante, con las facultades de proponer diligencias, participar en los actos de la investigación, recurrir las decisiones que me causen agravio y formular acusación autónoma.

**Claves:** adjuntar poder especial o acta; solicitar expresamente notificación electrónica de todo acto; reservar el derecho a acusación autónoma.

---

## 5. Presentación espontánea del imputado

**Suma:** SE PRESENTA ESPONTÁNEAMENTE. SOLICITA SER OÍDO.
**Cuándo:** cuando el imputado toma conocimiento de una causa en su contra y quiere evitar la detención o aclarar su situación.
**Base normativa:** CPPF art. 63 y ss.; CPPN art. 279.

**Cuerpo tipo:**
> Que habiendo tomado conocimiento de la existencia de la presente causa, mi asistido se presenta espontáneamente ante V.S. a fin de aclarar los hechos y solicitar ser oído, poniéndose desde ya a disposición del tribunal y comprometiéndose a comparecer a toda citación que se le curse. Se acredita arraigo con {{DOCUMENTACION_ARRAIGO}}. Su comparecencia voluntaria desvirtúa por sí misma cualquier presunción de peligro de fuga.

**Claves:** la presentación espontánea es el mejor argumento anticipado contra el peligro de fuga; acompañar constancias de domicilio, trabajo y familia en el mismo acto.

---

## 6. Pronto despacho / urgimiento

**Suma:** SOLICITA PRONTO DESPACHO.
**Cuándo:** ante demora injustificada en resolver un planteo pendiente.
**Base normativa:** plazo razonable, arts. 18 CN, 7.5 y 8.1 CADH; CPPF arts. 2 y 118; CPPN art. 127.

**Cuerpo tipo:**
> Que habiendo transcurrido {{TIEMPO}} desde la presentación de fecha {{FECHA_PRESENTACION}} sin que se haya dictado resolución, vengo a solicitar pronto despacho. La dilación afecta la garantía de ser juzgado en un plazo razonable (CSJN, "Mattei", "Barra"; Corte IDH, "Suárez Rosero"). Hago reserva de recurrir por las vías que correspondan y de formular la denuncia administrativa pertinente.

**Claves:** consignar fechas exactas y fojas; el escrito es el sustento para una eventual queja por retardo de justicia.

---

# II. Libertad y medidas de coerción

## 7. Eximición de prisión

**Suma:** SOLICITA EXIMICIÓN DE PRISIÓN.
**Cuándo:** antes de la detención, ante temor fundado de ser privado de la libertad.
**Base normativa:** CPPF arts. 210/221 (medidas de coerción); CPPN arts. 316/319.

**Cuerpo tipo:**
> Que vengo a solicitar la eximición de prisión de mi asistido/a, quien teme fundadamente ser privado/a de su libertad en esta causa. La libertad durante el proceso es la regla y la coerción la excepción (arts. 18 CN, 9.3 PIDCP, 7.5 CADH). No concurren los riesgos procesales que habilitan la coerción: **(a) peligro de fuga:** arraigo acreditado —domicilio de {{ANTIGUEDAD}}, trabajo estable en {{TRABAJO}}, familia a cargo, carencia de pasaporte o recursos para eludir la acción de la justicia—; **(b) entorpecimiento de la investigación:** la prueba se encuentra ya producida y asegurada, no existiendo posibilidad material de influir sobre testigos o evidencia. La escala penal en abstracto no puede operar como presunción iuris et de iure de riesgo procesal ("Díaz Bessone", CNCP en pleno).

**Claves:** ofrecer caución en el mismo escrito; adjuntar informe socioambiental, certificado de trabajo y de domicilio.

---

## 8. Excarcelación

**Suma:** SOLICITA EXCARCELACIÓN.
**Cuándo:** con el imputado ya detenido, en cualquier estado del proceso.
**Base normativa:** CPPN arts. 316/317; CPPF arts. 210 y ss.; Ley 24.390.

**Cuerpo tipo:**
> Que vengo a solicitar la inmediata excarcelación de mi asistido/a, detenido/a desde el {{FECHA_DETENCION}}. **(i)** Los riesgos procesales deben verificarse en concreto y con prueba, no presumirse a partir del monto de la pena en expectativa ("Díaz Bessone"; CSJN "Loyo Fraire"). **(ii)** El arraigo está acreditado por {{PRUEBA_ARRAIGO}}. **(iii)** La investigación se encuentra sustancialmente completa: la prueba dirimente ya fue producida, de modo que no hay entorpecimiento posible. **(iv)** Existen medidas menos lesivas e igualmente idóneas (art. 210 CPPF): presentación periódica, prohibición de salida del país, caución, monitoreo electrónico. La prisión preventiva es la ultima ratio y debe superar los test de necesidad y proporcionalidad.

**Claves:** ofrecer subsidiariamente la alternativa menos gravosa; consignar el tiempo de detención cumplido y compararlo con la pena en expectativa de mínima.

---

## 9. Cese de prisión preventiva

**Suma:** SOLICITA CESE DE LA PRISIÓN PREVENTIVA.
**Cuándo:** al desaparecer o atenuarse los riesgos que la fundaron, o al exceder el plazo razonable.
**Base normativa:** Ley 24.390 (arts. 1 y 2); CPPF arts. 220/221; arts. 7.5 CADH y 9.3 PIDCP.

**Cuerpo tipo:**
> Que solicito el cese de la prisión preventiva que sufre mi asistido/a desde hace {{TIEMPO_DETENCION}}. **(i) Plazo:** se ha superado el plazo previsto por la Ley 24.390, sin que la complejidad de la causa ni la conducta de la defensa justifiquen la demora, imputable exclusivamente al órgano jurisdiccional. **(ii) Variación de circunstancias:** {{HECHO_NUEVO}} —producción completa de la prueba, cambio de calificación, oferta de domicilio y trabajo, estado de salud—. La prisión preventiva no puede convertirse en pena anticipada, lo que vulneraría el principio de inocencia (art. 18 CN).

**Claves:** discriminar el cómputo con precisión de días; identificar cuál de los fundamentos originales cayó y por qué.

---

## 10. Prisión domiciliaria

**Suma:** SOLICITA PRISIÓN DOMICILIARIA.
**Cuándo:** supuestos del art. 10 CP y art. 32 Ley 24.660 (mayor de 70, enfermedad, embarazo, madre/padre de menor de 5 años o de persona con discapacidad).
**Base normativa:** art. 10 CP; arts. 32/34 Ley 24.660; Ley 26.472; art. 3 Convención sobre los Derechos del Niño.

**Cuerpo tipo:**
> Que vengo a solicitar el arresto domiciliario de mi asistido/a, por encuadrar en el supuesto del art. 32 inc. {{INCISO}} de la Ley 24.660, conforme acredito con {{PRUEBA}}. El instituto no persigue beneficiar al interno sino tutelar bienes jurídicos de terceros o situaciones de vulnerabilidad que el encierro agrava de modo desproporcionado. En el caso, el interés superior del niño (art. 3 CDN) impone la solución domiciliaria. Se propone como domicilio {{DOMICILIO_PROPUESTO}}, con conformidad de {{TITULAR}} y ofrecimiento de {{REFERENTE_ADULTO}} como referente responsable, y se acepta el control por dispositivo electrónico y las visitas periódicas del patronato.

**Claves:** acompañar informe médico o partida de nacimiento, informe socioambiental del domicilio propuesto y conformidad escrita del titular del inmueble.

---

## 11. Morigeración de la coerción con dispositivo electrónico

**Suma:** SOLICITA MORIGERACIÓN. OFRECE MONITOREO ELECTRÓNICO.
**Cuándo:** como alternativa intermedia cuando el tribunal no concede la libertad plena.
**Base normativa:** CPPF art. 210 incs. a) a k); principio de proporcionalidad y subsidiariedad.

**Cuerpo tipo:**
> Que subsidiariamente, y para el supuesto de no hacerse lugar a la libertad, solicito la morigeración de la coerción mediante la aplicación de las medidas del art. 210 CPPF, ofreciendo: **(a)** dispositivo de monitoreo electrónico a cargo del Programa correspondiente; **(b)** presentación {{FRECUENCIA}} ante la autoridad que V.S. designe; **(c)** prohibición de salida del país con comunicación a Migraciones y retención del pasaporte; **(d)** prohibición de contacto con {{PERSONAS}}; **(e)** caución {{TIPO_CAUCION}}. El conjunto neutraliza en concreto los riesgos invocados con una injerencia notoriamente menor.

**Claves:** presentarlo siempre en subsidio del pedido principal; ofrecer un paquete de medidas acumuladas, no una sola.

---

## 12. Ofrecimiento y sustitución de caución

**Suma:** OFRECE CAUCIÓN. SOLICITA SUSTITUCIÓN POR CAUCIÓN JURATORIA.
**Cuándo:** al pedir la libertad, o cuando la caución real fijada resulta de cumplimiento imposible.
**Base normativa:** CPPN arts. 320/324; CPPF art. 210 inc. f).

**Cuerpo tipo:**
> Que vengo a ofrecer caución {{JURATORIA_PERSONAL_REAL}} y, en su caso, a solicitar la sustitución de la caución real fijada en {{MONTO}}, por resultar de imposible cumplimiento para mi asistido/a. La caución debe fijarse atendiendo a la situación patrimonial del imputado y no puede convertirse en una barrera económica que transforme la libertad en un privilegio de quienes tienen recursos, lo que importaría una discriminación contraria al art. 16 CN y al art. 24 CADH. Se acredita la situación económica con {{PRUEBA_ECONOMICA}}. Se ofrece como fiador/a a {{FIADOR}}, DNI {{DNI_FIADOR}}, quien acredita solvencia con {{DOCUMENTACION}}.

**Claves:** acompañar constancia de ingresos o de percepción de programas sociales; la desproporción de la caución es agraviante y recurrible.

---

## 13. Oposición a la prórroga de la prisión preventiva

**Suma:** SE OPONE A LA PRÓRROGA. SOLICITA LIBERTAD.
**Cuándo:** al correrse vista del pedido fiscal de prórroga del plazo de detención.
**Base normativa:** arts. 1 y 2 Ley 24.390; CPPF art. 221; Corte IDH, "Bayarri", "Suárez Rosero".

**Cuerpo tipo:**
> Que vengo a oponerme a la prórroga solicitada. La excepcionalidad del instituto exige que el Ministerio Público acredite **(i)** la especial complejidad del caso, **(ii)** la diligencia efectiva desplegada en la investigación y **(iii)** la subsistencia actual y concreta de los riesgos procesales. Nada de ello se verifica: la demora obedece a {{CAUSA_DEMORA}}, ajena a la conducta de esta defensa. La prórroga automática y fundada en la sola gravedad del delito convierte el encierro cautelar en pena anticipada.

**Claves:** demostrar inactividad del acusador con un cronograma de fojas y fechas; ese cuadro comparativo es lo que gana el planteo.

---

## 14. Levantamiento de embargo e inhibición general de bienes

**Suma:** SOLICITA LEVANTAMIENTO DE EMBARGO E INHIBICIÓN.
**Cuándo:** cuando la medida cautelar patrimonial es desproporcionada, recae sobre bienes ajenos o inembargables, o cesó su causa.
**Base normativa:** CPPN arts. 518/520; CPPF arts. 227 y ss.; arts. 219 CPCCN y ss. (supletorio); art. 17 CN.

**Cuerpo tipo:**
> Que solicito el levantamiento del embargo trabado sobre {{BIEN}} por la suma de {{MONTO}}. **(i)** El monto carece de fundamentación autónoma y no guarda proporción con el perjuicio verificado ni con las costas presumibles. **(ii)** El bien afectado {{ES_INEMBARGABLE/ES_DE_UN_TERCERO/ES_LA_VIVIENDA_UNICA}}, conforme acredito con {{PRUEBA}}. **(iii)** Subsidiariamente, ofrezco sustituir la cautelar por {{BIEN_SUSTITUTO}}, igualmente idóneo y menos gravoso, ya que la medida debe causar el menor perjuicio posible al afectado.

**Claves:** el embargo penal necesita fundamentación cuantitativa; atacar la falta de motivación del monto suele ser más eficaz que discutir el fondo.

---

# III. Prueba e investigación

## 15. Ofrecimiento de prueba en la etapa preparatoria

**Suma:** OFRECE PRUEBA. SOLICITA MEDIDAS DE INVESTIGACIÓN.
**Cuándo:** durante la investigación penal preparatoria, cuanto antes mejor.
**Base normativa:** arts. 18 CN y 8.2.f CADH; CPPF arts. 128/132; CPPN art. 199.

**Cuerpo tipo:**
> Que vengo a ofrecer la siguiente prueba, cuya producción resulta conducente y pertinente para el esclarecimiento de los hechos:
> **1. Testimonial:** {{TESTIGO}}, DNI, domicilio. *Objeto:* declarará sobre {{CIRCUNSTANCIA}}, lo que acredita {{PROPOSICION_FACTICA}}.
> **2. Documental:** se acompaña {{DOCUMENTO}} y se solicita su incorporación.
> **3. Informativa:** líbrese oficio a {{ORGANISMO}} a fin de que informe {{OBJETO}}.
> **4. Pericial:** {{TIPO_PERICIA}}, con los puntos de pericia que se detallan.
> La denegatoria de medidas conducentes propuestas por la defensa configura una restricción al derecho de defensa en juicio y habilita el planteo de nulidad, por lo que desde ya formulo reserva.

**Claves:** siempre fundar el *objeto* de cada medida (qué proposición fáctica prueba); sin eso, se deniega por "impertinente".

---

## 16. Solicitud de pericia y designación de perito de parte

**Suma:** SOLICITA PERICIA. PROPONE PUNTOS. DESIGNA PERITO DE PARTE.
**Cuándo:** cuando la prueba requiere conocimiento técnico (informática, contable, balística, médica, accidentología, psicológica).
**Base normativa:** CPPN arts. 253/267; CPPF arts. 165/169.

**Cuerpo tipo:**
> Que solicito se disponga pericia {{TIPO}} sobre {{OBJETO_A_PERITAR}}, designándose perito oficial del cuerpo correspondiente. Propongo como perito de parte a {{PERITO}}, {{TITULO}}, matrícula {{MATRICULA}}, con domicilio en {{DOMICILIO_PERITO}}, solicitando se lo notifique para la aceptación del cargo y se le permita participar de todas las operaciones técnicas. Solicito que no se realice la pericia sin previa notificación a esta parte, bajo pena de nulidad por afectación del control de la prueba (art. 18 CN).
> **Puntos de pericia propuestos:** 1) {{PUNTO_1}}; 2) {{PUNTO_2}}; 3) {{PUNTO_3}}; 4) toda otra circunstancia de interés que el experto observe.
> *Variante informática:* preservación forense con hash, cadena de custodia, imagen bit a bit del dispositivo, metadatos, integridad de los archivos, ausencia de manipulación.
> *Variante contable:* trazabilidad de las operaciones, correspondencia con la registración, determinación del perjuicio.

**Claves:** pedir siempre notificación previa; los puntos mal formulados condicionan todo el resultado del informe.

---

## 17. Solicitud de declaraciones testimoniales

**Suma:** SOLICITA CITACIÓN DE TESTIGOS.
**Cuándo:** para incorporar testigos de descargo o ampliar declaraciones existentes.
**Base normativa:** CPPN arts. 239/252; CPPF arts. 154/162; art. 8.2.f CADH.

**Cuerpo tipo:**
> Que solicito se cite a prestar declaración testimonial a {{TESTIGO}}, DNI {{DNI_TESTIGO}}, con domicilio en {{DOMICILIO_TESTIGO}}, quien depondrá sobre {{OBJETO}}. La declaración resulta dirimente porque {{FUNDAMENTO}}. Solicito asimismo se notifique a esta parte con antelación suficiente a fin de ejercer el derecho de interrogar y contrainterrogar, garantía expresamente reconocida por el art. 8.2.f CADH.
> *Variante ampliación:* solicito la ampliación de la declaración de {{TESTIGO}} de fs. {{FOJAS}}, por existir contradicciones con {{ELEMENTO}} que deben ser aclaradas.

**Claves:** aportar datos completos de localización; si el testigo no puede comparecer, ofrecer videoconferencia para evitar la denegatoria por razones prácticas.

---

## 18. Pedido de informes a organismos públicos y privados

**Suma:** SOLICITA SE LIBREN OFICIOS.
**Cuándo:** para obtener registros de terceros (bancos, telefónicas, ANSES, AFIP, Migraciones, empresas, hospitales).
**Base normativa:** CPPN art. 232 y ss.; CPPF art. 145 y ss.; Ley 25.326 en lo pertinente.

**Cuerpo tipo:**
> Que solicito se libren los siguientes oficios: **(1)** a {{ORGANISMO}}, a fin de que informe {{DATO_REQUERIDO}} correspondiente al período {{PERIODO}}; **(2)** a {{EMPRESA_TELEFONICA}}, a fin de que remita el detalle de llamadas y registro de antenas de la línea {{LINEA}}, con expresa autorización judicial por tratarse de datos protegidos; **(3)** a {{ENTIDAD}}, a fin de que acompañe {{DOCUMENTACION}}. Solicito se autorice a esta parte a diligenciar los oficios y se fije plazo perentorio de {{PLAZO}} días para su contestación, bajo apercibimiento de ley.

**Claves:** pedir la autorización para diligenciar; acelera meses el trámite. Especificar período y formato del dato requerido.

---

## 19. Solicitud de prueba anticipada

**Suma:** SOLICITA ANTICIPO JURISDICCIONAL DE PRUEBA.
**Cuándo:** ante riesgo de que la prueba se pierda o el testigo no pueda declarar en el debate.
**Base normativa:** CPPF arts. 156/158; CPPN art. 200 y ss.

**Cuerpo tipo:**
> Que solicito la producción anticipada de {{MEDIDA}}, por concurrir el supuesto de {{RIESGO}}: enfermedad terminal del testigo, inminente residencia en el extranjero, alteración del objeto o riesgo de destrucción de la evidencia. La medida se producirá con citación de todas las partes, bajo las formas del debate y con registro audiovisual íntegro, a fin de resguardar el contradictorio y la posterior incorporación por lectura o reproducción.

**Claves:** acreditar el riesgo con prueba documental (certificado médico, pasaje, informe técnico); sin eso se rechaza de plano.

---

## 20. Solicitud de careo

**Suma:** SOLICITA CAREO.
**Cuándo:** ante contradicciones sustanciales entre declaraciones sobre hechos dirimentes.
**Base normativa:** CPPN arts. 276/281; CPPF art. 163.

**Cuerpo tipo:**
> Que solicito se disponga careo entre {{PERSONA_A}} y {{PERSONA_B}}, por existir contradicción sustancial respecto de {{CIRCUNSTANCIA}}: mientras el primero sostiene que {{VERSION_A}}, el segundo afirma que {{VERSION_B}}. La discrepancia recae sobre un hecho decisivo para la resolución del caso y no puede ser dilucidada por otro medio.

**Claves:** transcribir las dos versiones enfrentadas con cita de fojas; evaluar el riesgo táctico antes de pedirlo si involucra al propio asistido.

---

## 21. Reconocimiento en rueda de personas: pedido e impugnación

**Suma:** SOLICITA RECONOCIMIENTO EN RUEDA / PLANTEA NULIDAD DEL RECONOCIMIENTO.
**Cuándo:** para asegurar la identificación con control, o para atacar un reconocimiento irregular (fotográfico, impropio o sugerido).
**Base normativa:** CPPN arts. 270/274; CPPF arts. 170/173.

**Cuerpo tipo (impugnación):**
> Que vengo a impugnar el reconocimiento practicado, por haberse realizado en abierta violación de las formas legales: **(i)** no se recibió previamente la descripción del sujeto por parte del reconocedor; **(ii)** la rueda se integró con personas de características notoriamente disímiles, tornando la elección inducida; **(iii)** se exhibieron fotografías del imputado con anterioridad al acto, contaminando irreversiblemente la memoria del testigo; **(iv)** no se notificó a la defensa, impidiendo el control del acto. Un reconocimiento así practicado carece de valor probatorio y es nulo de nulidad absoluta.

**Claves:** citar literatura sobre falibilidad de la identificación ocular; pedir la exclusión de todo lo derivado del reconocimiento viciado.

---

# IV. Escritos de la víctima y la querella

## 22. Solicitud de medidas urgentes por la querella

**Suma:** SOLICITA MEDIDAS URGENTES: ALLANAMIENTO, SECUESTRO Y GEOLOCALIZACIÓN.
**Cuándo:** al inicio, ante riesgo de pérdida de evidencia.
**Base normativa:** CPPN arts. 224/236; CPPF arts. 140/152.

**Cuerpo tipo:**
> Que solicito se disponga con carácter urgente: **(1)** allanamiento del inmueble sito en {{DIRECCION}}, con facultad de secuestro de {{ELEMENTOS}}; **(2)** secuestro y preservación forense de los dispositivos electrónicos allí hallados, con resguardo de la cadena de custodia; **(3)** oficio a {{EMPRESA}} para la preservación inmediata de las grabaciones de las cámaras de seguridad del período {{PERIODO}}, que son sobrescritas automáticamente en el término de días; **(4)** informe de geolocalización de la línea {{LINEA}}. La demora frustraría definitivamente la obtención de la evidencia.

**Claves:** fundar la urgencia con el plazo técnico real de conservación de cada registro.

---

## 23. Solicitud de medidas de protección para la víctima

**Suma:** SOLICITA MEDIDAS DE PROTECCIÓN.
**Cuándo:** casos de violencia de género, familiar, amenazas o riesgo de revictimización.
**Base normativa:** Ley 27.372 (arts. 5 y 6); Ley 26.485; Ley 24.417; Convención de Belém do Pará.

**Cuerpo tipo:**
> Que en representación de {{VICTIMA}} solicito se dispongan las siguientes medidas de protección: **(a)** prohibición de acercamiento del imputado a menos de {{METROS}} metros del domicilio, lugar de trabajo y establecimiento educativo; **(b)** prohibición de contacto por cualquier medio, incluidas redes sociales y terceras personas; **(c)** exclusión del hogar; **(d)** botón antipánico y consigna policial; **(e)** prohibición de portación de armas y comunicación al RENAR/ANMaC. Solicito asimismo que las declaraciones se reciban en Cámara Gesell o mediante mecanismos que eviten el contacto visual con el imputado, y que se informe a la víctima toda decisión sobre la libertad del acusado (art. 12 Ley 27.372).

**Claves:** pedir plazo de vigencia y mecanismo concreto de control; una medida sin control es papel.

---

# V. Nulidades, excepciones y garantías

## 24. Nulidad de allanamiento y regla de exclusión

**Suma:** PLANTEA NULIDAD DE ALLANAMIENTO Y DE LA PRUEBA DERIVADA.
**Cuándo:** cuando el ingreso al domicilio fue sin orden válida, sin consentimiento libre o excediendo el objeto de la orden.
**Base normativa:** arts. 18 y 19 CN; CPPN arts. 166/173 y 224; CPPF arts. 129/135; CSJN "Rayford", "Fiorentino", "Daray", "Quaranta".

**Cuerpo tipo:**
> Que vengo a plantear la nulidad del allanamiento practicado el {{FECHA}} y, por vía de consecuencia, de todos los actos que son su fruto. **(i) Vicio:** la orden careció de fundamentación suficiente / se ejecutó fuera del horario y del objeto autorizados / se ingresó sin orden invocando un consentimiento que no fue libre ni informado, prestado por quien se hallaba bajo coacción por la presencia de personal armado. **(ii) Consecuencia:** la prueba obtenida es ilícita y debe ser excluida del proceso (regla de exclusión). **(iii) Derivación:** conforme la doctrina del fruto del árbol venenoso, corresponde suprimir hipotéticamente el acto viciado; si sin él no se hubiese llegado a {{PRUEBA_DERIVADA}}, ésta también cae, por no existir un cauce de investigación independiente.
> Se impone la nulidad de orden absoluta por afectar garantías constitucionales, declarable de oficio y en cualquier estado del proceso.

**Claves:** el eje es el nexo causal; hay que reconstruir la cadena de hallazgos paso a paso y mostrar que sin el acto viciado la línea investigativa muere.

---

## 25. Nulidad de la declaración del imputado

**Suma:** PLANTEA NULIDAD DE LA DECLARACIÓN INDAGATORIA.
**Cuándo:** falta de intimación adecuada, ausencia de defensor, no información de derechos, o "declaraciones espontáneas" ante la policía.
**Base normativa:** art. 18 CN (nemo tenetur); CPPN arts. 294/298 y 167 inc. 3; CPPF arts. 64/71; art. 8.2.g CADH.

**Cuerpo tipo:**
> Que planteo la nulidad de la declaración de mi asistido/a de fecha {{FECHA}}. **(i)** No se le hizo saber en forma clara, previa y circunstanciada el hecho que se le atribuye ni la prueba obrante en su contra, tornando imposible el ejercicio del descargo. **(ii)** No se le informó su derecho a negarse a declarar sin que ello importe presunción en su contra. **(iii)** No contó con asistencia técnica previa y en privado con su defensor. **(iv)** En cuanto a las manifestaciones vertidas ante personal policial, carecen de todo valor: la incorporación de "dichos espontáneos" al proceso constituye un modo de eludir la prohibición legal de que la prevención reciba declaración al imputado, y viola la garantía contra la autoincriminación.

**Claves:** son nulidades absolutas; pedir también la exclusión de todo lo obtenido a partir de esos dichos.

---

## 26. Nulidad del requerimiento de elevación a juicio

**Suma:** PLANTEA NULIDAD DEL REQUERIMIENTO DE ELEVACIÓN A JUICIO.
**Cuándo:** al contestar la vista de la clausura de la instrucción.
**Base normativa:** CPPN arts. 347 y 349; CPPF art. 274; principio de congruencia.

**Cuerpo tipo:**
> Que vengo a plantear la nulidad del requerimiento fiscal de elevación a juicio. **(i) Falta de descripción clara, precisa y circunstanciada del hecho:** la pieza omite precisar {{ELEMENTO_FALTANTE}} —tiempo, modo, lugar o aporte concreto de mi asistido/a—, lo que impide conocer con exactitud la imputación y organizar la defensa. **(ii) Falta de fundamentación:** no se explicita la prueba en que se sustenta cada afirmación fáctica, remitiéndose a fórmulas genéricas. **(iii) Violación al principio de congruencia:** el hecho requerido difiere sustancialmente del intimado en la declaración del imputado, introduciendo circunstancias sobre las que jamás pudo defenderse.

**Claves:** confrontar en dos columnas el hecho intimado y el hecho requerido; la diferencia visual es el mejor argumento.

---

## 27. Excepción de falta de acción

**Suma:** OPONE EXCEPCIÓN DE FALTA DE ACCIÓN.
**Cuándo:** delito de instancia privada sin instancia válida, querella mal promovida, falta de legitimación, o desistimiento.
**Base normativa:** CPPN arts. 339 inc. 2 y 343; CPPF art. 34; art. 72 CP.

**Cuerpo tipo:**
> Que opongo excepción de falta de acción. El delito de {{DELITO}} es dependiente de instancia privada (art. 72 CP) y no obra en autos instancia válida de la persona legitimada, o bien ésta fue prestada por quien carece de legitimación. La ausencia de este presupuesto obsta al ejercicio de la acción penal y torna nulo todo lo actuado a partir de {{ACTO}}. Corresponde, en consecuencia, hacer lugar a la excepción y sobreseer a mi asistido/a.

**Claves:** verificar si hubo instancia expresa o solo denuncia informal; distinguir "falta de acción" de "falta de acción por prescripción", que va por otra vía.

---

## 28. Excepción de prescripción de la acción penal

**Suma:** OPONE EXCEPCIÓN DE PRESCRIPCIÓN. SOLICITA SOBRESEIMIENTO.
**Cuándo:** cumplido el plazo del art. 62 CP sin actos interruptivos válidos.
**Base normativa:** arts. 59 inc. 3, 62, 63 y 67 CP; CPPN art. 339 inc. 2; CSJN "Mattei", "Barra".

**Cuerpo tipo:**
> Que opongo excepción de prescripción de la acción penal. **(i) Cómputo:** el hecho se habría cometido el {{FECHA_HECHO}}; el delito de {{DELITO}} prevé pena máxima de {{PENA_MAXIMA}}, de modo que el plazo de prescripción es de {{PLAZO}} años. **(ii) Actos interruptivos:** los únicos actos con capacidad interruptiva son los taxativamente enumerados en el art. 67 CP; entre {{FECHA_A}} y {{FECHA_B}} transcurrió el plazo íntegro sin que se verificara ninguno de ellos —los simples actos de trámite, oficios y pedidos de informes carecen de esa aptitud—. **(iii)** Corresponde declarar extinguida la acción y sobreseer (art. 336 inc. 1 CPPN).

**Claves:** armar una tabla cronológica de actos interruptivos; el error típico del acusador es contar como interruptivos actos que no lo son.

---

## 29. Planteo de inconstitucionalidad

**Suma:** PLANTEA INCONSTITUCIONALIDAD DE {{NORMA}}.
**Cuándo:** cuando la aplicación de una norma al caso vulnera garantías constitucionales o convencionales.
**Base normativa:** arts. 31, 18 y 75 inc. 22 CN; control de convencionalidad, Corte IDH "Almonacid Arellano".

**Cuerpo tipo:**
> Que planteo la inconstitucionalidad del art. {{ARTICULO}} de {{NORMA}}, en cuanto su aplicación al caso resulta incompatible con {{GARANTIA}} (arts. {{ARTS_CN}} CN y {{ARTS_TRATADO}} CADH). **(i) Caso concreto:** la norma se aplica efectivamente a mi asistido/a y le causa el gravamen consistente en {{GRAVAMEN}}, de modo que existe un caso judicial actual. **(ii) Repugnancia manifiesta:** {{ARGUMENTO}}. **(iii)** La declaración es la ultima ratio, pero no existe interpretación posible que concilie la norma con el bloque de constitucionalidad. Se solicita se declare su inaplicabilidad al caso.

**Claves:** demostrar el gravamen concreto y actual, no abstracto; sin caso, se rechaza sin tratar el fondo.

---

## 30. Recusación

**Suma:** RECUSA CON CAUSA.
**Cuándo:** cuando concurre una causal objetiva que compromete la imparcialidad del juez o fiscal.
**Base normativa:** CPPN arts. 55/64; CPPF arts. 47/56; art. 8.1 CADH; CSJN "Llerena", "Dieser".

**Cuerpo tipo:**
> Que vengo a recusar con causa a {{MAGISTRADO}}, con fundamento en la causal prevista en el art. {{ARTICULO}} inc. {{INCISO}}: {{CAUSAL}}. La imparcialidad se analiza en su doble dimensión, subjetiva y objetiva; conforme la doctrina de "Llerena", basta con que existan elementos que autoricen a temer fundadamente la falta de imparcialidad, sin necesidad de acreditar parcialidad efectiva. En el caso, {{CIRCUNSTANCIA}} genera ese temor objetivamente fundado. Ofrezco como prueba {{PRUEBA}}.

**Claves:** la temporalidad es crítica: se recusa en la primera oportunidad procesal posterior al conocimiento de la causal, o precluye.

---

## 31. Planteo de incompetencia

**Suma:** PLANTEA INCOMPETENCIA. SOLICITA REMISIÓN.
**Cuándo:** cuando interviene un tribunal que no corresponde por materia, territorio o fuero.
**Base normativa:** CPPN arts. 39/47; CPPF arts. 41/46; art. 18 CN (juez natural).

**Cuerpo tipo:**
> Que planteo la incompetencia {{TERRITORIAL/MATERIAL/EN_RAZON_DEL_FUERO}} de V.S. Los hechos investigados ocurrieron en {{JURISDICCION}} y no afectan bienes ni intereses que habiliten la competencia de excepción del fuero federal, cuya interpretación es restrictiva. Corresponde, en consecuencia, declinar la competencia y remitir las actuaciones a {{TRIBUNAL_COMPETENTE}}, sin perjuicio de la validez de los actos ya cumplidos y de las medidas urgentes que deban adoptarse.

**Claves:** identificar el criterio atributivo (lugar de consumación, resultado, bien jurídico federal); en delitos a distancia y digitales, argumentar sobre el lugar del resultado.

---

## 32. Habeas corpus

**Suma:** INTERPONE ACCIÓN DE HABEAS CORPUS.
**Cuándo:** limitación o agravamiento ilegítimo de la libertad ambulatoria o de las condiciones de detención.
**Base normativa:** art. 43 CN; Ley 23.098; art. 7.6 CADH; CSJN "Verbitsky".

**Cuerpo tipo:**
> Que interpongo acción de habeas corpus {{REPARADOR/CORRECTIVO/PREVENTIVO}} a favor de {{PERSONA}}, alojado/a en {{LUGAR}}. **(i) Hecho:** {{DESCRIPCION}} —detención sin orden de autoridad competente, prolongación indebida, o agravamiento ilegítimo de las condiciones de detención consistente en {{AGRAVAMIENTO}}—. **(ii) Autoridad responsable:** {{AUTORIDAD}}. **(iii) Derecho:** la acción procede de modo expedito y rápido, con trámite urgente y de oficio. Solicito se fije audiencia inmediata, se requiera informe a la autoridad responsable en el plazo perentorio que se fije y se disponga {{MEDIDA}}, con constatación in situ por parte de V.S.

**Claves:** es de trámite urgentísimo y no requiere patrocinio; pedir siempre la audiencia y la inspección personal del juez.

---

# VI. Salidas alternativas y resolución anticipada

## 33. Solicitud de sobreseimiento

**Suma:** SOLICITA SOBRESEIMIENTO.
**Cuándo:** en cualquier estado de la instrucción, apenas la prueba permite descartar la imputación.
**Base normativa:** CPPN arts. 334/338; CPPF arts. 268/272.

**Cuerpo tipo:**
> Que solicito el sobreseimiento total y definitivo de mi asistido/a, por encuadrar el caso en el supuesto del art. 336 inc. {{INCISO}} CPPN: **inc. 2)** el hecho investigado no se cometió; **inc. 3)** el hecho no encuadra en figura legal alguna —atipicidad—; **inc. 4)** mi asistido/a no participó en él; **inc. 5)** media una causa de justificación, inculpabilidad o excusa absolutoria. La prueba producida —{{SINTESIS}}— no solo no acredita la imputación sino que la descarta positivamente. Solicito se deje expresa constancia de que la formación de la causa no afecta el buen nombre y honor del que gozare (art. 336 in fine).

**Claves:** el pedido debe apoyarse en prueba producida, no en la mera ausencia de prueba de cargo; pedir siempre la cláusula de honor.

---

## 34. Oposición a la elevación a juicio

**Suma:** SE OPONE A LA ELEVACIÓN A JUICIO. SOLICITA SOBRESEIMIENTO.
**Cuándo:** al contestar la vista del art. 349 CPPN.
**Base normativa:** CPPN arts. 349/351; CPPF arts. 279/280.

**Cuerpo tipo:**
> Que evacuando la vista conferida, me opongo a la elevación a juicio y solicito el sobreseimiento de mi asistido/a. **(i)** El requerimiento no supera el estándar de probabilidad positiva que exige la remisión a debate: se sustenta en {{PRUEBA_DEBIL}}, insuficiente para sostener una acusación. **(ii)** Existen hipótesis alternativas plausibles no descartadas: {{HIPOTESIS}}. **(iii)** Subsidiariamente, planteo la nulidad del requerimiento por los vicios señalados en el punto {{PUNTO}}. Someter a una persona a la publicidad y el desgaste del debate cuando la acusación es manifiestamente insuficiente vulnera el principio de inocencia y el derecho a un proceso sin dilaciones indebidas.

**Claves:** es la última chance de evitar el juicio: combinar oposición + nulidad + sobreseimiento en subsidio, en ese orden.

---

## 35. Suspensión del juicio a prueba (probation)

**Suma:** SOLICITA SUSPENSIÓN DEL JUICIO A PRUEBA. OFRECE REPARACIÓN Y TAREAS COMUNITARIAS.
**Cuándo:** delitos con pena de reclusión o prisión cuyo máximo no exceda de tres años, o supuestos de condena condicional posible.
**Base normativa:** arts. 76 bis, ter y quater CP; CSJN "Acosta"; Ley 27.147.

**Cuerpo tipo:**
> Que solicito la suspensión del juicio a prueba respecto de mi asistido/a. **(i) Procedencia:** conforme la tesis amplia consagrada por la CSJN en "Acosta", el instituto procede en tanto resulte procedente la condena de ejecución condicional, criterio que impone estar a la interpretación más favorable al imputado (principio pro homine). **(ii) Reparación:** ofrezco en concepto de reparación del daño la suma de {{MONTO}}, pagadera en {{FORMA_PAGO}}, en la medida de las posibilidades económicas de mi asistido/a, dejando a salvo el derecho de la víctima de reclamar en sede civil. **(iii) Reglas de conducta:** se ofrece fijar residencia, someterse al control del Patronato, realizar {{HORAS}} horas de tareas comunitarias no remuneradas en {{INSTITUCION}}, y {{REGLA_ADICIONAL}}, por el plazo de {{PLAZO}}. **(iv)** Mi asistido/a carece de antecedentes condenatorios computables, conforme surge del informe del RNR.

**Claves:** llevar la conformidad de la institución donde se harán las tareas y el ofrecimiento reparatorio cuantificado; sin eso la audiencia se cae.

---

## 36. Reparación integral del perjuicio

**Suma:** SOLICITA EXTINCIÓN DE LA ACCIÓN POR REPARACIÓN INTEGRAL.
**Cuándo:** delitos patrimoniales o de contenido económico, con acuerdo o consignación.
**Base normativa:** art. 59 inc. 6 CP (Ley 27.147); CPPF art. 34 inc. 4.

**Cuerpo tipo:**
> Que solicito se declare extinguida la acción penal por reparación integral del perjuicio (art. 59 inc. 6 CP). Se acompaña {{ACUERDO/CONSTANCIA_DE_PAGO/DEPOSITO}} por la suma de {{MONTO}}, que la víctima ha aceptado como reparación integral, según manifestación que se acompaña. La operatividad del instituto no depende de una reglamentación procesal ulterior: se trata de una causal de extinción de derecho de fondo, de aplicación inmediata y obligatoria, sin que la falta de recepción en el código procesal local pueda frustrar su aplicación, so pena de vulnerar el art. 31 CN.

**Claves:** conseguir manifestación expresa de conformidad de la víctima; si se niega, consignar judicialmente y argumentar suficiencia objetiva.

---

## 37. Conciliación / mediación penal

**Suma:** SOLICITA AUDIENCIA DE CONCILIACIÓN.
**Cuándo:** delitos de contenido patrimonial sin violencia sobre las personas o culposos, según la regulación local.
**Base normativa:** art. 59 inc. 6 CP; CPPF art. 34 inc. 6 y art. 22; leyes provinciales de mediación penal.

**Cuerpo tipo:**
> Que solicito se convoque a audiencia de conciliación con {{VICTIMA}}, por tratarse de un delito de contenido patrimonial cometido sin grave violencia sobre las personas. La resolución del conflicto por vías composicionales es un principio rector del proceso penal moderno, que privilegia la restauración del vínculo social y la satisfacción concreta del interés de la víctima por sobre la respuesta punitiva. Mi asistido/a manifiesta su voluntad de arribar a un acuerdo, ofreciendo {{PROPUESTA}}. Homologado el acuerdo y cumplido, corresponderá declarar extinguida la acción penal y sobreseer.

**Claves:** ir con una propuesta concreta y cumplible; los acuerdos incumplidos reactivan la acción y empeoran la posición.

---

## 38. Acuerdo de juicio abreviado

**Suma:** PRESENTA ACUERDO DE JUICIO ABREVIADO.
**Cuándo:** cuando existe acuerdo con el fiscal sobre hecho, calificación y pena.
**Base normativa:** CPPN art. 431 bis; CPPF arts. 323/325.

**Cuerpo tipo:**
> Que en los términos del art. {{ARTICULO}}, las partes vienen a presentar acuerdo de juicio abreviado. **(i) Hecho:** {{DESCRIPCION_ACORDADA}}. **(ii) Calificación:** {{CALIFICACION}}. **(iii) Pena acordada:** {{PENA}}, de cumplimiento {{CONDICIONAL/EFECTIVO}}, con más {{ACCESORIAS}}. **(iv) Conformidad:** el imputado presta su conformidad libre y voluntaria, habiendo sido informado por esta defensa del alcance del acuerdo, de la prueba de cargo, del derecho que le asiste a exigir un juicio oral y público y de las consecuencias de la renuncia a esa garantía, lo que declara comprender acabadamente. **(v)** Se deja constancia de que la conformidad recae también sobre la existencia del hecho y la participación.

**Claves:** documentar la voluntariedad con precisión; verificar antes el cómputo, la unificación con condenas previas y el impacto en la ejecución antes de firmar.

---

## 39. Criterio de oportunidad / archivo

**Suma:** SOLICITA APLICACIÓN DE CRITERIO DE OPORTUNIDAD.
**Cuándo:** hechos de insignificancia, pena natural, o pena que carece de relevancia frente a otra ya impuesta.
**Base normativa:** art. 59 inc. 5 CP; CPPF art. 31; regulaciones provinciales.

**Cuerpo tipo:**
> Que solicito la aplicación de un criterio de oportunidad y el consecuente archivo de las actuaciones, por concurrir el supuesto de: **(a) insignificancia** —la afectación al bien jurídico es mínima y no justifica el despliegue del aparato punitivo estatal—; **(b) pena natural** —mi asistido/a sufrió a consecuencia del hecho {{CONSECUENCIA}}, un padecimiento de tal gravedad que torna innecesaria y desproporcionada la aplicación de pena—; **(c) escasa relevancia de la pena en expectativa frente a la ya impuesta en la causa {{CAUSA}}. La persecución en el caso concreto resulta contraria a los principios de proporcionalidad, lesividad (art. 19 CN) y racionalidad de la respuesta penal.

**Claves:** acreditar la insignificancia con datos objetivos (monto, entidad del daño); en pena natural, prueba médica o pericial del padecimiento.

---

# VII. Etapa de juicio

## 40. Ofrecimiento de prueba para el debate

**Suma:** OFRECE PRUEBA PARA EL DEBATE.
**Cuándo:** al contestar la citación a juicio.
**Base normativa:** CPPN arts. 354/357; CPPF arts. 274/276.

**Cuerpo tipo:**
> Que en el término de la citación a juicio vengo a ofrecer la siguiente prueba:
> **Testimonial:** 1) {{TESTIGO}}, domicilio {{DOMICILIO}}. *Utilidad:* declarará sobre {{OBJETO}}, lo que resulta dirimente para acreditar {{TESIS_DEFENSIVA}}.
> **Pericial:** {{PERITO}}, quien se expedirá sobre {{OBJETO}}.
> **Documental:** se acompaña e instrumenta {{DOCUMENTOS}}, solicitando su exhibición en el debate.
> **Informativa:** oficio a {{ORGANISMO}}.
> **Instrumental:** se tenga presente la totalidad de las actuaciones.
> Solicito la citación de los testigos bajo apercibimiento de ser conducidos por la fuerza pública, y hago expresa reserva de ampliar el ofrecimiento y de oponerme a la incorporación por lectura de declaraciones no controladas por esta parte, lo que afectaría el derecho de interrogar a los testigos de cargo (art. 8.2.f CADH; CSJN "Benítez").

**Claves:** fundar la utilidad de cada testigo (no solo listar); la reserva contra la incorporación por lectura hay que dejarla planteada desde acá.

---

## 41. Cuestiones preliminares y nulidad en el debate

**Suma:** PLANTEA CUESTIONES PRELIMINARES.
**Cuándo:** en la apertura del debate, apenas abierta la audiencia.
**Base normativa:** CPPN art. 376; CPPF arts. 288/290.

**Cuerpo tipo:**
> Que en la oportunidad prevista para las cuestiones preliminares, esta parte plantea: **(i)** nulidad de {{ACTO}} por {{VICIO}}; **(ii)** oposición a la incorporación por lectura de {{PIEZA}}, por no haber sido controlada por la defensa y no configurarse ninguno de los supuestos de excepción; **(iii)** exclusión probatoria de {{ELEMENTO}} por ilicitud en su obtención; **(iv)** suspensión del debate por {{MOTIVO}}. Se hace expresa reserva de casación y del caso federal para el supuesto de rechazo.

**Claves:** si no se plantea acá, precluye; dejar siempre sentada la reserva del caso federal en el acta.

---

## 42. Unificación de penas y condenas

**Suma:** SOLICITA UNIFICACIÓN DE PENAS.
**Cuándo:** ante la existencia de condenas anteriores o concurso de causas.
**Base normativa:** arts. 55/58 CP.

**Cuerpo tipo:**
> Que solicito se proceda a la unificación de {{PENAS/CONDENAS}} recaídas en las causas {{CAUSAS}}, conforme el art. 58 CP. La pena única debe fijarse mediante el método composicional, valorando en conjunto la totalidad de los hechos y la personalidad del condenado, y no por simple suma aritmética de las penas parciales, cuyo resultado sería contrario a los principios de proporcionalidad y de humanidad de las penas (art. 5.2 CADH). Solicito se fije pena única de {{PENA_SOLICITADA}} y se practique el cómputo correspondiente, considerando el tiempo de detención cumplido.

**Claves:** revisar los cómputos previos antes de pedirlo; una unificación mal calculada puede empeorar la situación del condenado.

---

# VIII. Recursos

## 43. Recurso de reposición

**Suma:** INTERPONE RECURSO DE REPOSICIÓN. APELACIÓN EN SUBSIDIO.
**Cuándo:** contra decretos y providencias simples, dentro de los tres días.
**Base normativa:** CPPN arts. 446/448; CPPF arts. 353/354.

**Cuerpo tipo:**
> Que vengo a interponer recurso de reposición contra el decreto de fecha {{FECHA}}, que dispuso {{DECISION}}, y en subsidio apelación. **Agravio:** la decisión {{AGRAVIO}}, causando a esta parte un perjuicio de imposible reparación ulterior. **Fundamento:** {{ARGUMENTO}}. Solicito se revoque por contrario imperio y se disponga {{PETICION}}.

**Claves:** siempre con apelación en subsidio; el plazo es brevísimo.

---

## 44. Recurso de apelación

**Suma:** INTERPONE RECURSO DE APELACIÓN.
**Cuándo:** contra el auto de procesamiento, prisión preventiva, embargo, denegatoria de excarcelación, sobreseimiento o falta de mérito.
**Base normativa:** CPPN arts. 449/455; CPPF arts. 355/359.

**Cuerpo tipo:**
> Que vengo a interponer recurso de apelación contra el auto de fecha {{FECHA}}, que dispuso {{DECISION}}, por ser el mismo expresamente apelable y causar gravamen irreparable a esta parte.
> **Agravios:** **(1) Arbitrariedad en la valoración de la prueba:** el auto prescinde de prueba dirimente —{{PRUEBA_OMITIDA}}— y funda la decisión en una consideración parcial y sesgada de los elementos de cargo. **(2) Errónea aplicación de la ley sustantiva:** el hecho no encuadra en la figura de {{DELITO}} porque {{ARGUMENTO}}. **(3) Falta de fundamentación:** la resolución no constituye derivación razonada del derecho vigente conforme a las circunstancias comprobadas de la causa, requisito de validez de todo acto jurisdiccional (art. 123 CPPN).
> Se solicita se revoque la resolución y se disponga {{PETICION}}. Se mantiene la reserva del caso federal.

**Claves:** un agravio por vicio, cada uno con estructura *qué dijo el juez / por qué está mal / qué corresponde*; pedir audiencia de informe oral.

---

## 45. Recurso de casación / impugnación

**Suma:** INTERPONE RECURSO DE CASACIÓN.
**Cuándo:** contra sentencias definitivas y autos equiparables.
**Base normativa:** CPPN arts. 456/463; CPPF arts. 360/369; CSJN "Casal"; art. 8.2.h CADH.

**Cuerpo tipo:**
> Que interpongo recurso de casación contra la sentencia de fecha {{FECHA}}.
> **I. Admisibilidad:** se trata de sentencia definitiva; el recurso se interpone en término, por parte legitimada y con expresión concreta de motivos.
> **II. Motivos:** **(a) Inobservancia o errónea aplicación de la ley sustantiva** (inc. 1): {{ARGUMENTO}}. **(b) Inobservancia de normas procesales bajo pena de nulidad** (inc. 2): {{VICIO}}. **(c) Arbitrariedad y violación de las reglas de la sana crítica:** conforme la doctrina de "Casal", el tribunal revisor debe agotar el esfuerzo por revisar todo lo que resulte revisable, aplicando la teoría del máximo rendimiento; el estándar de la duda razonable no fue respetado, pues {{ARGUMENTO}}.
> **III. Solución que se propone:** casación de la sentencia y absolución, o reenvío para la realización de un nuevo juicio.
> **IV.** Se hace reserva del caso federal (art. 14 Ley 48) y de acudir a instancias internacionales.

**Claves:** vincular cada agravio a un motivo legal y a un pasaje textual de la sentencia; sin autosuficiencia, se declara inadmisible.

---

## 46. Recurso extraordinario federal

**Suma:** INTERPONE RECURSO EXTRAORDINARIO FEDERAL.
**Cuándo:** contra sentencia definitiva del superior tribunal de la causa que resuelve contra el derecho federal invocado.
**Base normativa:** art. 14 Ley 48; art. 257 CPCCN; Acordada CSJN 4/2007.

**Cuerpo tipo:**
> Que interpongo recurso extraordinario federal contra la sentencia de fecha {{FECHA}}.
> **I. Requisitos comunes:** existe cuestión justiciable, la sentencia emana del superior tribunal de la causa, es definitiva y el recurso se interpone en término.
> **II. Cuestión federal:** se ha puesto en tela de juicio la inteligencia de las cláusulas de los arts. {{ARTS}} CN y {{ARTS_CADH}} CADH, y la decisión ha sido contraria al derecho federal invocado.
> **III. Introducción oportuna y mantenimiento:** la cuestión fue introducida en {{OPORTUNIDAD}} y mantenida en todas las instancias.
> **IV. Relación directa e inmediata:** {{ARGUMENTO}}.
> **V. Arbitrariedad:** la sentencia prescinde del texto legal sin dar razones, omite el tratamiento de planteos conducentes y se funda en afirmaciones dogmáticas, descalificándose como acto jurisdiccional válido.
> **VI. Gravedad institucional** (si corresponde).
> Se acompaña carátula conforme Acordada 4/2007 y se respetan las limitaciones de extensión allí previstas.

**Claves:** cumplir la Acordada 4/2007 al pie (carátula, 40 páginas, 26 renglones, tipografía); el incumplimiento formal es la causa más común de rechazo.

---

## 47. Queja por recurso denegado

**Suma:** INTERPONE RECURSO DE QUEJA POR APELACIÓN/CASACIÓN/EXTRAORDINARIO DENEGADO.
**Cuándo:** dentro del plazo legal desde la notificación de la denegatoria.
**Base normativa:** CPPN arts. 476/478; art. 285 CPCCN; Acordada 4/2007.

**Cuerpo tipo:**
> Que vengo a interponer queja por denegación del recurso de {{RECURSO}}, resuelta el {{FECHA}}.
> **I. Antecedentes:** se acompañan copias de la resolución recurrida, del escrito recursivo, del auto denegatorio y de las constancias de notificación.
> **II. Crítica del auto denegatorio:** el rechazo se funda en {{FUNDAMENTO_DENEGATORIO}}, lo que constituye un exceso de rigor formal incompatible con la garantía del doble conforme (art. 8.2.h CADH; CSJN "Giroldi"). El a quo ha evaluado el mérito de los agravios, tarea vedada en el juicio de admisibilidad.
> **III.** Se solicita se declare mal denegado el recurso y se ordene su sustanciación.

**Claves:** la queja debe ser autosuficiente: el tribunal solo lee lo que se le acompaña.

---

# IX. Ejecución de la pena

## 48. Libertad condicional

**Suma:** SOLICITA LIBERTAD CONDICIONAL.
**Cuándo:** cumplidos los plazos del art. 13 CP con los requisitos reglamentarios.
**Base normativa:** arts. 13/17 CP; Ley 24.660 arts. 28 y ss.

**Cuerpo tipo:**
> Que solicito la libertad condicional de mi asistido/a, quien lleva cumplidos {{TIEMPO}} de la pena de {{PENA}} impuesta en autos, superando el plazo del art. 13 CP conforme el cómputo practicado a fs. {{FOJAS}}. Se han observado con regularidad los reglamentos carcelarios, según surge de los informes del establecimiento. Los informes criminológicos desfavorables no resultan vinculantes ni pueden fundar por sí solos la denegatoria, máxime cuando se apoyan en pronósticos abstractos de reincidencia; la finalidad de reinserción social de la pena (art. 5.6 CADH y art. 1 Ley 24.660) impone la interpretación más favorable a la progresividad del régimen. Se ofrece domicilio en {{DOMICILIO}} y se acompaña ofrecimiento laboral de {{EMPLEADOR}}.

**Claves:** adjuntar propuesta concreta de domicilio y trabajo; discutir los informes desfavorables punto por punto en vez de ignorarlos.

---

## 49. Salidas transitorias y régimen de semilibertad

**Suma:** SOLICITA INCORPORACIÓN AL RÉGIMEN DE SALIDAS TRANSITORIAS.
**Cuándo:** al alcanzar el período de prueba con la calificación requerida.
**Base normativa:** arts. 16/23 Ley 24.660.

**Cuerpo tipo:**
> Que solicito la incorporación de mi asistido/a al régimen de salidas transitorias, por reunir los requisitos temporales del art. 17 de la Ley 24.660, no registrar causa abierta con prisión preventiva ni sanciones disciplinarias, y contar con conducta {{CONDUCTA}} y concepto {{CONCEPTO}}. Se propone como referente y responsable a {{FAMILIAR}}, DNI {{DNI}}, domiciliado/a en {{DOMICILIO}}, y como frecuencia {{FRECUENCIA}}, con la finalidad de {{FINALIDAD: afianzamiento de lazos familiares / estudio / trabajo}}. La progresividad del régimen penitenciario no es una gracia sino un derecho que integra el contenido del principio de reinserción social.

**Claves:** conseguir el aval escrito del referente y constancia de estudio o trabajo antes de presentar.

---

## 50. Libertad asistida, cómputo y estímulo educativo

**Suma:** SOLICITA LIBERTAD ASISTIDA. IMPUGNA CÓMPUTO. SOLICITA APLICACIÓN DEL ESTÍMULO EDUCATIVO.
**Cuándo:** en los seis meses previos al agotamiento de la pena, o al practicarse el cómputo.
**Base normativa:** arts. 54/56 y 140 Ley 24.660; art. 24 CP.

**Cuerpo tipo:**
> **I. Libertad asistida.** Solicito la incorporación de mi asistido/a al régimen de libertad asistida, por encontrarse a {{TIEMPO}} del agotamiento de la pena. La denegatoria solo procede ante un riesgo grave y concreto para el condenado o la sociedad, debidamente fundado, sin que basten fórmulas rituales ni la mera invocación de la gravedad del delito por el que fue condenado, que ya fue valorada al imponer la pena.
> **II. Estímulo educativo.** Solicito la reducción de los plazos requeridos para el avance a través de las distintas fases del régimen, en razón de haber completado {{ESTUDIOS_CURSADOS}}, conforme el art. 140 de la Ley 24.660, correspondiendo una reducción de {{MESES}} meses.
> **III. Cómputo.** Impugno el cómputo practicado a fs. {{FOJAS}}, por no haberse considerado {{PERIODO}} de detención efectivamente sufrido, ni la aplicación del art. 24 CP. Solicito se practique nuevo cómputo.

**Claves:** los cómputos se hacen mal con frecuencia; recalcularlos día por día suele adelantar el egreso más que cualquier otro planteo.

---

## Anexo — Checklist antes de presentar

1. ¿El escrito es autosuficiente? ¿Se entiende sin leer todo el expediente?
2. ¿Está el plazo vigente? Contarlo en días hábiles judiciales y verificar la notificación.
3. ¿Se citó la prueba con foja o número de actuación digital?
4. ¿Se dejó reserva del caso federal y de instancias internacionales?
5. ¿Hay petitorio numerado y coherente con lo desarrollado?
6. ¿Se pidieron las medidas subsidiarias para el caso de rechazo del pedido principal?
7. ¿Firma, sello, domicilio electrónico y adjuntos en el formato que exige la mesa de entradas digital?
