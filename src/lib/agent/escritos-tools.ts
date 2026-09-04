import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { filtrarModelos } from "@/lib/escritos/filtrar";
import { crearModelo, listarModelos, obtenerModelo } from "@/lib/escritos/queries";
import {
  CATEGORIAS_ESCRITO,
  CATEGORIA_ESCRITO_LABEL,
  ROLES_SUGERIDOS,
  type CategoriaEscrito,
  type RolSugerido,
} from "@/lib/escritos/types";

// Tools sobre los modelos de escrito. Las usa LEXIE para recomendar qué
// presentar ("que el agente le recomiende al abogado qué escrito presentar,
// esté o no en el repo de modelos") y para sumar al catálogo del abogado lo
// que ella misma redacta cuando no hay un modelo que sirva ("que lo traiga él
// desde afuera y nos nutre").
//
// === Dos familias, a propósito ===
//
// Las dos de lectura (`buscar_modelos_escrito`, `leer_modelo_escrito`) son
// inofensivas y paralelizables. `guardar_modelo_escrito` es la PRIMERA tool de
// escritura de LEXIE, que hasta acá era de solo lectura por diseño. Va en su
// propia familia con cap 1 por turno y en serie, y con dos límites que no
// dependen del prompt: el `usuario_id` sale del contexto del servidor (LEXIE
// no puede guardar un modelo a nombre de otro abogado) y el origen queda fijo
// en 'lexie', para que en el catálogo se vea de dónde salió.

export type ContextoEscritos = {
  /** Del servidor. Nunca del input del modelo. */
  usuarioId: string;
};

export const ESCRITOS_TOOL_NAMES = {
  buscar: "buscar_modelos_escrito",
  leer: "leer_modelo_escrito",
  guardar: "guardar_modelo_escrito",
} as const;

const CATEGORIAS_DESC = CATEGORIAS_ESCRITO.map(
  (c) => `${c} (${CATEGORIA_ESCRITO_LABEL[c]})`,
).join(", ");

export const escritosLecturaTools: Anthropic.Tool[] = [
  {
    name: ESCRITOS_TOOL_NAMES.buscar,
    description:
      "Busca en el catálogo de modelos de escritos judiciales: los 50 del estudio (aceptación de cargo, excarcelación, eximición, prisión domiciliaria, nulidades, prescripción, sobreseimiento, probation, apelación, casación, REF, libertad condicional, etc.) más los modelos propios del abogado. Usala cuando pregunte qué escrito presentar, cómo se pide algo, o qué modelo usar. Devuelve título, suma, cuándo se presenta y para qué rol está pensado. Sin `consulta` devuelve el catálogo entero resumido (50+ filas): preferí buscar por tema.",
    input_schema: {
      type: "object",
      properties: {
        consulta: {
          type: "string",
          description:
            "Tema o nombre del escrito, en pocas palabras ('excarcelación', 'nulidad allanamiento', 'apelación procesamiento'). Sin tildes ni mayúsculas hace falta.",
        },
        categoria: {
          type: "string",
          enum: [...CATEGORIAS_ESCRITO],
          description: `Acotar a una categoría: ${CATEGORIAS_DESC}.`,
        },
        rol: {
          type: "string",
          enum: ["defensor", "querellante"],
          description:
            "Rol del estudio en la causa. Filtra los modelos pensados para el otro lado (una denuncia no es un escrito de la defensa).",
        },
      },
    },
  },
  {
    name: ESCRITOS_TOOL_NAMES.leer,
    description:
      "Abre UN modelo de escrito completo: cuerpo tipo con sus placeholders, base normativa orientativa y las claves del estudio. Usala cuando el abogado quiera ver cómo es el modelo o pregunte qué tiene que acompañar. El `modelo_id` sale de buscar_modelos_escrito: no lo inventes.",
    input_schema: {
      type: "object",
      properties: {
        modelo_id: {
          type: "string",
          description:
            "Id del modelo tal como lo devolvió buscar_modelos_escrito (un slug como 'excarcelacion' o un UUID si es propio del abogado).",
        },
      },
      required: ["modelo_id"],
    },
  },
];

