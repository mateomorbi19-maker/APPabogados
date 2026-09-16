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
  enCuarentena,
  NOTA_CUARENTENA,
  type ContextoLexie,
  type ResultadoToolLexie,
} from "@/lib/agent/lexie-tools";
import { esUuid } from "@/lib/escritos/types";
import {
  generarReporteParaCaso,
  MENSAJE_SIN_MIGRACION_REPORTERIA,
  prevueloReporte,
  type GenerarReporteFallo,
  type PrevueloReporteOk,
} from "@/lib/reporteria/generar-reporte";
import { enviarReporte } from "@/lib/reporteria/enviar-reporte";
import { obtenerReporte } from "@/lib/reporteria/queries";
import { normalizarTelefonoAr } from "@/lib/reporteria/telefono";
import { leerParte } from "@/lib/casos/escritura";
import { camposAplicables, plantillaPorId, PLANTILLAS } from "@/lib/reporteria/plantillas";
import { clientesSinNovedades } from "@/lib/reporteria/pendientes";
import {
  CANALES_REPORTE,
  marcasReporte,
  PLANTILLAS_REPORTE,
  type PlantillaReporte,
} from "@/lib/reporteria/types";

// Dominio REPORTERÍA de LEXIE: los mensajes al cliente sobre el estado de su
// causa (Fase 12). Ver docs/PLAN_REPORTERIA.md.
//
// === Tres familias, y las dos son costosas o externas ===
//
//   - `reporteria_lectura` (cap 3, paralela): `reportes_pendientes` (a qué
//     clientes hace mucho que no se les reporta) y `reporte_preparar` (qué
//     sabe el sistema de una causa, qué plantilla conviene y qué le va a
//     faltar). Gratis, no escriben nada.
//   - `reporteria_generacion` (cap 1, en serie): `generar_reporte_cliente`.
//     CUESTA PLATA. Mismo protocolo que generar un escrito: el primer llamado
//     es un pre-vuelo que queda pendiente, y la generación la dispara el botón.
//   - `reporteria_envio` (cap 1, en serie): `enviar_reporte_cliente`. Es lo
//     más irreversible de toda la app: un mensaje que sale del estudio hacia
//     el cliente, firmado por el abogado. SIEMPRE pendiente, con el texto
//     completo y la dirección exacta en la vista previa.
//
// === Lo que LEXIE no puede hacer acá, y no lo decide el prompt ===
//
//   - No elige el criterio profesional. El próximo paso, por qué la resolución
//     es buena noticia, si se recurre y con qué argumento: eso es criterio del
//     abogado y va en el `criterio` que ÉL dicta. Lo que no dicte queda como
//     `[FALTA: …]` en el texto y el envío se rechaza hasta que lo complete.
//   - No genera las plantillas de peores noticias (prisión preventiva,
//     condena): son `sin_ia` por decisión del equipo y el cuerpo lo escribe el
//     abogado en el detalle del reporte.
//   - No inventa un destinatario: sólo partes marcadas como cliente, y la
//     dirección de correo sale de la ficha, nunca de lo que diga el modelo.
//   - No manda nada con marcas pendientes: lo frena `enviarReporte`, no el
//     prompt.

export const REPORTERIA_TOOL_NAMES = {
  pendientes: "reportes_pendientes",
  preparar: "reporte_preparar",
  generar: "generar_reporte_cliente",
  enviar: "enviar_reporte_cliente",
} as const;

export function esToolDeReporteria(nombre: string): boolean {
  return (Object.values(REPORTERIA_TOOL_NAMES) as string[]).includes(nombre);
}

const HREF_CASOS = "/dashboard/mis-casos";

// Las descripciones van cortas: entran en el prefijo cacheado de LEXIE y se
// pagan en cada apertura de hilo. El protocolo de confirmación lo explica el
// system una sola vez.
export const reporteriaLecturaTools: Anthropic.Tool[] = [
  {
    name: REPORTERIA_TOOL_NAMES.pendientes,
    description:
      "Causas activas con cliente cargado a las que hace más de 30 días que no se les manda un reporte, o nunca. Sin argumentos.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: REPORTERIA_TOOL_NAMES.preparar,
    description:
      "Qué sabe el sistema de una causa para reportarle al cliente: a quién se le puede escribir, etapa, último movimiento, próximos eventos, qué plantilla conviene y por qué, y qué dato va a faltar en cada una. Gratis; no escribe nada. Llamala antes de proponer un reporte.",
    input_schema: {
      type: "object",
      properties: {
        caso_id: { type: "string", description: "Omitilo si está parado en la causa." },
      },
    },
  },
];

