# APPabogados — EstrategiaLegal

## Descripción
App web para abogados penales argentinos. Tres usuarios entran sin contraseña, describen un caso, completan un formulario dinámico generado por IA y reciben estrategias legales fundamentadas en el Código Penal y manuales de litigación. Cada análisis se trackea en Supabase (tokens, costo USD, modelo) y se muestra en un panel de consumo.

## Stack
- **Frontend:** `index.html` monolítico (HTML + CSS + JS inline) servido por Express. Deploy en Easypanel.
- **Backend/Orquestación:** n8n en `https://app-n8n.udmrwg.easypanel.host`.
- **Modelo IA:** Claude Sonnet 4.5 (Anthropic).
- **Embeddings:** OpenAI `text-embedding-3-small`.
- **Vector store + tracking:** Supabase (`xvdlnevcvcsgxbngwliv`).
- **Deploy:** EasyPanel — cada `git push` a `main` redeploya automáticamente.

## Flujo de la app

1. **Login**: 3 cards (Lautaro / Gonzalo / Mateo). Selección guardada en `localStorage.usuario_activo`. Sin contraseña. **No hay control de acceso real**: los webhooks n8n tienen CORS abierto y aceptan cualquier `usuario` válido del payload, así que cualquiera con la URL del webhook puede consumir el cupo de otro. Aceptable mientras sea uso interno; si se expone públicamente, mover la identidad del usuario a un JWT o header firmado.
2. **Header siempre visible**: barra de consumo (verde 0-60%, amarillo 60-85%, rojo 85%+) + dropdown de usuario (cambiar / cerrar sesión).
3. **Tab "Nuevo análisis"**:
   1. Usuario describe el caso → "Continuar".
   2. `POST /webhook/pre-analisis` con `{ caso }` → IA devuelve resumen + datos detectados + preguntas dinámicas.
   3. Renderiza formulario (`select`/`radio`/`text`/`checkbox`) con `valor_sugerido` pre-cargado y `motivo` como ayuda.
   4. Usuario completa → "Analizar caso" → `POST /webhook/analizar-caso` con `{ caso, rol, contexto, usuario }`.
   5. IA devuelve estrategias; tracking se inserta en Supabase en paralelo; barra de consumo se refresca.
4. **Tab "Mi consumo"**: 4 metric cards (tokens usados, gasto USD, ejecuciones, tokens restantes) + tabla de historial (20 últimas).

## Endpoints n8n

| Workflow | ID | Webhook |
|---|---|---|
| Pre-Análisis (Form Dinámico) | `z5MiTcR3ymorKvxc` | `POST /webhook/pre-analisis` |
| Analizar Caso v3 (AI Agent) | `a0owi3kHimKWtOFB` | `POST /webhook/analizar-caso` |
| Consultar Consumo | `aWQ4R1MZ0mfhVpLE` | `POST /webhook/consultar-consumo` |

### `/webhook/pre-analisis`
Request: `{ "caso": "string >= 20 chars" }`

