import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import { nombreCaso } from "@/lib/casos/nombre";
import { rolParteLabel } from "@/lib/casos/ficha";

// Búsqueda del buscador global. Alcance: los casos del usuario que consulta.
//
// Por qué en memoria y no con full-text search de Postgres: el universo son 3
// abogados con decenas de casos cada uno, así que traer las filas y filtrarlas
// cuesta menos que mantener una columna tsvector, su trigger y su índice. Si
// esto crece a cientos de casos por usuario, el reemplazo natural es un
// `tsvector` generado sobre titulo || caso_descripcion con índice GIN — el
// contrato de `buscarCasos` no cambia.
//
// Hasta la Fase 9, "buscar por imputado" funcionaba de casualidad: el nombre
// estaba en el relato y el match caía en `relato`, sin poder decir que esa
// persona ERA el imputado. Ahora `partes_caso` existe y el resultado dice
// "Rodríguez, Carlos — imputado".

export type CampoMatch =
  | "caratula"
  | "expediente"
  | "parte"
  | "organismo"
  | "delito"
  | "titulo"
  | "relato"
  | "contexto";

export type ResultadoBusqueda = {
  id: string;
  /** Nombre resuelto de la causa (carátula si está cargada). */
  titulo: string;
  rol: string;
  actualizado_en: string;
  /** Dónde pegó la búsqueda. */
  campo: CampoMatch;
  /** Fragmento con el término en su contexto. Vacío cuando el campo se explica solo. */
  fragmento: string;
};

/**
 * Normaliza para comparar: minúsculas y sin tildes. Un abogado que escribe
 * "rodriguez" tiene que encontrar "Rodríguez", y al revés.
 *
 * ⚠️ CONSERVA LA LONGITUD, y de eso depende `fragmentoAlrededor`: NFD separa la
 * letra de su tilde y `\p{M}` borra la marca suelta, así que queda un carácter
 * por carácter base y el índice del texto normalizado sirve sobre el original.
 * Cualquier reemplazo que borre o agregue caracteres va en
 * `normalizarIdentificador`, no acá.
 */
export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/**
 * Normalización agresiva para NÚMEROS DE EXPEDIENTE: además de tildes y
 * mayúsculas, borra todo lo que no sea letra o dígito.
 *
 * Existe porque el mismo expediente se escribe de varias formas y ninguna es
 * la correcta: `12345/2026`, `12.345/2026`, `IPP 08-00-012345-26`,
 * `IPP 08000123452 6`. Con la normalización común, buscar "12345/2026" no
 * encuentra "12.345/2026" — que es exactamente el caso en que el abogado copia
 * el número de un mail y lo pega acá.
 *
 * NO conserva la longitud, así que no se puede usar para calcular fragmentos.
 * No hace falta: un expediente que pega se muestra entero.
 */
export function normalizarIdentificador(s: string): string {
  return normalizar(s).replace(/[^a-z0-9]/g, "");
}

const RADIO_FRAGMENTO = 60;