export const reporteriaGeneracionTools: Anthropic.Tool[] = [
  {
    name: REPORTERIA_TOOL_NAMES.generar,
    description:
      "Prepara el mensaje al cliente sobre el estado de su causa, desde una de las seis plantillas del estudio. Cuesta plata: sólo si el abogado lo pidió. El primer llamado es un pre-vuelo gratis que queda pendiente; lo genera el botón de la tarjeta. En `criterio` va SOLO lo que el abogado dictó: lo que falte sale como [FALTA: …] y hay que completarlo antes de enviar.",
    input_schema: {
      type: "object",
      properties: {
        caso_id: { type: "string", description: "Omitilo si está parado en la causa." },
        parte_id: {
          type: "string",
          description: "La persona destinataria, de reporte_preparar. Tiene que estar marcada como cliente.",
        },
        plantilla: {
          type: "string",
          enum: [...PLANTILLAS_REPORTE],
          description:
            "P01 novedades generales · P02 resolución · P03 previa del juicio · P04 sentencia · P05 recurso presentado · P06 reporte mensual.",
        },
        variante: {
          type: "string",
          description: "Sólo P02 y P04, que la exigen. Los ids los devuelve reporte_preparar.",
        },
        canal: { type: "string", enum: [...CANALES_REPORTE] },
        criterio: {
          type: "object",
          description:
            "Las respuestas del abogado a los campos de la plantilla, por clave. Nada inventado: lo que él no dijo, se omite.",
          additionalProperties: { type: "string" },
        },
        clave: { type: "string", description: "Clave de la pendiente." },
        confirmar: { type: "boolean" },
      },
      required: ["plantilla"],
    },
  },
];

export const reporteriaEnvioTools: Anthropic.Tool[] = [
  {
    name: REPORTERIA_TOOL_NAMES.enviar,
    description:
      "Manda al cliente un reporte YA GENERADO, o lo registra como enviado por WhatsApp. Sale del estudio firmado por el abogado: siempre queda pendiente y se ejecuta con el botón. El correo va a la dirección de la ficha, nunca a una que digas vos.",
    input_schema: {
      type: "object",
      properties: {
        caso_id: { type: "string" },
        reporte_id: { type: "string", description: "El id que devolvió la generación." },
        canal: { type: "string", enum: [...CANALES_REPORTE] },
        clave: { type: "string" },
        confirmar: { type: "boolean" },
      },
      required: ["reporte_id"],
    },
  },
];

// ————————————————————————————————————————————————————————————————
// Validación del input del modelo
// ————————————————————————————————————————————————————————————————

const uuidOpc = z.string().trim().refine(esUuid, "tiene que ser un UUID").optional();

const generarSchema = z.object({
  caso_id: uuidOpc,
  parte_id: uuidOpc,
  plantilla: z.enum(PLANTILLAS_REPORTE).optional(),
  variante: z.string().trim().min(1).max(60).optional(),
  canal: z.enum(CANALES_REPORTE).optional(),
  criterio: z.record(z.string().max(80), z.string().max(4000)).optional(),
  clave: z.string().optional(),
  confirmar: z.boolean().optional(),
});

const enviarSchema = z.object({
  caso_id: uuidOpc,
  reporte_id: uuidOpc,
  canal: z.enum(CANALES_REPORTE).optional(),
  clave: z.string().optional(),
  confirmar: z.boolean().optional(),
});

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function invalido(error: z.ZodError, ayuda: string): ResultadoToolLexie {
  const detalle = error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  return {
    contentJSON: JSON.stringify({ ok: false, motivo: `Input inválido: ${detalle}`, sugerencia: ayuda }),
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
      seccion: "causa",
      motivo: r.motivo,
      sugerencia: r.sugerencia,
    },
  };
}

function error(motivo: string, sugerencia?: string): ResultadoToolLexie {
  return {
    contentJSON: JSON.stringify({ ok: false, motivo, ...(sugerencia ? { sugerencia } : {}) }),
    isError: true,
  };
}

// ————————————————————————————————————————————————————————————————
// Lecturas
// ————————————————————————————————————————————————————————————————