Response:
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
    { "id": "snake_case", "tipo": "select|radio|text|checkbox", "label": "string",
      "opciones": ["..."], "valor_sugerido": "string|null", "requerido": true, "motivo": "string" }
  ]
}
```

### `/webhook/analizar-caso`
Request:
```json
{
  "caso": "string",
  "rol": "defensor|querellante|ambos",
  "contexto": { "jurisdiccion": "Entre Ríos", "hay_detenidos": "No", "...": "..." },
  "usuario": "Lautaro|Gonzalo|Mateo"
}
```

`Validar Input` exige `usuario` válido. `Armar Prompt` inyecta `contexto` y agrega instrucciones de código procesal según `contexto.jurisdiccion` (Federal → CPPF, CABA → CPP CABA, provincia → código provincial). El `AI Agent` consulta el vector store. `Calcular Consumo` estima tokens (caso + contexto + overhead) / 3.5 chars-per-token, calcula costo, y dispara dos ramas paralelas: una al frontend (`Parsear Resultado` → `Responder`) y otra al tracking (`Buscar Usuario ID` → `Guardar Tracking` en Supabase).

### `/webhook/consultar-consumo`
Request: `{ "usuario": "Lautaro" }`

Response:
```json
{
  "consumo": {
    "nombre": "Lautaro",
    "tokens_usados_mes": 6928,
    "gasto_usd_mes": 0.09012,
    "ejecuciones_mes": 4,
    "tokens_restantes": 993072,
    "limite_tokens_mensual": 1000000
  },
  "historial": [
    { "id": "...", "tipo": "analisis_caso", "modelo": "...",
      "input_tokens": 1150, "output_tokens": 3054, "total_tokens": 4204,
      "costo_usd": 0.04926, "ejecutado_en": "2026-04-20T20:11:56Z" }
  ]
}
```

Historial ordenado por `ejecutado_en DESC`, máximo 20 filas.

## Estimación de tokens

El AI Agent de langchain expone tokens en una rama `ai_languageModel` que no es accesible desde un Code node externo. Por eso `Calcular Consumo` **estima** en lugar de leer el valor real:

- `inputTokens ≈ (2000 + len(caso) + len(JSON.stringify(contexto))) * 1.5 / 3.5`
- `outputTokens ≈ len(output_text) / 3.5`

Calibración empírica: ±20% vs tokens reales observados. El factor 1.5 compensa las múltiples llamadas que hace el agente cuando usa el tool de búsqueda vectorial. El overhead de 2000 cubre el system prompt + la descripción de la tool. Si en el futuro se necesita precisión exacta, una opción es exponer la API key de n8n al Code node (vía env var habilitada) y hacer fetch a `/api/v1/executions/{id}?includeData=true` para sumar `tokenUsageEstimate` real.

## Schema Supabase

Ver `supabase-schema.sql`. Tablas:
- `usuarios` (id UUID, nombre UNIQUE, limite_tokens_mensual)
- `ejecuciones` (id UUID, usuario_id FK, tipo, modelo, input_tokens, output_tokens, total_tokens GENERATED, costo_usd, ejecutado_en, metadata)
- Vista `v_consumo_mensual` agrega tokens y costo del mes en curso por usuario.
- RLS deshabilitado en ambas tablas (n8n usa service_role para escribir).

3 usuarios precargados: `Lautaro`, `Gonzalo`, `Mateo`, todos con límite de 1.000.000 tokens/mes.

## Setup desde cero

1. **Variables de entorno**: copiar `.env.example` → `.env` y llenar. Nunca commitear `.env`.
2. **Supabase**: pegar `supabase-schema.sql` en el SQL Editor del proyecto y correrlo (idempotente). Verificar con `npm run setup:supabase`.
3. **n8n**: las credenciales `Anthropic account`, `OpenAI account` y `Supabase account` deben estar configuradas en n8n. Los templates versionados viven en [workflows-template/](workflows-template/) (por ahora solo `consultar-consumo.json`). Para reaplicarlo: `npm run setup:n8n`. El workflow `analizar-caso` y `pre-analisis` ya están en producción y se modifican vía la API n8n (los scripts puntuales viven en mi máquina local en `C:\tmp\`).
4. **Frontend**: `npm install && npm start` corre en `:3000`.

## Desarrollo local

```bash
npm install
npm start   # puerto 3000
```

`server.js` sirve `index.html` para cualquier ruta (SPA-style). No hay build.

## Deploy

- Repo: https://github.com/mateomorbi19-maker/APPabogados
- Branch deployable: `main`
- Trigger: cada push a `main` activa redeploy en EasyPanel

## Convenciones

- **Sin frameworks frontend**: todo en `index.html`. No agregar React/Vue.
- El agente hace **máximo 4 búsquedas vectoriales** por consulta.
- El prompt exige **JSON puro** (sin markdown ni backticks); el parser limpia backticks defensivamente.
- **CORS abierto** (`*`) en los webhooks de n8n.
- **Estilo visual**: paleta dark (`#0a0e17`/`#0f172a`), acentos violeta `#8b5cf6`, fuentes IBM Plex + DM Serif Display.
- **Colores por usuario**: Lautaro azul (`#3b82f6`), Gonzalo verde (`#22c55e`), Mateo púrpura (`#8b5cf6`).
- Tokens y costos se muestran con separador argentino (`toLocaleString('es-AR')`); fechas en `DD/MM/YYYY HH:MM`.
