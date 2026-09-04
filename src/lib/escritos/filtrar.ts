// Filtro y búsqueda sobre modelos de escrito. Módulo PURO: lo usan el diálogo
// del cliente (sobre el listado que ya bajó) y la tool de LEXIE (sobre el
// catálogo + los modelos del abogado). Que las dos superficies filtren con el
// MISMO código es lo que hace que "buscá excarcelación" devuelva lo mismo en
// la pantalla y en el chat.

import { normalizarTexto, tokenizar } from "@/lib/repositorio/texto";
import type {
  CategoriaEscrito,
  ModeloEscritoResumen,
  RolSugerido,
} from "./types";

export type FiltroModelos = {
  /** Texto libre. Tildes y mayúsculas no importan. */
  q?: string;
  categoria?: CategoriaEscrito | null;
  /**
   * Rol con el que el estudio actúa en la causa. Un modelo `ambos` matchea
   * cualquiera; `defensor` y `querellante` sólo su rol. `ambos` como filtro
   * (o null) no filtra.
   */
  rol?: RolSugerido | null;
};

function textoIndexable(m: ModeloEscritoResumen): string {
  return normalizarTexto(
    [m.titulo, m.suma, m.cuando ?? "", m.base_normativa ?? "", m.claves ?? ""].join(
      " ",
    ),
  );
}

/**
 * Puntaje simple: cuántos tokens de la query aparecen en el modelo, con peso
 * extra si pegan en el título. Cero = no matchea. No es un ranking serio y no
 * hace falta: son 50 modelos y un abogado busca por una o dos palabras
 * ("excarcelación", "nulidad allanamiento").
 */
function puntaje(m: ModeloEscritoResumen, tokens: string[]): number {
  if (tokens.length === 0) return 1;
  const texto = textoIndexable(m);
  const titulo = normalizarTexto(m.titulo);
  let p = 0;
  for (const t of tokens) {
    if (titulo.includes(t)) p += 3;
    else if (texto.includes(t)) p += 1;
  }
  // Todos los tokens tienen que pegar en algún lado: "nulidad allanamiento"
  // no debería devolver los nueve modelos que dicen "nulidad".
  const todos = tokens.every((t) => texto.includes(t));
  return todos ? p : 0;
}

export function filtrarModelos<T extends ModeloEscritoResumen>(
  modelos: readonly T[],
  filtro: FiltroModelos,
): T[] {
  const tokens = tokenizar(filtro.q ?? "");
  const rol = filtro.rol && filtro.rol !== "ambos" ? filtro.rol : null;
  const conPuntaje = modelos
    .filter((m) => !filtro.categoria || m.categoria === filtro.categoria)
    .filter((m) => !rol || m.rol_sugerido === "ambos" || m.rol_sugerido === rol)
    .map((m) => ({ m, p: puntaje(m, tokens) }))
    .filter((x) => x.p > 0);

  // Con query se ordena por relevancia; sin query, se respeta el orden del
  // catálogo (por número) y los propios van después, más nuevos primero.
  if (tokens.length > 0) conPuntaje.sort((a, b) => b.p - a.p);
  return conPuntaje.map((x) => x.m);
}