async function ejecutarLectura(
  nombre: string,
  input: unknown,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  if (nombre === REPORTERIA_TOOL_NAMES.pendientes) {
    const p = await clientesSinNovedades(ctx.usuarioId);
    return {
      contentJSON: JSON.stringify({
        cantidad: p.length,
        causas: p.slice(0, 12).map((x) => ({
          caso_id: x.caso_id,
          causa: x.nombre_caso,
          clientes: x.clientes,
          dias_sin_reporte: x.dias_sin_reporte,
          nunca: x.dias_sin_reporte === null,
        })),
        nota:
          p.length === 0
            ? "No hay causas atrasadas. Decíselo en una línea."
            : "Son causas activas con cliente cargado. Si el abogado quiere reportarle a alguna, empezá por reporte_preparar.",
      }),
    };
  }

  // reporte_preparar
  const args = (input ?? {}) as Record<string, unknown>;
  const casoId = str(args.caso_id) ?? ctx.casoIdEnPantalla;
  if (!casoId) {
    return error(
      "Falta caso_id y el abogado no está parado en ninguna causa.",
      "Tomá el id de la lista de causas del contexto o de buscar_mis_casos; si hay más de una candidata, preguntale cuál.",
    );
  }
  if (!esUuid(casoId)) return error("caso_id tiene que ser un UUID.");

  const pv = await prevueloReporte({ casoId, usuarioId: ctx.usuarioId });
  if (!pv.ok) {
    return {
      contentJSON: JSON.stringify(
        pv.motivo === "sin_migracion"
          ? {
              ok: false,
              motivo: MENSAJE_SIN_MIGRACION_REPORTERIA,
              sugerencia: "Decíselo al abogado tal cual. No hay camino manual hasta que se aplique.",
            }
          : {
              ok: false,
              motivo: "No existe ninguna causa con ese id entre las causas de este abogado.",
              sugerencia: "Usá buscar_mis_casos, o pedile al abogado que te diga de qué causa se trata.",
            },
      ),
    };
  }
  return { contentJSON: JSON.stringify(resumenPrevuelo(pv)) };
}

function resumenPrevuelo(pv: PrevueloReporteOk): Record<string, unknown> {
  const d = pv.datos;
  return {
    causa: pv.caso.nombre,
    caso_id: pv.caso.id,
    rol_del_estudio: pv.caso.rol,
    destinatarios_posibles: d.clientes.map((c) => ({
      parte_id: c.parte_id,
      nombre: c.nombre,
      rol: c.rol,
      tiene_correo: c.email !== null,
      tiene_telefono: c.telefono !== null,
    })),
    etapa: d.etapa ? `${d.etapa.label} — «${d.etapa.coloquial}»` : "sin mapa procesal cargado",
    ultimo_movimiento: d.ultimo_movimiento
      ? `${d.ultimo_movimiento.fecha}: ${d.ultimo_movimiento.descripcion}`
      : "ninguno registrado",
    movimientos_del_mes: d.movimientos_mes.length,
    proximos_en_la_agenda: d.proximos.map((p) => `${p.fecha}${p.hora ? ` ${p.hora}` : ""} — ${p.titulo}`),
    plantilla_sugerida: `${pv.sugerencia.plantilla}: ${pv.sugerencia.motivo}`,
    plantillas: PLANTILLAS.map((p) => ({
      plantilla: p.id,
      titulo: `${p.codigo} · ${p.titulo}`,
      cuando: p.cuando,
      variantes: p.variantes.map((v) => ({ id: v.id, label: v.label, sin_ia: !!v.sin_ia })),
      pide_al_abogado: p.campos_criterio.map((c) => ({
        clave: c.clave,
        label: c.label,
        requerido: !!c.requerido,
        ...(c.opciones ? { opciones: c.opciones.map((o) => o.valor) } : {}),
        ...(c.solo_variantes ? { solo_variantes: c.solo_variantes } : {}),
      })),
      faltantes_del_sistema: pv.faltantes_por_plantilla[p.id],
    })),
    costo_estimado: `USD ${pv.costo_estimado_usd.toFixed(2)}`,
    nota:
      "Los campos de `pide_al_abogado` son CRITERIO PROFESIONAL: preguntáselos al abogado y pasá su respuesta tal cual en `criterio`. Lo que no conteste sale como [FALTA: …] y bloquea el envío.",
  };
}

// ————————————————————————————————————————————————————————————————
// generar_reporte_cliente — pre-vuelo gratis, generación por el botón
// ————————————————————————————————————————————————————————————————

const RECHAZO_GENERAR_POR_TEXTO = {
  motivo: "La generación se hace con el botón Confirmar de la tarjeta, no desde acá.",
  sugerencia: "Decile al abogado que toque Confirmar en la tarjeta.",
};

function mensajeFalloGeneracion(g: GenerarReporteFallo): string {
  switch (g.motivo) {
    case "error":
      return g.mensaje;
    case "sin_migracion":
      return MENSAJE_SIN_MIGRACION_REPORTERIA;
    case "caso_ajeno":
      return "La causa ya no existe entre las causas del abogado.";
    default:
      return g.detalle;
  }
}

