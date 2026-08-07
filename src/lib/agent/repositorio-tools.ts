import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import {
  buscarEnRepositorio,
  leerDocumentoRepositorio,
  type DocumentoRecuperado,
} from "@/lib/repositorio/rag";
import { COLECCIONES_VALUES, type Coleccion } from "@/lib/repositorio/types";

// Herramientas que le dan al agente acceso al Repositorio del estudio
// (jurisprudencia y doctrina). Son DISTINTAS de `buscar_documentos_legales`, que
// busca NORMATIVA (Código Penal, CPPF, manuales de litigación) y que el agente
// sigue usando para fundar el encuadre.
//
// La separación es deliberada y está reflejada en las descripciones: la norma
// dice qué se puede hacer, el precedente muestra que ya se hizo. Si fueran una
// sola herramienta el modelo mezclaría los dos planos y terminaría citando un
// fallo donde corresponde un artículo.
//
// El repositorio es material del estudio: NO es una base pública de
// jurisprudencia. Todo lo que devuelve es un documento que Lautaro, Gonzalo o
// Mateo pusieron ahí, y el abogado lo puede abrir en la app
// (/dashboard/repositorio/<documento_id>) para verificar la cita.

export const BUSCAR_JURISPRUDENCIA = "buscar_jurisprudencia" as const;
export const LEER_JURISPRUDENCIA = "leer_jurisprudencia" as const;

const NOMBRES: readonly string[] = [BUSCAR_JURISPRUDENCIA, LEER_JURISPRUDENCIA];

export function esToolDeRepositorio(nombre: string): boolean {
  return NOMBRES.includes(nombre);
}

// ————————————————————————————————————————————————————————————————
// Declaración de las tools
// ————————————————————————————————————————————————————————————————

// El orden en el que el agente tiene que trabajar va en la DESCRIPCIÓN de la
// tool y no sólo en el system prompt: es lo que el modelo lee en el momento
// exacto de decidir si la llama, y es donde más pega.
const ORDEN =
  "CUÁNDO USARLA: recién DESPUÉS de haber construido tu hipótesis con los hechos de la causa y el encuadre dogmático. " +
  "La jurisprudencia respalda un análisis ya armado; no lo origina. Si todavía no sabés qué vas a sostener, no busques precedentes: " +
  "primero resolvé el encuadre con `buscar_documentos_legales` y con los hechos que te dio el abogado.";

export const repositorioTools: Anthropic.Tool[] = [
  {
    name: BUSCAR_JURISPRUDENCIA,
    description:
      "Busca en el REPOSITORIO INTERNO DEL ESTUDIO: fallos (jurisprudencia) y textos de autor (doctrina) que los abogados fueron juntando. " +
      "Es la base propia del estudio, no un buscador público: si un precedente no está acá, no está disponible. " +
      `${ORDEN} ` +
      "CÓMO CONSULTARLA: describí la HIPÓTESIS JURÍDICA, no los hechos crudos. " +
      "Mal: 'lo detuvieron a las 3 de la mañana en Lanús con un arma'. " +
      "Bien: 'nulidad de la requisa sin orden judicial por ausencia de estado de sospecha razonable previo'. " +
      "La búsqueda compara tu consulta contra un resumen curado de cada documento (la regla que sienta), así que anda mucho mejor con lenguaje jurídico que con relato. " +
      "Hacé una búsqueda por cada eje de tu estrategia, no una sola búsqueda gigante. " +
      "QUÉ DEVUELVE: por cada documento, la cita ya formateada, el holding (la regla que sienta), un sumario, las normas que cita y uno o dos pasajes textuales. " +
      "Podés citar SOLO lo que aparezca en esos pasajes o en el holding. Si el holding no sostiene lo que querés afirmar, ese fallo no te sirve: no lo fuerces.",
    input_schema: {
      type: "object",
      properties: {
        consulta: {
          type: "string",
          description:
            "La hipótesis jurídica a respaldar, en lenguaje técnico y en español. Una sola línea, concreta.",
        },
        coleccion: {
          type: "string",
          enum: [...COLECCIONES_VALUES],
          description:
            "Opcional. 'jurisprudencia' para buscar sólo fallos, 'doctrina' para buscar sólo textos de autor. Omitilo para buscar en las dos, que es lo normal.",
        },
        limite: {
          type: "integer",
          description:
            "Opcional, entre 1 y 10 (default 6). Subilo sólo si la primera búsqueda devolvió poco y necesitás ver más abajo del ranking.",
        },
      },
      required: ["consulta"],
    },
  },
  {
    name: LEER_JURISPRUDENCIA,
    description:
      "Trae MÁS TEXTO de un documento del repositorio que ya identificaste con `buscar_jurisprudencia`. " +
      "Usala cuando el holding te sirve pero necesitás el considerando textual para citarlo con precisión, o para verificar que el fallo dice lo que creés antes de apoyar una estrategia en él. " +
      "No la uses para explorar: para eso está la búsqueda.",
    input_schema: {
      type: "object",
      properties: {
        documento_id: {
          type: "string",
          description:
            "El `documento_id` exacto que devolvió `buscar_jurisprudencia`. No lo inventes ni lo derives del título.",
        },
        consulta: {
          type: "string",
          description:
            "Opcional. Qué parte del documento te interesa ('el fundamento del rechazo de la prisión preventiva'). Sin esto se devuelve el comienzo del documento.",
        },
      },
      required: ["documento_id"],
    },
  },
];

