import type { z } from "zod";
import type { preguntaSchema } from "@/lib/schemas";
import type { RespuestaValor } from "@/components/nuevo-analisis/pregunta-field";

type Pregunta = z.infer<typeof preguntaSchema>;

// Inicializa el shape de respuestas a partir del array de preguntas.
// Espejo de `valorInicial` que vivía dentro de `formulario-dinamico.tsx`
// pre-Fase-4.5; se subió acá porque ahora el state de respuestas vive en
// el panel y necesita inicializarse cuando se entra a fase "form".
export function inicializarRespuestas(
  preguntas: Pregunta[],
): Record<string, RespuestaValor> {
  const out: Record<string, RespuestaValor> = {};
  for (const p of preguntas) {
    if (p.tipo === "checkbox") {
      out[p.id] = p.opciones && p.opciones.length > 0 ? [] : false;
    } else {
      out[p.id] = p.valor_sugerido ?? "";
    }
  }
  return out;
}

// Convierte el shape interno de respuestas (RespuestaValor por id) al shape
// que el endpoint espera en `contexto`: Record<string, string|number|boolean|null>.
// `contextoSchema` no acepta arrays, así que checkbox multi-select se serializa
// con join(", "). Strings vacíos se omiten para no enviar pares vacíos al
// agente. Un checkbox toggle (boolean) se envía aún si es false: el usuario
// "respondió No" y eso es información para el agente.
export function serializarRespuestas(
  respuestas: Record<string, RespuestaValor>,
  preguntas: Pregunta[],
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const p of preguntas) {
    const v = respuestas[p.id];
    if (v === undefined) continue;
    if (p.tipo === "checkbox") {
      if (Array.isArray(v)) {
        if (v.length > 0) out[p.id] = v.join(", ");
      } else if (typeof v === "boolean") {
        out[p.id] = v;
      }
      continue;
    }
    if (typeof v === "string" && v.trim() !== "") {
      out[p.id] = v;
    }
  }
  return out;
}