/**
 * Recorta un fragmento del texto alrededor de la primera aparición del término,
 * con elipsis a los costados si hay más texto. `posicion` viene del texto YA
 * normalizado con `normalizar`, que conserva la longitud.
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
  caratula: string | null;
  expediente_numero: string | null;
  organismo: string | null;
  delitos: string[] | null;
  rol: string;
  contexto: Record<string, unknown> | null;
  caso_descripcion: string;
  actualizado_en: string;
};

type FilaParte = {
  caso_id: string;
  nombre: string;
  rol: string;
};

// Prioridad de campo. La carátula y el expediente van primero porque son los
// dos identificadores del expediente: si el abogado tipeó el número, quiere ESA
// causa y no una que menciona el número en el relato. Las partes van antes que
// el título de trabajo porque un nombre propio casi siempre se busca como
// persona, no como texto.
const PESO_CAMPO: Record<CampoMatch, number> = {
  caratula: 0,
  expediente: 1,
  parte: 2,
  titulo: 3,
  delito: 4,
  organismo: 5,
  contexto: 6,
  relato: 7,
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
  const crudo = consulta.trim();
  const termino = normalizar(crudo);
  if (termino.length < 2) return [];
  const terminoId = normalizarIdentificador(crudo);

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("casos")
    .select(
      "id, titulo, caratula, expediente_numero, organismo, delitos, rol, contexto, caso_descripcion, actualizado_en",
    )
    .eq("usuario_id", usuarioId)
    .order("actualizado_en", { ascending: false });

  if (error) throw new Error(`buscarCasos: ${error.message}`);

  const filas = (data ?? []) as unknown as FilaCaso[];
  if (filas.length === 0) return [];

  // Las partes de TODAS las causas del usuario en una sola query, igual que
  // GET /api/casos hace con los eventos. Con 3 usuarios sale más barato que N+1.
  // Un fallo acá degrada a "sin partes": el buscador sigue encontrando por
  // carátula y relato, que es lo que hacía antes.
  const { data: partesData, error: partesErr } = await supabase
    .from("partes_caso")
    .select("caso_id, nombre, rol")
    .in(
      "caso_id",
      filas.map((f) => f.id),
    );
  if (partesErr) {
    console.error("[buscarCasos] error cargando partes:", partesErr);
  }
  const partesPorCaso = new Map<string, FilaParte[]>();
  for (const p of ((partesData ?? []) as unknown as FilaParte[])) {
    const lista = partesPorCaso.get(p.caso_id);
    if (lista) lista.push(p);
    else partesPorCaso.set(p.caso_id, [p]);
  }

  const salida: ResultadoBusqueda[] = [];

  for (const c of filas) {
    const nombre = nombreCaso(c);

    // El expediente se compara aparte, con la normalización agresiva: es el
    // único campo donde la puntuación es decorativa.
    if (
      c.expediente_numero &&
      terminoId.length >= 2 &&
      normalizarIdentificador(c.expediente_numero).includes(terminoId)
    ) {
      salida.push({
        id: c.id,
        titulo: nombre,
        rol: c.rol,
        actualizado_en: c.actualizado_en,
        campo: "expediente",
        fragmento: c.expediente_numero,
      });
      continue;
    }

    // Una parte que pega gana a cualquier match de texto salvo la carátula:
    // buscar un apellido es buscar a una persona.
    const parteMatch = (partesPorCaso.get(c.id) ?? []).find((p) =>
      normalizar(p.nombre).includes(termino),
    );

    // El orden de evaluación ES la prioridad: nos quedamos con el primer campo
    // que pegue, así cada caso aparece una sola vez en los resultados.
    const candidatos: Array<{ campo: CampoMatch; texto: string }> = [
      { campo: "caratula", texto: c.caratula ?? "" },
      ...(parteMatch
        ? [
            {
              campo: "parte" as CampoMatch,
              texto: `${parteMatch.nombre} — ${rolParteLabel(parteMatch.rol)}`,
            },
          ]
        : []),
      { campo: "titulo", texto: c.titulo },
      { campo: "delito", texto: (c.delitos ?? []).join(" · ") },
      { campo: "organismo", texto: c.organismo ?? "" },
      { campo: "contexto", texto: contextoATexto(c.contexto) },
      { campo: "relato", texto: c.caso_descripcion },
    ];

    for (const { campo, texto } of candidatos) {
      if (!texto) continue;
      const pos = normalizar(texto).indexOf(termino);
      if (pos === -1) continue;
      salida.push({
        id: c.id,
        titulo: nombre,
        rol: c.rol,
        actualizado_en: c.actualizado_en,
        campo,
        // El fragmento se omite cuando el texto que pegó ES el que ya se
        // muestra como nombre de la fila: repetirlo abajo no aporta nada. Se
        // compara contra el nombre y no por nombre de campo, porque `titulo`
        // cae de los dos lados — es el nombre mostrado cuando no hay carátula,
        // y un dato distinto y no visible cuando sí la hay.
        //
        // Los campos cortos que sí se muestran van enteros: recortar "Robo
        // agravado" a un fragmento con elipsis no aclara nada. Los largos
        // (relato, formulario) van recortados alrededor del match.
        fragmento:
          texto === nombre
            ? ""
            : campo === "relato" || campo === "contexto"
              ? fragmentoAlrededor(texto, pos, termino.length)
              : texto,
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
