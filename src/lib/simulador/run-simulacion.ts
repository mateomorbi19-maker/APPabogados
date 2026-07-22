// Llamada al modelo del Simulador de Audiencias (THÉMIS v1).
//
// A propósito NO reusa run-agent.ts ni run-agent-consulta.ts: esos son loops
// de tool-use ya duplicados entre sí, y THÉMIS v1 no usa herramientas ni RAG
// en vivo (el marco legal está horneado en el guion). Acá hay UNA
// client.messages.create por operación y nada más. Sumar un tercer loop
// acoplado habría empeorado la deuda que ya reconoce run-agent-consulta.ts.
//
// Este módulo es PURO respecto de la DB: recibe datos, llama al modelo y
// devuelve texto + usage + costo. Persistir es responsabilidad de queries.ts /
// las rutas, igual que en mapa-procesal/simulacion.ts.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/anthropic";
import { MODELO_POR_NIVEL } from "@/lib/agent/modelos";
import { parseWithRecovery } from "@/lib/agent/parse";
import { calcularCosto, type Usage } from "@/lib/agent/pricing";
import type { TurnoSimulacion } from "@/lib/types";
import { debriefingSchema, type Debriefing } from "./schemas";

// Nivel fijo para toda la simulación. No se expone selector Bajo/Medio/Alto en
// esta pasada: el realismo de la sala depende del modelo y no queremos que la
// calidad de la práctica varíe por una perilla. Sale de MODELO_POR_NIVEL para
// no hardcodear un ID y para heredar la garantía de pricing.
const NIVEL_SIMULADOR = "medio" as const;
export const MODELO_SIMULADOR = MODELO_POR_NIVEL[NIVEL_SIMULADOR].modelId;

// Mismo techo que usa el chat por caso (16000). NO se copia el 2048 de
// mapa-procesal/simulacion.ts: allá la salida es un JSON de 2-5 ramas cortas,
// acá es prosa multi-personaje. La apertura sola tiene que cubrir presentación
// de sala, verificación de identidad, información de derechos y el alegato
// completo del fiscal — con 2048 se cortaba a mitad de frase. El cap no se
// factura: se paga el output real.
const MAX_TOKENS_TURNO = MODELO_POR_NIVEL[NIVEL_SIMULADOR].maxTokens;
const MAX_TOKENS_DEBRIEFING = 4096;

// Cue interno que abre la audiencia. NO se persiste como turno (el primer
// turno guardado es la respuesta del modelo), pero se reinyecta como primer
// mensaje `user` en cada reconstrucción del historial: sin él el array
// arrancaría con un `assistant` y la API lo rechaza.
export const CUE_APERTURA =
  "Iniciá la audiencia. Abrí con la apertura del secretario/OGA y seguí hasta " +
  "el primer momento en que me toque intervenir a mí; ahí detenete y esperá mi " +
  "intervención.";

const PROMPT_DEBRIEFING = `La audiencia terminó. Salí del personaje y actuá como evaluador forense.

Analizá el desempeño del abogado usuario en la audiencia que acabás de conducir, a la luz del caso real y de la estrategia que había formulado la aplicación.

Respondé SOLO con JSON válido (sin markdown ni backticks), con esta estructura exacta:
{
  "puntuacion_general": 7.5,
  "fidelidad_estrategia": 6,
  "dimensiones": [
    { "nombre": "Nombre de la dimensión", "puntaje": 7, "comentario": "Qué hizo bien y qué no, con referencia a momentos concretos de la audiencia." }
  ],
  "momentos_clave": ["Momento concreto de la audiencia y por qué importó"],
  "oportunidades_perdidas": ["Planteo o argumento disponible que no usó"],
  "resultado_probable": "Cómo habría resuelto un juez real y por qué.",
  "proximos_pasos": ["Qué practicar o preparar para la próxima"]
}

Reglas:
- "puntuacion_general" y "fidelidad_estrategia" van de 0 a 10 (admiten decimales).
- "dimensiones": entre 3 y 4 entradas, con puntaje de 0 a 10. Elegí las dimensiones que esta audiencia concreta hizo relevantes (por ejemplo: manejo del peligro procesal, uso del arraigo, técnica de litigación oral, fundamentación normativa).
- NO cites jurisprudencia ni fallos por carátula. Si referís a un criterio, hacelo en términos genéricos.
- Fundá con los artículos del CPP PBA habilitados en el guion, cuando corresponda.
- Sé concreto: citá lo que el usuario efectivamente dijo, no generalidades.`;

export type LlamadaResult = {
  texto: string;
  usage: Usage;
  costoUsd: number;
  latenciaMs: number;
  // true si la API cortó por max_tokens. Se persiste en la metadata del turno:
  // sin esto la truncación es invisible y el abogado contesta un alegato que
  // nunca terminó (además de que el debriefing lo evalúa mutilado).
  truncado: boolean;
};

export type DebriefingResult = LlamadaResult & {
  debriefing: Debriefing | null;
  parseoError: string | null;
  parseoIntento: number | null;
};

