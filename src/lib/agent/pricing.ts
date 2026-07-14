import "server-only";

type Pricing = {
  input_per_mtok: number;
  output_per_mtok: number;
  cache_write_5m_per_mtok: number;
  cache_read_per_mtok: number;
};

// Precios oficiales en USD por millón de tokens (Anthropic, verificados
// contra platform.claude.com/docs/en/about-claude/pricing el 2026-07-14).
// Cache write 5m = 1.25x input, cache read = 0.1x input.
//
// Todo modelId usado por la app (ver src/lib/agent/modelos.ts) DEBE
// tener entrada acá: calcularCosto tira Error si falta.
const PRECIOS: Record<string, Pricing> = {
  // Sonnet 4.5: nivel "medio" del chat + todos los flujos legacy.
  "claude-sonnet-4-5-20250929": {
    input_per_mtok: 3.0,
    output_per_mtok: 15.0,
    cache_write_5m_per_mtok: 3.75,
    cache_read_per_mtok: 0.3,
  },
  // Haiku 4.5: nivel "bajo" del chat.
  "claude-haiku-4-5-20251001": {
    input_per_mtok: 1.0,
    output_per_mtok: 5.0,
    cache_write_5m_per_mtok: 1.25,
    cache_read_per_mtok: 0.1,
  },
  // Opus 4.6: nivel "alto" del chat.
  "claude-opus-4-6": {
    input_per_mtok: 5.0,
    output_per_mtok: 25.0,
    cache_write_5m_per_mtok: 6.25,
    cache_read_per_mtok: 0.5,
  },
};

// Long-context tier: aplica cuando el input de UN request supera 200K.
// Solo Sonnet 4.5 lo tiene: Opus 4.6 incluye el contexto 1M a precio
// estándar, y Haiku 4.5 capea en 200K (nunca lo supera). Los modelos
// sin entrada acá usan su precio base a cualquier tamaño.
const PRECIOS_LONG_CONTEXT: Record<string, Pricing> = {
  "claude-sonnet-4-5-20250929": {
    input_per_mtok: 6.0,
    output_per_mtok: 22.5,
    cache_write_5m_per_mtok: 7.5,
    cache_read_per_mtok: 0.6,
  },
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

// Costo de UN request (una respuesta de la API). Para loops multi-turno
// (tool-use), llamar POR RESPUESTA y sumar — NO con la usage agregada
// del loop: el tier long-context se decide por request, y decidirlo
// sobre la suma inflaba el costo (bug A-3 de la auditoría: 11 requests
// de 25K sumaban 275K → todo se cobraba al tier 2x aunque ningún
// request individual superó 200K).
export function calcularCosto(modelo: string, usage: Usage): number {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const fullInput = usage.input_tokens;
  const totalInput = fullInput + cacheWrite + cacheRead;
  const p =
    totalInput > 200_000
      ? (PRECIOS_LONG_CONTEXT[modelo] ?? PRECIOS[modelo])
      : PRECIOS[modelo];
  if (!p) {
    throw new Error(`Pricing desconocido para modelo: ${modelo}`);
  }
  const usd =
    (fullInput / 1_000_000) * p.input_per_mtok +
    (usage.output_tokens / 1_000_000) * p.output_per_mtok +
    (cacheWrite / 1_000_000) * p.cache_write_5m_per_mtok +
    (cacheRead / 1_000_000) * p.cache_read_per_mtok;
  return Number(usd.toFixed(6));
}
