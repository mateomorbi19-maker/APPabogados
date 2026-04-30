import "server-only";

export const SYSTEM_PROMPT =
  "Eres un abogado penalista argentino de élite. Tienes acceso a una base de datos vectorial con el Código Penal argentino y manuales de litigación penal. SIEMPRE debes buscar en la base de datos antes de generar estrategias. Usa la herramienta de búsqueda múltiples veces con diferentes términos jurídicos para obtener todos los artículos relevantes. Fundamenta CADA estrategia con artículos específicos que hayas recuperado de la base de datos. Responde SIEMPRE en JSON válido sin markdown ni backticks.";

export type Rol = "defensor" | "querellante" | "ambos";

export type Contexto = Record<string, unknown>;

const CAMPOS_ESPECIALES = ["jurisdiccion", "hay_detenidos", "etapa_procesal"];

/**
 * Construye el user prompt — portado verbatim del nodo "Armar Prompt" del
 * workflow N8N "EstrategiaLegal - Analizar Caso v3".
 */
export function armarPrompt(
  caso: string,
  rol: Rol,
  contexto: Contexto = {},
): string {
  let rolInstrucciones = "";
  if (rol === "defensor" || rol === "ambos") {
    rolInstrucciones += `\n\nGENERA ESTRATEGIAS DE DEFENSA:\nGenera exactamente 3 estrategias de DEFENSA diferenciadas para el/los imputado/s.`;
  }
  if (rol === "querellante" || rol === "ambos") {
    rolInstrucciones += `\n\nGENERA ESTRATEGIAS DE ACUSACIÓN:\nGenera exactamente 3 estrategias de ACUSACIÓN diferenciadas como querellante/fiscal.`;
  }

  const lineasContexto: string[] = [];
  if (contexto.jurisdiccion)
    lineasContexto.push(`- Jurisdicción: ${String(contexto.jurisdiccion)}`);
  if (contexto.hay_detenidos)
    lineasContexto.push(`- Hay detenidos: ${String(contexto.hay_detenidos)}`);
  if (contexto.etapa_procesal)
    lineasContexto.push(`- Etapa procesal: ${String(contexto.etapa_procesal)}`);

  for (const [k, v] of Object.entries(contexto)) {
    if (CAMPOS_ESPECIALES.includes(k)) continue;
    if (v === null || v === undefined || v === "") continue;
    lineasContexto.push(`- ${k}: ${String(v)}`);
  }

  const bloqueContexto = lineasContexto.length
    ? `\n\nCONTEXTO DEL CASO (proporcionado por el usuario):\n${lineasContexto.join("\n")}`
    : "";

  return `Analiza el siguiente caso penal argentino. PRIMERO usa la herramienta de búsqueda vectorial para buscar los artículos del Código Penal y doctrina de los manuales de litigación que sean relevantes para este caso. Hacé entre 2 y 4 búsquedas como MÁXIMO, combinando conceptos relacionados en cada búsqueda. Por ejemplo, buscá "homicidio tentativa emoción violenta" en vez de hacer búsquedas separadas para cada concepto. No hagas más de 4 búsquedas.

Después de recuperar el contexto legal, genera las estrategias fundamentadas en esos artículos y doctrina.${bloqueContexto}
${rolInstrucciones}

CASO:
${caso}

Responde SOLO con JSON válido (sin markdown ni backticks). El formato debe ser:
{
  "defensor": {  // solo si se pidió defensa
    "rol": "Defensor",
    "imputados_identificados": ["nombre1"],
    "delitos_imputables": ["delito1"],
    "estrategias": [
      {
        "numero": 1,
        "nombre": "Nombre de la estrategia",
        "tesis_central": "Explicación en 2-3 oraciones",
        "fundamento_legal": ["Art. X CP - explicación"],
        "doctrina_aplicable": "Doctrina relevante del manual",
        "fortalezas": ["fortaleza 1", "fortaleza 2"],
        "riesgos": ["riesgo 1", "riesgo 2"],
        "pasos_procesales": ["paso 1", "paso 2"]
      }
    ]
  },
  "querellante": { // solo si se pidió acusación
    "rol": "Querellante/Fiscal",
    ... misma estructura ...
  },
  "metadata": {
    "conceptos_extraidos": ["concepto1", "concepto2"],
    "articulos_consultados": ["Art. 79", "Art. 42"],
    "timestamp": "fecha"
  }
}`;
}

export const PRE_ANALISIS_SYSTEM_PROMPT =
  "Eres un abogado penalista argentino de élite ayudando a un colega a preparar el contexto de un caso antes del análisis profundo. Tu tarea es: (1) leer la descripción inicial, (2) inferir datos clave que se puedan deducir, (3) detectar qué información falta y armar un formulario corto de preguntas para que el usuario complete. Devuelve SIEMPRE JSON válido sin markdown ni backticks.";

export function armarPromptPreAnalisis(caso: string): string {
  return `Analiza brevemente el siguiente caso penal argentino y devolvé un JSON con esta estructura EXACTA:

{
  "resumen_preliminar": "string - 2-3 oraciones describiendo lo central del caso",
  "datos_detectados": {
    "jurisdiccion_inferida": "Federal | CABA | <provincia> | null si no se infiere",
    "delitos_posibles": ["string", ...],
    "hay_detenidos": "Sí | No | null",
    "etapa_procesal": "string descriptiva | null"
  },
  "preguntas": [
    {
      "id": "snake_case_id",
      "tipo": "select | radio | text | checkbox",
      "label": "pregunta en español",
      "opciones": ["..."],          // requerido para select/radio/checkbox, omitido en text
      "valor_sugerido": "valor_pre-cargado | null",
      "requerido": true | false,
      "motivo": "explicación corta de por qué se necesita el dato"
    }
  ]
}

REGLAS:
- Generá entre 4 y 8 preguntas máximo, las más relevantes para definir la estrategia.
- Si podés inferir un dato del caso, ponelo en "valor_sugerido" para pre-cargarlo.
- Incluí siempre preguntas sobre: jurisdicción, etapa procesal y si hay detenidos (si no son obvios del texto).
- "id" en snake_case sin espacios ni acentos.
- Respondé SOLO con el JSON, sin texto antes ni después.

CASO:
${caso}`;
}
