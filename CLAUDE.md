# APPabogados - EstrategiaLegal

## Descripción del Proyecto
Aplicación web para abogados y estudios jurídicos argentinos. El usuario ingresa los hechos de un caso penal y el sistema devuelve 3 estrategias legales posibles (defensa, acusación, o ambas), fundamentadas en el Código Penal argentino y manuales de litigación.

## Stack Tecnológico
- **Frontend:** App web deployada en Easypanel (https://app-abogados-bogas.i45nua.easypanel.host)
- **Backend/Orquestación:** n8n (https://n8n.teotec.org)
- **Modelo de IA principal:** Claude Sonnet (Anthropic) — nodo AI Agent
- **Embeddings:** OpenAI text-embedding-3-small
- **Base de datos vectorial:** Supabase Vector Store (RAG con Código Penal + manuales de litigación)
- **Integración:** Claude conectado a n8n via API y MCP

## Flujo n8n — "EstrategiaLegal - Analizar Caso v3"
El flujo recibe un POST desde el frontend y sigue estos pasos:
1. **Webhook** (`/webhook/analizar-caso`) — recibe `{ caso: string, rol: 'defensor'|'querellante'|'ambos' }`
2. **Validar Input** — verifica que lleguen ambos campos
3. **Armar Prompt** — construye el prompt según el rol elegido
4. **AI Agent (Claude Sonnet)** — busca en el vector store y genera las estrategias
5. **Vector Store Tool** — busca artículos y doctrina en Supabase (RAG)
6. **Parsear Resultado** — limpia y parsea el JSON devuelto por el agente
7. **Responder al Frontend** — devuelve el JSON final

## Estructura del Response
El agente devuelve JSON con esta forma:
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

## Estado Actual
- [x] Flujo n8n funcionando en producción
- [x] Claude conectado via API y MCP
- [x] Vector store con Código Penal argentino y manuales de litigación
- [x] Frontend deployado en Easypanel
- [ ] (completar con lo que falta)

## Convenciones y Decisiones Técnicas
- El agente hace máximo 4 búsquedas vectoriales por consulta
- El prompt siempre exige respuesta en JSON puro (sin markdown ni backticks)
- El parser tiene 3 intentos de recuperación ante JSON malformado
- CORS habilitado con `*` en el webhook
- El flujo está en n8n.teotec.org, instancia propia

## Próximos Pasos
- (completar con las features que se vienen)