async function generarReporteCliente(
  input: unknown,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  const TOOL = REPORTERIA_TOOL_NAMES.generar;
  const parseado = generarSchema.safeParse(input ?? {});
  if (!parseado.success) {
    return invalido(
      parseado.error,
      "caso_id y parte_id son UUID; plantilla es P01..P06; criterio es un objeto de strings.",
    );
  }
  const d = parseado.data;
  const casoId = d.caso_id ?? ctx.casoIdEnPantalla ?? null;
  // El criterio se ordena por clave antes de hashear: dos pedidos iguales en
  // otro orden son la misma acción y tienen que dar la misma clave.
  const criterio: Record<string, string> = {};
  for (const k of Object.keys(d.criterio ?? {}).sort()) {
    const v = (d.criterio ?? {})[k]?.trim();
    if (v) criterio[k] = v;
  }

  if (d.confirmar === true || d.clave) {
    const r = resolverConfirmacion(
      ctx,
      TOOL,
      {
        caso_id: casoId ?? "",
        parte_id: d.parte_id ?? "",
        plantilla: d.plantilla ?? "",
        variante: d.variante ?? null,
        canal: d.canal ?? "copia",
        criterio,
      },
      { clave: d.clave, confirmar: d.confirmar },
    );
    if (r.modo === "ejecutar") {
      // Igual que generar un escrito: por texto NO se genera, se re-emite la
      // pendiente para que la tarjeta del turno nuevo siga teniendo el botón.
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
    if (r.modo === "rechazar") return rechazoConfirmacion(TOOL, r, "Generar reporte al cliente");
  }

  if (!casoId) {
    return error(
      "Falta caso_id y el abogado no está parado en ninguna causa.",
      "Usá buscar_mis_casos o pedile al abogado de qué causa se trata.",
    );
  }
  if (!d.plantilla) {
    return error("Falta la plantilla.", "Llamá reporte_preparar: te dice cuál conviene y por qué.");
  }
  const plantilla = plantillaPorId(d.plantilla);
  if (!plantilla) return error(`No existe la plantilla ${d.plantilla}.`);

  // El pre-vuelo valida propiedad y trae los clientes: el destinatario se
  // resuelve contra ESA lista, nunca contra lo que diga el modelo.
  let pv;
  try {
    pv = await prevueloReporte({ casoId, usuarioId: ctx.usuarioId, parteId: d.parte_id ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[reporteria-tools] prevueloReporte falló:", msg);
    return error(`No pude preparar el reporte: ${msg}`, "Decíselo al abogado y que pruebe de nuevo.");
  }
  if (!pv.ok) {
    return {
      contentJSON: JSON.stringify({
        ok: false,
        motivo:
          pv.motivo === "sin_migracion"
            ? MENSAJE_SIN_MIGRACION_REPORTERIA
            : "No existe ninguna causa con ese id entre las causas de este abogado.",
      }),
    };
  }
  if (pv.datos.clientes.length === 0) {
    return error(
      `La causa «${pv.caso.nombre}» no tiene ninguna persona marcada como cliente del estudio.`,
      "Sólo se le reporta al cliente. Decile al abogado que la marque en Mis casos → la causa → bloque «Partes».",
    );
  }
  const parteId = d.parte_id ?? (pv.datos.clientes.length === 1 ? pv.datos.clientes[0].parte_id : null);
  if (!parteId) {
    return error(
      `La causa tiene ${pv.datos.clientes.length} clientes: ${pv.datos.clientes.map((c) => c.nombre).join(", ")}.`,
      "Preguntale al abogado a cuál le quiere escribir y pasá su parte_id. Nunca elijas vos: dos imputados pueden tener intereses contrapuestos.",
    );
  }
  const destinatario = pv.datos.clientes.find((c) => c.parte_id === parteId);
  if (!destinatario) {
    return error(
      "Esa persona no está marcada como cliente en esta causa.",
      "Los parte_id válidos son los que devolvió reporte_preparar.",
    );
  }

  const variante = d.variante
    ? (plantilla.variantes.find((v) => v.id === d.variante) ?? null)
    : plantilla.variantes.length === 0
      ? null
      : undefined;
  if (variante === undefined) {
    return error(
      `La plantilla ${plantilla.codigo} necesita una variante.`,
      `Preguntale al abogado qué pasó y pasá una de: ${plantilla.variantes.map((v) => `${v.id} (${v.label})`).join(", ")}.`,
    );
  }

  const canal = d.canal ?? plantilla.canal_sugerido;
  if (canal === "email" && !destinatario.email) {
    return error(
      `${destinatario.nombre} no tiene correo cargado en la ficha.`,
      "Proponé generarlo igual y mandarlo por otro canal, o que el abogado cargue el correo en el bloque «Partes».",
    );
  }

  // Qué campos de criterio aplican y cuáles quedaron sin contestar: es lo que
  // el abogado tiene que ver ANTES de gastar.
  const campos = camposAplicables(plantilla, variante?.id ?? null, criterio);
  const sinContestar = campos
    .filter((c) => c.requerido && !criterio[c.clave])
    .map((c) => c.label);
  const faltantesSistema = pv.faltantes_por_plantilla[plantilla.id];

  const payload = {
    caso_id: casoId,
    parte_id: parteId,
    plantilla: plantilla.id as PlantillaReporte,
    variante: variante?.id ?? null,
    canal,
    criterio,
  };
  const vista: Record<string, unknown> = {
    causa: pv.caso.nombre,
    destinatario: `${destinatario.nombre}${canal === "email" ? ` (${destinatario.email})` : ""}`,
    plantilla: `${plantilla.codigo} · ${plantilla.titulo}`,
    canal,
  };
  if (variante) vista.situacion = variante.label;
  vista.lo_que_pone_el_sistema = [
    pv.datos.etapa ? `etapa: ${pv.datos.etapa.coloquial}` : null,
    pv.datos.ultimo_movimiento ? `último movimiento: ${pv.datos.ultimo_movimiento.descripcion}` : null,
    pv.datos.proximos[0] ? `próximo: ${pv.datos.proximos[0].titulo}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (Object.keys(criterio).length > 0) {
    vista.lo_que_dijo_el_abogado = Object.fromEntries(
      campos
        .filter((c) => criterio[c.clave])
        .map((c) => [c.label, criterio[c.clave]]),
    );
  }
  const huecos = [...faltantesSistema, ...sinContestar];
  vista.va_a_quedar_para_completar =
    huecos.length > 0
      ? `${huecos.join(", ")} — salen como [FALTA: …] y bloquean el envío hasta que el abogado los complete`
      : "Nada: el mensaje sale completo";
  if (variante?.sin_ia) {
    vista.sin_ia =
      "Esta situación no pasa por la IA por decisión del estudio: la app arma el encabezado y el cierre, y el cuerpo lo escribe el abogado en el detalle del reporte.";
  }
  vista.costo_estimado = variante?.sin_ia
    ? "USD 0,00 (sin IA)"
    : `USD ${pv.costo_estimado_usd.toFixed(2)}`;

  return emitirPendiente({
    tool: TOOL,
    clave: claveAccion(TOOL, payload),
    resumen: `Reporte ${plantilla.codigo} para ${destinatario.nombre} («${pv.caso.nombre}»)`,
    seccion: "causa",
    vista_previa: vista,
    payload,
    nota:
      "EXCEPCIÓN de esta herramienta: el reporte se genera SOLO con el botón Confirmar de la tarjeta. Aunque el abogado te diga que sí por texto, decile que toque Confirmar. " +
      "Y aclarale que generar NO es enviar: después va a poder leerlo entero y corregirlo antes de que salga.",
  });
}

async function ejecutarGeneracionPendiente(
  accion: AccionLexie,
  ctx: CtxEjecucion,
): Promise<AccionLexie> {
  const p = accion.payload ?? {};
  const casoId = str(p.caso_id);
  const parteId = str(p.parte_id);
  const plantilla = str(p.plantilla) as PlantillaReporte | null;
  if (!casoId || !parteId || !plantilla) {
    return resolverPendiente(accion, {
      estado: "error",
      error: "La acción pendiente no trae caso_id, parte_id o plantilla: hay que emitirla de nuevo.",
    });
  }
  const g = await generarReporteParaCaso({
    casoId,
    usuarioId: ctx.usuarioId,
    parteId,
    plantilla,
    variante: str(p.variante),
    canal: (str(p.canal) as "email" | "whatsapp" | "copia" | null) ?? "copia",
    criterio: (p.criterio as Record<string, unknown>) ?? {},
    nivel: "medio",
  });
  if (!g.ok) {
    return resolverPendiente(accion, { estado: "error", error: mensajeFalloGeneracion(g) });
  }
  return resolverPendiente(accion, {
    estado: "ok",
    resumen: `Reporte generado para ${g.reporte.destinatario_nombre}`,
    datos: {
      href: `${HREF_CASOS}/${casoId}?reporte=${g.reporte.id}`,
      reporte_id: g.reporte.id,
      caso_id: casoId,
      marcas_pendientes: g.marcas_pendientes,
    },
    vista_previa: {
      destinatario: g.reporte.destinatario_nombre,
      marcas_pendientes: g.marcas_pendientes,
      extracto: g.extracto,
      todavia_no_se_envio: "El mensaje quedó como borrador. Se envía desde el detalle del reporte.",
    },
  });
}

// ————————————————————————————————————————————————————————————————
// enviar_reporte_cliente — siempre pendiente
// ————————————————————————————————————————————————————————————————

async function enviarReporteCliente(
  input: unknown,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  const TOOL = REPORTERIA_TOOL_NAMES.enviar;
  const parseado = enviarSchema.safeParse(input ?? {});
  if (!parseado.success) return invalido(parseado.error, "caso_id y reporte_id son UUID.");
  const d = parseado.data;
  const casoId = d.caso_id ?? ctx.casoIdEnPantalla ?? null;

  if (d.confirmar === true || d.clave) {
    const r = resolverConfirmacion(
      ctx,
      TOOL,
      { caso_id: casoId ?? "", reporte_id: d.reporte_id ?? "", canal: d.canal ?? "" },
      { clave: d.clave, confirmar: d.confirmar },
    );
    if (r.modo === "ejecutar") {
      return ejecutarPorTexto(ctx, r.pendiente, DOMINIO_REPORTERIA);
    }
    if (r.modo === "rechazar") return rechazoConfirmacion(TOOL, r, "Enviar reporte al cliente");
  }

  if (!casoId || !d.reporte_id) {
    return error(
      "Falta caso_id o reporte_id.",
      "El reporte_id lo devuelve la generación. Si el abogado lo generó desde la ficha, pedile que lo envíe desde ahí.",
    );
  }
  const reporte = await obtenerReporte(d.reporte_id, casoId, ctx.usuarioId);
  if (!reporte) {
    return error("No existe ese reporte en esa causa.", "Verificá el reporte_id que te devolvió la generación.");
  }
  if (reporte.estado !== "borrador") {
    return error(
      reporte.estado === "enviado"
        ? `Ese reporte ya se envió el ${reporte.enviado_en} a ${reporte.enviado_a}.`
        : "Ese reporte está descartado.",
      "Contale al abogado; si quiere mandar otro, hay que generarlo de nuevo.",
    );
  }
  const marcas = marcasReporte(reporte.contenido);
  if (marcas.length > 0) {
    return error(
      `El mensaje todavía tiene ${marcas.length} dato${marcas.length === 1 ? "" : "s"} sin completar: ${marcas.join(", ")}.`,
      "Decile al abogado que lo complete en el detalle del reporte. No se envía con huecos, y vos no los completás.",
    );
  }

  const canal = d.canal ?? reporte.canal;

  // WhatsApp: el número se valida ACÁ, antes de mostrarle la tarjeta. Si el
  // teléfono de la ficha no se puede interpretar, que se entere ahora y no
  // después de tocar Confirmar.
  if (canal === "whatsapp") {
    const parte = reporte.parte_id ? await leerParte(casoId, reporte.parte_id) : null;
    const tel = normalizarTelefonoAr(parte?.telefono);
    if (!tel.ok) {
      return error(
        tel.motivo === "vacio"
          ? `${reporte.destinatario_nombre} no tiene teléfono cargado, así que no se puede registrar un envío por WhatsApp.`
          : `El teléfono cargado para ${reporte.destinatario_nombre} no se puede usar: ${tel.mensaje}`,
        "Decile al abogado que lo corrija en el bloque Partes de la ficha, o mandalo por correo.",
      );
    }
  }

  const payload = { caso_id: casoId, reporte_id: reporte.id, canal };
  // La vista previa lleva el TEXTO COMPLETO y el destinatario exacto:
  // confirmar es mandar exactamente esto, así que tiene que poder leerse todo.
  const vista: Record<string, unknown> = {
    destinatario: reporte.destinatario_nombre,
    canal,
    ...(reporte.asunto ? { asunto: reporte.asunto } : {}),
    mensaje_completo: reporte.contenido,
  };
  if (canal === "email") {
    vista.va_a_salir_a =
      "la dirección cargada en la ficha de esta persona; el servidor la vuelve a leer al enviar y no acepta otra";
  } else if (canal === "whatsapp") {
    vista.aclaracion =
      "Esto NO manda el WhatsApp: deja asentado que el abogado ya se lo mandó, al teléfono cargado en la ficha. Para mandarlo, el botón que abre el chat con el mensaje escrito está en el detalle del reporte.";
  } else {
    vista.aclaracion =
      "Por este canal la app no manda nada: registra que el abogado lo mandó él. El texto se copia desde el detalle del reporte.";
  }

  return emitirPendiente({
    tool: TOOL,
    clave: claveAccion(TOOL, payload),
    resumen:
      canal === "whatsapp"
        ? `Registrar el envío por WhatsApp a ${reporte.destinatario_nombre}`
        : `Enviar el reporte a ${reporte.destinatario_nombre}`,
    seccion: "causa",
    vista_previa: vista,
    payload,
    nota:
      "Mostrale el mensaje ENTERO antes de que confirme: sale firmado por él y va a su cliente. " +
      (canal === "email"
        ? "Decile que revise la dirección en la tarjeta."
        : canal === "whatsapp"
          ? "Preguntale PRIMERO si ya se lo mandó: confirmar sólo lo deja asentado. Si todavía no, mandalo a abrirlo desde el detalle del reporte."
          : "Recordale que por este canal tiene que copiar el texto y pegarlo él."),
  });
}

async function ejecutarEnvioPendiente(
  accion: AccionLexie,
  ctx: CtxEjecucion,
): Promise<AccionLexie> {
  const p = accion.payload ?? {};
  const casoId = str(p.caso_id);
  const reporteId = str(p.reporte_id);
  const canal = (str(p.canal) as "email" | "whatsapp" | "copia" | null) ?? "copia";
  if (!casoId || !reporteId) {
    return resolverPendiente(accion, {
      estado: "error",
      error: "La acción pendiente no trae caso_id o reporte_id: hay que emitirla de nuevo.",
    });
  }
  // El destinatario lo resuelve el servicio desde la ficha. `para` se completa
  // acá con ese mismo destinatario para pasar su propio chequeo de
  // coincidencia: es el paso que, en el camino del UI, hace el abogado al
  // leerlo en pantalla.
  const actual = await obtenerReporte(reporteId, casoId, ctx.usuarioId);
  if (!actual) {
    return resolverPendiente(accion, { estado: "error", error: "El reporte ya no existe." });
  }
  const parte = actual.parte_id ? await leerParte(casoId, actual.parte_id) : null;
  let para: string | null = null;
  if (canal === "email") {
    para = parte?.email ?? null;
  } else if (canal === "whatsapp") {
    const tel = normalizarTelefonoAr(parte?.telefono);
    if (!tel.ok) {
      return resolverPendiente(accion, { estado: "error", error: tel.mensaje });
    }
    para = tel.e164;
  }

  const r = await enviarReporte({
    casoId,
    usuarioId: ctx.usuarioId,
    clerkUserId: ctx.clerkUserId,
    reporteId,
    canal,
    para,
  });
  if (!r.ok) return resolverPendiente(accion, { estado: "error", error: r.mensaje });
  return resolverPendiente(accion, {
    estado: "ok",
    resumen: `Reporte enviado a ${r.reporte.destinatario_nombre} (${r.enviado_a})`,
    datos: {
      href: `${HREF_CASOS}/${casoId}?reporte=${r.reporte.id}`,
      reporte_id: r.reporte.id,
      caso_id: casoId,
      enviado_a: r.enviado_a,
    },
    vista_previa: { destinatario: r.reporte.destinatario_nombre, enviado_a: r.enviado_a, canal },
  });
}

// ————————————————————————————————————————————————————————————————
// Despacho
// ————————————————————————————————————————————————————————————————

async function ejecutarToolReporteria(
  nombre: string,
  input: unknown,
  ctx: ContextoLexie,
): Promise<ResultadoToolLexie> {
  switch (nombre) {
    case REPORTERIA_TOOL_NAMES.pendientes:
    case REPORTERIA_TOOL_NAMES.preparar:
      return ejecutarLectura(nombre, input, ctx);
    case REPORTERIA_TOOL_NAMES.generar:
      return generarReporteCliente(input, ctx);
    case REPORTERIA_TOOL_NAMES.enviar: {
      // Cuarentena: si en este turno se leyó correo, ni siquiera el pre-vuelo
      // del envío corre sin que el abogado vea la nota. Generar y enviar ya
      // son confirmables, así que acá sólo se le explica al modelo por qué.
      const r = await enviarReporteCliente(input, ctx);
      if (enCuarentena(ctx) && r.accion?.estado === "pendiente") {
        return {
          ...r,
          contentJSON: JSON.stringify({
            ...(JSON.parse(r.contentJSON) as Record<string, unknown>),
            nota_cuarentena: NOTA_CUARENTENA,
          }),
        };
      }
      return r;
    }
    default:
      return { contentJSON: `Error: "${nombre}" no es una tool de reportería.`, isError: true };
  }
}

async function ejecutarPendienteReporteria(
  accion: AccionLexie,
  ctx: CtxEjecucion,
): Promise<AccionLexie | null> {
  if (accion.tool === REPORTERIA_TOOL_NAMES.generar) return ejecutarGeneracionPendiente(accion, ctx);
  if (accion.tool === REPORTERIA_TOOL_NAMES.enviar) return ejecutarEnvioPendiente(accion, ctx);
  return null;
}

// ============================================================================
// El dominio
// ============================================================================

const CAP_LECTURA = 3;
const CAP_GENERACION = 1;
const CAP_ENVIO = 1;

export const PROMPT_REPORTERIA =
  "REPORTES AL CLIENTE. Podés preparar y mandar el mensaje con el que el abogado le cuenta a su cliente cómo va la causa, desde las seis plantillas del estudio (P01 novedades, P02 resolución, P03 previa del juicio, P04 sentencia, P05 recurso, P06 reporte mensual). " +
  "El orden es siempre: `reporte_preparar` (gratis) → proponerle al abogado la plantilla y PREGUNTARLE lo que sólo él sabe → `generar_reporte_cliente` → él lee y corrige → `enviar_reporte_cliente`. " +
  "LO QUE NO SABÉS Y TENÉS QUE PREGUNTAR: cuál es el próximo paso, por qué una resolución es buena o mala noticia, qué va a hacer la defensa, si se decidió recurrir y con qué argumento, qué tiene que hacer el cliente, qué pruebas y testigos hay, cuántos días hay para recurrir. " +
  "Nada de eso se deduce del expediente: es criterio del abogado. Preguntáselo en una sola tanda, corto, y pasá su respuesta TAL CUAL en `criterio`. Lo que no conteste queda como [FALTA: …] en el texto y el sistema no deja enviarlo. " +
  "NO CALCULÁS PLAZOS tampoco acá: el plazo del recurso lo dicta él. " +
  "DESTINATARIO: sólo personas marcadas como cliente del estudio. Si hay más de una, preguntá a cuál: dos imputados de la misma causa pueden tener intereses contrapuestos y el mismo texto no les sirve a los dos. " +
  "GENERAR NO ES ENVIAR: son dos confirmaciones distintas y en el medio el abogado lee el mensaje entero. Decíselo así. " +
  "PRISIÓN PREVENTIVA Y CONDENA: esas dos situaciones no pasan por la IA por decisión del estudio. Generalas igual —la app arma el encabezado y el cierre— y avisale que el cuerpo lo escribe él. " +
  "WHATSAPP: vos no podés mandarlo. El abogado sí, desde el detalle del reporte: un botón le abre el chat de su cliente con el mensaje ya escrito y él toca enviar. `enviar_reporte_cliente` con canal whatsapp SÓLO DEJA ASENTADO que ya lo mandó, así que preguntale primero si lo mandó; si todavía no, mandalo al detalle del reporte en vez de registrarlo.";

export const MANUAL_REPORTERIA =
  "REPORTES AL CLIENTE (dónde se ve lo que hiciste): Mis casos → la causa → bloque «Reportes al cliente». Ahí se genera («Nuevo reporte»), se lee, se corrige el texto y se manda: «Enviar por correo» lo manda desde el Gmail del abogado, y «Enviar por WhatsApp» le muestra el número completo y le abre el chat de esa persona con el mensaje ya escrito, para que él toque enviar y después lo registre. " +
  "El correo y el teléfono del cliente se cargan en el bloque «Partes», en la persona marcada como cliente; el teléfono conviene cargarlo como +54 9 11 5555-5555. " +
  "En el Inicio aparece «Clientes sin novedades» cuando hace más de 30 días que no se le reporta a alguno.";

export const DOMINIO_REPORTERIA: DominioLexie = {
  nombre: "reporteria",
  familias: (): FamiliaLexie[] => [
    {
      nombre: "reporteria_lectura",
      tools: reporteriaLecturaTools,
      cap: CAP_LECTURA,
      paralelizable: true,
      mensajeCapAgotado: `Alcanzaste el límite de ${CAP_LECTURA} consultas de reportería en este mensaje. Trabajá con lo que ya tenés.`,
      avisoCapAgotado: `Alcanzaste el límite de consultas de reportería (${CAP_LECTURA}) en este mensaje.`,
      ejecutar: (tu, c) => ejecutarToolReporteria(tu.name, tu.input, c),
    },
    {
      nombre: "reporteria_generacion",
      tools: reporteriaGeneracionTools,
      cap: CAP_GENERACION,
      paralelizable: false,
      mensajeCapAgotado:
        "Ya propusiste un reporte en este mensaje. Si el abogado quiere otro, que te lo pida en el próximo.",
      avisoCapAgotado: "Ya usaste la generación de reportes en este mensaje.",
      ejecutar: (tu, c) => ejecutarToolReporteria(tu.name, tu.input, c),
    },
    {
      nombre: "reporteria_envio",
      tools: reporteriaEnvioTools,
      cap: CAP_ENVIO,
      paralelizable: false,
      mensajeCapAgotado:
        "Ya propusiste un envío en este mensaje. Si hay que mandar otro reporte, que te lo pida en el próximo.",
      avisoCapAgotado: "Ya usaste el envío de reportes en este mensaje.",
      ejecutar: (tu, c) => ejecutarToolReporteria(tu.name, tu.input, c),
    },
  ],
  ejecutarPendiente: ejecutarPendienteReporteria,
  prompt: PROMPT_REPORTERIA,
  manual: MANUAL_REPORTERIA,
};
