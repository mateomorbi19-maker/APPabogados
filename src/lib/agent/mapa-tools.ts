import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODEL_ID } from "@/lib/anthropic";
import { calcularCosto, type Usage } from "@/lib/agent/pricing";
import type { AccionMapa } from "@/lib/schemas";
import {
  validarAccion,
  type AccionValidable,
  type ResultadoValidacion,
} from "@/lib/mapa-procesal/coherencia";
import {
  actualizarNodo,
  crearNodoHijo,
  crearRamasSimuladas,
  eliminarNodo,
  getNodosByCaso,
  marcarComoOcurrido,
} from "@/lib/mapa-procesal/queries";
import { runSimulacionMapa } from "@/lib/mapa-procesal/simulacion";
import { serializarArbolMapa } from "@/lib/mapa-procesal/serializar";
import type { Fuero, NodoProcesalDB } from "@/lib/mapa-procesal/types";

// Herramientas de ESCRITURA sobre el mapa procesal, expuestas al agente del
// chat del caso.
//
// === AISLAMIENTO POR CASO (requisito duro) ===
// Ninguna tool tiene un parámetro `caso_id`: el modelo NO puede elegir sobre
// qué caso opera. El `casoId` y el `usuarioId` viajan en `ContextoMapaTools`,
// que arma la route desde `params` y `requireUsuarioOr403()`. Además:
//   - todas las lecturas pasan por getNodosByCaso(casoId, usuarioId), que
//     verifica que el caso sea del usuario ANTES de devolver nodos;
//   - todas las mutaciones pasan por queries.ts, que repite la verificación de
//     ownership y scopea cada UPDATE/DELETE por caso_id;
//   - los identificadores de nodo que manda el modelo se resuelven contra el
//     snapshot de ESE caso (resolverRef en coherencia.ts), así que un uuid de
//     otro caso simplemente no matchea y se rechaza como inexistente.
// Resultado: no hay camino por el cual el chat del caso A toque el mapa del B.

export const MAPA_CREAR_NODO = "mapa_crear_nodo" as const;
export const MAPA_EDITAR_NODO = "mapa_editar_nodo" as const;
export const MAPA_ELIMINAR_NODO = "mapa_eliminar_nodo" as const;
export const MAPA_MARCAR_OCURRIDO = "mapa_marcar_ocurrido" as const;
export const MAPA_SIMULAR_RAMAS = "mapa_simular_ramas" as const;

export const MAPA_TOOL_NAMES: readonly string[] = [
  MAPA_CREAR_NODO,
  MAPA_EDITAR_NODO,
  MAPA_ELIMINAR_NODO,
  MAPA_MARCAR_OCURRIDO,
  MAPA_SIMULAR_RAMAS,
];

export function esToolDeMapa(nombre: string): boolean {
  return MAPA_TOOL_NAMES.includes(nombre);
}

// Preámbulo común a todas las descripciones: la doctrina de coherencia tiene
// que estar donde el modelo la lee al decidir si llama la tool, no solo en el
// system prompt.
const DOCTRINA =
  "ANTES de usarla: releé el árbol del mapa (viene en el contexto del caso y en el campo `arbol_actualizado` de la última herramienta que usaste) y verificá que el cambio sea procesalmente coherente. Si el pedido del abogado rompe la lógica del proceso penal, NO lo ejecutes: explicale por qué y proponele la alternativa correcta. El servidor valida igual y puede devolverte un rechazo (`ok:false`) con el motivo y una sugerencia — un rechazo NO es un error técnico: leelo y contáselo al abogado en tus palabras.";

const REF_NODO =
  "Identificador del nodo. Usá el id corto entre corchetes que ves en el árbol del mapa (8 caracteres). Si el servidor te avisa que el prefijo es ambiguo, repetí la llamada con el uuid completo.";