// ————————————————————————————————————————————————————————————————
// Registro de lo consultado (para metadata / observabilidad)
// ————————————————————————————————————————————————————————————————

/**
 * Espejo de `Busqueda` del RAG normativo, para el repositorio. Se persiste en
 * `ejecuciones.metadata.consultas_repositorio` para poder medir si el agente
 * está encontrando precedentes o buscando al vacío.
 */
export type ConsultaRepositorio = {
  consulta: string;
  coleccion: Coleccion | null;
  documentos_devueltos: number;
  similitud_top: number | null;
  documento_ids: string[];
  /**
   * Lo mismo que `documento_ids` pero con lo necesario para pintar un link en
   * el chat. Lo arma el SERVIDOR con lo que la búsqueda realmente devolvió, no
   * el modelo: así la lista de fuentes que ve el abogado no puede contener un
   * fallo inventado. Ojo con el nombre al leerla: son los documentos
   * CONSULTADOS, no necesariamente los que el agente terminó usando.
   */
  documentos: { documento_id: string; cita: string; tipo: "fallo" | "doctrina" }[];
};

// ————————————————————————————————————————————————————————————————
// Serialización para el modelo
// ————————————————————————————————————————————————————————————————

/**
 * Cita ya armada, para que el modelo no invente el formato ni mezcle campos.
 * Se prefiere la carátula sobre el título del archivo: los títulos del catálogo
 * salen de nombres de archivo del estudio y a veces traen ruido ("Fallo-Salvini
 * 2 (1)"), que en un escrito quedaría horrible.
 */
function formatearCita(d: DocumentoRecuperado): string {
  if (d.coleccion === "doctrina") {
    const partes = [d.autor, `«${d.titulo}»`].filter(Boolean);
    return partes.join(", ");
  }
  const partes: string[] = [];
  if (d.tribunal) partes.push(d.tribunal);
  partes.push(d.caratula ? `«${d.caratula}»` : `«${d.titulo}»`);
  if (d.anio) partes.push(String(d.anio));
  return partes.join(", ");
}

function serializarDocumento(d: DocumentoRecuperado): Record<string, unknown> {
  return {
    documento_id: d.documento_id,
    cita: formatearCita(d),
    tipo: d.coleccion === "doctrina" ? "doctrina" : "fallo",
    titulo_archivo: d.titulo,
    materias: d.materias,
    holding: d.holding,
    sumario: d.sumario,
    normas: d.normas,
    utilidad_defensa: d.utilidad_defensa,
    utilidad_acusacion: d.utilidad_acusacion,
    similitud: d.similitud,
    pasajes: d.pasajes.map((p) => ({
      ...(p.pagina !== null ? { pagina: p.pagina } : {}),
      texto: p.texto,
    })),
  };
}