export const escritosEscrituraTools: Anthropic.Tool[] = [
  {
    name: ESCRITOS_TOOL_NAMES.guardar,
    description:
      "Guarda un modelo de escrito NUEVO en la biblioteca del abogado, redactado por vos, para cuando el catálogo no tiene lo que hace falta. Sólo cuando el abogado te lo pidió EXPLÍCITAMENTE después de ver el texto: nunca lo guardes por iniciativa propia ni antes de mostrárselo. El cuerpo es un escrito TIPO: donde va un dato de la causa escribí un placeholder entre dobles llaves ({{IMPUTADO}}, {{NRO_CAUSA}}, {{FECHA_HECHO}}), no un dato inventado. Queda marcado como redactado por LEXIE y el abogado lo puede editar o archivar desde Generar escrito.",
    input_schema: {
      type: "object",
      properties: {
        titulo: {
          type: "string",
          description: "Nombre corto del modelo ('Solicitud de arresto domiciliario por enfermedad').",
        },
        suma: {
          type: "string",
          description: "La suma en mayúsculas con la que arranca el escrito ('SOLICITA PRISIÓN DOMICILIARIA.').",
        },
        cuerpo: {
          type: "string",
          description:
            "El cuerpo tipo, en párrafos separados por línea en blanco, con placeholders {{ASI}} donde va cada dato de la causa. Mínimo 20 caracteres.",
        },
        categoria: {
          type: "string",
          enum: [...CATEGORIAS_ESCRITO],
          description: `Una de: ${CATEGORIAS_DESC}. Default 'otro'.`,
        },
        cuando: {
          type: "string",
          description: "En qué momento procesal se presenta.",
        },
        base_normativa: {
          type: "string",
          description: "Normas que lo sostienen. Orientativas.",
        },
        claves: {
          type: "string",
          description: "Qué no puede faltar al presentarlo (documentación a acompañar, pedidos en subsidio).",
        },
        rol_sugerido: {
          type: "string",
          enum: [...ROLES_SUGERIDOS],
          description: "Para quién está pensado. Default 'ambos'.",
        },
      },
      required: ["titulo", "suma", "cuerpo"],
    },
  },
];

export function esToolDeEscritos(nombre: string): boolean {
  return (Object.values(ESCRITOS_TOOL_NAMES) as string[]).includes(nombre);
}

type Resultado = { contentJSON: string; isError?: boolean };

