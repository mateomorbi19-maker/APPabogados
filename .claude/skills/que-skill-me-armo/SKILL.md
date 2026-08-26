---
name: que-skill-me-armo
description: Descubre qué skills le conviene crear a esta persona leyendo lo que ya le pidió a Claude Code, y las ordena por lo que más le devuelven. Escanea el historial local de pedidos (o mira la carpeta, o la entrevista), clasifica cada proceso repetido en skill / automatización / todavía no / no vale la pena, y devuelve las primeras con el nombre, la descripción ya escrita y qué parte conviene que sea código. Usar cuando la persona diga "qué skill me armo", "no sé qué automatizar", "por dónde empiezo con las skills", "qué proceso convierto en skill", "qué le puedo pedir a Claude", "tengo Claude Code y no sé para qué usarlo", "mirá lo que te vengo pidiendo", "analizá mi historial", "qué repito más", "ayudame a decidir qué automatizar", o cuando pida ayuda para elegir antes de escribir una skill.
---

# Qué skill me armo

Esta skill resuelve el paso que se saltea todo el mundo: **decidir qué convertir en skill**.
No escribe la skill final (para eso está `skill-creator`, de Anthropic). Lo que hace es mirar
cómo trabaja esta persona, encontrar los procesos que valen la pena y ordenarlos por lo que
le devuelven.

**La regla que manda sobre todo lo demás:** una skill guarda un proceso que la persona
**ya hizo al menos una vez, completo**. Si nunca lo hizo, no tiene un proceso: tiene una idea.
Nunca proponer una skill de algo que la persona todavía no hizo.

## Cómo hablarle

Esto lo va a usar gente que recién abre la terminal y también gente que programa hace años.
Por defecto, castellano simple y sin jerga: nada de "workflow", "pipeline" ni "output".
Se dice **proceso**, **paso**, **lo que sale al final**. Si la persona usa jerga, se le puede
seguir el idioma.

Nunca hablar de "optimizar tu productividad". Se habla de lo concreto: qué hace todos los días,
qué le lleva tiempo, qué le da fiaca.

## El proceso

### Paso 1 — Elegir cómo se junta la información

Ofrecer las tres, en este orden, y aclarar que se pueden combinar:

- **"Mirá lo que ya le pedí"** (la mejor, empezar ofreciendo esta): Claude Code guarda todo lo
  que le escribiste. Ahí está la verdad de qué repetís, sin depender de que te acuerdes.
  Se corre el script y sale la cuenta:

  ```bash
  python escanear.py --dias 90
  ```

  Opciones: `--proyecto .` para mirar solo esta carpeta, `--top 30` para ver más temas,
  y sin `--dias` para todo el historial. Si el archivo no está (por ejemplo porque usa Claude
  Code hace dos días), lo avisa y se sigue por las preguntas.

  **El script solo lee y cuenta, en la máquina de la persona.** No se conecta a internet,
  no manda nada y no escribe nada. Si pregunta, decírselo así, y ofrecerle leerlo: son
  200 líneas.

- **"Mirá cómo trabajo"**: mirar la carpeta en la que está parada — qué tipo de proyecto es,
  qué archivos se repiten, si hay un CLAUDE.md, qué carpetas de salida hay.
  **Solo si lo autoriza explícitamente, y solo la carpeta actual.** Nunca abrir archivos
  personales, credenciales ni `.env`.

- **"Contame"**: las preguntas de `PREGUNTAS.md`, de a poco.

Lo que mejor funciona es el combo: correr el escáner primero y usar lo que sale para
preguntar sobre algo concreto, en vez de preguntar en el aire.

### Paso 2 — Sacar la lista de candidatos

Objetivo: entre 5 y 12 procesos concretos, escritos como los diría ella.
"Le armo el presupuesto a un cliente nuevo" sirve. "Gestión comercial" no sirve.

**Si se corrió el escáner**, la salida trae los temas contados, con ejemplos textuales y
cuántas veces hubo que corregir. Cómo leerla:

- **Los "días distintos" importan más que el total.** Veinte pedidos en un solo día fue una
  tarde peleando con algo; ocho pedidos en ocho días distintos es una rutina — y las rutinas
  son las que se convierten en skills.
- **Las correcciones marcan lo que sale distinto cada vez.** Un tema con muchas es de los que
  más se agradecen: la skill no le ahorra tiempo, le ahorra el retrabajo.
- **Los temas se titulan con dos palabras y a veces se parten.** Si dos temas hablan
  claramente de lo mismo, unificarlos sin preguntar.
- **El script cuenta, no entiende.** Un tema repetido puede ser un proyecto que ya terminó,
  o algo que se hizo mucho una semana y nunca más. Preguntar antes de darlo por bueno:
  *"esto de los informes, ¿lo seguís haciendo o fue de esa época?"*.
