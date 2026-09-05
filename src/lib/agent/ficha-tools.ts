import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
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
import { normalizar } from "@/lib/casos/buscar";
import {
  agregarParte,
  editarFicha,
  editarParte,
  eliminarParte,
  leerFicha,
  leerParte,
  listarPartes,
  MENSAJE_FUERO_CONGELADO,
  type CasoFicha,
  type ParteCaso,
} from "@/lib/casos/escritura";
import { ROL_PARTE_LABEL, SITUACION_LIBERTAD_LABEL } from "@/lib/casos/ficha";
import { nombreCaso } from "@/lib/casos/nombre";
import { casoEsDelUsuario } from "@/lib/casos/propiedad";
import { listarEscritos } from "@/lib/escritos/queries";
import { FUERO_LABEL, FUEROS, type Fuero } from "@/lib/mapa-procesal/types";
import { rolParteSchema, situacionLibertadSchema } from "@/lib/schemas";
import type { RolParte, SituacionLibertad } from "@/lib/types";

// Dominio FICHA de LEXIE: la ficha de causa y las personas de la causa.
//
// === Qué es "crear la ficha" acá ===
//
// En esta app la ficha no es una entidad aparte: son ocho columnas nullable
// de `casos` (carátula, expediente, organismo, secretaría, juez, fiscalía,
// delitos, fuero) más la tabla `partes_caso`. Toda causa nace con la ficha
// vacía, así que "creá la ficha de la causa de Pérez" es COMPLETARLA sobre una
// causa que ya existe. LEXIE no inserta en `casos` —una causa nace de un
// análisis— y este dominio no tiene ninguna tool que lo haga.
//
// === Las dos velocidades ===
//
// La reversibilidad decide el gate, no el dominio (plan de la Fase 11, §3):
//
//   - Completar un campo VACÍO, agregar un delito, cargar o corregir una
//     persona: reversible desde la ficha en un click → se ejecuta DIRECTO y
//     la tarjeta dice "Hecho".
//   - SOBRESCRIBIR un valor cargado (o vaciarlo), quitar un delito, cambiar el
//     fuero, pisar un DNI, quitar una persona: pisa o borra un dato que el
//     abogado cargó → queda PENDIENTE con el diff «antes → después» y se
//     ejecuta sólo cuando él confirma (botón o texto).
//
// Las dos cosas pueden pasar en la misma llamada: "cargá la secretaría y
// corregí el juez" completa la secretaría ya y deja el juez pendiente. El
// tool_result dice qué se aplicó y qué espera, y la única `accion` que
// devuelve la tool es la pendiente —es la que la ruta tiene que sembrar en el
// turno siguiente. Lo aplicado directo queda relatado por el modelo y en
// `actualizado_en` de la causa, que dispara el refresco del contexto.
//
// === Lo que NO se hace, y no lo decide el prompt ===
//
//   - `delitos` nunca se reemplaza: se MERGEA en el servidor (actual + agregar
//     − quitar, comparando sin tildes ni mayúsculas). Un modelo que "corrige"
//     la lista mandándola entera perdería lo que no recordó.
//   - El DNI se guarda SOLO si sus dígitos aparecen en un mensaje escrito por
//     el abogado en este hilo (`dictadoPorElAbogado`). Es la regla del dato
//     faltante de la ficha extendida al chat: el dato verosímil es el bug.
//   - `titulo` y `estado_seguimiento` no existen en el input. El título es el
//     nombre de trabajo que la carátula ya reemplaza, y el estado lo decide
//     el abogado desde la ficha.
//   - Autocompletar desde el relato está prohibido (PLAN_FICHA_CAUSA §5). No
//     hay guard de servidor para eso —un juzgado reformateado por el modelo
//     no pasaría un `includes`— así que vive en el prompt, junto con el "no
//     inventes".
//
// Aislamiento: `usuarioId` viene del contexto del servidor, y TODO `caso_id`
// pasa por `leerFicha(casoId, usuarioId)` (que devuelve null para lo ajeno,
// indistinguible de lo inexistente) antes de leer una parte o escribir nada.
// El servicio de escritura repite el filtro dentro del UPDATE/DELETE.

export const FICHA_TOOL_NAMES = {
  ver: "ver_ficha_caso",
  editar: "ficha_editar",
  parteAgregar: "parte_agregar",
  parteEditar: "parte_editar",
  parteEliminar: "parte_eliminar",
} as const;

const CAP_LECTURA = 4;
const CAP_ESCRITURA = 4;
const CAP_ELIMINACION = 1;

// Mismo tope que el schema del PATCH de la ficha: el merge del servidor puede
// superar lo que el modelo mandó (actual + agregados), así que se controla acá.
const MAX_DELITOS = 20;

const CAMPOS_TEXTO = [
  "caratula",
  "expediente_numero",
  "organismo",
  "secretaria",
  "juez",
  "fiscalia",
] as const;

const CAMPOS_FICHA = [...CAMPOS_TEXTO, "delitos", "fuero"] as const;
type CampoFicha = (typeof CAMPOS_FICHA)[number];

const ETIQUETA_FICHA: Record<CampoFicha, string> = {
  caratula: "Carátula",
  expediente_numero: "Expediente",
  organismo: "Organismo",
  secretaria: "Secretaría",
  juez: "Juez",
  fiscalia: "Fiscalía",
  delitos: "Delitos",
  fuero: "Fuero",
};

type CampoParte = "nombre" | "rol" | "es_cliente" | "situacion_libertad" | "documento";

const ETIQUETA_PARTE: Record<CampoParte, string> = {
  nombre: "Nombre",
  rol: "Rol",
  es_cliente: "Es el cliente",
  situacion_libertad: "Situación de libertad",
  documento: "DNI",
};

const ROLES = rolParteSchema.options;
const SITUACIONES = situacionLibertadSchema.options;

function hrefCausa(casoId: string): string {
  return `/dashboard/mis-casos/${casoId}`;
}

// ————————————————————————————————————————————————————————————————
// Tools (lo que ve el modelo)
// ————————————————————————————————————————————————————————————————

// Las descripciones son cortas a propósito: el protocolo de confirmación, la
// cuarentena, el aislamiento y la regla de los datos dictados ya están en el
// system («CÓMO ACTUÁS»), y cada tool los pagaba de nuevo en el prefijo
// cacheado (Fase 11.9). Acá va sólo lo que el modelo necesita para llamarla
// bien y que el system no dice.
// `clave` y `confirmar` viajan en cuatro tools: cada palabra acá se paga
// cuatro veces en el prefijo.
const PROPIEDADES_CONFIRMACION: Record<string, Record<string, unknown>> = {
  clave: {
    type: "string",
    description: "Clave de la vista previa a confirmar.",
  },
  confirmar: {
    type: "boolean",
    description: "true al confirmar, en un mensaje posterior.",
  },
};

export const fichaLecturaTools: Anthropic.Tool[] = [
  {
    name: FICHA_TOOL_NAMES.ver,
    description:
      "Ficha compacta de una causa: los ocho campos con la lista `vacios`, si el mapa procesal está armado (fuero congelado), las personas con su `parte_id` (nunca el número de DNI) y los escritos generados. Llamala antes de editar la ficha o tocar una persona. Para el relato o la estrategia usá `leer_caso`.",
    input_schema: {
      type: "object",
      properties: {
        caso_id: {
          type: "string",
          description: "UUID de la causa. Omitilo para usar la que el abogado tiene en pantalla.",
        },
      },
    },
  },
];

