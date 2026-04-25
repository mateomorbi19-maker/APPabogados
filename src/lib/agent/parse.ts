import "server-only";

export type ParseResult =
  | {
      ok: true;
      resultado: Record<string, unknown>;
      parseo_intento: 1 | 2 | 3;
    }
  | {
      ok: false;
      raw_response: string;
      error: string;
    };

function repairJSON(str: string): string {
  let s = str.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = s.indexOf("{");
  if (start === -1) return s;
  s = s.substring(start);
  const end = s.lastIndexOf("}");
  if (end === -1) return s;
  s = s.substring(0, end + 1);
  s = s.replace(/,\s*([}\]])/g, "$1");
  return s;
}

function extractResult(parsedIn: unknown): Record<string, unknown> {
  let parsed: Record<string, unknown> = Array.isArray(parsedIn)
    ? ((parsedIn[0] ?? {}) as Record<string, unknown>)
    : (parsedIn as Record<string, unknown>);
  const result: Record<string, unknown> = {};
  if ("defensor" in parsed) result.defensor = parsed.defensor;
  if ("querellante" in parsed) result.querellante = parsed.querellante;
  result.metadata = parsed.metadata ?? { timestamp: new Date().toISOString() };
  if (!result.defensor && !result.querellante) {
    return { ...parsed, metadata: result.metadata };
  }
  return result;
}

/**
 * Parser portado verbatim del nodo "Parsear Resultado" del workflow N8N.
 * 3 intentos de recovery:
 *   1. Limpia backticks y prefijo, parsea directo.
 *   2. Busca el bloque JSON balanceado más grande.
 *   3. Trunca en la posición de error y cierra brackets/braces abiertos.
 */
export function parseWithRecovery(raw: string): ParseResult {
  // Intento 1
  let firstError: string | null = null;
  try {
    const clean = repairJSON(raw);
    const parsed = JSON.parse(clean);
    return { ok: true, resultado: extractResult(parsed), parseo_intento: 1 };
  } catch (e1) {
    firstError = e1 instanceof Error ? e1.message : String(e1);
  }

  // Intento 2
  let secondError: string | null = null;
  try {
    let depth = 0;
    let start = -1;
    let jsonStr = "";
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (raw[i] === "}") {
        depth--;
        if (depth === 0 && start !== -1) {
          const candidate = raw.substring(start, i + 1);
          if (candidate.length > jsonStr.length) jsonStr = candidate;
          start = -1;
        }
      }
    }
    if (jsonStr) {
      const clean = jsonStr.replace(/,\s*([}\]])/g, "$1");
      const parsed = JSON.parse(clean);
      return { ok: true, resultado: extractResult(parsed), parseo_intento: 2 };
    }
    throw new Error("No se encontró bloque JSON");
  } catch (e2) {
    secondError = e2 instanceof Error ? e2.message : String(e2);
  }

  // Intento 3
  try {
    const posMatch =
      (firstError && firstError.match(/position (\d+)/i)) ||
      (secondError && secondError.match(/position (\d+)/i));
    if (posMatch) {
      let truncated = repairJSON(raw).substring(0, parseInt(posMatch[1], 10));
      truncated = truncated.replace(/,\s*"[^"]*":\s*"[^"]*$/, "");
      truncated = truncated.replace(/,\s*"[^"]*":\s*\[[^\]]*$/, "");
      truncated = truncated.replace(/,\s*$/, "");
      const openBraces =
        (truncated.match(/{/g) || []).length -
        (truncated.match(/}/g) || []).length;
      const openBrackets =
        (truncated.match(/\[/g) || []).length -
        (truncated.match(/]/g) || []).length;
      for (let i = 0; i < openBrackets; i++) truncated += "]";
      for (let i = 0; i < openBraces; i++) truncated += "}";
      const parsed = JSON.parse(truncated);
      const result = extractResult(parsed);
      const metaRaw = (result.metadata ?? {}) as Record<string, unknown>;
      result.metadata = {
        ...metaRaw,
        warning:
          "Respuesta truncada - algunas estrategias pueden estar incompletas",
      };
      return { ok: true, resultado: result, parseo_intento: 3 };
    }
    throw new Error(secondError ?? firstError ?? "parse error");
  } catch (e3) {
    return {
      ok: false,
      raw_response: raw.substring(0, 2000),
      error: `No se pudo parsear tras 3 intentos: ${e3 instanceof Error ? e3.message : String(e3)}`,
    };
  }
}
