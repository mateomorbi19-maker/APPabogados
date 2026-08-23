// Cómo se llama una causa, en un solo lugar.
//
// Hasta la Fase 9 la respuesta era `casos.titulo` y nada más, y `titulo` lo
// siembra `sugerirTitulo()` con los primeros 60 caracteres del relato. Medido
// contra la base el 2026-08-22: de 8 causas, 4 se llamaban con un pedazo de
// texto — una es `"El 3 de julio de 2026, cerca de las 04:15"`. Ese mismo
// string es el que veían la lista lateral, el Inicio, la agenda, el header del
// mapa, el del simulador, el del chat, el buscador global y el contexto de
// LEXIE, porque los once consumidores leen la misma columna.
//
// La carátula NO pisa el título en la base: conviven. `titulo` queda como el
// nombre de trabajo que el abogado ya reconoce, y la carátula manda cuando
// existe. Pisar la columna habría cambiado de golpe lo que se ve en todas
// esas pantallas y, sin PATCH previo, no había forma de volver atrás.

import type { CasoNombrable } from "@/lib/types";

/**
 * El nombre con el que se muestra una causa. La carátula oficial si está
 * cargada; si no, el título de trabajo.
 *
 * Trata la cadena vacía y la de solo espacios como ausente: un `<input>` que
 * se abre y se cierra sin escribir manda `""`, no `null`, y sin esto la causa
 * pasaría a llamarse "" en toda la app.
 */
export function nombreCaso(caso: CasoNombrable): string {
  const caratula = caso.caratula?.trim();
  return caratula ? caratula : caso.titulo;
}

/**
 * `true` si la causa todavía se llama por su título automático. Lo usa el UI
 * para ofrecer cargar la carátula donde se nota (la ficha, la lista), en vez
 * de esconder el faltante.
 */
export function sinCaratula(caso: CasoNombrable): boolean {
  return !caso.caratula?.trim();
}
