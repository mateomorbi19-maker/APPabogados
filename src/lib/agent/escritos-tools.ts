import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AccionLexie } from "@/lib/lexie/acciones";
import {
  claveAccion,
  emitirPendiente,
  jsonRechazoConfirmacion,
  resolverConfirmacion,
  type ResolucionConfirmacion,
} from "@/lib/lexie/confirmacion";
import {
  ejecutarPorTexto,
  resolverPendiente,
  type CtxEjecucion,
  type DominioLexie,
  type FamiliaLexie,
} from "@/lib/agent/lexie-dominio";
import {
  dictadoPorElAbogado,
  enCuarentena,
  NOTA_CUARENTENA,
  type ContextoLexie,
  type ResultadoToolLexie,
} from "@/lib/agent/lexie-tools";
import { filtrarModelos } from "@/lib/escritos/filtrar";
import {
  actualizarPerfilProfesional,
  crearModelo,
  getPerfilProfesional,
  listarModelos,
  obtenerModelo,
} from "@/lib/escritos/queries";
import {
  generarEscritoParaCaso,
  MENSAJE_SIN_MIGRACION_ESCRITOS,
  prevueloEscrito,
  type GenerarEscritoFallo,
  type PrevueloEscritoFallo,
  type PrevueloEscritoOk,
} from "@/lib/escritos/generar-escrito";
import {
  CATEGORIAS_ESCRITO,
  esUuid,
  ORIGEN_MODELO_LABEL,
  ROLES_SUGERIDOS,
  type CategoriaEscrito,
  type PerfilProfesional,
  type RolSugerido,
} from "@/lib/escritos/types";

// Tools de escritos judiciales de LEXIE. Recomendar qué presentar ("que el
// agente le recomiende al abogado qué escrito presentar, esté o no en el repo
// de modelos"), sumar al catálogo lo que ella misma redacta ("que lo traiga él
// desde afuera y nos nutre"), y —desde 11.6— GENERAR el escrito de una causa
// y completar el perfil profesional que va en el encabezado y la firma.
//
// === Tres familias, a propósito ===
//
// - `escritos` (lectura, paralela, cap 4): `buscar_modelos_escrito` y
//   `leer_modelo_escrito`. Inofensivas.
// - `escritos_escritura` (en serie, cap 2): `guardar_modelo_escrito` y
//   `actualizar_perfil_profesional`. Las dos son REVERSIBLES desde la app (un
//   modelo se archiva, el perfil se corrige), así que se ejecutan directo;
//   pisar un dato ya cargado del perfil, o cualquier escritura bajo cuarentena
//   de correo, pasa a pedir confirmación.
// - `escritos_generacion` (en serie, cap 1): `generar_escrito_causa`. Es la
//   acción COSTOSA del dominio (~USD 0,09 y 40-90 segundos). Va en familia
//   propia para que guardar un modelo y generar no compitan por el mismo
//   cupo: un turno típico es "no hay modelo → redactalo → guardalo → generá
//   el escrito con ése", y eso son dos escrituras distintas.
//
// Los dos límites que no dependen del prompt, iguales para todas: el
// `usuario_id` sale del contexto del servidor (LEXIE no puede guardar un
// modelo, tocar el perfil ni generar un escrito a nombre de otro abogado) y
// todo `caso_id` o `modelo_id` que venga del modelo se valida contra ese
// usuario ANTES de leer nada —`prevueloEscrito` y `obtenerModelo` lo hacen
// adentro, y un id ajeno se contesta igual que uno inexistente.
//
// === La generación es SIEMPRE por el botón ===
//
// `generar_escrito_causa` tiene dos pasos y el segundo no ocurre acá. El
// primer llamado es el PRE-VUELO gratis: qué datos del expediente se van a
// usar, qué va a salir como [COMPLETAR: …], si al abogado le falta el perfil,
// las instrucciones exactas, costo y duración. Eso queda como pendiente con
// su clave. Y aunque el abogado confirme por TEXTO ("dale, generalo"), la
// tool NO genera dentro del turno: la redacción tarda hasta 90 segundos y
// correría adentro de la vuelta del modelo, sumando la latencia de LEXIE
// encima y contra el timeout del proxy de Easypanel. Se rechaza con "usá el
// botón" y la pendiente se RE-EMITE tal cual (misma clave, mismo payload),
// porque sólo el último mensaje del agente tiene tarjetas activas: una
// `rechazada` sola mataría el botón que le estamos pidiendo que toque.

export type ContextoEscritos = {
  /** Del servidor. Nunca del input del modelo. */
  usuarioId: string;
};

export const ESCRITOS_TOOL_NAMES = {
  buscar: "buscar_modelos_escrito",
  leer: "leer_modelo_escrito",
  guardar: "guardar_modelo_escrito",
  perfil: "actualizar_perfil_profesional",
  generar: "generar_escrito_causa",
} as const;