const MAX_RESULTADOS = 12;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export async function ejecutarToolEscritos(
  nombre: string,
  input: unknown,
  ctx: ContextoEscritos,
): Promise<Resultado> {
  const args = (input ?? {}) as Record<string, unknown>;

  if (nombre === ESCRITOS_TOOL_NAMES.buscar) {
    const consulta = str(args.consulta) ?? "";
    const categoria = (CATEGORIAS_ESCRITO as readonly string[]).includes(
      String(args.categoria),
    )
      ? (args.categoria as CategoriaEscrito)
      : null;
    const rol =
      args.rol === "defensor" || args.rol === "querellante"
        ? (args.rol as RolSugerido)
        : null;

    const todos = await listarModelos(ctx.usuarioId);
    const filtrados = filtrarModelos(todos, { q: consulta, categoria, rol });
    const recorte = consulta ? filtrados.slice(0, MAX_RESULTADOS) : filtrados;
    return {
      contentJSON: JSON.stringify({
        cantidad: filtrados.length,
        mostrados: recorte.length,
        modelos: recorte.map((m) => ({
          modelo_id: m.id,
          numero: m.numero,
          origen: m.origen,
          titulo: m.titulo,
          suma: m.suma,
          cuando: m.cuando,
          categoria: m.categoria,
          rol_sugerido: m.rol_sugerido,
        })),
        nota:
          filtrados.length === 0
            ? "Ningún modelo del catálogo cubre ese tema. Decíselo al abogado tal cual. Si necesita el escrito igual, podés redactarle uno vos (con placeholders, sin datos inventados) y, si él te lo pide, guardarlo con guardar_modelo_escrito."
            : "Para generar el escrito adaptado a la causa, el abogado va a Mis casos → la causa → bloque «Escritos» → «Generar escrito» y elige el modelo por su nombre o número. Vos no podés generarlo desde acá.",
      }),
    };
  }

  if (nombre === ESCRITOS_TOOL_NAMES.leer) {
    const id = str(args.modelo_id);
    if (!id) {
      return {
        contentJSON: JSON.stringify({ ok: false, motivo: "Falta modelo_id." }),
        isError: true,
      };
    }
    // obtenerModelo filtra por usuario en los propios: un UUID ajeno vuelve null.
    const m = await obtenerModelo(id, ctx.usuarioId);
    if (!m) {
      return {
        contentJSON: JSON.stringify({
          ok: false,
          motivo: "No existe un modelo con ese id en el catálogo ni entre los modelos del abogado.",
          sugerencia: "Buscalo con buscar_modelos_escrito y usá el modelo_id que devuelva.",
        }),
      };
    }
    return {
      contentJSON: JSON.stringify({
        modelo_id: m.id,
        numero: m.numero,
        origen: m.origen,
        titulo: m.titulo,
        suma: m.suma,
        categoria: m.categoria,
        rol_sugerido: m.rol_sugerido,
        cuando: m.cuando,
        base_normativa: m.base_normativa,
        claves: m.claves,
        cuerpo_tipo: m.cuerpo,
        nota: "Las citas de artículos del modelo son orientativas: la numeración cambia entre el CPPF, el CPPN y los códigos provinciales.",
      }),
    };
  }

  if (nombre === ESCRITOS_TOOL_NAMES.guardar) {
    const titulo = str(args.titulo);
    const suma = str(args.suma);
    const cuerpo = str(args.cuerpo);
    if (!titulo || !suma || !cuerpo || cuerpo.length < 20) {
      return {
        contentJSON: JSON.stringify({
          ok: false,
          motivo: "Faltan titulo, suma o cuerpo (el cuerpo necesita al menos 20 caracteres).",
        }),
        isError: true,
      };
    }
    const categoria = (CATEGORIAS_ESCRITO as readonly string[]).includes(
      String(args.categoria),
    )
      ? (args.categoria as CategoriaEscrito)
      : "otro";
    const rol = (ROLES_SUGERIDOS as readonly string[]).includes(String(args.rol_sugerido))
      ? (args.rol_sugerido as RolSugerido)
      : "ambos";

    try {
      const m = await crearModelo(
        ctx.usuarioId,
        {
          categoria,
          titulo: titulo.slice(0, 200),
          suma: suma.slice(0, 300),
          cuando: str(args.cuando)?.slice(0, 500) ?? null,
          base_normativa: str(args.base_normativa)?.slice(0, 1000) ?? null,
          cuerpo: cuerpo.slice(0, 20000),
          claves: str(args.claves)?.slice(0, 1000) ?? null,
          rol_sugerido: rol,
        },
        "lexie",
      );
      return {
        contentJSON: JSON.stringify({
          ok: true,
          modelo_id: m.id,
          titulo: m.titulo,
          nota: "Guardado en la biblioteca del abogado, marcado como redactado por LEXIE. Decile que lo va a encontrar en Generar escrito → pestaña «Míos», y que lo puede editar o archivar desde ahí.",
        }),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        contentJSON: JSON.stringify({
          ok: false,
          motivo: `No se pudo guardar: ${msg}`,
        }),
        isError: true,
      };
    }
  }

  return {
    contentJSON: `Error: "${nombre}" no es una tool de escritos.`,
    isError: true,
  };
}