export const fichaEscrituraTools: Anthropic.Tool[] = [
  {
    name: FICHA_TOOL_NAMES.editar,
    description:
      "Completa o corrige la ficha de una causa existente. Devuelve `aplicados` y, si algo pisa un valor cargado, `pendiente`.",
    input_schema: {
      type: "object",
      properties: {
        caso_id: { type: "string" },
        campos: {
          type: "object",
          properties: {
            caratula: { type: ["string", "null"] },
            expediente_numero: { type: ["string", "null"] },
            organismo: { type: ["string", "null"] },
            secretaria: { type: ["string", "null"] },
            juez: { type: ["string", "null"] },
            fiscalia: { type: ["string", "null"] },
            delitos_agregar: {
              type: "array",
              items: { type: "string" },
            },
            delitos_quitar: {
              type: "array",
              items: { type: "string" },
            },
            fuero: {
              type: "string",
              enum: [...FUEROS],
            },
          },
        },
        ...PROPIEDADES_CONFIRMACION,
      },
    },
  },
  {
    name: FICHA_TOOL_NAMES.parteAgregar,
    description:
      "Carga una persona en una causa y devuelve su `parte_id`. Si el nombre ya está, devuelve `duplicada` con ese `parte_id`.",
    input_schema: {
      type: "object",
      properties: {
        caso_id: { type: "string" },
        nombre: { type: "string" },
        rol: { type: "string", enum: [...ROLES] },
        es_cliente: {
          type: "boolean",
          description: "Cliente del estudio.",
        },
        situacion_libertad: {
          type: ["string", "null"],
          enum: [...SITUACIONES, null],
          description: "Sólo imputados.",
        },
        documento: { type: "string", description: "DNI." },
        ...PROPIEDADES_CONFIRMACION,
      },
      required: ["caso_id", "nombre", "rol"],
    },
  },
  {
    name: FICHA_TOOL_NAMES.parteEditar,
    description:
      "Corrige una persona ya cargada, por su `parte_id`; devuelve antes/después. Pisar un DNI cargado queda `pendiente`.",
    input_schema: {
      type: "object",
      properties: {
        caso_id: { type: "string" },
        parte_id: { type: "string" },
        cambios: {
          type: "object",
          properties: {
            nombre: { type: "string" },
            rol: { type: "string", enum: [...ROLES] },
            es_cliente: { type: "boolean" },
            situacion_libertad: { type: ["string", "null"], enum: [...SITUACIONES, null] },
            documento: { type: ["string", "null"] },
          },
        },
        ...PROPIEDADES_CONFIRMACION,
      },
      required: ["caso_id", "parte_id"],
    },
  },
];

export const fichaEliminacionTools: Anthropic.Tool[] = [
  {
    name: FICHA_TOOL_NAMES.parteEliminar,
    description:
      "Quita una persona de una causa, por su `parte_id`. Siempre queda `pendiente` la primera vez; no se deshace desde la app.",
    input_schema: {
      type: "object",
      properties: {
        caso_id: { type: "string" },
        parte_id: { type: "string" },
        ...PROPIEDADES_CONFIRMACION,
      },
      required: ["caso_id", "parte_id"],
    },
  },
];

export function esToolDeFicha(nombre: string): boolean {
  return (Object.values(FICHA_TOOL_NAMES) as string[]).includes(nombre);
}

// ————————————————————————————————————————————————————————————————
// Schemas (el output del modelo es input no confiable)
// ————————————————————————————————————————————————————————————————

const uuid = z.string().uuid();
const pedidoConfirmacion = {
  clave: z.string().trim().min(1).optional(),
  confirmar: z.boolean().optional(),
};

// Texto de la ficha: `null` vacía el campo (pide confirmación si había algo);
// la cadena vacía no se acepta para que el modelo tenga que decir null a
// propósito y no vaciar por accidente.
const textoFicha = (max: number) =>
  z.string().trim().min(1).max(max).nullable().optional();

const camposFichaSchema = z
  .object({
    caratula: textoFicha(500),
    expediente_numero: textoFicha(120),
    organismo: textoFicha(300),
    secretaria: textoFicha(200),
    juez: textoFicha(200),
    fiscalia: textoFicha(300),
    delitos_agregar: z.array(z.string().trim().min(1).max(200)).max(MAX_DELITOS).optional(),
    delitos_quitar: z.array(z.string().trim().min(1).max(200)).max(MAX_DELITOS).optional(),
    fuero: z.enum(FUEROS).optional(),
  })
  // `.strict()`: `titulo`, `estado_seguimiento` o cualquier otra columna que
  // el modelo intente colar es un error explícito, no algo que se ignora.
  .strict();
type CamposFichaInput = z.infer<typeof camposFichaSchema>;

const verFichaSchema = z.object({ caso_id: uuid.optional() }).strict();

const fichaEditarSchema = z
  .object({ caso_id: uuid, campos: camposFichaSchema, ...pedidoConfirmacion })
  .strict();

const documentoSchema = z.string().trim().min(1).max(80);

const parteAgregarSchema = z
  .object({
    caso_id: uuid,
    nombre: z.string().trim().min(1).max(300),
    rol: rolParteSchema,
    es_cliente: z.boolean().optional(),
    situacion_libertad: situacionLibertadSchema.nullable().optional(),
    documento: documentoSchema.optional(),
    ...pedidoConfirmacion,
  })
  .strict();

const cambiosParteSchema = z
  .object({
    nombre: z.string().trim().min(1).max(300).optional(),
    rol: rolParteSchema.optional(),
    es_cliente: z.boolean().optional(),
    situacion_libertad: situacionLibertadSchema.nullable().optional(),
    documento: documentoSchema.nullable().optional(),
  })
  .strict();
type CambiosParte = z.infer<typeof cambiosParteSchema>;

const parteEditarSchema = z
  .object({
    caso_id: uuid,
    parte_id: uuid,
    cambios: cambiosParteSchema.optional(),
    ...pedidoConfirmacion,
  })
  .strict();

const parteEliminarSchema = z
  .object({ caso_id: uuid, parte_id: uuid, ...pedidoConfirmacion })
  .strict();

// Los payloads PERSISTIDOS de las pendientes. Se re-validan al ejecutar: lo
// que vuelve de `mensajes_lexie.metadata` es jsonb, y un ejecutor que confíe
// en su forma sin mirar escribiría lo que sea que haya quedado ahí.
const patchFichaSchema = z
  .object({
    caratula: z.string().nullable().optional(),
    expediente_numero: z.string().nullable().optional(),
    organismo: z.string().nullable().optional(),
    secretaria: z.string().nullable().optional(),
    juez: z.string().nullable().optional(),
    fiscalia: z.string().nullable().optional(),
    delitos: z.array(z.string()).nullable().optional(),
    fuero: z.enum(FUEROS).optional(),
  })
  .strict();
type PatchFicha = z.infer<typeof patchFichaSchema>;
type CampoPatch = keyof PatchFicha;

const payloadFichaEditarSchema = z.object({ caso_id: uuid, patch: patchFichaSchema });
const payloadParteAgregarSchema = z.object({
  caso_id: uuid,
  nombre: z.string().min(1),
  rol: rolParteSchema,
  es_cliente: z.boolean(),
  situacion_libertad: situacionLibertadSchema.nullable(),
  documento: z.string().nullable(),
});
const payloadParteEditarSchema = z.object({
  caso_id: uuid,
  parte_id: uuid,
  cambios: cambiosParteSchema,
});
const payloadParteEliminarSchema = z.object({ caso_id: uuid, parte_id: uuid });

// ————————————————————————————————————————————————————————————————
// Helpers
// ————————————————————————————————————————————————————————————————

function inputInvalido(error: z.ZodError, sugerencia: string): ResultadoToolLexie {
  const detalle = error.issues
    .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
    .join("; ");
  return {
    contentJSON: JSON.stringify({ ok: false, motivo: `Input inválido: ${detalle}`, sugerencia }),
    isError: true,
  };
}

// Caso ajeno e inexistente se contestan IGUAL: un "existe pero no es tuya"
// confirmaría la existencia de la causa de otro abogado.
function causaInexistente(): ResultadoToolLexie {
  return {
    contentJSON: JSON.stringify({
      ok: false,
      motivo: "No existe ninguna causa con ese id entre las causas de este abogado.",
      sugerencia:
        "Puede que hayas inventado o confundido el id. Usá buscar_mis_casos o la lista de causas del contexto, y si la causa no existe mandá al abogado a Nuevo análisis: vos no creás causas.",
    }),
  };
}

