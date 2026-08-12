import type { z } from "zod";
import type { preguntaSchema } from "@/lib/schemas";

type Pregunta = z.infer<typeof preguntaSchema>;

// Estado y serialización de las respuestas del formulario dinámico.
//
// Módulo neutro (sin "use client" ni "server-only") a propósito: acá viven las
// reglas de qué cuenta como respondido y cómo se le manda al agente, y tanto el
// campo de la pregunta como el panel las tienen que ver iguales. Antes esto
// estaba repartido entre el componente y un helper de serialización, y era fácil
// que el render y la validación no coincidieran.

/** Respuesta a una pregunta con opciones: qué marcó, si abrió "Otro", y qué
 *  escribió ahí. Los tres campos son independientes — ver pregunta-field.tsx. */
export type RespuestaOpciones = {
  opciones: string[];
  otroActivo: boolean;
  otro: string;
};

/** texto → string; opciones → RespuestaOpciones. */
export type RespuestaValor = string | RespuestaOpciones;

export const RESPUESTA_OPCIONES_VACIA: RespuestaOpciones = {
  opciones: [],
  otroActivo: false,
  otro: "",
};

export function esRespuestaOpciones(v: unknown): v is RespuestaOpciones {
  return typeof v === "object" && v !== null && "opciones" in v;
}

/**
 * Una pregunta se renderiza como lista de opciones solo si además de decir
 * tipo "opciones" TRAE opciones. Una lista vacía es un output degenerado del
 * modelo y cae a texto libre — así la pregunta sigue siendo respondible.
 *
 * Es la misma condición que usa el control: si el estado inicial y el render
 * no la evaluaran igual, el formulario guardaría un shape y mostraría otro.
 */
export function esPreguntaDeOpciones(p: Pregunta): boolean {
  return p.tipo === "opciones" && (p.opciones?.length ?? 0) > 0;
}

/**
 * Estado inicial de las respuestas a partir de las preguntas.
 *
 * `valor_sugerido` es lo que el modelo infirió del relato: si coincide con una
 * opción, la deja marcada; si no coincide con ninguna, la carga como aclaración
 * en "Otro" en vez de tirarla. Perder una inferencia correcta porque el modelo
 * no la escribió idéntica a su propia opción sería el peor de los dos mundos.
 */
export function inicializarRespuestas(
  preguntas: Pregunta[],
): Record<string, RespuestaValor> {
  const out: Record<string, RespuestaValor> = {};
  for (const p of preguntas) {
    if (!esPreguntaDeOpciones(p)) {
      out[p.id] = p.valor_sugerido ?? "";
      continue;
    }
    const sugerido = p.valor_sugerido?.trim() ?? "";
    const coincide = (p.opciones ?? []).find(
      (o) => o.toLowerCase() === sugerido.toLowerCase(),
    );
    if (coincide) {
      out[p.id] = { opciones: [coincide], otroActivo: false, otro: "" };
    } else if (sugerido !== "") {
      out[p.id] = { opciones: [], otroActivo: true, otro: sugerido };
    } else {
      out[p.id] = { ...RESPUESTA_OPCIONES_VACIA };
    }
  }
  return out;
}

/**
 * Una pregunta requerida está respondida si tiene contenido real:
 *   - texto: string no vacío
 *   - opciones: al menos una marcada, o una aclaración escrita en "Otro"
 * Marcar "Otro" y no escribir nada NO cuenta: no aporta ningún dato.
 */
export function preguntaRespondida(
  p: Pregunta,
  v: RespuestaValor | undefined,
): boolean {
  if (esPreguntaDeOpciones(p)) {
    if (!esRespuestaOpciones(v)) return false;
    return v.opciones.length > 0 || v.otro.trim() !== "";
  }
  return typeof v === "string" && v.trim() !== "";
}

export function preguntaRequeridaCompleta(
  p: Pregunta,
  v: RespuestaValor | undefined,
): boolean {
  return !p.requerido || preguntaRespondida(p, v);
}

/**
 * Convierte las respuestas al shape que espera `contexto` en el endpoint:
 * Record<string, string>. `contextoSchema` no acepta arrays, así que una
 * multi-selección se aplana con " · " (el mismo separador que usa el resto de
 * la app). La aclaración de "Otro" va como un ítem más al final.
 *
 * Las preguntas sin responder se omiten: mandarle al agente un par vacío no le
 * dice nada y le gasta contexto.
 */
export function serializarRespuestas(
  respuestas: Record<string, RespuestaValor>,
  preguntas: Pregunta[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of preguntas) {
    const v = respuestas[p.id];
    if (v === undefined) continue;

    if (esPreguntaDeOpciones(p)) {
      if (!esRespuestaOpciones(v)) continue;
      const partes = [...v.opciones];
      const aclaracion = v.otro.trim();
      if (aclaracion !== "") partes.push(aclaracion);
      if (partes.length > 0) out[p.id] = partes.join(" · ");
      continue;
    }

    if (typeof v === "string" && v.trim() !== "") out[p.id] = v.trim();
  }
  return out;
}
