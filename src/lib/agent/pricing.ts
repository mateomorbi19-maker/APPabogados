import "server-only";

type Pricing = {
  input_per_mtok: number;
  output_per_mtok: number;
  cache_write_5m_per_mtok: number;
  cache_read_per_mtok: number;
};

// Precios oficiales en USD por millón de tokens (Anthropic, abril 2026).
// Sonnet 4.5: input $3, output $15. Cache write 5m = 1.25x input, cache read = 0.1x input.
const PRECIOS: Record<string, Pricing> = {
  "claude-sonnet-4-5-20250929": {
    input_per_mtok: 3.0,
    output_per_mtok: 15.0,
    cache_write_5m_per_mtok: 3.75,
    cache_read_per_mtok: 0.3,
  },
};

// Long-context tier: aplica cuando el total de input tokens del request supera 200K.
// Sonnet 4.5 long-context: input $6, output $22.50, cache write 5m $7.50, cache read $0.60.
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

export function calcularCosto(modelo: string, usage: Usage): number {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const fullInput = usage.input_tokens;
  const totalInput = fullInput + cacheWrite + cacheRead;
  const tier = totalInput > 200_000 ? PRECIOS_LONG_CONTEXT : PRECIOS;
  const p = tier[modelo];
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
