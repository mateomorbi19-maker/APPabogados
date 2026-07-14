// Niveles de modelo del chat por caso — FUENTE ÚNICA DE VERDAD del
// mapeo nivel → modelo. Módulo puro (sin "server-only"/"use client"):
// el cliente importa los labels y el enum; el server resuelve el model
// ID. Los IDs no son secretos, pero la UI NUNCA muestra los nombres
// oficiales — siempre "Bajo / Medio / Alto" (decisión de producto).
//
// SEGURIDAD: el cliente solo manda el nivel (enum validado por Zod en
// el borde); el model ID se resuelve server-side desde este mapa. Nunca
// aceptar un model ID crudo del cliente.
//
// IMPORTANTE: cada modelId de este mapa DEBE tener su entrada de
// pricing en src/lib/agent/pricing.ts — calcularCosto tira Error si
// falta, y eso rompe el turno completo con 500.
//
// IDs verificados contra GET /v1/models de Anthropic el 2026-07-14.

export const NIVELES_MODELO = ["bajo", "medio", "alto"] as const;
export type NivelModelo = (typeof NIVELES_MODELO)[number];

export const NIVEL_DEFAULT: NivelModelo = "medio";

export const NIVEL_LABEL: Record<NivelModelo, string> = {
  bajo: "Bajo",
  medio: "Medio",
  alto: "Alto",
};

// Para el tooltip/descripcion del selector. Sin nombres oficiales.
export const NIVEL_DESCRIPCION: Record<NivelModelo, string> = {
  bajo: "Más rápido y económico. Para consultas simples.",
  medio: "Equilibrado (recomendado). El nivel de siempre.",
  alto: "Máxima profundidad de análisis. Más lento y caro.",
};

export const MODELO_POR_NIVEL: Record<
  NivelModelo,
  { modelId: string; maxTokens: number }
> = {
  // Haiku 4.5 — rápido/barato ($1/$5 por MTok).
  bajo: { modelId: "claude-haiku-4-5-20251001", maxTokens: 16000 },
  // Sonnet 4.5 — el modelo que la app usa desde siempre (= comportamiento
  // actual; default).
  medio: { modelId: "claude-sonnet-4-5-20250929", maxTokens: 16000 },
  // Opus 4.6 — máxima calidad ($5/$25 por MTok, contexto 1M sin tier
  // premium).
  alto: { modelId: "claude-opus-4-6", maxTokens: 16000 },
};