export const mapaTools: Anthropic.Tool[] = [
  {
    name: MAPA_CREAR_NODO,
    description: `Crea un nodo nuevo colgando de un nodo existente del mapa procesal del caso (queda como escenario "posible"). Usala cuando el abogado quiere registrar una etapa, un desenlace o una incidencia que todavía no está en el mapa. ${DOCTRINA} Reglas que se validan: el padre tiene que existir; no puede haber dos hijos del mismo padre con el mismo título; el nodo nuevo no puede pertenecer a una etapa ANTERIOR a la del padre (el proceso no vuelve atrás); no se cuelgan hijos de un desenlace terminal sin confirmación del abogado; riesgo_alto es SOLO para desenlaces adversos al imputado. Preferí pocos nodos significativos a muchas ramas hipotéticas.`,
    input_schema: {
      type: "object",
      properties: {
        padre_id: {
          type: "string",
          description: `${REF_NODO} Es el nodo del que va a colgar el nuevo.`,
        },
        titulo: {
          type: "string",
          description:
            "Título corto y de estilo procesal, máximo 60 caracteres, sin numeración. Usá el vocabulario del código procesal del fuero del caso.",
        },
        descripcion: {
          type: "string",
          description:
            "1 a 3 oraciones explicando qué es este nodo EN ESTE caso. Citá artículos solo si estás seguro; nunca inventes números.",
        },
        riesgo_alto: {
          type: "boolean",
          description:
            "true SOLO si es un desenlace gravoso para el imputado (prisión preventiva, condena, agravamiento de la coerción, revocación de libertad). NUNCA para desenlaces favorables o neutros (absolución, sobreseimiento, probation, falta de mérito).",
        },
        confirmar: {
          type: "boolean",
          description:
            "Mandalo en true SOLO en un mensaje POSTERIOR a un rechazo con `requiere_confirmacion: true` sobre este mismo nodo, y solo si el abogado te lo confirmó. El servidor verifica que esa advertencia haya viajado antes: si mandás confirmar de entrada, lo rechaza.",
        },
      },
      required: ["padre_id", "titulo"],
    },
  },
  {
    name: MAPA_EDITAR_NODO,
    description: `Edita el título, la descripción o la marca de riesgo de un nodo que YA existe. Usala para corregir o precisar algo del mapa, en vez de crear un nodo duplicado. ${DOCTRINA} Ojo: la etapa procesal se DERIVA del título, así que renombrar mueve de etapa a todo lo que cuelga del nodo. El servidor bloquea el renombre si genera una regresión de etapa respecto del padre, y pide confirmación si descoloca una rama que cuelga o si convierte el nodo en un desenlace terminal teniendo hijos.`,
    input_schema: {
      type: "object",
      properties: {
        nodo_id: { type: "string", description: REF_NODO },
        titulo: {
          type: "string",
          description: "Título nuevo. Omitilo si no lo estás cambiando.",
        },
        descripcion: {
          type: "string",
          description: "Descripción nueva. Omitila si no la estás cambiando.",
        },
        riesgo_alto: {
          type: "boolean",
          description:
            "Marca de riesgo alto. Solo para desenlaces adversos al imputado. Omitila si no la estás cambiando.",
        },
        confirmar: {
          type: "boolean",
          description:
            "Mandalo en true SOLO en un mensaje POSTERIOR a un rechazo con `requiere_confirmacion: true` sobre este mismo nodo, y solo si el abogado te lo confirmó. El servidor verifica que esa advertencia haya viajado antes.",
        },
      },
      required: ["nodo_id"],
    },
  },
  {
    name: MAPA_ELIMINAR_NODO,
    description: `Elimina un nodo del mapa Y TODOS SUS DESCENDIENTES (borrado en cascada, no se deshace desde el chat). Usala solo cuando el abogado pide explícitamente podar una rama descartada. ${DOCTRINA} No se puede eliminar la raíz. Si el nodo ya está marcado como ocurrido, o si arrastra descendientes, el servidor rechaza el primer intento con \`requiere_confirmacion: true\`: contale al abogado EXACTAMENTE qué se pierde y, si él confirma, repetí la llamada con confirmar: true recién en tu PRÓXIMO mensaje (el servidor no acepta el confirmar dentro del mismo turno del rechazo).`,
    input_schema: {
      type: "object",
      properties: {
        nodo_id: { type: "string", description: REF_NODO },
        confirmar: {
          type: "boolean",
          description:
            "Mandalo en true SOLO en un mensaje POSTERIOR al rechazo con `requiere_confirmacion: true` sobre este mismo nodo, y solo si el abogado confirmó el borrado. El servidor verifica que esa advertencia haya viajado antes.",
        },
      },
      required: ["nodo_id"],
    },
  },
  {
    name: MAPA_MARCAR_OCURRIDO,
    description: `Marca un nodo como OCURRIDO: pasa a ser un hecho consumado de la línea de tiempo real del caso (verde en el mapa) y desbloquea sus hijos. Usala cuando el abogado te cuenta que un hito procesal efectivamente sucedió. ${DOCTRINA} La línea de tiempo real no puede tener agujeros: el servidor rechaza la marca si algún antecedente del nodo todavía NO está marcado como ocurrido, y te dice cuáles faltan y en qué orden marcarlos. Si un antecedente no sucedió, entonces el caso avanzó por otra rama: chequealo con el abogado antes de insistir.`,
    input_schema: {
      type: "object",
      properties: {
        nodo_id: { type: "string", description: REF_NODO },
        confirmar: {
          type: "boolean",
          description:
            "Reservado para rechazos con `requiere_confirmacion: true`. Normalmente no hace falta.",
        },
      },
      required: ["nodo_id"],
    },
  },
  {
    name: MAPA_SIMULAR_RAMAS,
    description: `Proyecta con IA los escenarios más probables de cómo puede seguir el proceso desde un nodo, y los inserta como ramas hijas "posibles" del mapa. Usala cuando el abogado pregunta "¿cómo puede seguir esto?" o pide simular escenarios, NO para agregar un nodo puntual (para eso está ${MAPA_CREAR_NODO}). ${DOCTRINA} Genera entre 1 y 5 nodos de una sola vez: usala con criterio, un mapa saturado de ramas hipotéticas deja de ser legible.`,
    input_schema: {
      type: "object",
      properties: {
        nodo_id: {
          type: "string",
          description: `${REF_NODO} Es el nodo desde el cual se proyectan los escenarios.`,
        },
      },
      required: ["nodo_id"],
    },
  },
];