function parteInexistente(): ResultadoToolLexie {
  return {
    contentJSON: JSON.stringify({
      ok: false,
      motivo: "No hay ninguna persona con ese parte_id en esa causa.",
      sugerencia: "Los parte_id salen de ver_ficha_caso: llamala y usá el id que devuelva.",
    }),
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
      seccion: "causa",
      motivo: r.motivo,
      sugerencia: r.sugerencia,
    },
  };
}

/**
 * Camino corto de la confirmación por TEXTO: si el modelo mandó `clave`, no
 * hace falta nada más del input —se ejecuta el payload persistido o se
 * rechaza—, y por eso se resuelve ANTES de parsear el resto (el protocolo le
 * pide llamar con {clave, confirmar: true} y ningún otro campo).
 */
async function confirmarPorClave(
  tool: string,
  args: Record<string, unknown>,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie | null> {
  const clave = typeof args.clave === "string" ? args.clave.trim() : "";
  if (!clave) return null;
  const r = resolverConfirmacion(ctx, tool, {}, { clave, confirmar: true });
  if (r.modo === "rechazar") {
    return rechazoConfirmacion(tool, r, `Confirmar ${tool} (clave ${clave})`);
  }
  if (r.modo === "ejecutar") return ejecutarPorTexto(ctx, r.pendiente, DOMINIO_FICHA);
  return null;
}

/**
 * `confirmar: true` SIN clave: el contenido tiene que ser idéntico al que el
 * abogado vio. Devuelve null cuando no hubo pedido de confirmación (la tool
 * sigue por el camino normal: emitir o ejecutar directo).
 */
async function confirmarPorContenido(
  tool: string,
  payload: Record<string, unknown>,
  confirmar: boolean | undefined,
  ctx: ContextoLexie,
  resumen: string,
): Promise<ResultadoToolLexie | null> {
  if (!confirmar) return null;
  const r = resolverConfirmacion(ctx, tool, payload, { confirmar: true });
  if (r.modo === "rechazar") return rechazoConfirmacion(tool, r, resumen);
  if (r.modo === "ejecutar") return ejecutarPorTexto(ctx, r.pendiente, DOMINIO_FICHA);
  return null;
}

type Pendiente = {
  tool: string;
  payload: Record<string, unknown>;
  resumen: string;
  vista_previa: Record<string, unknown>;
  antes?: Record<string, unknown>;
  nota?: string;
};

function emitir(p: Pendiente): { accion: AccionLexie; contentJSON: string } {
  return emitirPendiente({
    tool: p.tool,
    clave: claveAccion(p.tool, p.payload),
    resumen: p.resumen,
    seccion: "causa",
    vista_previa: p.vista_previa,
    payload: p.payload,
    antes: p.antes,
    nota: p.nota,
  });
}

function accionError(tool: string, resumen: string, e: unknown): ResultadoToolLexie {
  const msg = e instanceof Error ? e.message : String(e);
  return {
    contentJSON: JSON.stringify({ ok: false, motivo: `Falló la base: ${msg}` }),
    isError: true,
    accion: { tool, estado: "error", resumen, seccion: "causa", error: msg },
  };
}

function esVacio(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    (typeof v === "string" && v.trim().length === 0) ||
    (Array.isArray(v) && v.length === 0)
  );
}