// Este texto es la contracara operativa de la regla de Gonza: el modelo lo lee
// en el momento exacto en que la tentación de forzar una cita tangencial es más
// fuerte, o sea cuando la búsqueda vino vacía.
const SIN_RESULTADOS =
  "El repositorio no tiene ningún documento con ratio aplicable a esta hipótesis. " +
  "NO cites un fallo de memoria ni fuerces uno tangencial de otra búsqueda: decile al abogado, con esta idea, " +
  "que no se recuperaron fallos con ratio directamente aplicable a esta combinación de hechos y que la estrategia " +
  "se sostiene en los argumentos desarrollados a partir de los hechos y del encuadre procesal. " +
  "Si te parece que el tema debería estar cubierto, probá UNA reformulación con otro concepto jurídico y no más.";

// ————————————————————————————————————————————————————————————————
// Ejecución
// ————————————————————————————————————————————————————————————————

export type ResultadoToolRepositorio = {
  contentJSON: string;
  /** null cuando la tool fue `leer_jurisprudencia` (no es una búsqueda). */
  consulta: ConsultaRepositorio | null;
};

function coleccionDe(valor: unknown): Coleccion | null {
  return valor === "jurisprudencia" || valor === "doctrina" ? valor : null;
}

export async function ejecutarToolRepositorio(
  nombre: string,
  input: unknown,
): Promise<ResultadoToolRepositorio> {
  const args = (input ?? {}) as Record<string, unknown>;

  if (nombre === BUSCAR_JURISPRUDENCIA) {
    const consulta =
      typeof args.consulta === "string" ? args.consulta.trim() : "";
    const coleccion = coleccionDe(args.coleccion);
    const limite =
      typeof args.limite === "number" && Number.isFinite(args.limite)
        ? Math.floor(args.limite)
        : undefined;

    if (consulta.length === 0) {
      return {
        contentJSON: JSON.stringify({
          ok: false,
          motivo: "La consulta vino vacía. Reformulá la hipótesis y reintentá.",
        }),
        consulta: null,
      };
    }

    const r = await buscarEnRepositorio({ consulta, coleccion, limite });

    if (!r.disponible) {
      return {
        contentJSON: JSON.stringify({
          ok: false,
          motivo: r.motivo,
          sugerencia:
            "Seguí adelante sin el repositorio: fundá la estrategia en la normativa y avisale al abogado, en una línea, que el repositorio interno no está disponible en este momento.",
        }),
        consulta: {
          consulta,
          coleccion,
          documentos_devueltos: 0,
          similitud_top: null,
          documento_ids: [],
          documentos: [],
        },
      };
    }

    const registro: ConsultaRepositorio = {
      consulta,
      coleccion,
      documentos_devueltos: r.documentos.length,
      similitud_top: r.documentos[0]?.similitud ?? null,
      documento_ids: r.documentos.map((d) => d.documento_id),
      documentos: r.documentos.map((d) => ({
        documento_id: d.documento_id,
        cita: formatearCita(d),
        tipo: d.coleccion === "doctrina" ? ("doctrina" as const) : ("fallo" as const),
      })),
    };

    if (r.documentos.length === 0) {
      return {
        contentJSON: JSON.stringify({
          ok: true,
          encontrados: 0,
          instruccion: SIN_RESULTADOS,
        }),
        consulta: registro,
      };
    }

    return {
      contentJSON: JSON.stringify({
        ok: true,
        encontrados: r.documentos.length,
        documentos: r.documentos.map(serializarDocumento),
      }),
      consulta: registro,
    };
  }

  if (nombre === LEER_JURISPRUDENCIA) {
    const documentoId =
      typeof args.documento_id === "string" ? args.documento_id.trim() : "";
    const consulta =
      typeof args.consulta === "string" ? args.consulta.trim() : undefined;

    if (documentoId.length === 0) {
      return {
        contentJSON: JSON.stringify({
          ok: false,
          motivo:
            "Falta `documento_id`. Usá el que devolvió `buscar_jurisprudencia`.",
        }),
        consulta: null,
      };
    }

    const r = await leerDocumentoRepositorio(documentoId, consulta);
    if (!r.encontrado) {
      return {
        contentJSON: JSON.stringify({ ok: false, motivo: r.motivo }),
        consulta: null,
      };
    }
    return {
      contentJSON: JSON.stringify({
        ok: true,
        documento: serializarDocumento(r.documento),
      }),
      consulta: null,
    };
  }

  return {
    contentJSON: JSON.stringify({
      ok: false,
      motivo: `Tool de repositorio desconocida: "${nombre}"`,
    }),
    consulta: null,
  };
}
