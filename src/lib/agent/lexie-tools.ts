import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { buscarCasos } from "@/lib/casos/buscar";
import { buildContextoCaso } from "@/lib/casos/build-contexto-caso";
import { casoEsDelUsuario, getEventosByUser } from "@/lib/agenda/queries";
import {
  ahoraPartesAR,
  partesAIsoAR,
  sumarDias,
  type PartesFecha,
} from "@/lib/agenda/tz-ar";
import { TIPOS_EVENTO } from "@/lib/agenda/types";

// Tools de LEXIE, el asistente global. TODAS son de solo lectura en la v1.
//
// === La regla que gobierna este archivo ===
//
// En el chat por caso, el aislamiento entre abogados es ESTRUCTURAL: el
// `casoId` sale de la URL y ninguna tool tiene un parámetro `caso_id` — el
// modelo literalmente no puede elegir sobre qué caso opera. LEXIE rompe esa
// garantía por diseño: es global, así que el caso lo elige el modelo.
//
// Y no hay red de contención abajo. El servidor consulta Supabase con la
// service_role key, que BYPASSA RLS: si una tool se olvida el filtro, devuelve
// el caso de otro abogado sin que nada la frene.
//
// Por eso acá vale una sola regla, sin excepciones: **todo id que venga del
// modelo se valida contra el usuario del contexto ANTES de leer nada**, y
// `usuarioId` viaja en el contexto del servidor — nunca en un input_schema
// donde el modelo pueda escribirlo.

export type ContextoLexie = {
  /** Del servidor, vía requireUsuarioOr403. JAMÁS del input del modelo. */
  usuarioId: string;
  nombre: string;
};

export const LEXIE_TOOL_NAMES = {
  leerCaso: "leer_caso",
  miAgenda: "mi_agenda",
  buscarCasos: "buscar_mis_casos",
} as const;

// Rangos que el modelo puede pedir, en vez de obligarlo a construir fechas ISO
// con offset -03:00 (que se equivoca, y cuando se equivoca devuelve la agenda
// de otro día sin que nadie lo note). El servidor traduce el rango a fechas
// usando la hora de pared argentina.
const RANGOS = [
  "hoy",
  "manana",
  "proximos_7_dias",
  "proximos_30_dias",
  "esta_semana_laboral",
] as const;
type Rango = (typeof RANGOS)[number];

function inicioDelDia(p: PartesFecha): PartesFecha {
  return { ...p, h: 0, mi: 0 };
}
function finDelDia(p: PartesFecha): PartesFecha {
  return { ...p, h: 23, mi: 59 };
}

/**
 * Traduce un rango a un par desde/hasta en hora de pared argentina.
 *
 * Existía solo del lado del cliente (`rangoABounds` en agenda-view.tsx) y usaba
 * `setHours()` sobre la hora local del browser. Eso acá no sirve: el server
 * corre en UTC, así que "hoy" habría empezado a las 21:00 del día anterior.
 */
export function rangoAFechas(
  rango: Rango,
  ahora: PartesFecha = ahoraPartesAR(),
): { desde: string; hasta: string; etiqueta: string } {
  const hoy = inicioDelDia(ahora);
  switch (rango) {
    case "hoy":
      return {
        desde: partesAIsoAR(hoy),
        hasta: partesAIsoAR(finDelDia(ahora)),
        etiqueta: "hoy",
      };
    case "manana": {
      const m = sumarDias(hoy, 1);
      return {
        desde: partesAIsoAR(m),
        hasta: partesAIsoAR(finDelDia(m)),
        etiqueta: "mañana",
      };
    }
    case "proximos_7_dias":
      return {
        desde: partesAIsoAR(ahora),
        hasta: partesAIsoAR(finDelDia(sumarDias(hoy, 7))),
        etiqueta: "los próximos 7 días",
      };
    case "proximos_30_dias":
      return {
        desde: partesAIsoAR(ahora),
        hasta: partesAIsoAR(finDelDia(sumarDias(hoy, 30))),
        etiqueta: "los próximos 30 días",
      };
    case "esta_semana_laboral": {
      // dowDe: 0=domingo. Lunes de esta semana = hoy - (dow - 1), con domingo
      // contando como el final de la semana anterior.
      const dow = new Date(Date.UTC(hoy.y, hoy.mo, hoy.d)).getUTCDay();
      const haciaLunes = dow === 0 ? -6 : 1 - dow;
      const lunes = sumarDias(hoy, haciaLunes);
      return {
        desde: partesAIsoAR(lunes),
        hasta: partesAIsoAR(finDelDia(sumarDias(lunes, 4))),
        etiqueta: "esta semana (lunes a viernes)",
      };
    }
  }
}

