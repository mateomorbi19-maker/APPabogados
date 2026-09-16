import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import { COLS_CASO } from "@/lib/casos/columnas";
import { listarPartes } from "@/lib/casos/escritura";
import { nombreCaso } from "@/lib/casos/nombre";
import { casoEsDelUsuario } from "@/lib/casos/propiedad";
import { getEventosByUser } from "@/lib/agenda/queries";
import { getNodosDelCaso } from "@/lib/mapa-procesal/queries";
import { etapaActual } from "@/lib/mapa-procesal/etapa-actual";
import { getPerfilProfesional } from "@/lib/escritos/queries";
import { mensajeDeErrorDeApi } from "@/lib/escritos/generar-escrito";
import {
  MODELO_POR_NIVEL,
  NIVEL_DEFAULT,
  type NivelModelo,
} from "@/lib/agent/modelos";
import { AgentError, type AgentErrorCode } from "@/lib/agent/run-agent";
import { inputTokensParaCuota } from "@/lib/lexie/queries";
import type { Caso, EventoCaso, ParteCaso } from "@/lib/types";
import type { PerfilProfesional } from "@/lib/escritos/types";
import { armarDatosReporte, type DatosReporte } from "./datos";
import {
  camposAplicables,
  plantillaPorId,
  variantePorId,
  PLANTILLAS,
  type DefinicionPlantilla,
  type VarianteReporte,
} from "./plantillas";
import { renderizarAsunto, renderizarReporte } from "./render";
import { armarMensajeReporte } from "./prompt";
import { insertarReporte, migracionReporteriaAplicada } from "./queries";
import { runReporte } from "./run-reporte";
import { sugerirPlantilla, type SugerenciaPlantilla } from "./sugerir";
import {
  contarMarcasReporte,
  type CanalReporte,
  type PlantillaReporte,
  type ReporteCliente,
} from "./types";

// Generar un reporte al cliente, como SERVICIO. Misma forma que
// escritos/generar-escrito.ts: una entrada gratis (`prevueloReporte`: qué
// sabe el sistema, qué falta, qué plantilla sugiere) y una entrada paga
// (`generarReporteParaCaso`: render → modelo → ejecuciones → reportes_cliente).
// Lo usan la ruta de la ficha y las tools de LEXIE.
//
// === Orden por la plata ===
//
// Todo lo gratis va antes de la única llamada paga: sondeo de la migración,
// propiedad, carga, render. Y las variantes `sin_ia` no llaman al modelo:
// el reporte se guarda con el borrador tal cual y cuesta cero.
//
// === Aislamiento ===
//
// `usuarioId` viene SIEMPRE del servidor. `casoId` y `parteId` pueden venir
// del modelo (LEXIE), así que la propiedad se verifica con `casoEsDelUsuario`
// ANTES de leer partes o eventos, y la parte se busca DENTRO de las partes de
// esa causa: un `parte_id` de otra causa no matchea.

/** Estimación para la vista previa: un turno sin tools con ~4.000 tokens de entrada. */
export const COSTO_ESTIMADO_REPORTE_USD = 0.02;
export const DURACION_ESTIMADA_REPORTE_S = "10-25";

export const MENSAJE_SIN_MIGRACION_REPORTERIA =
  "Falta aplicar la migración de reportería en la base (20260915120000_reporteria_cliente.sql). Hasta entonces no se pueden generar reportes al cliente.";

// ————————————————————————————————————————————————————————————————
// Tipos
// ————————————————————————————————————————————————————————————————

export type MotivoPrevueloReporteFallido = "caso_ajeno" | "sin_migracion";

export type PrevueloReporteFallo = {
  ok: false;
  motivo: MotivoPrevueloReporteFallido;
  detalle?: string;
};