// === Validación del input del modelo ===
// El output del modelo es input no confiable como cualquier otro: se valida en
// el borde, igual que el body de una API route.
const refSchema = z.string().trim().min(4).max(64);

const crearInputSchema = z.object({
  padre_id: refSchema,
  titulo: z.string().trim().min(1).max(200),
  descripcion: z.string().trim().max(2000).optional(),
  riesgo_alto: z.boolean().optional(),
  confirmar: z.boolean().optional(),
});

const editarInputSchema = z
  .object({
    nodo_id: refSchema,
    titulo: z.string().trim().min(1).max(200).optional(),
    descripcion: z.string().trim().max(2000).optional(),
    riesgo_alto: z.boolean().optional(),
    // Editar también tiene rechazos confirmables (R9 sobre un título que niega
    // un instituto favorable, R3 hacia abajo, R4 al renombrar a un terminal con
    // hijos), así que necesita la misma llave que crear y eliminar.
    confirmar: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.titulo !== undefined ||
      v.descripcion !== undefined ||
      v.riesgo_alto !== undefined,
    "Hay que mandar al menos uno de: titulo, descripcion, riesgo_alto.",
  );

const soloNodoSchema = z.object({
  nodo_id: refSchema,
  confirmar: z.boolean().optional(),
});

// === Registro de rechazos confirmables ===
// `confirmar: true` no puede ser una llave que el modelo se auto-otorgue: si lo
// fuera, R4/R7/R8/R9 serían opcionales y el requisito central del producto —que
// la IA ALERTE ANTES de tocar el mapa— quedaría delegado al prompt. El registro
// guarda los rechazos confirmables que el turno ANTERIOR del agente ya le
// mostró al abogado; solo esos se pueden levantar.
export type RechazoConfirmable = {
  accion: AccionMapa["accion"];
  nodoId: string;
  regla: string;
};

export function claveRechazo(
  accion: AccionMapa["accion"],
  nodoId: string,
): string {
  return `${accion}:${nodoId.toLowerCase()}`;
}

// Reconstruye el registro desde las `acciones` persistidas del último mensaje
// del agente. Se alimenta del turno previo a propósito: un rechazo emitido en
// ESTE turno no sirve como confirmación, porque el abogado todavía no lo vio.
export function rechazosConfirmablesDeAcciones(
  acciones: AccionMapa[],
): Map<string, RechazoConfirmable> {
  const m = new Map<string, RechazoConfirmable>();
  for (const a of acciones) {
    if (a.ok || a.requiere_confirmacion !== true || !a.nodo_id) continue;
    m.set(claveRechazo(a.accion, a.nodo_id), {
      accion: a.accion,
      nodoId: a.nodo_id,
      regla: a.regla ?? "",
    });
  }
  return m;
}

export type ContextoMapaTools = {
  // Del contexto del SERVIDOR, nunca del modelo. Ver el bloque de aislamiento
  // arriba.
  casoId: string;
  usuarioId: string;
  // Contexto markdown del caso, reusado para la simulación de ramas (evita
  // reconstruirlo con otra ronda de queries dentro del turno).
  contextoCaso: string;
  // Rechazos confirmables que el agente ya le comunicó al abogado en su turno
  // anterior. Vacío en el primer mensaje de la conversación.
  rechazosConfirmables: Map<string, RechazoConfirmable>;
};

export type ResultadoToolMapa = {
  // JSON que se devuelve como tool_result al modelo.
  contentJSON: string;
  // Registro para RunAgentResult / metadata / UI.
  accion: AccionMapa;
  // Solo en 'simular': tokens del sub-call al modelo, para que el loader los
  // sume al total del turno (si no, esa llamada quedaría sin trackear).
  usageExtra?: { modelId: string; usage: Usage; costoUsd: number };
};

function jsonRechazo(
  accion: AccionMapa["accion"],
  v: Extract<ResultadoValidacion, { ok: false }>,
  arbol: string,
  // Título que el modelo PIDIÓ. Solo en 'crear': ahí `v.nodo` es el PADRE (es
  // lo único que existe cuando el nodo nuevo se rechaza), así que sin este
  // parámetro la tarjeta del chat y la nota del historial nombraban un nodo que
  // no se tocó ("No se creó el nodo · Juicio Oral"). `nodo_id` sigue siendo el
  // del padre, como documenta accionMapaSchema.
  tituloSolicitado?: string,
): ResultadoToolMapa {
  const payload = {
    ok: false as const,
    accion,
    motivo: v.motivo,
    regla: v.regla,
    sugerencia: v.sugerencia,
    ...(v.requiere_confirmacion ? { requiere_confirmacion: true } : {}),
    arbol_actualizado: arbol,
  };
  return {
    contentJSON: JSON.stringify(payload),
    accion: {
      accion,
      ok: false,
      nodo_id: v.nodo?.id ?? null,
      titulo: tituloSolicitado ?? v.nodo?.titulo ?? null,
      advertencias: v.advertencias ?? [],
      motivo: v.motivo,
      regla: v.regla,
      sugerencia: v.sugerencia,
      ...(v.requiere_confirmacion ? { requiere_confirmacion: true } : {}),
    },
  };
}

function jsonExito(
  accion: AccionMapa["accion"],
  nodo: { id: string; titulo: string } | null,
  advertencias: string[],
  arbol: string,
  extra: Record<string, unknown> = {},
): ResultadoToolMapa {
  const payload = {
    ok: true as const,
    accion,
    nodo: nodo
      ? { id: nodo.id, id_corto: nodo.id.slice(0, 8), titulo: nodo.titulo }
      : null,
    advertencias,
    ...extra,
    arbol_actualizado: arbol,
  };
  return {
    contentJSON: JSON.stringify(payload),
    accion: {
      accion,
      ok: true,
      nodo_id: nodo?.id ?? null,
      titulo: nodo?.titulo ?? null,
      advertencias,
      ...(Array.isArray(extra.creados)
        ? { creados: extra.creados as Array<{ id: string; titulo: string }> }
        : {}),
    },
  };
}

function jsonError(
  accion: AccionMapa["accion"],
  motivo: string,
): ResultadoToolMapa {
  return {
    contentJSON: JSON.stringify({ ok: false, accion, motivo, regla: "ERROR_INTERNO" }),
    accion: {
      accion,
      ok: false,
      nodo_id: null,
      titulo: null,
      advertencias: [],
      motivo,
      regla: "ERROR_INTERNO",
    },
  };
}

// Snapshot fresco del mapa DESPUÉS de cada mutación. Se relee de la DB en vez
// de parchear el array en memoria: la mutación puede tener efectos laterales
// (marcarComoOcurrido desbloquea hijos, eliminarNodo cascadea) y un árbol
// desactualizado es exactamente lo que rompe la coherencia del turno siguiente.
async function arbolActual(ctx: ContextoMapaTools): Promise<string> {
  const mapa = await getNodosByCaso(ctx.casoId, ctx.usuarioId);
  if (!mapa) return "(no se pudo releer el mapa después del cambio)";
  return serializarArbolMapa(mapa.nodos, mapa.fuero);
}

export async function ejecutarToolMapa(
  nombre: string,
  inputCrudo: unknown,
  ctx: ContextoMapaTools,
): Promise<ResultadoToolMapa> {
  const accionTipo = tipoDeAccion(nombre);
  if (!accionTipo) return jsonError("editar", `Tool desconocida "${nombre}".`);

  // TODA la ejecución va envuelta, no solo la mutación: la lectura del
  // snapshot, la serialización del árbol y la validación también pueden tirar
  // (getNodosByCaso lanza ante cualquier error de Supabase). Una excepción que
  // escapa de acá sube hasta la route como Error común, que no es AgentError:
  // ahí el turno devuelve 500 sin persistir la ejecución, y si el agente ya
  // había mutado el mapa esos cambios quedan sin rastro.
  try {
    return await despacharToolMapa(nombre, accionTipo, inputCrudo, ctx);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[mapa-tools] ${nombre} falló:`, msg);
    return jsonError(
      accionTipo,
      `La operación sobre el mapa falló: ${msg}. Contale al abogado que el cambio NO se aplicó.`,
    );
  }
}

async function despacharToolMapa(
  nombre: string,
  accionTipo: AccionMapa["accion"],
  inputCrudo: unknown,
  ctx: ContextoMapaTools,
): Promise<ResultadoToolMapa> {
  // Snapshot + ownership en un solo lugar: si el caso no es del usuario,
  // getNodosByCaso devuelve null y la tool no llega a tocar nada.
  const mapa = await getNodosByCaso(ctx.casoId, ctx.usuarioId);
  if (!mapa) {
    return jsonError(
      accionTipo,
      "No se pudo acceder al mapa de este caso. Avisale al abogado que recargue la página.",
    );
  }
  const { nodos, fuero } = mapa;
  const arbolPrevio = serializarArbolMapa(nodos, fuero);

  const parseado = parsearInput(nombre, inputCrudo);
  if (!parseado.ok) {
    return {
      contentJSON: JSON.stringify({
        ok: false,
        accion: accionTipo,
        motivo: parseado.error,
        regla: "INPUT_INVALIDO",
        sugerencia:
          "Corregí los parámetros y volvé a intentar. Si no sabés qué nodo referenciar, releé el árbol del mapa.",
        arbol_actualizado: arbolPrevio,
      }),
      accion: {
        accion: accionTipo,
        ok: false,
        nodo_id: null,
        titulo: null,
        advertencias: [],
        motivo: parseado.error,
        regla: "INPUT_INVALIDO",
      },
    };
  }

  const validable = aAccionValidable(nombre, parseado.data);
  const veredicto = validarAccion(validable, nodos, fuero);
  // Solo en 'crear': el título que el modelo pidió, para que el rechazo nombre
  // el nodo pretendido y no el padre.
  const tituloSolicitado =
    accionTipo === "crear" ? parseado.data.titulo : undefined;

  // Patrón `confirmar: true`: el primer intento se rechaza con el motivo, el
  // modelo se lo explica al abogado y, si confirma, repite la llamada con
  // confirmar en el mensaje SIGUIENTE. Solo los rechazos marcados como
  // confirmables se levantan; los bloqueos duros (raíz, ancestros faltantes,
  // regresión de etapa al crear) no.
  const confirmado = parseado.data.confirmar === true;
  let advertencias: string[] = [];
  let nodoResuelto: NodoProcesalDB | null = null;
  let cupoRestante = 0;

  if (veredicto.ok) {
    advertencias = veredicto.advertencias;
    nodoResuelto = veredicto.nodo;
    cupoRestante = veredicto.cupoRestante;
  } else if (veredicto.requiere_confirmacion && confirmado && veredicto.nodo) {
    // `confirmar: true` sirve SOLO si este mismo rechazo, sobre este mismo
    // nodo, ya viajó al abogado en el turno anterior. Sin este chequeo el
    // modelo podía saltearse la advertencia en el primer intento y el abogado
    // se enteraba del borrado en cascada (o del hijo bajo un terminal) después
    // del hecho — que es exactamente lo que la feature promete evitar.
    const previo = ctx.rechazosConfirmables.get(
      claveRechazo(accionTipo, veredicto.nodo.id),
    );
    if (!previo) {
      return jsonRechazo(
        accionTipo,
        {
          ...veredicto,
          sugerencia: `${veredicto.sugerencia} IMPORTANTE: mandaste confirmar: true sin haberle avisado antes al abogado — el servidor no registra ninguna advertencia previa sobre este nodo. Explicale ahora lo que dice el motivo, esperá su respuesta, y recién en tu PRÓXIMO mensaje volvé a llamar la herramienta con confirmar: true si él confirma.`,
        },
        arbolPrevio,
        tituloSolicitado,
      );
    }
    advertencias = [
      `Ejecutado con confirmación explícita del abogado pese a la advertencia: ${veredicto.motivo}`,
      ...(veredicto.advertencias ?? []),
    ];
    nodoResuelto = veredicto.nodo;
    cupoRestante = veredicto.cupoRestante ?? 0;
  } else {
    return jsonRechazo(accionTipo, veredicto, arbolPrevio, tituloSolicitado);
  }

  if (!nodoResuelto) {
    return jsonError(accionTipo, "No se pudo resolver el nodo objetivo.");
  }

  switch (nombre) {
    case MAPA_CREAR_NODO:
      return await ejecutarCrear(
        parseado.data as z.infer<typeof crearInputSchema>,
        nodoResuelto,
        advertencias,
        ctx,
      );
    case MAPA_EDITAR_NODO:
      return await ejecutarEditar(
        parseado.data as z.infer<typeof editarInputSchema>,
        nodoResuelto,
        advertencias,
        ctx,
      );
    case MAPA_ELIMINAR_NODO:
      return await ejecutarEliminar(nodoResuelto, advertencias, ctx);
    case MAPA_MARCAR_OCURRIDO:
      return await ejecutarMarcar(nodoResuelto, advertencias, ctx);
    case MAPA_SIMULAR_RAMAS:
      // Le pasamos el snapshot que ya leímos arriba: nada mutó desde
      // entonces (esta es la primera escritura del dispatcher) y así el
      // camino más caro no gasta dos round-trips extra a la DB.
      return await ejecutarSimular(
        nodoResuelto,
        advertencias,
        cupoRestante,
        mapa,
        ctx,
      );
    default:
      return jsonError(accionTipo, `Tool desconocida "${nombre}".`);
  }
}

function tipoDeAccion(nombre: string): AccionMapa["accion"] | null {
  switch (nombre) {
    case MAPA_CREAR_NODO:
      return "crear";
    case MAPA_EDITAR_NODO:
      return "editar";
    case MAPA_ELIMINAR_NODO:
      return "eliminar";
    case MAPA_MARCAR_OCURRIDO:
      return "marcar_ocurrido";
    case MAPA_SIMULAR_RAMAS:
      return "simular";
    default:
      return null;
  }
}

type InputParseado =
  | {
      ok: true;
      data: {
        padre_id?: string;
        nodo_id?: string;
        titulo?: string;
        descripcion?: string;
        riesgo_alto?: boolean;
        confirmar?: boolean;
      };
    }
  | { ok: false; error: string };

function parsearInput(nombre: string, crudo: unknown): InputParseado {
  const schema =
    nombre === MAPA_CREAR_NODO
      ? crearInputSchema
      : nombre === MAPA_EDITAR_NODO
        ? editarInputSchema
        : soloNodoSchema;
  const r = schema.safeParse(crudo ?? {});
  if (!r.success) {
    return {
      ok: false,
      error: `Parámetros inválidos: ${r.error.issues
        .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
        .join("; ")}`,
    };
  }
  return { ok: true, data: r.data };
}

function aAccionValidable(
  nombre: string,
  data: Extract<InputParseado, { ok: true }>["data"],
): AccionValidable {
  switch (nombre) {
    case MAPA_CREAR_NODO:
      return {
        tipo: "crear",
        padre_ref: data.padre_id ?? "",
        titulo: data.titulo ?? "",
        riesgo_alto: data.riesgo_alto,
      };
    case MAPA_EDITAR_NODO:
      return {
        tipo: "editar",
        nodo_ref: data.nodo_id ?? "",
        titulo: data.titulo,
        riesgo_alto: data.riesgo_alto,
      };
    case MAPA_ELIMINAR_NODO:
      return { tipo: "eliminar", nodo_ref: data.nodo_id ?? "" };
    case MAPA_MARCAR_OCURRIDO:
      return { tipo: "marcar_ocurrido", nodo_ref: data.nodo_id ?? "" };
    default:
      return { tipo: "simular", nodo_ref: data.nodo_id ?? "" };
  }
}

async function ejecutarCrear(
  data: z.infer<typeof crearInputSchema>,
  padre: NodoProcesalDB,
  advertencias: string[],
  ctx: ContextoMapaTools,
): Promise<ResultadoToolMapa> {
  const r = await crearNodoHijo(ctx.casoId, padre.id, ctx.usuarioId, {
    titulo: data.titulo,
    descripcion: data.descripcion ?? null,
    riesgo_alto: data.riesgo_alto ?? false,
  });
  if (r.status === "not_found") {
    return jsonError("crear", "El nodo padre ya no existe en el mapa.");
  }
  if (r.status === "tope") {
    return jsonError(
      "crear",
      `El mapa ya tiene ${r.total} nodos y el máximo es ${r.maximo}: no se creó nada. Proponele al abogado podar las hipótesis descartadas.`,
    );
  }
  const arbol = await arbolActual(ctx);
  return jsonExito("crear", r.nodo, advertencias, arbol, {
    padre: { id: padre.id, titulo: padre.titulo },
  });
}

async function ejecutarEditar(
  data: z.infer<typeof editarInputSchema>,
  nodo: NodoProcesalDB,
  advertencias: string[],
  ctx: ContextoMapaTools,
): Promise<ResultadoToolMapa> {
  const actualizado = await actualizarNodo(nodo.id, ctx.casoId, ctx.usuarioId, {
    ...(data.titulo !== undefined ? { titulo: data.titulo } : {}),
    ...(data.descripcion !== undefined ? { descripcion: data.descripcion } : {}),
    ...(data.riesgo_alto !== undefined ? { riesgo_alto: data.riesgo_alto } : {}),
  });
  if (!actualizado) {
    return jsonError("editar", "El nodo ya no existe en el mapa.");
  }
  const arbol = await arbolActual(ctx);
  return jsonExito("editar", actualizado, advertencias, arbol);
}

async function ejecutarEliminar(
  nodo: NodoProcesalDB,
  advertencias: string[],
  ctx: ContextoMapaTools,
): Promise<ResultadoToolMapa> {
  const r = await eliminarNodo(nodo.id, ctx.casoId, ctx.usuarioId);
  if (r.status !== "ok") {
    return jsonError(
      "eliminar",
      r.status === "is_raiz"
        ? "No se puede eliminar la raíz del mapa."
        : "El nodo ya no existe en el mapa.",
    );
  }
  const arbol = await arbolActual(ctx);
  // El nodo ya no existe: devolvemos su identidad previa para que el modelo (y
  // la UI) puedan nombrar lo que se borró.
  return jsonExito("eliminar", nodo, advertencias, arbol);
}

async function ejecutarMarcar(
  nodo: NodoProcesalDB,
  advertencias: string[],
  ctx: ContextoMapaTools,
): Promise<ResultadoToolMapa> {
  // Idempotente: si ya estaba ocurrido, la validación dejó una advertencia y
  // acá igual re-ejecutamos (barato) para no bifurcar el flujo.
  const actualizado = await marcarComoOcurrido(nodo.id, ctx.casoId, ctx.usuarioId);
  if (!actualizado) {
    return jsonError(
      "marcar_ocurrido",
      "El nodo ya no existe en el mapa, o es la raíz (que no se marca).",
    );
  }
  const arbol = await arbolActual(ctx);
  return jsonExito("marcar_ocurrido", actualizado, advertencias, arbol);
}

async function ejecutarSimular(
  nodo: NodoProcesalDB,
  advertencias: string[],
  cupoRestante: number,
  mapa: { nodos: NodoProcesalDB[]; fuero: Fuero | null },
  ctx: ContextoMapaTools,
): Promise<ResultadoToolMapa> {
  if (mapa.fuero === null) {
    return jsonError(
      "simular",
      "El mapa no tiene fuero asignado: no se puede simular sin saber qué código procesal aplica.",
    );
  }
  const fuero = mapa.fuero;

  const sim = await runSimulacionMapa({
    fuero,
    contextoCaso: ctx.contextoCaso,
    nodos: mapa.nodos,
    nodoObjetivo: nodo,
  });
  const usageExtra = {
    modelId: MODEL_ID,
    usage: sim.usage,
    costoUsd: calcularCosto(MODEL_ID, sim.usage),
  };

  if (!sim.ramas) {
    return {
      ...jsonError(
        "simular",
        `La simulación devolvió una respuesta que no se pudo interpretar (${sim.parseoError ?? "error de parseo"}). No se creó ningún nodo.`,
      ),
      usageExtra,
    };
  }

  // Recorte por tope de nodos: mejor guardar las primeras ramas que romper el
  // límite o perder la simulación entera (la validación ya avisó del recorte).
  const recortadas = sim.ramas.slice(0, Math.max(0, cupoRestante));
  const advertenciasFinales = [...advertencias];
  if (recortadas.length < sim.ramas.length) {
    advertenciasFinales.push(
      `La simulación propuso ${sim.ramas.length} ramas pero solo entraron ${recortadas.length} por el tope de nodos del mapa.`,
    );
  }

  // `validarSimular` solo valida el nodo PADRE. Las ramas las escribe libremente
  // un sub-modelo, así que este era el camino de escritura más voluminoso del
  // feature (hasta 5 nodos por llamada) y el único que no pasaba por el
  // validador: podía meter en el mapa exactamente lo que `mapa_crear_nodo`
  // rechaza (un sobreseimiento en rojo, dos hermanos con el mismo título). Cada
  // rama se valida contra un snapshot que va acumulando las ya aceptadas, así
  // los duplicados ENTRE ramas también se detectan.
  const ramas: typeof recortadas = [];
  const snapshot = [...mapa.nodos];
  for (const propuesta of recortadas) {
    let rama = propuesta;
    let notaR9: string | null = null;
    let v = validarRama(nodo.id, rama, snapshot, fuero);
    if (!v.ok && v.regla === "R9_RIESGO_EN_DESENLACE_FAVORABLE") {
      // El rojo sobre un desenlace favorable es un error de MARCADO, no de
      // contenido: se corrige la marca y se conserva la rama.
      rama = { ...rama, riesgo_alto: false };
      notaR9 = `"${rama.titulo}" venía marcada como riesgo alto siendo un desenlace favorable al imputado: se guardó sin la marca roja.`;
      v = validarRama(nodo.id, rama, snapshot, fuero);
    }
    // Los rechazos confirmables (p. ej. R4, simular desde un terminal) NO
    // descartan la rama: `validarSimular` ya decidió que esa proyección es
    // legítima y dejó su advertencia sobre el nodo objetivo.
    if (!v.ok && v.requiere_confirmacion !== true) {
      advertenciasFinales.push(
        `La rama "${rama.titulo}" NO se guardó: ${v.motivo}`,
      );
      continue;
    }
    if (notaR9) advertenciasFinales.push(notaR9);
    ramas.push(rama);
    snapshot.push(nodoSintetico(nodo, rama));
  }

  if (ramas.length === 0) {
    return {
      ...jsonError(
        "simular",
        recortadas.length === 0
          ? "No queda cupo de nodos en el mapa: no se guardó ninguna rama."
          : `Ninguna de las ${recortadas.length} ramas propuestas pasó la validación de coherencia: ${advertenciasFinales.join(" ")}`,
      ),
      usageExtra,
    };
  }

  const r = await crearRamasSimuladas(
    ctx.casoId,
    nodo.id,
    ctx.usuarioId,
    ramas,
  );
  if (r.status === "not_found") {
    return { ...jsonError("simular", "El nodo ya no existe en el mapa."), usageExtra };
  }
  if (r.status === "tope") {
    return {
      ...jsonError(
        "simular",
        `El mapa ya tiene ${r.total} nodos y el máximo es ${r.maximo}: no se guardó ninguna rama.`,
      ),
      usageExtra,
    };
  }

  // Solo puede pasar si el mapa creció entre el snapshot y el insert: el cupo
  // real lo tiene la DB, así que el aviso sale de ahí y no de la validación.
  if (r.descartadas > 0) {
    advertenciasFinales.push(
      `${r.descartadas} ${r.descartadas === 1 ? "rama quedó" : "ramas quedaron"} sin guardar por el tope de nodos del mapa.`,
    );
  }

  const arbol = await arbolActual(ctx);
  const resumen = r.nodos.map((c) => ({ id: c.id, titulo: c.titulo }));
  return {
    ...jsonExito("simular", nodo, advertenciasFinales, arbol, {
      creados: resumen,
    }),
    usageExtra,
  };
}

// Valida una rama simulada como si fuera un `mapa_crear_nodo` colgando del nodo
// objetivo.
function validarRama(
  padreId: string,
  rama: { titulo: string; riesgo_alto: boolean },
  snapshot: NodoProcesalDB[],
  fuero: Fuero,
): ResultadoValidacion {
  return validarAccion(
    {
      tipo: "crear",
      padre_ref: padreId,
      titulo: rama.titulo,
      riesgo_alto: rama.riesgo_alto,
    },
    snapshot,
    fuero,
  );
}

// Nodo en memoria que representa una rama ya aceptada, para que la validación
// de la rama siguiente la "vea" (detección de duplicados entre las propias
// ramas de la tanda). Nunca se persiste: el insert real lo hace
// crearRamasSimuladas con los ids que asigna Postgres.
function nodoSintetico(
  padre: NodoProcesalDB,
  rama: { titulo: string; riesgo_alto: boolean },
): NodoProcesalDB {
  return {
    ...padre,
    id: crypto.randomUUID(),
    titulo: rama.titulo,
    descripcion: null,
    tipo: "prediccion",
    estado: "desbloqueado",
    padre_id: padre.id,
    riesgo_alto: rama.riesgo_alto,
  };
}
