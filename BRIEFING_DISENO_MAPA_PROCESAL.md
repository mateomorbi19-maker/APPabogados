# Briefing de rediseño — Mapa Procesal (EstrategiaLegal)

> **Para pegar en una sesión de diseño con Claude.** Este documento le da a la IA de diseño
> todo el contexto de una vista llamada **"mapa procesal"** que quiero rediseñar con una
> estética nueva. Voy a adjuntar además **capturas de pantalla** del estado actual.

---

## 0. Tu rol y lo que te pido

Sos un **diseñador de producto / dirección de arte** especializado en interfaces de datos
y visualización. Te voy a dar: (a) el contexto funcional del mapa, (b) lo que **debe seguir
comunicando** aunque cambie la estética, (c) la colorimetría y el lenguaje visual **actual**
(punto de partida que se puede reemplazar entero), (d) las **libertades y restricciones
técnicas** reales, y (e) capturas.

**Quiero que me ayudes a encontrar una estética NUEVA y bastante diferente para el mapa.**
Al final del documento está el detalle de qué entregar, pero en resumen: dirección visual,
paleta concreta (con hex), tratamiento de nodos/conexiones/fondo, y motion — todo mapeado a
la semántica que describo abajo, y teniendo en cuenta que después esto lo implementa otra IA
en el código real (así que necesito valores concretos, no solo vibras).

---

## 1. Qué es la app (contexto mínimo)

**EstrategiaLegal** es una herramienta web interna para **3 abogados penales argentinos**.
Beta privada, en español (es-AR). Sirve para analizar casos penales con IA, guardar casos,
agenda, y el **mapa procesal**. Stack: Next.js 16 + React 19, Tailwind v4, shadcn/ui,
**dark-only** (siempre tema oscuro), fuentes **Inter** (texto) y **Space Grotesk** (títulos),
acento de marca **violeta `#8b5cf6`**. El canvas del mapa usa **React Flow (@xyflow/react)**.

**DATO CLAVE — el mapa tiene libertad visual casi total.** El resto de la app vive en un
marco compartido (topbar + sidebar). **El mapa NO**: se monta *full-screen en su propia ruta,
fuera del layout global*, como una **vista inmersiva soberana**. Puede tener su propio fondo,
su propia toolbar y su propio lenguaje de color/animación **sin romper el resto de la app**.
Lo único que conviene conservar por coherencia de marca es el **acento violeta** y las
**tipografías** (Inter / Space Grotesk). Todo lo demás es negociable, incluido el fondo (que
ya hoy se despega del resto).

---

## 2. Qué es el mapa procesal (funcional)

Es el **grafo del recorrido judicial de un caso penal**, dibujado como un **árbol vertical**
que fluye de **arriba (origen del caso) hacia abajo (etapas sucesivas y desenlaces)**.

- Cada **nodo** es un momento/etapa/desenlace del proceso: "Investigación", "Prisión
  preventiva", "Juicio Oral", "Absolución", "Condena", etc.
- Las **conexiones** (edges) son relaciones padre→hijo: cada etapa es hija de la anterior, y
  los desenlaces cuelgan como hojas.
- Cada caso instancia una de **3 plantillas** según el **fuero** (Nación / Provincia de Buenos
  Aires / Federal). Las 3 comparten la misma gramática visual; cambian los nombres del flujo.
- El abogado **marca nodos como ocurridos** a medida que el caso avanza en la realidad, y
  puede **simular con IA** cómo podría seguir (ramas hipotéticas).
- Es una herramienta de **trabajo diario y lectura rápida**: el abogado tiene que entender el
  estado del caso *de un vistazo*, sin leer todos los textos.

**Interacción actual (estilo n8n):** arrastrar en vacío = caja de selección; Ctrl+arrastre =
mover el tablero (pan); rueda = zoom; Shift+click = multiselección; Supr = borrar; hay
Deshacer, Reordenar (auto-layout) y un panel lateral de detalle al clickear un nodo.

---

## 3. ⚠️ Lo que el mapa DEBE comunicar (semántica intocable)

**Esto es lo más importante del briefing.** La estética puede cambiar por completo —colores,
formas, tipografía, animación—, pero **cada uno de estos significados tiene que sobrevivir**.
Antes de tocar un elemento, preguntate: *"¿esto sigue permitiendo distinguir de un vistazo lo
que ya pasó, lo posible, lo peligroso y la encrucijada — y sigue separando el eje 'estado' del
eje 'etapa'?"*.

### 3.1. Los 4 ESTADOS (el corazón — hoy = los 4 colores del nodo)
El abogado tiene que separar **instantáneamente, sin leer texto**, cuatro categorías:

| Categoría | Hoy | Significa |
|---|---|---|
| **Ejecutada** | verde | Ya ocurrió — hecho consumado de la línea de tiempo real del caso. |
| **Posible** | azul | Futuro neutro disponible — un camino abierto, sin carga. (Es la mayoría del mapa al arrancar.) |
| **Riesgo alto** | rojo | Peor desenlace para el imputado (p. ej. prisión preventiva, condena). La alarma. |
| **Decisión pendiente** | amarillo | Bifurcación abierta — una encrucijada donde el caso puede irse por varias ramas y aún no se decidió. |

Las 4 deben quedar **mutuamente inconfundibles** (pensá también en daltonismo y pantallas
malas: no las apoyes *solo* en el matiz).

### 3.2. La PRECEDENCIA (regla dura, no invertir)
Un nodo puede cumplir varias condiciones a la vez; el color se decide en este orden estricto:

> **Ejecutada (verde) › Riesgo (rojo) › Decisión (amarillo) › Posible (azul)**

- **Lo ya ocurrido gana siempre.** Consecuencia contraintuitiva pero **obligatoria**: un
  desenlace de riesgo que **efectivamente se materializó** (una "Condena" que sucedió) se
  muestra **verde, no rojo**. El rojo es una advertencia sobre un *futuro posible*; una vez que
  ese futuro se hace realidad, pasa a ser hecho consumado. **No "corrijas" esto pintando de
  rojo los riesgos ya ocurridos.**
- El rojo describe **futuros peligrosos no realizados**; el verde, **el pasado real recorrido**;
  el azul, **el futuro neutro**.

### 3.3. Matices a respetar
- **El amarillo (decisión) es derivado y transitorio:** aparece/desaparece solo según cambia
  el caso (cuando alguien toma una de las ramas, la encrucijada se resuelve y el amarillo se
  va). No es un estado fijo. Debe distinguirse tanto del rojo como del azul.
- **El rojo es SOLO para lo adverso al cliente.** Nunca para desenlaces favorables
  (sobreseimiento, absolución, probation jamás llevan rojo).
- **El tamaño codifica jerarquía, aparte del color:** el nodo **raíz** (origen del caso) es el
  **más grande**; los **bloqueados/inactivos**, los **más chicos**. No mezclar esta señal con
  el color.
- **Las conexiones NO son decorativas: llevan estado.** Cada línea se pinta con un **degradé
  del color del nodo origen al del destino**. El camino que lleva a un riesgo debe *sentirse*
  distinto del que lleva a un desenlace favorable. Poner todas las líneas de un gris plano
  **borraría información**.
- **La forma de árbol comunica el proceso:** tronco vertical de arriba (origen) hacia abajo
  (etapas), con desenlaces colgando como hojas. Las bifurcaciones (etapas con 2+ hojas) son
  donde nace el amarillo.

### 3.4. Segundo eje de color: las 6 ETAPAS (independiente del estado)
Además del estado, cada nodo pertenece a una de **6 macro-fases** del proceso penal, comunes a
los 3 fueros. Hoy se muestran como un **chip numerado** (1-6) arriba del nodo, **no** como el
color del orbe:

| # | Etapa | Color hoy |
|---|---|---|
| 1 | Inicio del proceso | rojo ladrillo `#d4553e` |
| 2 | Investigación | azul acero `#4a7fb5` |
| 3 | Etapa intermedia | teal `#3fa89c` |
| 4 | Juicio | verde `#6bbf5a` |
| 5 | Recursos e impugnaciones | violeta `#8a6fc9` |
| 6 | Ejecución | naranja `#d98a3d` |

**Punto crítico y fácil de romper:** *estado* (4 colores) y *etapa* (6 colores) son **dos
canales que conviven sobre el mismo nodo, en superficies distintas** (orbe = estado, chip =
etapa). Y la paleta de etapas **pisa** matices del sistema de estado (etapa 1 = rojo, etapa 4 =
verde). Hoy no confunde *solo porque viven en superficies separadas*. **Si tu rediseño fusiona
el color de etapa dentro del orbe, la etapa-1 "roja" chocaría con "rojo = riesgo" y la etapa-4
"verde" con "verde = ejecutado".** Mantené los dos ejes visualmente separables (o rediseñá la
paleta de etapas para que no colisione).

---

## 4. Colorimetría y lenguaje visual ACTUAL (punto de partida — reemplazable)

> Todos los valores son **literales del código**. Es el estado que verás en las capturas.
> No estás obligado a conservar ninguno: es tu línea de base para proponer algo distinto.