export type PrevueloReporteOk = {
  ok: true;
  caso: { id: string; nombre: string; rol: Caso["rol"] };
  datos: DatosReporte;
  sugerencia: SugerenciaPlantilla;
  /**
   * Por plantilla: las etiquetas de las variables de sistema/ficha que NO
   * tienen valor y van a salir como [FALTA: …] (las de criterio las pide el
   * formulario).
   */
  faltantes_por_plantilla: Record<PlantillaReporte, string[]>;
  costo_estimado_usd: number;
  duracion_estimada_s: string;
};

export type PrevueloReporteResultado = PrevueloReporteOk | PrevueloReporteFallo;

export type GenerarReporteInput = {
  casoId: string;
  /** Del servidor. Nunca del input del modelo. */
  usuarioId: string;
  parteId: string;
  plantilla: PlantillaReporte;
  variante?: string | null;
  canal: CanalReporte;
  criterio: Record<string, unknown>;
  nivel?: NivelModelo;
  /** Sin IA aunque la variante lo permita: guarda el borrador determinístico. */
  sinIa?: boolean;
};

export type GenerarReporteOk = {
  ok: true;
  reporte: ReporteCliente;
  ejecucion_id: string | null;
  marcas_pendientes: number;
  extracto: string;
  metadata: { costo_usd: number; sin_ia: boolean };
};

export type GenerarReporteFallo =
  | PrevueloReporteFallo
  | {
      ok: false;
      motivo: "parte_inexistente" | "parte_no_cliente" | "plantilla_invalida" | "variante_invalida";
      detalle: string;
    }
  | {
      ok: false;
      motivo: "error";
      etapa: "preparacion" | "redaccion";
      code: AgentErrorCode | null;
      mensaje: string;
      detalle?: string;
    };

export type GenerarReporteResultado = GenerarReporteOk | GenerarReporteFallo;

// ————————————————————————————————————————————————————————————————
// Preparación (gratis)
// ————————————————————————————————————————————————————————————————

type Preparado = {
  ok: true;
  caso: Caso;
  partes: ParteCaso[];
  perfil: PerfilProfesional;
  datos: DatosReporte;
};

async function preparar(
  casoId: string,
  usuarioId: string,
  parteId: string | null,
): Promise<Preparado | PrevueloReporteFallo> {
  if (!(await migracionReporteriaAplicada())) {
    return {
      ok: false,
      motivo: "sin_migracion",
      detalle: MENSAJE_SIN_MIGRACION_REPORTERIA,
    };
  }
  // La barrera de propiedad va ANTES de cualquier lectura que cuelgue del
  // caso: partes, eventos y nodos no tienen usuario_id.
  if (!(await casoEsDelUsuario(casoId, usuarioId))) {
    return { ok: false, motivo: "caso_ajeno" };
  }

  const supabase = createServerClient();
  const ahora = new Date();
  const [casoRes, partes, eventosRes, agenda, nodos, perfil, usuarioRes] =
    await Promise.all([
      supabase
        .from("casos")
        .select(COLS_CASO)
        .eq("id", casoId)
        .eq("usuario_id", usuarioId)
        .maybeSingle(),
      listarPartes(casoId),
      supabase
        .from("eventos_caso")
        .select("id, tipo, categoria, descripcion, ocurrido_en, estado, creado_en, adjuntos")
        .eq("caso_id", casoId)
        .order("ocurrido_en", { ascending: false })
        .limit(200),
      getEventosByUser(usuarioId, { caso_id: casoId, desde: ahora.toISOString() }),
      // Un mapa que no existe degrada a "sin etapa", igual que la ficha.
      getNodosDelCaso(casoId).catch((e) => {
        console.error("[reporteria] error nodos del mapa:", e);
        return [];
      }),
      getPerfilProfesional(usuarioId),
      supabase.from("usuarios").select("nombre").eq("id", usuarioId).maybeSingle(),
    ]);
  if (casoRes.error) throw new Error(casoRes.error.message);
  if (!casoRes.data) return { ok: false, motivo: "caso_ajeno" };
  if (eventosRes.error) throw new Error(eventosRes.error.message);

  const caso = casoRes.data as unknown as Caso;
  const etapaDerivada = etapaActual(nodos);
  const datos = armarDatosReporte({
    caso,
    partes,
    parteId,
    eventos: (eventosRes.data ?? []) as EventoCaso[],
    agenda: agenda.map((a) => ({
      id: a.id,
      titulo: a.titulo,
      tipo: a.tipo,
      fecha_inicio: a.fecha_inicio,
      todo_el_dia: a.todo_el_dia,
    })),
    etapa: etapaDerivada
      ? { etapa: etapaDerivada.etapa, label: etapaDerivada.label, nodoTitulo: etapaDerivada.nodoTitulo }
      : null,
    perfil,
    nombreUsuario: (usuarioRes.data as { nombre?: string } | null)?.nombre ?? "",
    ahora,
  });
  return { ok: true, caso, partes, perfil, datos };
}

