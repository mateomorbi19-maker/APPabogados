// Sugerencia de fuero (Fase B). SIEMPRE es una sugerencia — el abogado la
// confirma o la corrige en el selector del mapa; sin señal clara devolvemos
// null y el selector queda sin preselección.
//
// Prioridad de señales (de más fuerte a más débil):
//   1. Claves del contexto sobre el CÓDIGO PROCESAL aplicable
//      (codigo_procesal_aplicable, etc.). Es la señal más fuerte: el mapa
//      modela las etapas de un código, y el pre-análisis pregunta exactamente
//      esto (categoría A5). Un caso ante un juzgado federal que aún tramita
//      bajo la Ley 23.984 (mixto) sigue las etapas del mapa "Nación".
//   2. Claves del contexto sobre jurisdicción / fuero / competencia
//      (jurisdiccion_tramite, fuero_competente, etc.).
//   3. Señales en el relato del caso (órganos, leyes, lugares).
//
// Las claves del contexto las genera la IA del pre-análisis en snake_case
// arbitrario ("jurisdiccion_tramite", "jurisdiccion_actual"...), por eso se
// matchean por patrón y NO por nombre exacto.
import type { Fuero } from "./types";

function normalizar(s: string): string {
  // NFD separa las tildes como caracteres combinantes (U+0300–U+036F) y las
  // borramos: "Instrucción" → "instruccion".
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Reglas evaluadas EN ORDEN — el orden importa:
// - Códigos y leyes procesales primero (señal inequívoca).
// - "capital federal" (= CABA, justicia nacional ordinaria) ANTES que los
//   matchers de fuero federal.
// - Las variantes de CABA ANTES que "buenos aires" (que solo debe matchear
//   la provincia).
const REGLAS: Array<[RegExp, Fuero]> = [
  // — Códigos / leyes procesales (señal inequívoca) —
  [/\bcppf\b|27\.?063/, "federal"],
  [/23\.?984|\bcppn\b|procesal penal de la nacion/, "nacion"],
  [/11\.?922|14\.?442/, "pba"], // CPP Buenos Aires (y su reforma)
  // — Señales fuertes (órganos / frases / leyes de fondo) —
  [/capital federal/, "nacion"],
  [/(juzgado|fiscalia|camara|justicia|fuero) federal/, "federal"],
  [/justicia nacional|juzgado nacional|nacional en lo criminal/, "nacion"],
  [/juez de instruccion|juzgado de instruccion/, "nacion"],
  [/ley 23\.?737/, "federal"], // estupefacientes → competencia federal
  [/provincia de buenos aires|prov\.? de buenos aires|bonaerense|\bpba\b/, "pba"],
  [/\bufi\b/, "pba"], // Unidad Fiscal de Instrucción (orgánica bonaerense)
  // — Señales cortas (típicas de respuestas breves del formulario) —
  [/\bcaba\b|ciudad autonoma|ciudad de buenos aires/, "nacion"],
  [/\bfederal(es)?\b/, "federal"],
  [/buenos aires/, "pba"], // las variantes de CABA ya matchearon arriba
];

function matchFuero(texto: string): Fuero | null {
  const t = normalizar(texto);
  if (t.length === 0) return null;
  for (const [re, fuero] of REGLAS) {
    if (re.test(t)) return fuero;
  }
  return null;
}

// Escanea los valores del contexto cuyas CLAVES matcheen el patrón dado.
function matchPorClaves(
  contexto: Record<string, unknown>,
  patronClave: RegExp,
): Fuero | null {
  for (const [clave, valor] of Object.entries(contexto)) {
    if (typeof valor !== "string") continue;
    if (!patronClave.test(normalizar(clave))) continue;
    const fuero = matchFuero(valor);
    if (fuero) return fuero;
  }
  return null;
}

export function sugerirFuero(input: {
  contexto?: Record<string, unknown> | null;
  descripcion?: string | null;
}): Fuero | null {
  const contexto = input.contexto ?? null;

  if (contexto) {
    // 1) Código procesal aplicable: la señal más fuerte.
    const porCodigo = matchPorClaves(contexto, /codigo.*procesal|procesal.*aplicable/);
    if (porCodigo) return porCodigo;

    // 2) Jurisdicción / fuero / competencia.
    const porJurisdiccion = matchPorClaves(
      contexto,
      /jurisdiccion|fuero|competencia/,
    );
    if (porJurisdiccion) return porJurisdiccion;
  }

  // 3) Fallback: escanear el relato del caso.
  if (input.descripcion) {
    return matchFuero(input.descripcion);
  }
  return null;
}