export const lexieTools: Anthropic.Tool[] = [
  {
    name: LEXIE_TOOL_NAMES.miAgenda,
    description:
      "Consulta la agenda del abogado: audiencias, vencimientos procesales, presentaciones, reuniones y tareas. Usala cuando pregunte qué tiene hoy, mañana, esta semana, o si hay algo próximo. Devuelve los eventos ordenados cronológicamente con su tipo, fecha, hora y la causa asociada si tiene.",
    input_schema: {
      type: "object",
      properties: {
        rango: {
          type: "string",
          enum: [...RANGOS],
          description:
            "Período a consultar. Elegí el más acotado que responda la pregunta: para '¿qué tengo hoy?' usá 'hoy', no 'proximos_7_dias'.",
        },
      },
      required: ["rango"],
    },
  },
  {
    name: LEXIE_TOOL_NAMES.buscarCasos,
    description:
      "Busca entre las causas del abogado por texto libre: nombre de un imputado, carátula, delito, o cualquier palabra que aparezca en el relato del caso. Usala cuando mencione una causa que no está en la lista que ya tenés en el contexto, o cuando busque por el nombre de una persona. Devuelve el fragmento donde encontró el término.",
    input_schema: {
      type: "object",
      properties: {
        consulta: {
          type: "string",
          description:
            "Término a buscar. Mínimo 2 caracteres. No hace falta respetar tildes ni mayúsculas.",
        },
      },
      required: ["consulta"],
    },
  },
  {
    name: LEXIE_TOOL_NAMES.leerCaso,
    description:
      "Abre el expediente completo de UNA causa: el relato original, las respuestas del formulario de análisis, la estrategia elegida si hay una, y la línea de tiempo de lo que fue pasando. Usala cuando el abogado pregunte por una causa concreta y necesites el detalle. El caso_id sale de la lista de causas del contexto o de buscar_mis_casos: no lo inventes.",
    input_schema: {
      type: "object",
      properties: {
        caso_id: {
          type: "string",
          description: "UUID de la causa, tal como aparece en el contexto o en el resultado de buscar_mis_casos.",
        },
      },
      required: ["caso_id"],
    },
  },
];

export function esToolDeLexie(nombre: string): boolean {
  return lexieTools.some((t) => t.name === nombre);
}

// Aviso que acompaña TODA respuesta de agenda. No es un detalle técnico: la
// tabla `eventos_agenda` no es el calendario del abogado. El pull desde Google
// es update-only (google-pull.ts: "Decisión 1: update-only"), así que un evento
// creado desde el celular o desde calendar.google.com NUNCA entra a la app.
//
// Sin esta advertencia, LEXIE contestaría "mañana no tenés nada" con total
// convicción y estaría diciendo algo falso. Es el peor error posible para un
// asistente: correcto respecto de la base, falso respecto de la realidad. Que
// el modelo lo sepa es lo único que hoy separa una respuesta útil de una
// mentira con formato de dato.
const AVISO_AGENDA_PARCIAL =
  "IMPORTANTE: esta agenda solo contiene los eventos cargados DESDE LA APP. Los eventos que el abogado haya creado directamente en Google Calendar (desde el celular, por ejemplo) no están acá. Si la respuesta es que no hay nada, o si el abogado parece esperar un evento que no aparece, aclarale que vos solo ves lo cargado en la app.";

type ResultadoLexie = { contentJSON: string; isError?: boolean };