- **Mirar también la lista de comandos que ya usa**: eso ya está resuelto y no se propone
  de nuevo. Si usa mucho uno propio, preguntarle qué le falta a ese, que suele ser mejor
  idea que armar uno nuevo.

**Si no se corrió**, las preguntas están en `PREGUNTAS.md`. No hacerlas todas de corrido como
un formulario: son seis, se hacen de a una o dos y se va tirando del hilo. Si una respuesta
trae algo jugoso, repreguntar antes de seguir.

Anotar de cada proceso, aunque sea a ojo:
- **cada cuánto** lo hace (por semana o por mes)
- **cuánto le lleva** cada vez
- **si ya lo hizo completo** alguna vez, o nunca
- **qué decide con la cabeza** en el medio (dónde hay criterio y no una regla fija)
- **qué le sale mal** cuando se lo pide a Claude sin nada preparado

### Paso 3 — Clasificar cada uno

Pasar cada candidato por el mapa de `CATEGORIAS.md`. Cada proceso cae en una de cuatro:

| | Qué es | Qué se hace |
|---|---|---|
| 🟢 **Skill ya** | Se repite, necesita criterio y ya lo hizo | Se arma ahora |
| 🔵 **No es skill, es automatización** | Siempre igual y podría correr sin nadie | Se le dice, y se le dice con qué |
| 🟡 **Todavía no** | Nunca lo hizo completo | Primero se hace una vez a mano |
| ⚪ **No vale la pena** | Pasa una vez cada tanto o se hace en dos minutos | Se descarta y se explica por qué |

**Decir las cuatro, no solo las verdes.** El valor de esto es tanto lo que conviene armar
como lo que conviene no armar: alguien que se ahorra tres skills inútiles ganó tiempo igual.

### Paso 4 — Ordenar por lo que devuelve

De las 🟢, ordenar por **cuánto le devuelve**, que es dos cosas multiplicadas:

```
veces por mes  ×  minutos que le lleva cada vez
```

y después ajustar con estas tres, en este orden:

1. **Lo que hoy sale mal** sube: si el resultado le sale distinto cada vez, la skill arregla algo
   que hoy le duele, no solo le ahorra tiempo.
2. **Lo que ya tiene los materiales** sube: si ya tiene el molde, la plantilla o los ejemplos,
   la skill sale en diez minutos.
3. **Lo que toca datos de verdad** baja un poco: no porque no valga, sino porque conviene
   arrancar por una donde equivocarse no cueste nada.

Nunca proponer más de cinco. **Tres bien elegidas es una mejor respuesta que diez.**

### Paso 5 — Entregar las fichas

Para cada skill recomendada, una ficha corta (el formato exacto está en `PLANTILLA.md`):

- **Nombre** en minúsculas y con guiones
- **La descripción ya escrita**, con las frases que la persona usa de verdad — esto es lo que
  decide si la skill se activa o no, así que sale de sus palabras, no de las nuestras
- **Los pasos** del proceso, como ella los contó
- **Qué archivos de apoyo** va a necesitar (el molde, los ejemplos, el contexto de su negocio)
- **Qué parte conviene que sea un script** y cuál conviene dejarle al criterio
- **Qué tiene que preparar** antes de armarla

### Paso 6 — Arrancar la primera

Ofrecer las dos vías, en este orden:

1. **"¿La hacemos ahora?"** — hacer el proceso una vez, juntos, de punta a punta.
   Cuando termina, se guarda como skill. Ese es el camino corto y el que sale mejor.
2. Si tiene `skill-creator` instalado, pasarle la ficha: ya lleva la intención, los pasos
   y la descripción, que es justo lo que esa skill pide al empezar.

Si no lo tiene y quiere instalarlo: `npx skills add anthropics/skills` y elegir `skill-creator`.

## Reglas duras

- **Nunca inventar un proceso.** Solo entran los que la persona nombró o los que se ven
  en la carpeta que autorizó.
- **Nunca proponer una skill de algo que nunca hizo completo.** Eso va a 🟡 Todavía no.
- **Si es determinista y corre sin nadie, decirlo.** Aunque quede menos vistoso, no es una skill.
- **Nunca más de cinco recomendaciones.**
- **Nunca leer nada que no haya autorizado**, y nunca credenciales ni archivos personales.
- Si la persona no puede nombrar **ni un** proceso repetido, no forzar: la respuesta honesta
  es "todavía no te hace falta ninguna, volvé cuando algo te canse de repetir".

## Archivos de esta skill

- `escanear.py` — lee el historial local de Claude Code y cuenta qué se pide más seguido
- `PREGUNTAS.md` — las seis preguntas de la entrevista, con lo que se busca en cada una
- `CATEGORIAS.md` — el mapa de decisión, con ejemplos de los cuatro colores
- `PLANTILLA.md` — el formato de la ficha y cómo se escribe una descripción que dispare