/** Etiquetas de las variables de sistema/ficha sin valor, para una plantilla. */
function faltantesDe(p: DefinicionPlantilla, datos: DatosReporte): string[] {
  return p.variables
    .filter((v) => v.fuente !== "criterio" && !v.opcional && !datos.valores[v.clave])
    .map((v) => v.label);
}

// ————————————————————————————————————————————————————————————————
// Pre-vuelo (gratis)
// ————————————————————————————————————————————————————————————————

export async function prevueloReporte(input: {
  casoId: string;
  usuarioId: string;
  parteId?: string | null;
}): Promise<PrevueloReporteResultado> {
  const prep = await preparar(input.casoId, input.usuarioId, input.parteId ?? null);
  if (!prep.ok) return prep;
  const faltantes = {} as Record<PlantillaReporte, string[]>;
  for (const p of PLANTILLAS) faltantes[p.id] = faltantesDe(p, prep.datos);
  return {
    ok: true,
    caso: { id: prep.caso.id, nombre: nombreCaso(prep.caso), rol: prep.caso.rol },
    datos: prep.datos,
    sugerencia: sugerirPlantilla(prep.datos),
    faltantes_por_plantilla: faltantes,
    costo_estimado_usd: COSTO_ESTIMADO_REPORTE_USD,
    duracion_estimada_s: DURACION_ESTIMADA_REPORTE_S,
  };
}

// ————————————————————————————————————————————————————————————————
// Generación (paga, o gratis en sin_ia)
// ————————————————————————————————————————————————————————————————

/** Sólo lo que el formulario de esta plantilla/variante define, como texto. */
export function criterioLimpio(
  p: DefinicionPlantilla,
  variante: VarianteReporte | null,
  crudo: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Los checkboxes primero, porque `camposAplicables` los consulta (solo_si).
  for (const c of p.campos_criterio) {
    if (c.tipo === "checkbox" && crudo[c.clave] === true) out[c.clave] = true;
  }
  for (const c of camposAplicables(p, variante?.id ?? null, out)) {
    if (c.tipo === "checkbox") continue;
    const v = crudo[c.clave];
    if (typeof v === "string" && v.trim().length > 0) out[c.clave] = v.trim().slice(0, 2000);
  }
  return out;
}

function extractoDe(texto: string): string {
  return texto.replace(/\s+/g, " ").trim().slice(0, 300);
}