export async function ejecutarToolLexie(
  nombre: string,
  input: unknown,
  ctx: ContextoLexie,
): Promise<ResultadoLexie> {
  const args = (input ?? {}) as Record<string, unknown>;

  if (nombre === LEXIE_TOOL_NAMES.miAgenda) {
    const rango = RANGOS.includes(args.rango as Rango)
      ? (args.rango as Rango)
      : "proximos_7_dias";
    const { desde, hasta, etiqueta } = rangoAFechas(rango);
    const eventos = await getEventosByUser(ctx.usuarioId, { desde, hasta });
    return {
      contentJSON: JSON.stringify({
        rango: etiqueta,
        cantidad: eventos.length,
        // NOTA: getEventosByUser filtra por fecha_inicio, no por solapamiento.
        // Un evento que empezó ayer y sigue hoy no aparece en "hoy". Con
        // audiencias y vencimientos —que son puntuales— no se nota; si algún
        // día hay eventos de varios días, hay que cambiar el filtro.
        eventos: eventos.map((e) => ({
          titulo: e.titulo,
          tipo: TIPOS_EVENTO[e.tipo]?.label ?? e.tipo,
          clase: e.clase,
          prioridad: e.prioridad,
          cuando: e.todo_el_dia
            ? `${e.fecha_inicio.slice(0, 10)} (todo el día)`
            : e.fecha_inicio,
          causa: e.nombre_caso ?? null,
          completado: e.completado,
          descripcion: e.descripcion,
        })),
        aviso: AVISO_AGENDA_PARCIAL,
      }),
    };
  }

  if (nombre === LEXIE_TOOL_NAMES.buscarCasos) {
    const consulta = typeof args.consulta === "string" ? args.consulta : "";
    if (consulta.trim().length < 2) {
      return {
        contentJSON: JSON.stringify({
          resultados: [],
          nota: "La consulta necesita al menos 2 caracteres.",
        }),
      };
    }
    const r = await buscarCasos(ctx.usuarioId, consulta);
    return {
      contentJSON: JSON.stringify({
        cantidad: r.length,
        resultados: r.map((x) => ({
          caso_id: x.id,
          titulo: x.titulo,
          rol: x.rol,
          donde_pego: x.campo,
          fragmento: x.fragmento,
        })),
        nota:
          r.length === 0
            ? "Ninguna causa del abogado menciona ese término. Decíselo tal cual: no inventes una causa ni asumas que existe."
            : undefined,
      }),
    };
  }

  if (nombre === LEXIE_TOOL_NAMES.leerCaso) {
    const casoId = typeof args.caso_id === "string" ? args.caso_id : "";
    if (!casoId) {
      return {
        contentJSON: JSON.stringify({
          ok: false,
          motivo: "Falta caso_id.",
        }),
        isError: true,
      };
    }

    // === El chequeo que sostiene todo ===
    // buildContextoCaso NO valida propiedad: filtra solo por id, y está
    // documentada asumiendo que "el caller ya autenticó". Ese supuesto era
    // cierto mientras el casoId salía de la URL. Acá lo elige el modelo, así
    // que el caller que autentica es ESTA línea. Sin ella, un id filtrado en
    // cualquier lado abre el expediente de otro abogado.
    const esDelUsuario = await casoEsDelUsuario(casoId, ctx.usuarioId);
    if (!esDelUsuario) {
      return {
        contentJSON: JSON.stringify({
          ok: false,
          motivo:
            "No existe ninguna causa con ese id entre las causas de este abogado.",
          sugerencia:
            "Puede que hayas inventado o confundido el id. Usá buscar_mis_casos, o pedile al abogado que te diga de qué causa se trata.",
        }),
      };
    }

    const { contextoMarkdown } = await buildContextoCaso(casoId, {
      // El mapa procesal se deja afuera: en la v1 LEXIE no lo puede modificar,
      // y sumarlo duplicaría en el contexto algo que el chat del propio caso ya
      // muestra mejor. Si el abogado pregunta por el estado procesal, LEXIE lo
      // manda al mapa de esa causa.
      incluirMapa: false,
    });
    return { contentJSON: contextoMarkdown };
  }

  return {
    contentJSON: `Error: "${nombre}" no es una tool de LEXIE.`,
    isError: true,
  };
}