// Comparación de valores de la ficha tal como vuelven de la base o de un
// payload persistido (JSON): escalares por identidad, arrays elemento a
// elemento, y "vacío" (null, "", []) como un solo valor.
function mismoValor(a: unknown, b: unknown): boolean {
  if (esVacio(a) && esVacio(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

function legibleFicha(campo: CampoFicha, v: unknown): string {
  if (esVacio(v)) return "(vacío)";
  if (campo === "delitos") return Array.isArray(v) ? v.join(", ") : String(v);
  if (campo === "fuero") return FUERO_LABEL[v as Fuero] ?? String(v);
  return String(v);
}

function legibleParte(campo: CampoParte, v: unknown): string {
  if (campo === "es_cliente") return v ? "Sí" : "No";
  if (esVacio(v)) return "(vacío)";
  if (campo === "rol") return ROL_PARTE_LABEL[v as RolParte] ?? String(v);
  if (campo === "situacion_libertad") {
    return SITUACION_LIBERTAD_LABEL[v as SituacionLibertad] ?? String(v);
  }
  return String(v);
}

function elegir<T extends object>(obj: T, claves: (keyof T)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of claves) out[k as string] = obj[k] ?? null;
  return out;
}

function etiquetasFicha(campos: string[]): string {
  return campos.map((c) => ETIQUETA_FICHA[c as CampoFicha] ?? c).join(", ");
}

function etiquetasParte(campos: string[]): string {
  return campos.map((c) => ETIQUETA_PARTE[c as CampoParte] ?? c).join(", ");
}

async function mapaTieneNodos(casoId: string): Promise<boolean> {
  const supabase = createServerClient();
  const { count, error } = await supabase
    .from("mapa_procesal_nodos")
    .select("id", { count: "exact", head: true })
    .eq("caso_id", casoId);
  if (error) throw new Error(`mapaTieneNodos: ${error.message}`);
  return (count ?? 0) > 0;
}

// Lo que el modelo ve de una persona. NUNCA el número de documento: el
// modelo no lo necesita para nada de lo que hace acá y cada token que lo
// repite es una copia más del dato en el historial.
function parteParaModelo(p: ParteCaso) {
  return {
    parte_id: p.id,
    nombre: p.nombre,
    rol: p.rol,
    es_cliente: p.es_cliente,
    situacion_libertad: p.situacion_libertad,
    documento_cargado: !esVacio(p.documento),
  };
}

// El `antes` que ve el modelo tras corregir una persona: sólo los campos que
// cambiaron, y el DNI como booleano (misma regla que parteParaModelo).
function antesParaModelo(p: ParteCaso, campos: CampoParte[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of campos) {
    if (c === "documento") out.documento_cargado = textoCargado(p.documento);
    else out[c] = p[c];
  }
  return out;
}

// El aviso cuando el modelo trae un DNI que el abogado no escribió. Se
// devuelve en el tool_result para que LEXIE lo diga en una línea.
const AVISO_DNI_NO_DICTADO =
  "No cargué el DNI porque no está en lo que escribió el abogado en este hilo: nunca se carga un documento que él no haya dictado. Si lo tiene, que lo escriba y lo corregís con parte_editar.";

// ————————————————————————————————————————————————————————————————
// ver_ficha_caso
// ————————————————————————————————————————————————————————————————

async function verFichaCaso(
  args: Record<string, unknown>,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  const p = verFichaSchema.safeParse(args);
  if (!p.success) return inputInvalido(p.error, "caso_id tiene que ser un UUID, o no mandarlo.");

  let casoId = p.data.caso_id ?? null;
  let usoPantalla = false;
  if (!casoId) {
    if (!ctx.casoIdEnPantalla) {
      return {
        contentJSON: JSON.stringify({
          ok: false,
          motivo: "Falta caso_id y el abogado no está parado en ninguna causa.",
          sugerencia:
            "Tomá el id de la lista de causas del contexto o buscala con buscar_mis_casos.",
        }),
      };
    }
    casoId = ctx.casoIdEnPantalla;
    usoPantalla = true;
  }

  const ficha = await leerFicha(casoId, ctx.usuarioId);
  if (!ficha) return causaInexistente();

  const [partes, mapaArmado, escritos] = await Promise.all([
    listarPartes(casoId),
    mapaTieneNodos(casoId),
    // La tabla de escritos llegó con una migración posterior a la ficha: si
    // faltara, la ficha se sigue mostrando y el bloque de escritos queda
    // vacío con aviso, en vez de tirar abajo la lectura entera.
    listarEscritos(casoId, ctx.usuarioId).catch((e: unknown) => {
      console.warn(`[ficha-tools] listarEscritos falló: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }),
  ]);

  const vacios = CAMPOS_FICHA.filter((c) => esVacio(ficha[c]));

  return {
    contentJSON: JSON.stringify({
      ok: true,
      caso_id: casoId,
      nombre: nombreCaso(ficha),
      rol_estudio: ficha.rol,
      href: hrefCausa(casoId),
      nota_caso: usoPantalla
        ? "Sin caso_id: usé la causa que el abogado tiene abierta en pantalla."
        : undefined,
      ficha: {
        caratula: ficha.caratula,
        expediente_numero: ficha.expediente_numero,
        organismo: ficha.organismo,
        secretaria: ficha.secretaria,
        juez: ficha.juez,
        fiscalia: ficha.fiscalia,
        delitos: ficha.delitos,
        fuero: ficha.fuero,
      },
      vacios,
      mapa_armado: mapaArmado,
      fuero_editable: !mapaArmado,
      partes: partes.map(parteParaModelo),
      escritos: escritos
        ? escritos.map((e) => ({
            escrito_id: e.id,
            titulo: e.titulo,
            estado: e.estado,
            marcas_pendientes: e.pendientes,
          }))
        : [],
      nota_escritos: escritos ? undefined : "No se pudieron leer los escritos de la causa.",
      nota:
        "Los campos en `vacios` se completan directo con ficha_editar; los cargados se sobrescriben con confirmación. Para editar o quitar una persona usá su parte_id.",
    }),
  };
}

// ————————————————————————————————————————————————————————————————
// ficha_editar
// ————————————————————————————————————————————————————————————————

function textoCargado(v: string | null): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function claveDelito(s: string): string {
  return normalizar(s).replace(/\s+/g, " ").trim();
}

/**
 * El merge de delitos: actual + agregar − quitar, comparando sin tildes ni
 * mayúsculas. `lista` es el estado tras agregar (lo que se escribe directo),
 * `final` el estado tras quitar (lo que queda pendiente de confirmación).
 */
function mergearDelitos(actual: string[] | null, agregar: string[], quitar: string[]) {
  const aQuitar = new Set(quitar.map(claveDelito));
  const lista = [...(actual ?? [])];
  const presentes = new Set(lista.map(claveDelito));
  const agregados: string[] = [];
  for (const d of agregar) {
    const k = claveDelito(d);
    // Agregar y quitar el mismo delito en la misma llamada es no hacer nada.
    if (presentes.has(k) || aQuitar.has(k)) continue;
    presentes.add(k);
    lista.push(d);
    agregados.push(d);
  }
  const quitados = lista.filter((d) => aQuitar.has(claveDelito(d)));
  const final = lista.filter((d) => !aQuitar.has(claveDelito(d)));
  const encontrados = new Set(quitados.map(claveDelito));
  const noEncontrados = quitar.filter((q) => !encontrados.has(claveDelito(q)));
  return { lista, agregados, final, quitados, noEncontrados };
}

type PlanFicha = {
  /** Vacíos a completar y delitos a agregar: se escriben directo. */
  directos: PatchFicha;
  /** Sobrescrituras, vaciados, delitos a quitar y el fuero: piden confirmación. */
  confirmables: PatchFicha;
  sinCambios: CampoPatch[];
  fueroCongelado: boolean;
  delitosNoEncontrados: string[];
};

/**
 * Separa lo que el modelo pidió en directo / confirmable / sin cambios contra
 * la ficha actual. Puro: la decisión de qué gate lleva cada campo vive acá y
 * no en el prompt.
 */
function planificarFicha(
  actual: CasoFicha,
  campos: CamposFichaInput,
  mapaArmado: boolean,
): PlanFicha {
  const directos: PatchFicha = {};
  const confirmables: PatchFicha = {};
  const sinCambios: CampoPatch[] = [];
  let fueroCongelado = false;

  for (const c of CAMPOS_TEXTO) {
    const nuevo = campos[c];
    if (nuevo === undefined) continue;
    const viejo = actual[c];
    if (nuevo === viejo || (nuevo === null && !textoCargado(viejo))) {
      sinCambios.push(c);
    } else if (!textoCargado(viejo)) {
      directos[c] = nuevo;
    } else {
      confirmables[c] = nuevo;
    }
  }

  const pidioDelitos =
    (campos.delitos_agregar?.length ?? 0) > 0 || (campos.delitos_quitar?.length ?? 0) > 0;
  const merge = mergearDelitos(
    actual.delitos,
    campos.delitos_agregar ?? [],
    campos.delitos_quitar ?? [],
  );
  if (merge.agregados.length > 0) directos.delitos = merge.lista;
  if (merge.quitados.length > 0) confirmables.delitos = merge.final.length > 0 ? merge.final : null;
  if (pidioDelitos && merge.agregados.length === 0 && merge.quitados.length === 0) {
    sinCambios.push("delitos");
  }

  if (campos.fuero !== undefined) {
    if (campos.fuero === actual.fuero) sinCambios.push("fuero");
    else if (mapaArmado) fueroCongelado = true;
    else confirmables.fuero = campos.fuero;
  }

  return {
    directos,
    confirmables,
    sinCambios,
    fueroCongelado,
    delitosNoEncontrados: merge.noEncontrados,
  };
}

function diffFicha(base: Record<string, unknown>, patch: PatchFicha): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of Object.keys(patch) as CampoPatch[]) {
    out[ETIQUETA_FICHA[c]] = `${legibleFicha(c, base[c])} → ${legibleFicha(c, patch[c])}`;
  }
  return out;
}

function valoresFicha(fila: Record<string, unknown>, campos: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of campos) out[ETIQUETA_FICHA[c as CampoFicha] ?? c] = legibleFicha(c as CampoFicha, fila[c]);
  return out;
}

async function fichaEditar(
  args: Record<string, unknown>,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  const TOOL = FICHA_TOOL_NAMES.editar;
  const porClave = await confirmarPorClave(TOOL, args, ctx);
  if (porClave) return porClave;

  const p = fichaEditarSchema.safeParse(args);
  if (!p.success) {
    return inputInvalido(
      p.error,
      "caso_id (UUID) y campos con sólo caratula, expediente_numero, organismo, secretaria, juez, fiscalia (texto o null), delitos_agregar, delitos_quitar (listas) y fuero (nacion|pba|federal). titulo y estado_seguimiento no se editan desde acá.",
    );
  }
  const d = p.data;

  const actual = await leerFicha(d.caso_id, ctx.usuarioId);
  if (!actual) return causaInexistente();
  const nombre = nombreCaso(actual);
  const href = hrefCausa(d.caso_id);
  const mapaArmado = await mapaTieneNodos(d.caso_id);
  const plan = planificarFicha(actual, d.campos, mapaArmado);

  const hayDirectos = Object.keys(plan.directos).length > 0;
  const hayConfirmables = Object.keys(plan.confirmables).length > 0;

  // confirmar:true sin clave: el payload que se compara es TODO lo que falta
  // aplicar. En el turno siguiente a una emisión normal lo directo ya se
  // escribió (sale como sin cambios) y queda sólo lo confirmable, que es lo
  // que se emitió; tras una emisión en cuarentena no se escribió nada y el
  // payload vuelve a ser la suma. En los dos casos la clave coincide.
  const porContenido = await confirmarPorContenido(
    TOOL,
    { caso_id: d.caso_id, patch: { ...plan.directos, ...plan.confirmables } },
    d.confirmar,
    ctx,
    `Confirmar cambios en la ficha de «${nombre}»`,
  );
  if (porContenido) return porContenido;

  const extras = {
    sin_cambios: plan.sinCambios.length > 0 ? plan.sinCambios : undefined,
    delitos_no_encontrados:
      plan.delitosNoEncontrados.length > 0 ? plan.delitosNoEncontrados : undefined,
    fuero_rechazado: plan.fueroCongelado ? MENSAJE_FUERO_CONGELADO : undefined,
  };

  if (!hayDirectos && !hayConfirmables) {
    if (plan.fueroCongelado) {
      return {
        contentJSON: JSON.stringify({
          ok: false,
          motivo: MENSAJE_FUERO_CONGELADO,
          sugerencia:
            "Decíselo tal cual y mandalo al Mapa procesal de la causa si de verdad quiere cambiar el fuero.",
          ...extras,
        }),
        accion: {
          tool: TOOL,
          estado: "rechazada",
          resumen: `Cambiar el fuero de «${nombre}» a ${legibleFicha("fuero", d.campos.fuero)}`,
          seccion: "causa",
          motivo: MENSAJE_FUERO_CONGELADO,
          sugerencia: "El fuero se cambia reiniciando el mapa desde el Mapa procesal.",
        },
      };
    }
    return {
      contentJSON: JSON.stringify({
        ok: false,
        motivo: "Nada cambia: los valores ya son esos.",
        ...extras,
      }),
    };
  }

  if (plan.directos.delitos && plan.directos.delitos.length > MAX_DELITOS) {
    return {
      contentJSON: JSON.stringify({
        ok: false,
        motivo: `La causa no puede tener más de ${MAX_DELITOS} delitos cargados.`,
      }),
    };
  }

  // Cuarentena: en el turno en que se leyó correo, hasta completar un vacío
  // pide confirmación. Todo va en UNA pendiente.
  if (enCuarentena(ctx)) {
    const patch: PatchFicha = { ...plan.directos, ...plan.confirmables };
    const campos = Object.keys(patch) as CampoPatch[];
    const { accion, contentJSON } = emitir({
      tool: TOOL,
      payload: { caso_id: d.caso_id, patch },
      resumen: `Editar la ficha de «${nombre}»: ${etiquetasFicha(campos)}`,
      vista_previa: { Causa: nombre, ...diffFicha(actual, patch) },
      antes: elegir(actual, campos),
      nota: NOTA_CUARENTENA,
    });
    return {
      contentJSON: JSON.stringify({
        ...(JSON.parse(contentJSON) as Record<string, unknown>),
        aplicados: [],
        pendiente: { clave: accion.clave, vista_previa: accion.vista_previa },
        ...extras,
      }),
      accion,
    };
  }

  // 1. Lo directo se escribe ya.
  let aplicados: string[] = [];
  let base: CasoFicha = actual;
  let antesDirectos: Record<string, unknown> = {};
  if (hayDirectos) {
    let r;
    try {
      r = await editarFicha(d.caso_id, ctx.usuarioId, plan.directos, { mapaArmado });
    } catch (e) {
      return accionError(TOOL, `Editar la ficha de «${nombre}»`, e);
    }
    if (r.ok) {
      aplicados = r.cambios;
      base = r.despues;
      antesDirectos = elegir(r.antes, r.cambios as CampoPatch[]);
    } else if (r.motivo === "no_existe") {
      return causaInexistente();
    }
    // `sin_cambios` acá es una carrera (alguien completó el campo entre la
    // lectura y el UPDATE): no se aplicó nada y se sigue con lo confirmable.
  }

  // 2. Sin sobrescrituras: acción hecha.
  if (!hayConfirmables) {
    return {
      contentJSON: JSON.stringify({
        ok: aplicados.length > 0,
        aplicados,
        ficha: valoresFicha(base, aplicados),
        href,
        nota:
          aplicados.length > 0
            ? "Decile en una línea qué cargaste y que lo ve en Mis casos → la causa → Ficha."
            : "No se escribió nada: el campo ya estaba cargado con ese valor.",
        ...extras,
      }),
      accion:
        aplicados.length > 0
          ? {
              tool: TOOL,
              estado: "ok",
              resumen: `Ficha de «${nombre}»: ${etiquetasFicha(aplicados)}`,
              seccion: "causa",
              vista_previa: { Causa: nombre, ...valoresFicha(base, aplicados) },
              datos: { href, caso_id: d.caso_id },
              antes: antesDirectos,
            }
          : undefined,
    };
  }

  // 3. Las sobrescrituras, en UNA pendiente con el diff. `antes` sale del
  // estado POSTERIOR a lo directo: es contra eso que el ejecutor va a comparar.
  const camposPendientes = Object.keys(plan.confirmables) as CampoPatch[];
  const antes = elegir(base, camposPendientes);
  const { accion, contentJSON } = emitir({
    tool: TOOL,
    payload: { caso_id: d.caso_id, patch: plan.confirmables },
    resumen: `Sobrescribir en la ficha de «${nombre}»: ${etiquetasFicha(camposPendientes)}`,
    vista_previa: { Causa: nombre, ...diffFicha(base, plan.confirmables) },
    antes,
    nota:
      "Pisa (o vacía) un valor que ya estaba cargado: por eso quedó pendiente. Si además hubo campos en `aplicados`, ésos ya están escritos.",
  });
  return {
    contentJSON: JSON.stringify({
      ...(JSON.parse(contentJSON) as Record<string, unknown>),
      ok: aplicados.length > 0,
      aplicados,
      pendiente: { clave: accion.clave, vista_previa: accion.vista_previa },
      href,
      ...extras,
    }),
    accion,
  };
}

// ————————————————————————————————————————————————————————————————
// parte_agregar
// ————————————————————————————————————————————————————————————————

function vistaPreviaParte(nombreCausa: string, p: {
  nombre: string;
  rol: RolParte;
  es_cliente: boolean;
  situacion_libertad: SituacionLibertad | null;
  documento: string | null;
}): Record<string, unknown> {
  return {
    Causa: nombreCausa,
    Nombre: p.nombre,
    Rol: legibleParte("rol", p.rol),
    "Es el cliente": legibleParte("es_cliente", p.es_cliente),
    "Situación de libertad": p.situacion_libertad
      ? legibleParte("situacion_libertad", p.situacion_libertad)
      : undefined,
    DNI: p.documento ?? undefined,
  };
}

async function parteAgregar(
  args: Record<string, unknown>,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  const TOOL = FICHA_TOOL_NAMES.parteAgregar;
  const porClave = await confirmarPorClave(TOOL, args, ctx);
  if (porClave) return porClave;

  const p = parteAgregarSchema.safeParse(args);
  if (!p.success) {
    return inputInvalido(
      p.error,
      `caso_id (UUID), nombre y rol (${ROLES.join("|")}) son obligatorios; es_cliente booleano; situacion_libertad (${SITUACIONES.join("|")}) o null; documento texto.`,
    );
  }
  const d = p.data;

  const ficha = await leerFicha(d.caso_id, ctx.usuarioId);
  if (!ficha) return causaInexistente();
  const nombreCausa = nombreCaso(ficha);
  const href = hrefCausa(d.caso_id);

  // El DNI sólo si el abogado lo escribió. Si no, la persona se carga igual
  // —sin documento— y el resultado lo dice: el hueco visible es la salida
  // correcta, no el dato verosímil.
  let documento: string | null = null;
  let avisoDni: string | undefined;
  if (d.documento) {
    if (dictadoPorElAbogado(ctx, d.documento)) documento = d.documento;
    else avisoDni = AVISO_DNI_NO_DICTADO;
  }

  const payload = {
    caso_id: d.caso_id,
    nombre: d.nombre,
    rol: d.rol,
    es_cliente: d.es_cliente ?? false,
    situacion_libertad: d.situacion_libertad ?? null,
    documento,
  };
  const resumen = `Cargar en «${nombreCausa}»: ${d.nombre} (${legibleParte("rol", d.rol)})`;

  const porContenido = await confirmarPorContenido(TOOL, payload, d.confirmar, ctx, resumen);
  if (porContenido) return porContenido;

  if (enCuarentena(ctx)) {
    const { accion, contentJSON } = emitir({
      tool: TOOL,
      payload,
      resumen,
      vista_previa: vistaPreviaParte(nombreCausa, payload),
      nota: NOTA_CUARENTENA,
    });
    return {
      contentJSON: JSON.stringify({
        ...(JSON.parse(contentJSON) as Record<string, unknown>),
        aviso_dni: avisoDni,
      }),
      accion,
    };
  }

  let r;
  try {
    r = await agregarParte(d.caso_id, ctx.usuarioId, payload);
  } catch (e) {
    return accionError(TOOL, resumen, e);
  }
  if (!r.ok) {
    if (r.motivo === "caso_ajeno") return causaInexistente();
    const motivo =
      r.motivo === "duplicada"
        ? `Ya hay una persona con ese nombre en la causa${r.parte_existente ? ` (parte_id ${r.parte_existente.id}, ${legibleParte("rol", r.parte_existente.rol)})` : ""}.`
        : "La causa ya tiene el máximo de personas cargadas.";
    const sugerencia =
      r.motivo === "duplicada"
        ? "Si es la misma persona, corregila con parte_editar usando ese parte_id. Si es otra con el mismo nombre, cargala con algo que la distinga (segundo nombre, apodo) y avisale al abogado."
        : "Decíselo al abogado; desde la ficha puede quitar personas que ya no correspondan.";
    return {
      contentJSON: JSON.stringify({
        ok: false,
        motivo,
        parte_existente: r.parte_existente ? parteParaModelo(r.parte_existente) : undefined,
        sugerencia,
        aviso_dni: avisoDni,
      }),
      accion: { tool: TOOL, estado: "rechazada", resumen, seccion: "causa", motivo, sugerencia },
    };
  }

  return {
    contentJSON: JSON.stringify({
      ok: true,
      parte: parteParaModelo(r.parte),
      href,
      aviso_dni: avisoDni,
      nota: "Decile en una línea a quién cargaste y que lo ve en Mis casos → la causa → bloque «Partes».",
    }),
    accion: {
      tool: TOOL,
      estado: "ok",
      resumen,
      seccion: "causa",
      vista_previa: vistaPreviaParte(nombreCausa, r.parte),
      datos: { href, caso_id: d.caso_id, parte_id: r.parte.id },
    },
  };
}

// ————————————————————————————————————————————————————————————————
// parte_editar
// ————————————————————————————————————————————————————————————————

function diffParte(actual: ParteCaso, cambios: CambiosParte): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of Object.keys(cambios) as CampoParte[]) {
    out[ETIQUETA_PARTE[c]] = `${legibleParte(c, actual[c])} → ${legibleParte(c, cambios[c])}`;
  }
  return out;
}

async function parteEditar(
  args: Record<string, unknown>,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  const TOOL = FICHA_TOOL_NAMES.parteEditar;
  const porClave = await confirmarPorClave(TOOL, args, ctx);
  if (porClave) return porClave;

  const p = parteEditarSchema.safeParse(args);
  if (!p.success) {
    return inputInvalido(
      p.error,
      `caso_id y parte_id (UUID) y cambios con sólo nombre, rol (${ROLES.join("|")}), es_cliente, situacion_libertad (${SITUACIONES.join("|")} o null) y documento (texto o null).`,
    );
  }
  const d = p.data;

  const ficha = await leerFicha(d.caso_id, ctx.usuarioId);
  if (!ficha) return causaInexistente();
  const nombreCausa = nombreCaso(ficha);
  const href = hrefCausa(d.caso_id);
  // Propiedad ya verificada por leerFicha: leerParte filtra por caso_id.
  const actual = await leerParte(d.caso_id, d.parte_id);
  if (!actual) return parteInexistente();

  const cambios: CambiosParte = { ...(d.cambios ?? {}) };
  let avisoDni: string | undefined;
  if (typeof cambios.documento === "string" && !dictadoPorElAbogado(ctx, cambios.documento)) {
    delete cambios.documento;
    avisoDni = AVISO_DNI_NO_DICTADO;
  }

  // Sólo lo que difiere cuenta: un cambio que repite lo que ya está no se
  // escribe ni pide confirmación.
  const efectivos = (Object.keys(cambios) as CampoParte[]).filter(
    (c) => cambios[c] !== undefined && !mismoValor(cambios[c], actual[c]),
  );
  const resumenBase = `Corregir en «${nombreCausa}»: ${actual.nombre}`;
  if (efectivos.length === 0) {
    return {
      contentJSON: JSON.stringify({
        ok: false,
        motivo: avisoDni
          ? "Nada que cambiar: el único campo era el DNI y no estaba dictado por el abogado."
          : "Nada cambia: los valores ya son esos.",
        aviso_dni: avisoDni,
        persona: parteParaModelo(actual),
      }),
    };
  }
  const cambiosEfectivos: CambiosParte = {};
  for (const c of efectivos) {
    (cambiosEfectivos as Record<string, unknown>)[c] = cambios[c];
  }

  const payload = { caso_id: d.caso_id, parte_id: d.parte_id, cambios: cambiosEfectivos };
  const resumen = `${resumenBase} — ${etiquetasParte(efectivos)}`;
  const antes = elegir(actual, efectivos);
  const vista_previa = { Causa: nombreCausa, Persona: actual.nombre, ...diffParte(actual, cambiosEfectivos) };

  const porContenido = await confirmarPorContenido(TOOL, payload, d.confirmar, ctx, resumen);
  if (porContenido) return porContenido;

  // Pisar un DNI ya cargado (o vaciarlo) es perder un dato que el abogado
  // dictó: confirmable. El resto de la persona se corrige directo.
  const pisaDni = efectivos.includes("documento") && textoCargado(actual.documento);
  if (pisaDni || enCuarentena(ctx)) {
    const { accion, contentJSON } = emitir({
      tool: TOOL,
      payload,
      resumen,
      vista_previa,
      antes,
      nota: pisaDni
        ? "Pisa un DNI que ya estaba cargado: por eso quedó pendiente."
        : NOTA_CUARENTENA,
    });
    return {
      contentJSON: JSON.stringify({
        ...(JSON.parse(contentJSON) as Record<string, unknown>),
        aviso_dni: avisoDni,
      }),
      accion,
    };
  }

  let r;
  try {
    r = await editarParte(d.caso_id, ctx.usuarioId, d.parte_id, cambiosEfectivos);
  } catch (e) {
    return accionError(TOOL, resumen, e);
  }
  if (!r.ok) {
    if (r.motivo === "caso_ajeno") return causaInexistente();
    if (r.motivo === "no_existe") return parteInexistente();
    return {
      contentJSON: JSON.stringify({ ok: false, motivo: "Nada cambia: los valores ya son esos.", aviso_dni: avisoDni }),
    };
  }

  return {
    contentJSON: JSON.stringify({
      ok: true,
      antes: antesParaModelo(r.antes, efectivos),
      despues: parteParaModelo(r.despues),
      href,
      aviso_dni: avisoDni,
      nota: "Decile en una línea qué corregiste y que lo ve en Mis casos → la causa → bloque «Partes».",
    }),
    accion: {
      tool: TOOL,
      estado: "ok",
      resumen,
      seccion: "causa",
      vista_previa,
      datos: { href, caso_id: d.caso_id, parte_id: d.parte_id },
      antes,
    },
  };
}

// ————————————————————————————————————————————————————————————————
// parte_eliminar
// ————————————————————————————————————————————————————————————————

function filaParte(p: ParteCaso): Record<string, unknown> {
  return {
    id: p.id,
    caso_id: p.caso_id,
    nombre: p.nombre,
    rol: p.rol,
    es_cliente: p.es_cliente,
    situacion_libertad: p.situacion_libertad,
    documento: p.documento,
    creado_en: p.creado_en,
  };
}

async function parteEliminar(
  args: Record<string, unknown>,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  const TOOL = FICHA_TOOL_NAMES.parteEliminar;
  const porClave = await confirmarPorClave(TOOL, args, ctx);
  if (porClave) return porClave;

  const p = parteEliminarSchema.safeParse(args);
  if (!p.success) return inputInvalido(p.error, "caso_id y parte_id tienen que ser UUIDs.");
  const d = p.data;

  const ficha = await leerFicha(d.caso_id, ctx.usuarioId);
  if (!ficha) return causaInexistente();
  const nombreCausa = nombreCaso(ficha);
  const actual = await leerParte(d.caso_id, d.parte_id);
  if (!actual) return parteInexistente();

  const payload = { caso_id: d.caso_id, parte_id: d.parte_id };
  const resumen = `Quitar de «${nombreCausa}»: ${actual.nombre} (${legibleParte("rol", actual.rol)})`;

  const porContenido = await confirmarPorContenido(TOOL, payload, d.confirmar, ctx, resumen);
  if (porContenido) return porContenido;

  // Siempre pendiente. `antes` es la fila entera: es lo que permite recargar
  // a la persona a mano si el abogado se arrepiente.
  const { accion, contentJSON } = emitir({
    tool: TOOL,
    payload,
    resumen,
    vista_previa: {
      Causa: nombreCausa,
      Nombre: actual.nombre,
      Rol: legibleParte("rol", actual.rol),
      "Es el cliente": legibleParte("es_cliente", actual.es_cliente),
      "Situación de libertad": actual.situacion_libertad
        ? legibleParte("situacion_libertad", actual.situacion_libertad)
        : undefined,
      "DNI cargado": textoCargado(actual.documento) ? "Sí" : "No",
    },
    antes: filaParte(actual),
    nota: "Quitar una persona no se deshace desde la app.",
  });
  return { contentJSON, accion };
}

// ————————————————————————————————————————————————————————————————
// Dispatcher
// ————————————————————————————————————————————————————————————————

export async function ejecutarToolFicha(
  nombre: string,
  input: unknown,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (nombre) {
    case FICHA_TOOL_NAMES.ver:
      return verFichaCaso(args, ctx);
    case FICHA_TOOL_NAMES.editar:
      return fichaEditar(args, ctx);
    case FICHA_TOOL_NAMES.parteAgregar:
      return parteAgregar(args, ctx);
    case FICHA_TOOL_NAMES.parteEditar:
      return parteEditar(args, ctx);
    case FICHA_TOOL_NAMES.parteEliminar:
      return parteEliminar(args, ctx);
    default:
      return { contentJSON: `Error: "${nombre}" no es una tool de ficha.`, isError: true };
  }
}

// ————————————————————————————————————————————————————————————————
// Ejecución de pendientes (botón o texto): SIEMPRE con el payload persistido
// ————————————————————————————————————————————————————————————————

function rechazada(accion: AccionLexie, motivo: string, sugerencia: string): AccionLexie {
  return resolverPendiente(accion, { estado: "rechazada", motivo, sugerencia });
}

const SUGERENCIA_RELEER =
  "Mostrale el estado actual con ver_ficha_caso y, si el abogado sigue queriendo el cambio, emitilo de nuevo sin clave.";

/**
 * Concurrencia optimista: lo que la pendiente guardó en `antes` tiene que
 * seguir siendo lo que hay en la base. Si el abogado (o el otro camino de
 * confirmación) lo cambió entre la vista previa y el click, la pendiente ya no
 * describe lo que va a pasar y se rechaza.
 */
function cambioDesdeLaVista(
  antes: Record<string, unknown> | undefined,
  actual: Record<string, unknown>,
  etiqueta: (campo: string) => string,
  legible: (campo: string, v: unknown) => string,
): string | null {
  if (!antes) return null;
  const cambiados = Object.keys(antes).filter((c) => c in actual && !mismoValor(antes[c], actual[c]));
  if (cambiados.length === 0) return null;
  return cambiados.map((c) => `${etiqueta(c)} ahora vale ${legible(c, actual[c])}`).join("; ");
}

async function ejecutarFichaEditar(accion: AccionLexie, ctx: CtxEjecucion): Promise<AccionLexie> {
  const p = payloadFichaEditarSchema.safeParse(accion.payload);
  if (!p.success) {
    return resolverPendiente(accion, { estado: "error", error: "El payload persistido no tiene la forma esperada." });
  }
  const { caso_id, patch } = p.data;
  const actual = await leerFicha(caso_id, ctx.usuarioId);
  if (!actual) {
    return rechazada(accion, "La causa ya no existe entre las causas de este abogado.", SUGERENCIA_RELEER);
  }
  const cambio = cambioDesdeLaVista(
    accion.antes,
    actual as unknown as Record<string, unknown>,
    (c) => ETIQUETA_FICHA[c as CampoFicha] ?? c,
    (c, v) => legibleFicha(c as CampoFicha, v),
  );
  if (cambio) return rechazada(accion, `Cambió desde que lo viste: ${cambio}.`, SUGERENCIA_RELEER);

  const nombre = nombreCaso(actual);
  const r = await editarFicha(caso_id, ctx.usuarioId, patch);
  if (!r.ok) {
    switch (r.motivo) {
      case "fuero_congelado":
        return rechazada(accion, MENSAJE_FUERO_CONGELADO, "El fuero se cambia reiniciando el mapa desde el Mapa procesal.");
      case "sin_cambios":
        return rechazada(accion, "Nada cambia: los valores ya son esos.", "Decíselo al abogado.");
      case "no_existe":
        return rechazada(accion, "La causa ya no existe entre las causas de este abogado.", SUGERENCIA_RELEER);
      case "body_vacio":
        return resolverPendiente(accion, { estado: "error", error: "La pendiente no traía ningún campo." });
    }
  }
  return resolverPendiente(accion, {
    estado: "ok",
    resumen: `Ficha de «${nombre}»: ${etiquetasFicha(r.cambios)}`,
    vista_previa: { Causa: nombre, ...valoresFicha(r.despues, r.cambios) },
    datos: { href: hrefCausa(caso_id), caso_id },
    antes: elegir(r.antes, r.cambios as CampoPatch[]),
  });
}

async function ejecutarParteAgregar(accion: AccionLexie, ctx: CtxEjecucion): Promise<AccionLexie> {
  const p = payloadParteAgregarSchema.safeParse(accion.payload);
  if (!p.success) {
    return resolverPendiente(accion, { estado: "error", error: "El payload persistido no tiene la forma esperada." });
  }
  const { caso_id, ...input } = p.data;
  const ficha = await leerFicha(caso_id, ctx.usuarioId);
  if (!ficha) {
    return rechazada(accion, "La causa ya no existe entre las causas de este abogado.", SUGERENCIA_RELEER);
  }
  const nombreCausa = nombreCaso(ficha);
  const r = await agregarParte(caso_id, ctx.usuarioId, input);
  if (!r.ok) {
    switch (r.motivo) {
      case "caso_ajeno":
        return rechazada(accion, "La causa ya no existe entre las causas de este abogado.", SUGERENCIA_RELEER);
      case "duplicada":
        return rechazada(
          accion,
          `Ya hay una persona con ese nombre en la causa${r.parte_existente ? ` (parte_id ${r.parte_existente.id})` : ""}.`,
          "Si es la misma persona, corregila con parte_editar.",
        );
      case "tope":
        return rechazada(accion, "La causa ya tiene el máximo de personas cargadas.", "Decíselo al abogado.");
    }
  }
  return resolverPendiente(accion, {
    estado: "ok",
    resumen: `Cargada en «${nombreCausa}»: ${r.parte.nombre} (${legibleParte("rol", r.parte.rol)})`,
    vista_previa: vistaPreviaParte(nombreCausa, r.parte),
    datos: { href: hrefCausa(caso_id), caso_id, parte_id: r.parte.id },
  });
}

async function ejecutarParteEditar(accion: AccionLexie, ctx: CtxEjecucion): Promise<AccionLexie> {
  const p = payloadParteEditarSchema.safeParse(accion.payload);
  if (!p.success) {
    return resolverPendiente(accion, { estado: "error", error: "El payload persistido no tiene la forma esperada." });
  }
  const { caso_id, parte_id, cambios } = p.data;
  if (!(await casoEsDelUsuario(caso_id, ctx.usuarioId))) {
    return rechazada(accion, "La causa ya no existe entre las causas de este abogado.", SUGERENCIA_RELEER);
  }
  const actual = await leerParte(caso_id, parte_id);
  if (!actual) return rechazada(accion, "Esa persona ya no está en la causa.", SUGERENCIA_RELEER);
  const cambio = cambioDesdeLaVista(
    accion.antes,
    actual as unknown as Record<string, unknown>,
    (c) => ETIQUETA_PARTE[c as CampoParte] ?? c,
    (c, v) => legibleParte(c as CampoParte, v),
  );
  if (cambio) return rechazada(accion, `Cambió desde que lo viste: ${cambio}.`, SUGERENCIA_RELEER);

  const r = await editarParte(caso_id, ctx.usuarioId, parte_id, cambios);
  if (!r.ok) {
    switch (r.motivo) {
      case "caso_ajeno":
        return rechazada(accion, "La causa ya no existe entre las causas de este abogado.", SUGERENCIA_RELEER);
      case "no_existe":
        return rechazada(accion, "Esa persona ya no está en la causa.", SUGERENCIA_RELEER);
      case "sin_cambios":
        return rechazada(accion, "Nada cambia: los valores ya son esos.", "Decíselo al abogado.");
    }
  }
  const campos = Object.keys(cambios) as CampoParte[];
  return resolverPendiente(accion, {
    estado: "ok",
    resumen: `Corregida: ${r.despues.nombre} — ${etiquetasParte(campos)}`,
    datos: { href: hrefCausa(caso_id), caso_id, parte_id },
    antes: elegir(r.antes, campos),
  });
}

async function ejecutarParteEliminar(accion: AccionLexie, ctx: CtxEjecucion): Promise<AccionLexie> {
  const p = payloadParteEliminarSchema.safeParse(accion.payload);
  if (!p.success) {
    return resolverPendiente(accion, { estado: "error", error: "El payload persistido no tiene la forma esperada." });
  }
  const { caso_id, parte_id } = p.data;
  if (!(await casoEsDelUsuario(caso_id, ctx.usuarioId))) {
    return rechazada(accion, "La causa ya no existe entre las causas de este abogado.", SUGERENCIA_RELEER);
  }
  const actual = await leerParte(caso_id, parte_id);
  if (!actual) return rechazada(accion, "Esa persona ya no está en la causa.", "Decíselo al abogado: no hay nada que quitar.");
  const cambio = cambioDesdeLaVista(
    accion.antes,
    actual as unknown as Record<string, unknown>,
    (c) => ETIQUETA_PARTE[c as CampoParte] ?? c,
    (c, v) => legibleParte(c as CampoParte, v),
  );
  if (cambio) return rechazada(accion, `Cambió desde que lo viste: ${cambio}.`, SUGERENCIA_RELEER);

  const r = await eliminarParte(caso_id, ctx.usuarioId, parte_id);
  if (!r.ok) {
    return rechazada(
      accion,
      r.motivo === "no_existe"
        ? "Esa persona ya no está en la causa."
        : "La causa ya no existe entre las causas de este abogado.",
      SUGERENCIA_RELEER,
    );
  }
  return resolverPendiente(accion, {
    estado: "ok",
    resumen: `Quitada: ${r.eliminada.nombre} (${legibleParte("rol", r.eliminada.rol)})`,
    datos: { href: hrefCausa(caso_id), caso_id, parte_id },
    antes: filaParte(r.eliminada),
  });
}

// ————————————————————————————————————————————————————————————————
// Prompt, manual y dominio
// ————————————————————————————————————————————————————————————————

// Lo específico del dominio que el system no dice. Las dos velocidades, el
// protocolo de confirmación, la cuarentena y «nunca inventes un DNI» ya están
// en «CÓMO ACTUÁS»; acá van el flujo, lo que NO se hace y qué decir al cierre.
export const PROMPT_FICHA =
  "FICHA DE CAUSA Y PERSONAS. La ficha (carátula, expediente, organismo —juzgado o tribunal—, secretaría, juez, fiscalía, delitos, fuero; null vacía un campo) y las personas son columnas de una causa que YA EXISTE: toda causa nace con la ficha vacía, así que «crear» o «armar» la ficha es COMPLETARLA. " +
  "FLUJO: `ver_ficha_caso` PRIMERO: de ahí salen los vacíos, el `parte_id` de cada persona y si el fuero se puede tocar. Los delitos se agregan o se quitan, nunca se reemplaza la lista. El fuero pide confirmación siempre y con el mapa procesal armado no se cambia desde acá: relatá el rechazo tal cual. " +
  "NO HACÉS: completar la ficha con datos del relato, del análisis o de un correo, ni aunque te digan «sacalo del relato» —el dato lo escribe el abogado en el hilo—; cargar un DNI que él no escribió (la herramienta lo descarta; decíselo en una línea); editar el título o el estado de seguimiento. " +
  "AL TERMINAR: una línea con qué cargaste y que lo ve en Mis casos → la causa → bloque «Ficha» (o «Partes»).";

export const MANUAL_FICHA =
  "Lo que LEXIE carga en la ficha se ve al instante en Mis casos → la causa (bloques «Ficha de la causa» y «Partes»); una carátula nueva pasa a ser el nombre de la causa en toda la app. La tarjeta de la acción en la ventana de LEXIE deja el link a la causa.";

export const DOMINIO_FICHA: DominioLexie = {
  nombre: "ficha",
  familias: (): FamiliaLexie[] => [
    {
      nombre: "ficha_lectura",
      tools: fichaLecturaTools,
      cap: CAP_LECTURA,
      paralelizable: true,
      mensajeCapAgotado: `Alcanzaste el límite de ${CAP_LECTURA} lecturas de ficha en este mensaje. Seguí con lo que ya viste.`,
      avisoCapAgotado: `Alcanzaste el límite de lecturas de ficha (${CAP_LECTURA}) en este mensaje.`,
      ejecutar: (tu, c) => ejecutarToolFicha(tu.name, tu.input, c),
    },
    {
      nombre: "ficha_escritura",
      tools: fichaEscrituraTools,
      cap: CAP_ESCRITURA,
      // Mutaciones: en serie. Dos altas concurrentes de la misma persona
      // validarían el duplicado contra el mismo snapshot.
      paralelizable: false,
      mensajeCapAgotado: `Alcanzaste el límite de ${CAP_ESCRITURA} escrituras sobre la ficha en este mensaje. Contale al abogado qué quedó hecho y que lo demás lo pida en el próximo.`,
      avisoCapAgotado: `Alcanzaste el límite de escrituras sobre la ficha (${CAP_ESCRITURA}) en este mensaje.`,
      ejecutar: (tu, c) => ejecutarToolFicha(tu.name, tu.input, c),
    },
    {
      nombre: "ficha_eliminacion",
      tools: fichaEliminacionTools,
      cap: CAP_ELIMINACION,
      // Irreversible: familia propia, una por turno.
      paralelizable: false,
      mensajeCapAgotado:
        "Ya pediste quitar una persona en este mensaje. Si el abogado quiere quitar otra, que te lo pida en el próximo.",
      avisoCapAgotado: "Ya pediste quitar una persona en este mensaje.",
      ejecutar: (tu, c) => ejecutarToolFicha(tu.name, tu.input, c),
    },
  ],
  ejecutarPendiente: async (accion, ctx) => {
    switch (accion.tool) {
      case FICHA_TOOL_NAMES.editar:
        return ejecutarFichaEditar(accion, ctx);
      case FICHA_TOOL_NAMES.parteAgregar:
        return ejecutarParteAgregar(accion, ctx);
      case FICHA_TOOL_NAMES.parteEditar:
        return ejecutarParteEditar(accion, ctx);
      case FICHA_TOOL_NAMES.parteEliminar:
        return ejecutarParteEliminar(accion, ctx);
      default:
        return null;
    }
  },
  prompt: PROMPT_FICHA,
  manual: MANUAL_FICHA,
};