### 4.1. Superficies base (dark-only)
- Fondo real de la app: **`#08080c`** (`--el-canvas`, casi negro frío). Cards **`#20202e`**,
  sidebar **`#16161f`**. Bordes: blanco translúcido **`rgba(255,255,255,0.13)`**.
- Texto: **`#f5f5f8`** / secundario **`#a2a2b2`** / terciario **`#85858f`**.
- Acento marca (violeta): **`#8b5cf6`** · claro **`#a78bfa`** · CTA **`#7c5cfc`**.

### 4.2. Fondo del canvas del mapa (ya tiene identidad propia)
- **Degradado radial**: `radial-gradient(ellipse 70% 55% at 50% 38%, #12121c 0%, #0a0a10 55%, #08080c 100%)` — más claro al centro, oscurece a los bordes.
- **Grilla de puntos** casi imperceptible encima: color `rgba(255,255,255,0.035)`, cada 24px.
- Sobre eso flotan **partículas** violetas (ver 4.5).

### 4.3. Nodos = "orbes" (círculos con glow). Los 4 estados:
| Estado | Acento | Relleno (radial) | Borde | Glow / animación |
|---|---|---|---|---|
| **Ejecutada** (verde) | `#34d399` | `#0b5a43 → #073d2e` | 2px `#34d399` | glow verde multicapa hasta ~46px, **estático** |
| **Posible** (azul) | `#60a5fa` | `#1c1c28 → #14141c` (gris) | 1.5px `rgba(96,165,250,.4)` | sin halo externo, **opacidad 0.52** (0.85 al hover) — "fantasmal" |
| **Decisión** (ámbar) | `#fbbf24` | `#5a4410 → #3d2e07` | 2px `#fbbf24` | **pulsa** (box-shadow, ciclo 2.1s) |
| **Riesgo** (rojo) | `#f87171` | `#5a1818 → #3d0e0e` | 2px `#f87171` | **pulsa más rápido** (ciclo 1.7s) |

- Íconos (lucide, lineales) y labels de texto usan tonos pastel del mismo color: ícono
  ejecutada `#6ee7b7` / label `#a7f3d0`; posible `#93b4e8` / `#8fa3c4`; decisión y riesgo
  `#fcd34d` y `#fca5a5` respectivamente.
- **Tamaños:** raíz **76px**, estándar **66px**, bloqueado **56px**. Separación entre nodos:
  **170px vertical**, **130px horizontal** (amplia, para que los glows no se pisen).
- **Anatomía de un nodo:** orbe circular + ícono al centro + **chip numerado de etapa**
  (arriba-izq, 18px, color de las 6 etapas) + **badge de check verde** (arriba-der, solo si ya
  ocurrió) + **label de texto debajo** (2 líneas máx). Selección = outline violeta `#a78bfa`.

### 4.4. Conexiones (edges)
Curva bezier con **dos trazos** superpuestos: un **halo** ancho translúcido (6px, opacidad 0.2)
+ un **"flujo"** fino punteado (2px, dash `5 7`, opacidad 0.8) con **energía animada bajando**
(dash que se desplaza, ciclo 0.9s). Color = **gradiente del color de estado del nodo origen al
del destino** (mismos 4 hex). Flecha (punta) = estilo default de la librería.

### 4.5. Partículas y motion
- **18 partículas** violetas (`rgba(167,139,250,.5)`, 3px) que **suben ~90px** con fade
  in/out, en 5-11s, para dar profundidad.
- Motion global: glow estático (ejecutada), **pulsos** (decisión/riesgo), **dash animado** en
  las líneas, partículas flotando. **Todo se apaga con `prefers-reduced-motion`** (accesibilidad
  — mantené este comportamiento si agregás animaciones).

**Resumen de la vibra actual:** *"skill-tree / constelación sci-fi"* — orbes con glow de neón
sobre un fondo negro-azulado con partículas, energía fluyendo por las líneas, acento violeta.
Es hacia lo que quiero **cambiar** (o evolucionar): sentite libre de proponer algo bien distinto
(editorial, brutalismo, blueprint técnico, papel/expediente, minimal data-viz, lo que sea).

---

## 5. Libertad vs restricciones técnicas (para que propongas algo implementable)

**Libertad total (fácil de implementar, es "nuestro" CSS/tokens):**
- Toda la paleta, el relleno/borde/glow/pulso de los nodos, forma y tamaño de los orbes, el
  color/ícono/label, el chip de etapa, el badge de check, la selección.
- Las conexiones: ancho, opacidad, tipo de curva (bezier/step/recta), color, animación, y se
  puede definir una flecha propia.