function usageDe(response: Anthropic.Message): Usage {
  return {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
  };
}

function textoDe(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// Reconstruye el array de mensajes desde el transcript persistido.
//
// - Arranca SIEMPRE con CUE_APERTURA como user (ver nota en la constante).
// - emisor 'usuario' -> user; todo el resto (los personajes que encarna el
//   modelo) -> assistant.
// - Colapsa roles consecutivos. No debería pasar con el flujo normal, pero si
//   un turno del modelo no llegó a persistirse quedarían dos `user` seguidos y
//   la API responde 400 — que es exactamente cómo se brickeó una conversación
//   del chat (ver build-contexto-conversacion.ts:148-165). Defensa barata.
export function construirMensajes(
  turnos: TurnoSimulacion[],
): Anthropic.MessageParam[] {
  const crudos: Anthropic.MessageParam[] = [
    { role: "user", content: CUE_APERTURA },
  ];
  for (const t of turnos) {
    const role: "user" | "assistant" = t.emisor === "usuario" ? "user" : "assistant";
    crudos.push({ role, content: t.contenido });
  }

  const colapsados: Anthropic.MessageParam[] = [];
  for (const m of crudos) {
    const ultimo = colapsados[colapsados.length - 1];
    if (ultimo && ultimo.role === m.role) {
      ultimo.content = `${String(ultimo.content)}\n\n${String(m.content)}`;
      continue;
    }
    colapsados.push({ ...m });
  }
  return colapsados;
}

async function llamar(input: {
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
}): Promise<{ response: Anthropic.Message } & LlamadaResult> {
  const t0 = Date.now();
  const client = getAnthropic();
  const response = await client.messages.create({
    model: MODELO_SIMULADOR,
    max_tokens: input.maxTokens,
    system: input.system,
    messages: input.messages,
  });
  const latenciaMs = Date.now() - t0;
  const usage = usageDe(response);
  return {
    response,
    texto: textoDe(response),
    usage,
    costoUsd: calcularCosto(MODELO_SIMULADOR, usage),
    latenciaMs,
    truncado: response.stop_reason === "max_tokens",
  };
}

// (a) Primer turno: abre la audiencia. El transcript todavía está vacío.
export async function abrirAudiencia(input: {
  system: string;
}): Promise<LlamadaResult> {
  const { texto, usage, costoUsd, latenciaMs, truncado } = await llamar({
    system: input.system,
    messages: [{ role: "user", content: CUE_APERTURA }],
    maxTokens: MAX_TOKENS_TURNO,
  });
  return { texto, usage, costoUsd, latenciaMs, truncado };
}

// (b) Turno siguiente. `turnos` debe incluir YA el turno nuevo del usuario
// (la ruta lo persiste antes de llamar al modelo), así el último mensaje del
// array es el suyo.
export async function responderTurno(input: {
  system: string;
  turnos: TurnoSimulacion[];
}): Promise<LlamadaResult> {
  const { texto, usage, costoUsd, latenciaMs, truncado } = await llamar({
    system: input.system,
    messages: construirMensajes(input.turnos),
    maxTokens: MAX_TOKENS_TURNO,
  });
  return { texto, usage, costoUsd, latenciaMs, truncado };
}

// (c) Debriefing. El system es el mismo de la sesión (trae caso + estrategia +
// configuración); el pedido de salir del personaje y el contrato JSON van en
// el último mensaje, que es la posición más fuerte.
export async function generarDebriefing(input: {
  system: string;
  turnos: TurnoSimulacion[];
}): Promise<DebriefingResult> {
  const messages = construirMensajes(input.turnos);
  const ultimo = messages[messages.length - 1];
  if (ultimo && ultimo.role === "user") {
    // Evita dos `user` seguidos si la audiencia quedó con la última palabra
    // del abogado sin respuesta del modelo.
    ultimo.content = `${String(ultimo.content)}\n\n${PROMPT_DEBRIEFING}`;
  } else {
    messages.push({ role: "user", content: PROMPT_DEBRIEFING });
  }

  const base = await llamar({
    system: input.system,
    messages,
    maxTokens: MAX_TOKENS_DEBRIEFING,
  });
  const { texto, usage, costoUsd, latenciaMs, truncado } = base;

  const parsed = parseWithRecovery(texto);
  if (!parsed.ok) {
    return {
      texto,
      usage,
      costoUsd,
      latenciaMs,
      truncado,
      debriefing: null,
      parseoError: parsed.error,
      parseoIntento: null,
    };
  }
  const validado = debriefingSchema.safeParse(parsed.resultado);
  if (!validado.success) {
    return {
      texto,
      usage,
      costoUsd,
      latenciaMs,
      truncado,
      debriefing: null,
      parseoError: `Output con shape inválido: ${validado.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      parseoIntento: parsed.parseo_intento,
    };
  }
  return {
    texto,
    usage,
    costoUsd,
    latenciaMs,
    truncado,
    debriefing: validado.data,
    parseoError: null,
    parseoIntento: parsed.parseo_intento,
  };
}
