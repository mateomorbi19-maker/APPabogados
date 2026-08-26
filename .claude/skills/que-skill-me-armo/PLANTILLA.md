# La ficha, y cómo se escribe la descripción

## El formato de la ficha

Una por cada skill recomendada. Corta: si no entra en una pantalla, sobra algo.

```
━━━ 1. informe-de-reunion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Lo hacés 4 veces por mes · te lleva 40 minutos · ya tenés el molde
Te devuelve: ~2 horas y media al mes, y deja de salir distinto cada vez

DESCRIPCIÓN (esto es lo que hace que se active)
  Arma el informe para el cliente a partir de la transcripción de una
  reunión: qué se prometió, qué decidimos y qué sigue. Usar cuando pida
  "el informe de la reunión con X", "pasá esta llamada a informe" o
  "mandale el resumen al cliente".

LOS PASOS (como me los contaste)
  1. Leés la transcripción entera
  2. Sacás lo que se prometió y con qué fecha
  3. Lo escribís en el molde, sin inventar nada que no se haya dicho
  4. Lo exportás y se lo mandás

ARCHIVOS AL LADO
  molde.html          el formato que ya usás
  ejemplo-bueno.md    uno viejo que te haya quedado bien

QUÉ CONVIENE QUE SEA CÓDIGO
  Pasar el HTML a PDF. Siempre igual, no hay nada que decidir.

QUÉ NECESITÁS A MANO ANTES
  El molde y una transcripción de una reunión ya hecha.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Y al final de todas, una línea sola: **"¿Arrancamos por la 1?"**.

---

## Cómo se escribe la descripción

Es lo único que Claude tiene prendido siempre, de todas las skills instaladas. Con eso
decide cuál usar. Una skill perfecta con una descripción floja **no se activa nunca**.

### Las cuatro reglas

**1. Va en tercera persona.** Se describe lo que la skill hace, no se le habla al usuario.

- ✅ "Arma el informe para el cliente a partir de la transcripción."
- ❌ "Te ayudo a armar informes." · ❌ "Usá esto para armar informes."

**2. Dice qué hace **y** cuándo se usa.** Las dos cosas. La mayoría escribe solo la primera
y por eso no se dispara.

- ✅ "Genera la cotización en PDF. Usar cuando pida un presupuesto para un cliente."
- ❌ "Genera cotizaciones."

**3. Lleva las palabras que la persona usa de verdad.** Acá está el 90% del acierto, y es
la parte que solo puede salir de la entrevista. Si dice "pasame esto a limpio", eso va escrito
adentro, aunque suene informal. Si dice "armame la propuesta", va "propuesta", no "documento
comercial".

- ✅ "…cuando diga 'armame la propuesta para X' o 'pasá esto a propuesta'."
- ❌ "…para tareas de documentación comercial."

**4. Es específica.** Las descripciones genéricas se activan en cualquier lado o en ninguno.

- ✅ "Extrae los precios de un PDF de proveedor y actualiza el catálogo."
- ❌ "Ayuda con archivos." · ❌ "Procesa datos."

### Un buen molde para arrancar

> `<qué hace, en tercera persona>. Usar cuando <situación concreta> o cuando la persona diga
> "<frase textual 1>", "<frase textual 2>", "<frase textual 3>".`

### Los límites que pide el formato

- `name`: minúsculas, números y guiones. Hasta 64 caracteres. No puede contener las palabras
  "claude" ni "anthropic".
- `description`: hasta 1.024 caracteres. Conviene usarlos: no es el lugar para ser breve.
- El cuerpo del SKILL.md, corto — si se va de las 500 líneas, lo largo va a un archivo al lado.

---

## Cómo queda el archivo

```markdown
---
name: informe-de-reunion
description: Arma el informe para el cliente a partir de la transcripción de una reunión...
---

# Informe de reunión

<una línea de para qué existe>

## El proceso
1. …
2. …

## Reglas
- Nunca inventar nada que no esté en la transcripción.
- Si falta un dato, preguntarlo antes de escribir.

## Archivos
- `molde.html` — el formato de salida
```

**Y lo que la vuelve buena con el tiempo:** cada vez que sale mal, se entra y se escribe la
regla que faltaba. Una skill no se termina de escribir el día uno; se afila usándola.
Las mejores tienen adentro frases como *"por acá no vayas, da error"* — eso no lo tiene
ninguna skill bajada de un mercado, porque esos errores los cometió esta persona y nadie más.