- El fondo del canvas (degradado, grilla, o imagen/textura), las partículas (cantidad, color,
  trayectoria, o eliminarlas), toda la toolbar y el panel lateral (son componentes shadcn), las
  pantallas de carga/vacío.
- Tipografía: cualquier fuente vía `next/font` (hoy Inter + Space Grotesk).

**Restricciones reales a tener en cuenta:**
- **Es dark-only hoy.** Si proponés una estética **clara** (tipo papel/expediente, que sería
  muy coherente con lo penal), es **posible** pero implica más trabajo: hay que desmontar el
  supuesto de tema oscuro. Decilo explícito si vas por ahí, y aclará si el mapa sería claro
  mientras el resto de la app sigue oscuro (se puede, porque el mapa es soberano).
- **Chrome de la librería (React Flow) que hoy desentona** y que conviene rediseñar: los
  **controles de zoom** (botones default de la librería), la **caja de selección** (azul
  default) y la **flecha** de las conexiones. Se pueden re-estilar, pero requieren CSS
  específico o reemplazarlos por componentes propios. No es bloqueante, es trabajo extra.
- **Cambiar el paradigma de layout** (hoy: árbol vertical con auto-layout dagre) a algo radial,
  horizontal, o una "línea de tiempo" que scrollea (como un expediente) es **posible** pero es
  un cambio grande. Si tu propuesta lo requiere, marcalo como decisión mayor.
- **No usar canvas/WebGL exótico salvo que aporte mucho**: es una app real, se puede, pero
  sumá complejidad solo si la estética lo justifica.
- **Rendimiento y densidad:** un mapa puede tener ~15-40 nodos. La estética tiene que aguantar
  eso sin volverse ruido (glows que se pisan, demasiada animación).

---

## 6. Qué te pido que entregues

Con este contexto + las **capturas que adjunto**, proponeme una **dirección estética nueva
para el mapa procesal**. Idealmente:

1. **Concepto / dirección** (1 párrafo): la metáfora o el mundo visual (ej: "expediente
   forense", "blueprint de arquitecto", "constelación", "editorial suizo", "brutalismo
   judicial"…). Podés ofrecer **2-3 direcciones distintas** para que elija.
2. **Paleta concreta con hex**, mapeada explícitamente a:
   - las **4 categorías de estado** (ejecutada / posible / riesgo / decisión) — respetando que
     tienen que ser inconfundibles y respetar la precedencia,
   - las **6 etapas** (y cómo evitás que choquen con los colores de estado),
   - **superficies** (fondo del canvas, nodo, panel, bordes, texto), y el **acento** (idealmente
     conservando o dialogando con el violeta de marca `#8b5cf6`).
3. **Tratamiento del nodo**: forma (¿sigue siendo círculo/orbe? ¿tarjeta? ¿pastilla? ¿otra
   cosa?), cómo expresa cada estado, cómo integra el ícono, el label, el chip de etapa y el
   estado "ya ocurrido" — sin perder la jerarquía por tamaño (raíz grande, etc.).
4. **Tratamiento de las conexiones**: cómo se ven las líneas y cómo transmiten el estado
   origen→destino (recordá: no pueden ser un gris plano).
5. **Fondo y profundidad**: qué reemplaza al degradado + partículas actuales.
6. **Motion**: qué se mueve y qué no (respetando `prefers-reduced-motion`). Menos puede ser
   más.
7. **Cómo tratás el chrome que desentona** (controles de zoom, caja de selección, flecha).

**Importante para el hand-off:** esto lo va a implementar después otra IA en el código real
(Next + Tailwind + React Flow), así que **dame valores concretos** (hex, tamaños, grosores,
timings) y no solo descripciones. Cuanto más preciso, mejor sale.

---

### Apéndice — invariantes en una línea (checklist para no romper nada)
1. 4 estados inconfundibles de un vistazo (ejecutado / posible / riesgo / decisión).
2. Precedencia verde › rojo › amarillo › azul; **lo ocurrido gana siempre** (riesgo cumplido = verde).
3. Rojo solo para desenlaces adversos al cliente.
4. Amarillo (decisión) = derivado y transitorio, distinto de rojo y azul.
5. Estado (orbe) y etapa (chip) = dos ejes de color separables, sin colisión.
6. Tamaño codifica jerarquía (raíz grande / bloqueado chico), aparte del color.
7. Las conexiones llevan el estado origen→destino (no gris plano).
8. Árbol vertical arriba→abajo con desenlaces como hojas; las bifurcaciones generan el amarillo.
9. Acento violeta y tipografías (Inter / Space Grotesk) como puente con la marca.
10. Respetar `prefers-reduced-motion`.
