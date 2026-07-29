// Helpers de texto compartidos entre el generador del catálogo
// (scripts/construir-catalogo-repositorio.ts) y el buscador en runtime
// (buscar.ts). Viven en un módulo aparte a propósito: si el script y el
// buscador normalizaran distinto, el campo `busqueda` precomputado no
// matchearía las queries y el buscador devolvería vacío sin explicación.
//
// Sin `server-only`: el script de Node lo importa por ruta relativa.

/** Marcas diacríticas combinantes que deja la descomposición NFD. */
const DIACRITICOS = /[\u0300-\u036f]/g;

/**
 * Minúsculas, sin acentos, sin puntuación, espacios colapsados.
 * Conserva dígitos (los números de causa y los años son términos de búsqueda
 * legítimos: "causa 22051", "2014").
 */
export function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens de una query, ya normalizados. Vacíos descartados. */
export function tokenizar(q: string): string[] {
  const n = normalizarTexto(q);
  return n.length === 0 ? [] : n.split(" ");
}

/** Slug URL-safe estable. Se usa para los ids de documento y de materia. */
export function slugificar(s: string, maxLargo = 60): string {
  return normalizarTexto(s)
    .replace(/\s+/g, "-")
    .slice(0, maxLargo)
    .replace(/^-+|-+$/g, "");
}