export async function generarReporteParaCaso(
  input: GenerarReporteInput,
): Promise<GenerarReporteResultado> {
  const t0 = Date.now();
  const nivel = input.nivel ?? NIVEL_DEFAULT;
  const { modelId } = MODELO_POR_NIVEL[nivel];

  const plantilla = plantillaPorId(input.plantilla);
  if (!plantilla) {
    return { ok: false, motivo: "plantilla_invalida", detalle: `No existe la plantilla ${input.plantilla}.` };
  }
  const variante = variantePorId(plantilla, input.variante);
  if (plantilla.variantes.length > 0 && !variante) {
    return {
      ok: false,
      motivo: "variante_invalida",
      detalle: `La plantilla ${plantilla.codigo} necesita una variante: ${plantilla.variantes.map((v) => v.id).join(", ")}.`,
    };
  }

  // --- Preparación (gratis) ---
  let prep: Preparado;
  let borrador: string;
  let asuntoBorrador: string;
  let criterio: Record<string, unknown>;
  let sinIa: boolean;
  let faltantesRender: string[];
  try {
    const p = await preparar(input.casoId, input.usuarioId, input.parteId);
    if (!p.ok) return p;
    prep = p;
    const destinatario = prep.datos.destinatario;
    if (!destinatario) {
      return { ok: false, motivo: "parte_inexistente", detalle: "Esa persona no está cargada en esta causa." };
    }
    if (!destinatario.es_cliente) {
      return {
        ok: false,
        motivo: "parte_no_cliente",
        detalle: `${destinatario.nombre} no está marcada como cliente del estudio. Sólo se reporta a clientes: marcala en Partes si corresponde.`,
      };
    }
    criterio = criterioLimpio(plantilla, variante, input.criterio ?? {});
    const r = renderizarReporte({
      plantilla,
      variante,
      rolEstudio: prep.caso.rol,
      valoresSistema: prep.datos.valores,
      criterio,
    });
    borrador = r.texto;
    faltantesRender = r.faltantes;
    asuntoBorrador = renderizarAsunto(plantilla, { ...prep.datos.valores, ...r.valores });
    sinIa = r.sin_ia || input.sinIa === true;
  } catch (e) {
    console.error("[reporteria] error preparando el reporte:", e);
    return {
      ok: false,
      motivo: "error",
      etapa: "preparacion",
      code: null,
      mensaje: "No pude cargar los datos de la causa.",
      ...(e instanceof Error ? { detalle: e.message } : {}),
    };
  }
  void faltantesRender;

  const supabase = createServerClient();
  const datosPersistidos: Record<string, unknown> = {
    etapa: prep.datos.etapa,
    ultimo_movimiento: prep.datos.ultimo_movimiento,
    movimientos_mes: prep.datos.movimientos_mes,
    proximos: prep.datos.proximos,
    valores: prep.datos.valores,
    sugerencia: sugerirPlantilla(prep.datos),
  };
  const destinatario = prep.datos.destinatario!;

  // --- Sin IA: se guarda el borrador tal cual ---
  if (sinIa) {
    try {
      const reporte = await insertarReporte({
        casoId: input.casoId,
        usuarioId: input.usuarioId,
        parteId: destinatario.parte_id,
        destinatarioNombre: destinatario.nombre,
        plantilla: plantilla.id,
        variante: variante?.id ?? null,
        canal: input.canal,
        asunto: input.canal === "email" ? asuntoBorrador : null,
        contenidoGenerado: borrador,
        contenido: borrador,
        criterio,
        datos: datosPersistidos,
        sinIa: true,
        ejecucionId: null,
      });
      return {
        ok: true,
        reporte,
        ejecucion_id: null,
        marcas_pendientes: contarMarcasReporte(reporte.contenido),
        extracto: extractoDe(reporte.contenido),
        metadata: { costo_usd: 0, sin_ia: true },
      };
    } catch (e) {
      console.error("[reporteria] error guardando el reporte sin IA:", e);
      return {
        ok: false,
        motivo: "error",
        etapa: "preparacion",
        code: null,
        mensaje: "No pude guardar el reporte.",
        ...(e instanceof Error ? { detalle: e.message } : {}),
      };
    }
  }

  // --- Redacción (paga) ---
  const notas: Record<string, string> = {};
  for (const c of plantilla.campos_criterio) {
    const v = criterio[c.clave];
    if (typeof v === "string") notas[c.label] = v;
    if (v === true) notas[c.label] = "sí";
  }
  const mensaje = armarMensajeReporte({
    plantilla,
    variante,
    canal: input.canal,
    borrador,
    datos: prep.datos,
    notasAbogado: notas,
    asuntoSugerido: input.canal === "email" ? asuntoBorrador : null,
  });

  try {
    const res = await runReporte({ mensaje, modelId });
    const latencia_ms = Date.now() - t0;

    // Las marcas son el contrato: si el modelo se comió una, el borrador manda.
    // Se compara por conjunto para no depender del orden.
    const marcasBorrador = new Set(borrador.match(/\[(?:FALTA|REDACTAR):[^\]]*\]/g) ?? []);
    const marcasSalida = new Set(res.contenido.match(/\[(?:FALTA|REDACTAR):[^\]]*\]/g) ?? []);
    const perdioMarcas = [...marcasBorrador].some((m) => !marcasSalida.has(m));
    const contenido = perdioMarcas ? borrador : res.contenido;
    if (perdioMarcas) {
      console.warn("[reporteria] el modelo omitió marcas [FALTA]; se conserva el borrador determinístico");
    }

    const { data: ejec, error: ejecErr } = await supabase
      .from("ejecuciones")
      .insert({
        usuario_id: input.usuarioId,
        tipo: "reporte_cliente",
        modelo: modelId,
        input_tokens: inputTokensParaCuota(res.usage),
        output_tokens: res.usage.output_tokens,
        costo_usd: res.costo_usd,
        latencia_ms,
        metadata: {
          caso_id: input.casoId,
          plantilla: plantilla.id,
          variante: variante?.id ?? null,
          canal: input.canal,
          nivel,
          usage: res.usage,
          perdio_marcas: perdioMarcas,
        },
      })
      .select("id")
      .single();
    if (ejecErr) console.error("[reporteria] error persistiendo ejecución:", ejecErr);
    const ejecucionId = (ejec as { id?: string } | null)?.id ?? null;

    const reporte = await insertarReporte({
      casoId: input.casoId,
      usuarioId: input.usuarioId,
      parteId: destinatario.parte_id,
      destinatarioNombre: destinatario.nombre,
      plantilla: plantilla.id,
      variante: variante?.id ?? null,
      canal: input.canal,
      asunto: input.canal === "email" ? (res.asunto ?? asuntoBorrador) : null,
      contenidoGenerado: contenido,
      contenido,
      criterio,
      datos: datosPersistidos,
      sinIa: false,
      ejecucionId,
    });
    return {
      ok: true,
      reporte,
      ejecucion_id: ejecucionId,
      marcas_pendientes: contarMarcasReporte(reporte.contenido),
      extracto: extractoDe(reporte.contenido),
      metadata: { costo_usd: res.costo_usd, sin_ia: false },
    };
  } catch (e) {
    if (e instanceof AgentError) {
      // Los tokens parciales SE COBRARON: quedan en ejecuciones igual que en
      // los escritos.
      const { error: ejecErr } = await supabase.from("ejecuciones").insert({
        usuario_id: input.usuarioId,
        tipo: "reporte_cliente",
        modelo: modelId,
        input_tokens: inputTokensParaCuota(e.partialUsage),
        output_tokens: e.partialUsage.output_tokens,
        costo_usd: e.partialCostoUsd,
        latencia_ms: Date.now() - t0,
        metadata: {
          caso_id: input.casoId,
          plantilla: plantilla.id,
          error: e.code,
          error_message: e.message,
          usage: e.partialUsage,
        },
      });
      if (ejecErr) console.error("[reporteria] error persistiendo ejecución fallida:", ejecErr);
      return {
        ok: false,
        motivo: "error",
        etapa: "redaccion",
        code: e.code,
        mensaje: mensajeDeErrorDeApi(e.code, e.message),
        detalle: e.message,
      };
    }
    console.error("[reporteria] error inesperado en la redacción:", e);
    return {
      ok: false,
      motivo: "error",
      etapa: "redaccion",
      code: null,
      mensaje: "No pude guardar el reporte.",
      ...(e instanceof Error ? { detalle: e.message } : {}),
    };
  }
}
