import "server-only";
import { createServerClient } from "@/lib/supabase/server";

// Búsqueda del buscador global. Alcance: los casos del usuario que consulta.
//
// Por qué en memoria y no con full-text search de Postgres: el universo son 3
// abogados con decenas de casos cada uno, así que traer las filas y filtrarlas
// cuesta menos que mantener una columna tsvector, su trigger y su índice. Si
// esto crece a cientos de casos por usuario, el reemplazo natural es un
// `tsvector` generado sobre titulo || caso_descripcion con índice GIN — el
// contrato de `buscarCasos` no cambia.
//
// "Buscar por imputado" funciona sin una columna de imputados porque el nombre
// del imputado vive en el relato (`caso_descripcion`) y, casi siempre, también
// en el título de la causa. El fragmento que devolvemos muestra dónde pegó,
// para que el abogado vea por qué apareció ese caso.

export type CampoMatch = "titulo" | "relato" | "contexto";

export type ResultadoBusqueda = {
  id: string;
  titulo: string;
  rol: string;
  actualizado_en: string;
  /** Dónde pegó la búsqueda. */
  campo: CampoMatch;
  /** Fragmento con el término en su contexto. Vacío cuando pegó en el título. */
  fragmento: string;
};

/**
 * Normaliza para comparar: minúsculas y sin tildes. Un abogado que escribe
 * "rodriguez" tiene que encontrar "Rodríguez", y al revés.
 */
export function normalizar(s: string): string {
  // NFD separa la letra de su tilde; \p{M} borra las marcas de combinación que
  // quedaron sueltas. "Rodríguez" y "Rodriguez" terminan siendo el mismo string.
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

const RADIO_FRAGMENTO = 60;

/**
 * Recorta un fragmento del texto alrededor de la primera aparición del término,
 * con elipsis a los costados si hay más texto. `posicion` viene del texto YA
 * normalizado; como `normalizar` no cambia la longitud (NFD + drop de marcas de
 * combinación conserva un char por char base), el índice sirve sobre el original.
 */
function fragmentoAlrededor(texto: string, posicion: number, largo: number): string {
  const desde = Math.max(0, posicion - RADIO_FRAGMENTO);
  const hasta = Math.min(texto.length, posicion + largo + RADIO_FRAGMENTO);
  const cuerpo = texto.slice(desde, hasta).replace(/\s+/g, " ").trim();
  return `${desde > 0 ? "…" : ""}${cuerpo}${hasta < texto.length ? "…" : ""}`;
}

type FilaCaso = {
  id: string;
  titulo: string;
  rol: string;
  contexto: Record<string, unknown> | null;
  caso_descripcion: string;
  actualizado_en: string;
};

// Prioridad de campo: un match en el título es más relevante que uno en el
// relato, porque el título es lo que el abogado eligió para nombrar la causa.
const PESO_CAMPO: Record<CampoMatch, number> = {
  titulo: 0,
  contexto: 1,
  relato: 2,
};

/** Aplana los valores del contexto del formulario a una sola línea buscable. */
function contextoATexto(contexto: Record<string, unknown> | null): string {
  if (!contexto) return "";
  return Object.values(contexto)
    .filter((v) => typeof v === "string" || typeof v === "number")
    .join(" · ");
}

export async function buscarCasos(
  usuarioId: string,
  consulta: string,
  limite = 8,
): Promise<ResultadoBusqueda[]> {
  const termino = normalizar(consulta.trim());
  if (termino.length < 2) return [];

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("casos")
    .select("id, titulo, rol, contexto, caso_descripcion, actualizado_en")
    .eq("usuario_id", usuarioId)
    .order("actualizado_en", { ascending: false });

  if (error) throw new Error(`buscarCasos: ${error.message}`);

  const filas = (data ?? []) as unknown as FilaCaso[];
  const salida: ResultadoBusqueda[] = [];

  for (const c of filas) {
    // El orden de evaluación ES la prioridad: nos quedamos con el primer campo
    // que pegue, así cada caso aparece una sola vez en los resultados.
    const candidatos: Array<{ campo: CampoMatch; texto: string }> = [
      { campo: "titulo", texto: c.titulo },
      { campo: "contexto", texto: contextoATexto(c.contexto) },
      { campo: "relato", texto: c.caso_descripcion },
    ];

    for (const { campo, texto } of candidatos) {
      const pos = normalizar(texto).indexOf(termino);
      if (pos === -1) continue;
      salida.push({
        id: c.id,
        titulo: c.titulo,
        rol: c.rol,
        actualizado_en: c.actualizado_en,
        campo,
        fragmento:
          campo === "titulo" ? "" : fragmentoAlrededor(texto, pos, termino.length),
      });
      break;
    }
  }

  // Primero por relevancia de campo; a igual campo, el caso tocado más
  // recientemente. La query ya vino ordenada por actualizado_en desc, y
  // Array.sort es estable, así que basta con ordenar por peso.
  salida.sort((a, b) => PESO_CAMPO[a.campo] - PESO_CAMPO[b.campo]);
  return salida.slice(0, limite);
}