// Las descripciones son cortas a propósito: van en el prefijo cacheado de
// LEXIE y se pagan en cada apertura de hilo. Lo que el system ya dice (cómo
// se confirma, qué no se inventa) no se repite acá.
export const escritosLecturaTools: Anthropic.Tool[] = [
  {
    name: ESCRITOS_TOOL_NAMES.buscar,
    description:
      "Busca en el catálogo de modelos de escritos judiciales (los 50 del estudio más los propios del abogado). Devuelve modelo_id, número, título, suma, cuándo se presenta y rol. Sin `consulta` devuelve el catálogo entero: preferí buscar por tema.",
    input_schema: {
      type: "object",
      properties: {
        consulta: {
          type: "string",
          description: "Tema o nombre del escrito ('excarcelación', 'nulidad allanamiento').",
        },
        categoria: {
          type: "string",
          enum: [...CATEGORIAS_ESCRITO],
        },
        rol: {
          type: "string",
          enum: ["defensor", "querellante"],
          description: "Rol del estudio en la causa; filtra los del otro lado.",
        },
      },
    },
  },
  {
    name: ESCRITOS_TOOL_NAMES.leer,
    description:
      "Abre un modelo completo: cuerpo tipo con placeholders, base normativa orientativa y claves del estudio. Usala para mostrárselo al abogado o decirle qué acompañar.",
    input_schema: {
      type: "object",
      properties: {
        modelo_id: {
          type: "string",
          description: "Tal como lo devolvió buscar_modelos_escrito.",
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
      "Guarda en la biblioteca del abogado un modelo NUEVO redactado por vos; sólo a pedido explícito tras mostrarle el texto.",
    input_schema: {
      type: "object",
      properties: {
        titulo: { type: "string" },
        suma: {
          type: "string",
          description: "En mayúsculas.",
        },
        cuerpo: {
          type: "string",
          description: "Placeholders {{ASI}} donde va cada dato de la causa; nada inventado.",
        },
        categoria: {
          type: "string",
          enum: [...CATEGORIAS_ESCRITO],
        },
        cuando: { type: "string" },
        base_normativa: { type: "string" },
        claves: {
          type: "string",
          description: "Qué acompañar.",
        },
        rol_sugerido: {
          type: "string",
          enum: [...ROLES_SUGERIDOS],
        },
      },
      required: ["titulo", "suma", "cuerpo"],
    },
  },
  {
    name: ESCRITOS_TOOL_NAMES.perfil,
    description:
      "Carga o corrige los datos del encabezado y la firma de todo escrito. Usala si el pre-vuelo de generar_escrito_causa avisa que el perfil está incompleto o si el abogado te los dicta; sólo con valores escritos por él en este hilo. Confirmable al pisar un dato cargado: queda pendiente con el antes y el después; luego {clave, confirmar:true}.",
    input_schema: {
      type: "object",
      properties: {
        nombre_completo: { type: "string" },
        matricula: {
          type: "string",
          description: "Tomo y folio ('T° 123 F° 456').",
        },
        domicilio_constituido: { type: "string" },
        domicilio_electronico: { type: "string" },
        clave: {
          type: "string",
          description: "Clave de la pendiente.",
        },
        confirmar: {
          type: "boolean",
          description: "Sólo con clave, en el mensaje siguiente.",
        },
      },
    },
  },
];

export const escritosGeneracionTools: Anthropic.Tool[] = [
  {
    name: ESCRITOS_TOOL_NAMES.generar,
    description:
      "Prepara el escrito de una causa desde un modelo, adaptado al expediente, como borrador en la ficha. Cuesta plata: sólo si el abogado lo pidió. El primer llamado es un pre-vuelo gratis que queda pendiente (datos usados, huecos [COMPLETAR: …], perfil, costo, duración). La genera SÓLO el botón de la tarjeta: por texto el servidor la rechaza.",
    input_schema: {
      type: "object",
      properties: {
        caso_id: {
          type: "string",
          description: "Omitilo si está parado en la causa.",
        },
        modelo_id: {
          type: "string",
          description: "De buscar_modelos_escrito o guardar_modelo_escrito.",
        },
        instrucciones: {
          type: "string",
          description: "Lo que pidió el abogado, tal cual. Hasta 4000 caracteres.",
        },
        clave: {
          type: "string",
          description: "Clave de la pendiente.",
        },
        confirmar: { type: "boolean" },
      },
      required: ["modelo_id"],
    },
  },
];

export function esToolDeEscritos(nombre: string): boolean {
  return (Object.values(ESCRITOS_TOOL_NAMES) as string[]).includes(nombre);
}

// El output del modelo es input no confiable: se valida en el borde como el
// body de una API route. Antes esta tool validaba a mano tres campos y
// recortaba el resto en silencio.
const guardarInputSchema = z.object({
  titulo: z.string().trim().min(3).max(200),
  suma: z.string().trim().min(3).max(300),
  cuerpo: z.string().trim().min(20).max(20000),
  categoria: z.enum(CATEGORIAS_ESCRITO).optional(),
  cuando: z.string().trim().max(500).optional(),
  base_normativa: z.string().trim().max(1000).optional(),
  claves: z.string().trim().max(1000).optional(),
  rol_sugerido: z.enum(ROLES_SUGERIDOS).optional(),
});

// `modelo_id` es opcional en el schema, no en la tool: la confirmación por
// texto llega como {clave, confirmar: true} "y ningún otro campo" (así lo
// pide la sugerencia de toda pendiente), y exigirlo acá la haría fallar
// antes de llegar a resolverConfirmacion. El UUID se valida por forma (la de
// esUuid) y no con z.uuid(), que exige los bits de versión RFC y rechazaría
// ids válidos de la base sin ganar nada: un id con forma inválida haría
// tirar a `casoEsDelUsuario` con un error de Postgres.
const generarInputSchema = z.object({
  caso_id: z
    .string()
    .trim()
    .refine(esUuid, "caso_id tiene que ser un UUID")
    .optional(),
  modelo_id: z.string().trim().min(1).max(120).optional(),
  instrucciones: z.string().trim().max(4000).optional(),
  clave: z.string().optional(),
  confirmar: z.boolean().optional(),
});

// Mismos topes que perfilProfesionalInputSchema (schemas.ts). Sólo strings:
// desde el chat no se VACÍA un campo del perfil (eso es borrar un dato que
// firma escritos, y se hace desde el diálogo), así que no hay `null`.
const perfilInputSchema = z.object({
  nombre_completo: z.string().trim().min(1).max(200).optional(),
  matricula: z.string().trim().min(1).max(120).optional(),
  domicilio_constituido: z.string().trim().min(1).max(300).optional(),
  domicilio_electronico: z.string().trim().min(1).max(120).optional(),
  clave: z.string().optional(),
  confirmar: z.boolean().optional(),
});

const CAMPOS_PERFIL = [
  "nombre_completo",
  "matricula",
  "domicilio_constituido",
  "domicilio_electronico",
] as const satisfies readonly (keyof PerfilProfesional)[];
type CampoPerfil = (typeof CAMPOS_PERFIL)[number];

const ETIQUETA_PERFIL: Record<CampoPerfil, string> = {
  nombre_completo: "Nombre completo (firma)",
  matricula: "Matrícula",
  domicilio_constituido: "Domicilio constituido",
  domicilio_electronico: "Domicilio electrónico",
};

const MAX_RESULTADOS = 12;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

// Mismo criterio que `normalizarInstrucciones` en generar-escrito.ts: vacío
// o sólo espacios es "sin instrucciones", no una instrucción vacía. Se repite
// acá porque el payload de la pendiente tiene que quedar canónico ANTES del
// pre-vuelo (la clave es el hash del payload).
function normalizarInstrucciones(v: string | undefined): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t.length > 0 ? t : null;
}

function invalido(error: z.ZodError, ayuda: string): ResultadoToolLexie {
  const detalle = error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  return {
    contentJSON: JSON.stringify({
      ok: false,
      motivo: `Input inválido: ${detalle}`,
      sugerencia: ayuda,
    }),
    isError: true,
  };
}

function rechazoConfirmacion(
  tool: string,
  r: Extract<ResolucionConfirmacion, { modo: "rechazar" }>,
  resumen: string,
): ResultadoToolLexie {
  return {
    contentJSON: jsonRechazoConfirmacion(r),
    accion: {
      tool,
      estado: "rechazada",
      resumen,
      seccion: "escritos",
      motivo: r.motivo,
      sugerencia: r.sugerencia,
    },
  };
}

// ————————————————————————————————————————————————————————————————
// Catálogo y modelos (las tres tools originales; sólo necesitan usuarioId)
// ————————————————————————————————————————————————————————————————

export async function ejecutarToolEscritos(
  nombre: string,
  input: unknown,
  ctx: ContextoEscritos,
): Promise<ResultadoToolLexie> {
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
            ? "Ningún modelo del catálogo cubre ese tema. Decíselo al abogado tal cual. Si necesita el escrito igual, podés redactarle uno vos (con placeholders, sin datos inventados) y, si él te lo pide, guardarlo con guardar_modelo_escrito; con el modelo_id que devuelve podés generar el escrito de la causa."
            : "Para generar el escrito adaptado a la causa usá generar_escrito_causa con el modelo_id y el caso_id: el primer llamado es un pre-vuelo gratis y la generación la confirma el abogado con el botón de la tarjeta. También puede hacerlo él desde Mis casos → la causa → bloque «Escritos» → «Generar escrito».",
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
    const parseado = guardarInputSchema.safeParse(args);
    if (!parseado.success) {
      return invalido(
        parseado.error,
        "titulo (3-200), suma (3-300) y cuerpo (20-20000) son obligatorios; categoria y rol_sugerido tienen que ser de la lista.",
      );
    }
    const d = parseado.data;
    try {
      const m = await crearModelo(
        ctx.usuarioId,
        {
          categoria: d.categoria ?? "otro",
          titulo: d.titulo,
          suma: d.suma,
          cuando: d.cuando ?? null,
          base_normativa: d.base_normativa ?? null,
          cuerpo: d.cuerpo,
          claves: d.claves ?? null,
          rol_sugerido: d.rol_sugerido ?? "ambos",
        },
        "lexie",
      );
      return {
        contentJSON: JSON.stringify({
          ok: true,
          modelo_id: m.id,
          titulo: m.titulo,
          nota: "Guardado en la biblioteca del abogado, marcado como redactado por LEXIE. Decile que lo va a encontrar en Generar escrito → pestaña «Míos», y que lo puede editar o archivar desde ahí. Si quiere el escrito de una causa con este modelo, usá generar_escrito_causa con este modelo_id.",
        }),
        accion: {
          tool: ESCRITOS_TOOL_NAMES.guardar,
          estado: "ok",
          resumen: `Modelo guardado: ${m.titulo}`,
          seccion: "modelos",
          vista_previa: { titulo: m.titulo, suma: m.suma, categoria: m.categoria },
          // Sin href: no existe una vista de biblioteca. Los modelos propios
          // viven en el diálogo Generar escrito de cada causa, pestaña «Míos».
          datos: { modelo_id: m.id },
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        contentJSON: JSON.stringify({
          ok: false,
          motivo: `No se pudo guardar: ${msg}`,
        }),
        isError: true,
        accion: {
          tool: ESCRITOS_TOOL_NAMES.guardar,
          estado: "error",
          resumen: `No se guardó el modelo «${d.titulo}»`,
          seccion: "modelos",
          error: msg,
        },
      };
    }
  }

  return {
    contentJSON: `Error: "${nombre}" no es una tool de escritos.`,
    isError: true,
  };
}

// ————————————————————————————————————————————————————————————————
// generar_escrito_causa — pre-vuelo gratis, generación sólo por el botón
// ————————————————————————————————————————————————————————————————

const RECHAZO_GENERAR_POR_TEXTO = {
  motivo:
    "La generación tarda hasta 90 segundos y se hace con el botón Confirmar de la tarjeta, no desde acá.",
  sugerencia: "Decile al abogado que toque Confirmar en la tarjeta.",
};

function nombreModelo(m: PrevueloEscritoOk["modelo"]): string {
  return m.numero !== undefined
    ? `N° ${m.numero} — ${m.titulo}`
    : `${m.titulo} (${ORIGEN_MODELO_LABEL[m.origen]})`;
}

// Lo que pinta la tarjeta y lo que el modelo relata: pares ya formateados
// para un humano. Es el contrato del pre-vuelo con el abogado ANTES de
// gastar: qué se usa, qué queda como hueco, qué le falta a él, cuánto cuesta.
function vistaPreviaPrevuelo(pv: PrevueloEscritoOk): Record<string, unknown> {
  const vista: Record<string, unknown> = {
    modelo: nombreModelo(pv.modelo),
    causa: pv.caso.nombre,
    datos_del_expediente:
      Object.keys(pv.datos_usados).length > 0
        ? pv.datos_usados
        : "(ninguno cargado en la ficha)",
    faltantes:
      pv.faltantes.length > 0
        ? `${pv.faltantes.join(", ")} — van a salir como [COMPLETAR: …] en el texto, para completar a mano antes de presentar`
        : "Ninguno: todos los datos del encabezado están cargados",
  };
  if (pv.perfil_incompleto.length > 0) {
    vista.perfil_profesional_incompleto = `${pv.perfil_incompleto
      .map((k) => ETIQUETA_PERFIL[k as CampoPerfil] ?? k)
      .join(", ")} — conviene cargarlos antes con actualizar_perfil_profesional; si no, salen como [COMPLETAR: …] en la firma`;
  }
  vista.instrucciones = pv.instrucciones ?? "(sin instrucciones)";
  vista.costo_estimado = `USD ${pv.costo_estimado_usd.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  vista.duracion_estimada = `${pv.duracion_estimada_s} segundos`;
  return vista;
}

function relatarFalloPrevuelo(f: PrevueloEscritoFallo): {
  motivo: string;
  sugerencia: string;
} {
  switch (f.motivo) {
    case "sin_migracion":
      return {
        motivo: MENSAJE_SIN_MIGRACION_ESCRITOS,
        sugerencia:
          "Decíselo al abogado tal cual. No hay camino manual hasta que se aplique.",
      };
    case "caso_ajeno":
      // Ajena o inexistente, misma respuesta: no se revela nada.
      return {
        motivo: "No existe ninguna causa con ese id entre las causas de este abogado.",
        sugerencia:
          "Puede que hayas inventado o confundido el id. Usá buscar_mis_casos, o pedile al abogado que te diga de qué causa se trata.",
      };
    case "modelo_inexistente":
      return {
        motivo:
          f.detalle ??
          "No existe un modelo con ese id en el catálogo ni entre los modelos del abogado.",
        sugerencia: "Buscalo con buscar_modelos_escrito y usá el modelo_id que devuelva.",
      };
  }
}

// El error de la generación, ya en palabras para el abogado. `error` lo pinta
// la tarjeta después de "No pude: …" y el modelo lo relata tal cual.
function mensajeFalloGeneracion(g: GenerarEscritoFallo): string {
  switch (g.motivo) {
    case "error":
      return g.mensaje;
    case "sin_migracion":
      return MENSAJE_SIN_MIGRACION_ESCRITOS;
    case "caso_ajeno":
      return "La causa ya no existe entre las causas del abogado.";
    case "modelo_inexistente":
      return "El modelo de escrito ya no existe (se archivó o se borró).";
  }
}

async function generarEscritoCausa(
  input: unknown,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  const TOOL = ESCRITOS_TOOL_NAMES.generar;
  const parseado = generarInputSchema.safeParse(input ?? {});
  if (!parseado.success) {
    return invalido(
      parseado.error,
      "caso_id (UUID de la causa), modelo_id (slug del catálogo o UUID propio) e instrucciones (hasta 4000 caracteres).",
    );
  }
  const d = parseado.data;
  // «Esta causa» es la que tiene abierta: la ruta ya verificó que sea suya.
  const casoId = d.caso_id ?? ctx.casoIdEnPantalla ?? null;
  const instrucciones = normalizarInstrucciones(d.instrucciones);

  // === Confirmación por TEXTO: nunca genera acá ===
  // Con clave manda la clave; con sólo confirmar:true, el contenido tiene que
  // ser idéntico al que vio el abogado. En los dos casos el resultado es el
  // mismo: si la pendiente existe y está viva, se la manda al botón y se
  // RE-EMITE tal cual —sin consumir la clave— para que la tarjeta del turno
  // nuevo siga teniendo el botón que le estamos pidiendo que toque.
  if (d.confirmar === true || d.clave) {
    const r = resolverConfirmacion(
      ctx,
      TOOL,
      { caso_id: casoId ?? "", modelo_id: d.modelo_id ?? "", instrucciones },
      { clave: d.clave, confirmar: d.confirmar },
    );
    if (r.modo === "ejecutar") {
      return {
        contentJSON: JSON.stringify({
          ok: false,
          ...RECHAZO_GENERAR_POR_TEXTO,
          clave: r.pendiente.clave,
          vista_previa: r.pendiente.vista_previa,
        }),
        accion: { ...r.pendiente, estado: "pendiente" },
      };
    }
    if (r.modo === "rechazar") {
      return rechazoConfirmacion(TOOL, r, "Generar escrito");
    }
  }

  if (!d.modelo_id) {
    return {
      contentJSON: JSON.stringify({
        ok: false,
        motivo: "Falta modelo_id.",
        sugerencia: "Buscalo con buscar_modelos_escrito y usá el modelo_id que devuelva.",
      }),
      isError: true,
    };
  }
  if (!casoId) {
    return {
      contentJSON: JSON.stringify({
        ok: false,
        motivo: "Falta caso_id y el abogado no está parado en ninguna causa.",
        sugerencia:
          "Tomá el id de la lista de causas del contexto o de buscar_mis_casos; si hay más de una candidata, preguntale cuál.",
      }),
      isError: true,
    };
  }

  // === Pre-vuelo (gratis): propiedad, modelo, datos del expediente ===
  let pv;
  try {
    pv = await prevueloEscrito({
      casoId,
      usuarioId: ctx.usuarioId,
      modeloId: d.modelo_id,
      instrucciones,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[escritos-tools] prevueloEscrito falló:", msg);
    return {
      contentJSON: JSON.stringify({
        ok: false,
        motivo: `No pude preparar el escrito: ${msg}`,
        sugerencia: "Decíselo al abogado y que pruebe de nuevo en un momento.",
      }),
      isError: true,
      accion: {
        tool: TOOL,
        estado: "error",
        resumen: "No se pudo preparar la generación del escrito",
        seccion: "escritos",
        error: msg,
      },
    };
  }
  if (!pv.ok) {
    const { motivo, sugerencia } = relatarFalloPrevuelo(pv);
    return {
      contentJSON: JSON.stringify({ ok: false, motivo, sugerencia }),
      accion: {
        tool: TOOL,
        estado: "rechazada",
        resumen: `Generar escrito (${d.modelo_id})`,
        seccion: "escritos",
        motivo,
        sugerencia,
      },
    };
  }

  // El payload que el botón va a ejecutar, ya canónico: ids resueltos e
  // instrucciones normalizadas. El primer llamado siempre emite (sin clave ni
  // confirmar no hay nada que resolver), así que la clave sale directo del
  // contenido. La cuarentena no cambia nada: ya es confirmable.
  const payload = {
    caso_id: casoId,
    modelo_id: pv.modelo.id,
    instrucciones: pv.instrucciones,
  };
  return emitirPendiente({
    tool: TOOL,
    clave: claveAccion(TOOL, payload),
    resumen: `Generar escrito «${pv.modelo.titulo}» para «${pv.caso.nombre}»`,
    seccion: "escritos",
    vista_previa: vistaPreviaPrevuelo(pv),
    payload,
    nota:
      "EXCEPCIÓN de esta herramienta: la generación corre SOLO con el botón Confirmar de la tarjeta (tarda hasta 90 segundos y cuesta unos centavos). Aunque el abogado te diga que sí por texto, no la confirmes vos: decile que toque Confirmar. Si el perfil profesional está incompleto, ofrecé cargarlo antes con actualizar_perfil_profesional, sólo con los datos que él te dicte.",
  });
}

async function ejecutarGeneracionPendiente(
  accion: AccionLexie,
  ctx: CtxEjecucion,
): Promise<AccionLexie> {
  const p = accion.payload ?? {};
  const casoId = str(p.caso_id);
  const modeloId = str(p.modelo_id);
  const instrucciones = typeof p.instrucciones === "string" ? p.instrucciones : null;
  if (!casoId || !modeloId) {
    return resolverPendiente(accion, {
      estado: "error",
      error: "La acción pendiente no trae caso_id o modelo_id: hay que emitirla de nuevo.",
    });
  }

  // Nivel fijo: el escrito se redacta siempre con el modelo de siempre. El
  // nivel del chat de LEXIE es otra cosa (y el botón ni lo conoce). El
  // servicio persiste por sí mismo la fila 'generar_escrito' en ejecuciones,
  // con los tokens parciales si la redacción se corta. No tira.
  const g = await generarEscritoParaCaso({
    casoId,
    usuarioId: ctx.usuarioId,
    modeloId,
    instrucciones,
    nivel: "medio",
  });
  if (!g.ok) {
    return resolverPendiente(accion, {
      estado: "error",
      error: mensajeFalloGeneracion(g),
    });
  }

  // Sin el texto entero: son 5-8k tokens que viajarían pegados al hilo en
  // cada turno siguiente. El link abre el escrito en la ficha; el extracto
  // alcanza para que el abogado (y el modelo) sepan qué salió.
  return resolverPendiente(accion, {
    estado: "ok",
    resumen: `Escrito generado: ${g.escrito.titulo}`,
    datos: {
      href: `/dashboard/mis-casos/${casoId}?escrito=${g.escrito.id}`,
      escrito_id: g.escrito.id,
      caso_id: casoId,
      ejecucion_id: g.ejecucion_id,
      marcas_pendientes: g.marcas_pendientes,
    },
    vista_previa: {
      titulo: g.escrito.titulo,
      marcas_pendientes: g.marcas_pendientes,
      extracto: g.extracto,
    },
  });
}

// ————————————————————————————————————————————————————————————————
// actualizar_perfil_profesional — completar vacíos directo, pisar con confirmación
// ————————————————————————————————————————————————————————————————

type CambiosPerfil = Partial<Record<CampoPerfil, string>>;

function cambiosDesdePayload(payload: Record<string, unknown> | undefined): CambiosPerfil {
  const out: CambiosPerfil = {};
  for (const k of CAMPOS_PERFIL) {
    const v = str(payload?.[k]);
    if (v) out[k] = v;
  }
  return out;
}

function campos(c: CambiosPerfil): CampoPerfil[] {
  return CAMPOS_PERFIL.filter((k) => c[k] !== undefined);
}

function etiquetas(ks: CampoPerfil[]): string {
  return ks.map((k) => ETIQUETA_PERFIL[k].toLowerCase()).join(", ");
}

// El diff campo a campo que ve el abogado: "(vacío) → T° 12 F° 345".
function diffPerfil(
  antes: Record<string, unknown>,
  cambios: CambiosPerfil,
): Record<string, unknown> {
  const vista: Record<string, unknown> = {};
  for (const k of campos(cambios)) {
    vista[ETIQUETA_PERFIL[k]] = `${str(antes[k]) ?? "(vacío)"} → ${cambios[k]}`;
  }
  return vista;
}

async function actualizarPerfil(
  input: unknown,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  const TOOL = ESCRITOS_TOOL_NAMES.perfil;
  const parseado = perfilInputSchema.safeParse(input ?? {});
  if (!parseado.success) {
    return invalido(
      parseado.error,
      "nombre_completo (hasta 200), matricula (120), domicilio_constituido (300) y domicilio_electronico (120): strings no vacíos, y al menos uno.",
    );
  }
  const d = parseado.data;

  // Con clave, la clave manda: ejecuta lo PERSISTIDO, no lo que vino ahora.
  if (d.clave) {
    const r = resolverConfirmacion(ctx, TOOL, {}, { clave: d.clave, confirmar: d.confirmar });
    if (r.modo === "ejecutar") return ejecutarPorTexto(ctx, r.pendiente, DOMINIO_ESCRITOS);
    if (r.modo === "rechazar") return rechazoConfirmacion(TOOL, r, "Actualizar perfil profesional");
  }

  const pedidos = CAMPOS_PERFIL.filter((k) => d[k] !== undefined);
  if (pedidos.length === 0) {
    return {
      contentJSON: JSON.stringify({
        ok: false,
        motivo: "No mandaste ningún campo.",
        sugerencia:
          "Mandá al menos uno: nombre_completo, matricula, domicilio_constituido o domicilio_electronico, con el valor que el abogado dictó.",
      }),
      isError: true,
    };
  }

  // === El guard de dato dictado, para los cuatro ===
  // La matrícula y los domicilios van al encabezado de un escrito que se
  // presenta en un tribunal; el nombre completo es lo que FIRMA el PDF. Un
  // valor que no aparece en un mensaje del abogado no entra, ni aunque sea
  // verosímil: el dato verosímil es el bug.
  const aceptados: CambiosPerfil = {};
  const descartados: CampoPerfil[] = [];
  for (const k of pedidos) {
    const v = d[k] as string;
    if (dictadoPorElAbogado(ctx, v)) aceptados[k] = v;
    else descartados.push(k);
  }
  const avisoDescartados =
    descartados.length > 0
      ? `Descartado por no estar dictado por el abogado en este hilo: ${etiquetas(descartados)}. No lo inventes: pedile el dato y volvé a llamar cuando lo escriba él.`
      : null;
  if (campos(aceptados).length === 0) {
    const motivo =
      "Ninguno de los datos aparece escrito por el abogado en este hilo, así que no se cargó nada.";
    return {
      contentJSON: JSON.stringify({
        ok: false,
        motivo,
        descartados,
        sugerencia:
          "Pedile al abogado que te dicte el dato exacto (matrícula con tomo y folio, domicilio completo) y volvé a llamar con lo que él escriba.",
      }),
      accion: {
        tool: TOOL,
        estado: "rechazada",
        resumen: `Actualizar perfil profesional: ${etiquetas(descartados)}`,
        seccion: "escritos",
        motivo,
        sugerencia: "Los datos del perfil sólo se cargan con lo que el abogado dicta.",
      },
    };
  }

  // === Estado actual → qué cambia de verdad, y qué pisa ===
  let actual: PerfilProfesional;
  try {
    actual = await getPerfilProfesional(ctx.usuarioId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      contentJSON: JSON.stringify({ ok: false, motivo: `No pude leer el perfil: ${msg}` }),
      isError: true,
      accion: {
        tool: TOOL,
        estado: "error",
        resumen: "No se pudo leer el perfil profesional",
        seccion: "escritos",
        error: msg,
      },
    };
  }
  const cambios: CambiosPerfil = {};
  const sinCambio: CampoPerfil[] = [];
  const pisa: CampoPerfil[] = [];
  for (const k of campos(aceptados)) {
    const previo = str(actual[k]);
    const nuevo = aceptados[k] as string;
    if (previo === nuevo) {
      sinCambio.push(k);
      continue;
    }
    cambios[k] = nuevo;
    if (previo) pisa.push(k);
  }
  if (campos(cambios).length === 0) {
    // Nada que hacer, nada que mostrar: no hubo acción.
    return {
      contentJSON: JSON.stringify({
        ok: true,
        sin_cambios: sinCambio,
        descartados,
        nota:
          "El perfil ya tenía esos mismos valores: no se escribió nada. Decíselo al abogado sin decir que lo cargaste." +
          (avisoDescartados ? ` ${avisoDescartados}` : ""),
      }),
    };
  }

  const antes: Record<string, unknown> = {};
  for (const k of campos(cambios)) antes[k] = actual[k] ?? null;
  const payload: Record<string, unknown> = { ...cambios };
  const vista = diffPerfil(antes, cambios);
  const resumen = `Actualizar perfil profesional: ${etiquetas(campos(cambios))}`;

  // === Directo o confirmable ===
  // Pisar un dato ya cargado pide confirmación con el diff (misma lógica que
  // la ficha). Si hay al menos un campo que pisa, TODO el pedido va en una
  // sola pendiente y un solo UPDATE: una tarjeta con el antes y el después
  // de cada campo es más legible que un "hecho" y un "pendiente" separados
  // sobre el mismo perfil. Bajo cuarentena, hasta completar un vacío se
  // vuelve pendiente. Y un confirmar:true suelto se resuelve por el
  // protocolo (sólo ejecuta si hay una pendiente sembrada idéntica).
  const confirmable = pisa.length > 0 || enCuarentena(ctx) || d.confirmar === true;
  if (confirmable) {
    const r = resolverConfirmacion(ctx, TOOL, payload, { confirmar: d.confirmar });
    if (r.modo === "ejecutar") return ejecutarPorTexto(ctx, r.pendiente, DOMINIO_ESCRITOS);
    if (r.modo === "rechazar") return rechazoConfirmacion(TOOL, r, resumen);
    const notas: string[] = [];
    if (pisa.length > 0) {
      notas.push(
        `Pisa ${pisa.length === 1 ? "un dato ya cargado" : "datos ya cargados"} (${etiquetas(pisa)}): mostrale el antes y el después de cada campo.`,
      );
    }
    if (enCuarentena(ctx)) notas.push(NOTA_CUARENTENA);
    if (avisoDescartados) notas.push(avisoDescartados);
    return emitirPendiente({
      tool: TOOL,
      clave: r.clave,
      resumen,
      seccion: "escritos",
      vista_previa: vista,
      payload,
      antes,
      nota: notas.join(" "),
    });
  }

  try {
    const despues = await actualizarPerfilProfesional(ctx.usuarioId, cambios);
    return {
      contentJSON: JSON.stringify({
        ok: true,
        actualizados: campos(cambios),
        sin_cambios: sinCambio,
        descartados,
        antes,
        perfil: despues,
        nota:
          "Guardado en el perfil profesional: va en el encabezado y la firma de todos los escritos que se generen de acá en más." +
          (avisoDescartados ? ` ${avisoDescartados}` : ""),
      }),
      accion: {
        tool: TOOL,
        estado: "ok",
        resumen: `Perfil profesional actualizado: ${etiquetas(campos(cambios))}`,
        seccion: "escritos",
        vista_previa: vista,
        antes,
        // Sin href específico: no hay una pantalla del perfil; se edita desde
        // el paso 2 de Generar escrito de cualquier causa (HREF_SECCION).
        datos: { campos: campos(cambios).join(", ") },
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      contentJSON: JSON.stringify({ ok: false, motivo: `No se pudo guardar el perfil: ${msg}` }),
      isError: true,
      accion: {
        tool: TOOL,
        estado: "error",
        resumen,
        seccion: "escritos",
        error: msg,
      },
    };
  }
}

async function ejecutarPerfilPendiente(
  accion: AccionLexie,
  ctx: CtxEjecucion,
): Promise<AccionLexie> {
  const cambios = cambiosDesdePayload(accion.payload);
  if (campos(cambios).length === 0) {
    return resolverPendiente(accion, {
      estado: "error",
      error: "La acción pendiente no trae ningún campo del perfil: hay que emitirla de nuevo.",
    });
  }

  // Concurrencia optimista: si el perfil cambió desde la vista previa (desde
  // el diálogo de Generar escrito, por ejemplo), lo que el abogado confirmó
  // ya no es lo que se pisaría. Se rechaza y se le muestra el estado actual.
  const actual = await getPerfilProfesional(ctx.usuarioId);
  if (accion.antes) {
    for (const k of campos(cambios)) {
      const ahora = str(actual[k]);
      const visto = str(accion.antes[k]);
      if (ahora !== visto) {
        return resolverPendiente(accion, {
          estado: "rechazada",
          motivo: `Cambió desde que lo viste: ${ETIQUETA_PERFIL[k]} ahora es «${ahora ?? "(vacío)"}».`,
          sugerencia: "Mostrale el estado actual y volvé a emitir.",
        });
      }
    }
  }

  await actualizarPerfilProfesional(ctx.usuarioId, cambios);
  const antes: Record<string, unknown> = {};
  for (const k of campos(cambios)) antes[k] = actual[k] ?? null;
  return resolverPendiente(accion, {
    estado: "ok",
    resumen: `Perfil profesional actualizado: ${etiquetas(campos(cambios))}`,
    datos: { campos: campos(cambios).join(", ") },
    antes,
    vista_previa: diffPerfil(antes, cambios),
  });
}

// ————————————————————————————————————————————————————————————————
// Despacho para LEXIE (contexto completo)
// ————————————————————————————————————————————————————————————————

/**
 * Las cinco tools con el contexto de LEXIE. Las tres del catálogo sólo
 * necesitan `usuarioId` y conservan `ejecutarToolEscritos` (lo usa
 * verificar-escritos.ts); las dos nuevas necesitan el resto del contexto
 * —mensajes del abogado, causa en pantalla, pendientes, cuarentena—.
 */
export async function ejecutarToolEscritosLexie(
  nombre: string,
  input: unknown,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  if (nombre === ESCRITOS_TOOL_NAMES.generar) return generarEscritoCausa(input, ctx);
  if (nombre === ESCRITOS_TOOL_NAMES.perfil) return actualizarPerfil(input, ctx);
  return ejecutarToolEscritos(nombre, input, { usuarioId: ctx.usuarioId });
}

// === El dominio, para run-lexie.ts ===
//
// Tres familias (ver el comentario de cabecera). Los tramos de prompt y
// manual viven en este archivo para que cambien en el mismo commit que las
// tools.
const CAP_ESCRITOS = 4;
const CAP_ESCRITOS_ESCRITURA = 2;
const CAP_ESCRITOS_GENERACION = 1;

// Lo que el system no dice de este dominio: el orden hechos → catálogo →
// recomendación, que la generación es un pre-vuelo pendiente que sólo dispara
// el botón, y cómo se redacta un modelo cuando el catálogo no alcanza.
export const PROMPT_ESCRITOS =
  "ESCRITOS JUDICIALES. Si el abogado pregunta qué escrito presentar o pide el de una causa: " +
  "(1) la causa (`leer_caso` si no la ves): rol del estudio, libertad del imputado, etapa, último acto; " +
  "(2) `buscar_modelos_escrito` por rol, y recomendá uno o dos modelos con número y nombre exactos y por qué ése ahora; " +
  "(3) `generar_escrito_causa`: el pre-vuelo es gratis y queda pendiente; mostráselo y que confirme con el botón de la tarjeta (40-90 s, unos centavos); nunca lo confirmes vos por texto. " +
  "Si le falta matrícula, domicilios o firma, ofrecé cargarlos con `actualizar_perfil_profesional`, sólo con lo que él dicte. Los [COMPLETAR: …] los llena él en la ficha. " +
  "Si el catálogo no cubre el caso, decilo y ofrecé redactar el escrito tipo acá (suma en mayúsculas, objeto, hechos, fundamentos, petitorio numerado, reservas; placeholders {{ASI}} en cada dato de la causa; artículos verificados con `buscar_documentos_legales`, jurisprudencia sólo del repositorio); " +
  "guardalo con `guardar_modelo_escrito` sólo si lo pide tras verlo.";

export const MANUAL_ESCRITOS =
  "El escrito generado queda como borrador en Mis casos → la causa → bloque «Escritos» (la tarjeta trae el link). Ahí el abogado lo corrige, baja el PDF y lo marca «Presentado» cuando lo subió al portal: eso es de él, no tuyo. El perfil profesional también se corrige desde el paso 2 de Generar escrito.";

export const DOMINIO_ESCRITOS: DominioLexie = {
  nombre: "escritos",
  familias: (): FamiliaLexie[] => [
    {
      nombre: "escritos",
      tools: escritosLecturaTools,
      cap: CAP_ESCRITOS,
      paralelizable: true,
      mensajeCapAgotado: `Alcanzaste el límite de ${CAP_ESCRITOS} consultas al catálogo de escritos en este mensaje. Recomendá con lo que ya viste.`,
      avisoCapAgotado: `Alcanzaste el límite de consultas al catálogo de escritos (${CAP_ESCRITOS}) en este mensaje.`,
      ejecutar: (tu, c) => ejecutarToolEscritosLexie(tu.name, tu.input, c),
    },
    {
      nombre: "escritos_escritura",
      tools: escritosEscrituraTools,
      cap: CAP_ESCRITOS_ESCRITURA,
      // Mutaciones: en serie. Dos por turno alcanzan para "guardá el modelo
      // y cargame la matrícula" en el mismo mensaje.
      paralelizable: false,
      mensajeCapAgotado: `Ya hiciste ${CAP_ESCRITOS_ESCRITURA} escrituras sobre modelos o perfil en este mensaje (guardar un modelo, actualizar el perfil). Si el abogado quiere otra, que te lo pida en el próximo.`,
      avisoCapAgotado: `Alcanzaste el límite de escrituras sobre modelos y perfil (${CAP_ESCRITOS_ESCRITURA}) en este mensaje.`,
      ejecutar: (tu, c) => ejecutarToolEscritosLexie(tu.name, tu.input, c),
    },
    {
      nombre: "escritos_generacion",
      tools: escritosGeneracionTools,
      cap: CAP_ESCRITOS_GENERACION,
      // Costosa: en serie y una por turno. Familia propia para que no
      // compita con guardar un modelo en el mismo mensaje.
      paralelizable: false,
      mensajeCapAgotado:
        "Ya emitiste (o intentaste confirmar) una generación de escrito en este mensaje: es una por mensaje. Si el abogado quiere otro escrito, que te lo pida en el próximo.",
      avisoCapAgotado: "Alcanzaste el límite de una generación de escrito por mensaje.",
      ejecutar: (tu, c) => ejecutarToolEscritosLexie(tu.name, tu.input, c),
    },
  ],
  // El camino del BOTÓN (y el de texto, para el perfil). Siempre con el
  // payload persistido; nunca con el input nuevo del modelo.
  ejecutarPendiente: async (accion, ctx) => {
    switch (accion.tool) {
      case ESCRITOS_TOOL_NAMES.generar:
        return ejecutarGeneracionPendiente(accion, ctx);
      case ESCRITOS_TOOL_NAMES.perfil:
        return ejecutarPerfilPendiente(accion, ctx);
      default:
        return null;
    }
  },
  prompt: PROMPT_ESCRITOS,
  manual: MANUAL_ESCRITOS,
};
