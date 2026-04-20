# APPabogados — EstrategiaLegal

## Descripción del Proyecto
Aplicación web para abogados y estudios jurídicos argentinos. El usuario ingresa los hechos de un caso penal y, tras un pre-análisis dinámico que afina el contexto (jurisdicción, rol, etapa procesal, etc.), el sistema devuelve 3 estrategias legales (defensa, acusación o ambas), fundamentadas en el Código Penal argentino y manuales de litigación.

## Stack Tecnológico
- **Frontend:** `index.html` monolítico (HTML + CSS + JS inline), servido por Express (`server.js`). Deploy en Easypanel.
- **Backend/Orquestación:** n8n en `https://app-n8n.udmrwg.easypanel.host`.
- **Modelo de IA principal:** Claude Sonnet 4.5 (Anthropic) — vía nodo AI Agent (analizar-caso) y Basic LLM Chain (pre-analisis).
- **Embeddings:** OpenAI `text-embedding-3-small`.
- **Base de datos vectorial:** Supabase Vector Store (RAG con Código Penal + manuales de litigación).
- **Deploy:** EasyPanel — cada `git push` a `main` redeploya automáticamente.

## Flujo de la app (Sprint 2 — formulario dinámico)

1. **Paso 1**: el usuario describe el caso en un textarea y clickea "Continuar".
2. **Pre-análisis** — `POST /webhook/pre-analisis` con `{ caso }`. La IA devuelve:
   - `resumen_preliminar` — 2-3 oraciones para que el usuario confirme que la IA entendió bien.
   - `datos_detectados` — jurisdicción inferida, delitos posibles, hay_detenidos, etapa procesal.
   - `preguntas[]` — 3-6 preguntas dinámicas (`select`/`radio`/`text`/`checkbox`) con `valor_sugerido`, `requerido` y `motivo`.
3. **Paso 2**: el frontend renderiza el formulario dinámico. El usuario completa/ajusta y clickea "Analizar caso". Hay un botón "Volver" para editar el caso original.
4. **Análisis** — `POST /webhook/analizar-caso` con `{ caso, rol, contexto }`, donde `contexto` es `{id: valor}` con todas las respuestas del formulario. La IA devuelve estrategias.

El campo `rol` ya **no** es un selector separado: viene del formulario dinámico (pregunta con `id: "rol"`). Si el usuario no responde, el frontend manda `"ambos"` por default.

## Endpoints n8n

| Workflow | ID | Webhook | Método |
|---|---|---|---|
| `EstrategiaLegal - Pre-Análisis (Form Dinámico)` | `z5MiTcR3ymorKvxc` | `https://app-n8n.udmrwg.easypanel.host/webhook/pre-analisis` | POST |
| `EstrategiaLegal - Analizar Caso v3 (AI Agent)` | `a0owi3kHimKWtOFB` | `https://app-n8n.udmrwg.easypanel.host/webhook/analizar-caso` | POST |

### Request/response del pre-análisis

**Request**:
```json
{ "caso": "string (mínimo 20 chars)" }
```

**Response**:
```json
{
  "resumen_preliminar": "string",
  "datos_detectados": {
    "jurisdiccion_inferida": "string|null",
    "delitos_posibles": ["string"],
    "hay_detenidos": "Sí|No|null",
    "etapa_procesal": "string|null"
  },
  "preguntas": [
    {
      "id": "snake_case",
      "tipo": "select|radio|text|checkbox",
      "label": "string",
      "opciones": ["..."],
      "valor_sugerido": "string|null",
      "requerido": true,
      "motivo": "string"
    }
  ]
}
```

### Request del análisis

```json
{
  "caso": "string",
  "rol": "defensor|querellante|ambos",
  "contexto": {
    "jurisdiccion": "Entre Ríos",
    "hay_detenidos": "No",
    "etapa_procesal": "Investigación preliminar",
    "...otros campos del formulario": "..."
  }
}
```

El nodo **Validar Input** del workflow analizar-caso acepta `contexto` opcional. **Armar Prompt** lo inyecta en el prompt y agrega instrucciones específicas sobre código procesal según `contexto.jurisdiccion`:
- `Federal` → CPPF de la Nación
- `CABA` → CPP CABA
- Otra provincia → código procesal provincial correspondiente

### Response del análisis

```json
{
  "defensor": {
    "rol": "Defensor",
    "imputados_identificados": [],
    "delitos_imputables": [],
    "estrategias": [
      {
        "numero": 1,
        "nombre": "",
        "tesis_central": "",
        "fundamento_legal": [],
        "doctrina_aplicable": "",
        "fortalezas": [],
        "riesgos": [],
        "pasos_procesales": []
      }
    ]
  },
  "querellante": { /* misma estructura */ },
  "metadata": {
    "conceptos_extraidos": [],
    "articulos_consultados": [],
    "timestamp": ""
  }
}
```

## Workflow analizar-caso (interno)

Nodos:
1. **Webhook - Recibir Caso** (POST `/webhook/analizar-caso`)
2. **Validar Input** (Code) — valida `caso`, `rol`; normaliza `contexto`
3. **Armar Prompt** (Code) — inyecta contexto y arma prompt para el agente
4. **AI Agent - Análisis Legal** (`langchain.agent`) — Claude Sonnet 4.5 con tool de búsqueda vectorial
5. **Vector Store Tool** + **Supabase Vector Store** — RAG sobre código penal y manuales
6. **Parsear Resultado** (Code) — limpia y parsea JSON del agente
7. **Responder al Frontend** (RespondToWebhook)

## Workflow pre-analisis (interno)

Nodos:
1. **Webhook - Recibir Caso** (POST `/webhook/pre-analisis`)
2. **Armar Prompt** (Code) — valida caso, arma prompt con lista de provincias argentinas
3. **LLM Chain - Generar Preguntas** (`langchain.chainLlm`) — sin RAG, solo LLM directo
4. **Anthropic Chat Model** (Claude Sonnet 4.5)
5. **Parsear JSON** (Code) — limpia markdown y parsea JSON
6. **Responder al Frontend**

## Desarrollo local

```bash
npm install
npm start   # puerto 3000
```

`server.js` sirve `index.html` para cualquier ruta (SPA-style). No hay build.

## Deploy

- Repositorio: https://github.com/mateomorbi19-maker/APPabogados
- Branch deployable: `main`
- Trigger: cada push a `main` activa redeploy en EasyPanel

**Importante**: cualquier cambio se hace efectivo solo cuando se commitea y pushea a `main`. No hay staging.

## Estado Actual
- [x] Frontend con flujo de 2 pasos y formulario dinámico
- [x] Workflow `pre-analisis` creado y publicado
- [x] Workflow `analizar-caso` actualizado para aceptar `contexto`
- [x] Vector store con Código Penal argentino y manuales de litigación
- [x] Frontend deployado en Easypanel

## Convenciones y Decisiones Técnicas

- **Sin frameworks frontend**: todo va en `index.html`. No agregar React/Vue/etc.
- El agente hace **máximo 4 búsquedas vectoriales** por consulta.
- El prompt siempre exige **respuesta en JSON puro** (sin markdown ni backticks); el parser limpia backticks por las dudas.
- **CORS abierto** (`*`) en los webhooks de n8n.
- **Estilo visual**: paleta dark (fondos `#0a0e17`/`#0f172a`, acentos violeta `#8b5cf6`/`#6366f1`), fuentes IBM Plex + DM Serif Display.
- **URLs absolutas**: el frontend hace fetch directo a n8n.
