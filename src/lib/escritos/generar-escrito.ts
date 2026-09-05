import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import { COLS_CASO, COLS_PARTE } from "@/lib/casos/columnas";
import { nombreCaso } from "@/lib/casos/nombre";
import { buildContextoCaso } from "@/lib/casos/build-contexto-caso";
import { casoEsDelUsuario } from "@/lib/agenda/queries";
import {
  MODELO_POR_NIVEL,
  NIVEL_DEFAULT,
  type NivelModelo,
} from "@/lib/agent/modelos";
import { AgentError, type AgentErrorCode } from "@/lib/agent/run-agent";
import { inputTokensParaCuota } from "@/lib/lexie/queries";
import type { Caso, ParteCaso } from "@/lib/types";
import { armarDatosEscrito, type DatosEscrito } from "./datos-causa";
import { armarMensajeEscrito } from "./prompt";
import {
  getPerfilProfesional,
  insertarEscrito,
  migracionEscritosAplicada,
  obtenerModelo,
} from "./queries";
import { runEscrito } from "./run-escrito";
import {
  contarPendientes,
  type EscritoGenerado,
  type ModeloEscrito,
  type OrigenModelo,
  type PerfilProfesional,
} from "./types";

// Generar un escrito para una causa, como SERVICIO.
//
// Hasta la Fase 11 esta secuencia vivía inline en `POST /api/casos/[id]/escritos`.
// LEXIE pasa a poder generar el escrito de una causa desde el chat global, y
// eso quería decir copiar ~150 líneas de ruta dentro de una tool — con la
// garantía de que las dos copias divergirían en el primer arreglo, que es
// exactamente lo que pasó con los dos loops del agente antes del motor. Acá
// vive la única secuencia; la ruta y la tool la llaman.
//
// === Dos entradas, una gratis y una paga ===
//
// `prevueloEscrito` NO llama al modelo: valida propiedad, resuelve el modelo,
// arma los datos del expediente y dice qué se va a usar y qué va a salir como
// [COMPLETAR: …]. Es lo que la tool de LEXIE le muestra al abogado ANTES de
// pedirle confirmación para gastar, y es lo mismo que el paso 2 del diálogo
// de la ficha le muestra antes de apretar Generar.
//
// `generarEscritoParaCaso` es la secuencia completa: sondeo → carga → contexto
// → redactor → `ejecuciones` → `escritos_generados`. El orden importa por la
// plata: todo lo gratis va antes de la única llamada paga, y si el tracking
// falla después de cobrar, el escrito se guarda igual con `ejecucion_id`
// null —el texto es lo que el abogado vino a buscar.
//
// === Aislamiento ===
//
// `usuarioId` viene SIEMPRE del contexto del servidor (la whitelist en la
// ruta, `ContextoLexie` en la tool), nunca de un input del modelo. El
// `casoId` y el `modeloId` sí pueden venir del modelo, así que la propiedad
// se verifica con `casoEsDelUsuario` ANTES de leer nada que cuelgue del caso
// —`partes_caso` no tiene `usuario_id` propio— y la carga del caso repite el
// `.eq("usuario_id", …)` dentro del SELECT, que es lo que la ruta hizo
// siempre. `obtenerModelo` filtra por dueño en los modelos propios.

/** Medido el 2026-09-04 sobre una causa real: 38 s, USD 0,092. */
export const COSTO_ESTIMADO_ESCRITO_USD = 0.09;
/** Latencia del chat del caso con varias búsquedas; el redactor está en el mismo rango. */
export const DURACION_ESTIMADA_ESCRITO_S = "40-90";

/** Lo que la ruta devuelve con 503 y LEXIE le dice al abogado. Un solo texto. */
export const MENSAJE_SIN_MIGRACION_ESCRITOS =
  "Falta aplicar la migración de escritos en la base (20260904120000_escritos.sql). Hasta entonces no se pueden generar escritos.";

// ————————————————————————————————————————————————————————————————
// Tipos
// ————————————————————————————————————————————————————————————————

export type PrevueloEscritoInput = {
  casoId: string;
  /** Del servidor. Nunca del input del modelo. */
  usuarioId: string;
  /** Slug del catálogo o UUID de un modelo propio. */
  modeloId: string;
  instrucciones?: string | null;
};

export type PrevueloEscritoOk = {
  ok: true;
  modelo: { id: string; titulo: string; numero?: number; origen: OrigenModelo };
  caso: { id: string; nombre: string };
  /** Los datos del encabezado que SÍ tienen valor, por etiqueta ("Carátula": "…"). */
  datos_usados: Record<string, string>;
  /** Etiquetas de los datos que van a salir como `[COMPLETAR: etiqueta]`. */
  faltantes: string[];
  /** Campos del perfil profesional vacíos: se cargan una vez, no por causa. */
  perfil_incompleto: (keyof PerfilProfesional)[];
  instrucciones: string | null;
  costo_estimado_usd: number;
  duracion_estimada_s: string;
};

export type MotivoPrevueloFallido =
  | "caso_ajeno"
  | "modelo_inexistente"
  | "sin_migracion";

export type PrevueloEscritoFallo = {
  ok: false;
  motivo: MotivoPrevueloFallido;
  detalle?: string;
};

export type PrevueloEscritoResultado = PrevueloEscritoOk | PrevueloEscritoFallo;

export type GenerarEscritoParaCasoInput = {
  casoId: string;
  /** Del servidor. Nunca del input del modelo. */
  usuarioId: string;
  modeloId: string;
  instrucciones?: string | null;
  /** Default "medio". El model id se resuelve acá con MODELO_POR_NIVEL, nunca viene de afuera. */
  nivel?: NivelModelo;
};

export type GenerarEscritoOk = {
  ok: true;
  escrito: EscritoGenerado;
  ejecucion_id: string | null;
  /** Cuántas marcas [COMPLETAR: …] quedaron: lo que decide si está listo para presentar. */
  marcas_pendientes: number;
  /** Los primeros 300 caracteres del texto, sin la suma. */
  extracto: string;
  /** Lo que la ruta devuelve en `metadata` y el drill-down de consumo muestra. */
  metadata: {
    costo_usd: number;
    busquedas: number;
    consultas_repositorio: number;
    degraded_response: boolean;
  };
};

export type GenerarEscritoFallo =
  | PrevueloEscritoFallo
  | {
      ok: false;
      motivo: "error";
      /** "preparacion" falló antes de gastar; "redaccion" ya se cobró (total o parcialmente). */
      etapa: "preparacion" | "redaccion";
      /** Código del AgentError cuando la falla fue del modelo o de la API; null si fue otra cosa. */
      code: AgentErrorCode | null;
      /** Ya traducido para el abogado ("La cuenta de Anthropic se quedó sin crédito…"). */
      mensaje: string;
      /** El mensaje crudo del error, para logs y para `detail` en desarrollo. */
      detalle?: string;
    };

export type GenerarEscritoResultado = GenerarEscritoOk | GenerarEscritoFallo;

// ————————————————————————————————————————————————————————————————
// Helpers puros
// ————————————————————————————————————————————————————————————————

// "SOLICITA EXCARCELACIÓN. OFRECE CAUCIÓN." → "Solicita excarcelación. Ofrece caución"
// (sin el punto final). Sólo para el título de la lista: en el PDF la suma va
// en mayúsculas.
export function capitalizarSuma(suma: string): string {
  const s = suma.replace(/\.\s*$/, "").toLowerCase();
  return s
    .split(/(\.\s+)/)
    .map((t) => (t.length > 0 ? t[0].toUpperCase() + t.slice(1) : t))
    .join("")
    .slice(0, 300);
}

// Traducción del error crudo de la API a algo que el abogado pueda accionar.
// Copiado del criterio de /api/lexie: "probá de nuevo" es un consejo inútil
// cuando la causa es que la cuenta se quedó sin crédito.
export function mensajeDeErrorDeApi(code: string, detalle: string): string {
  if (code !== "API_ERROR") {
    return "La redacción se hizo demasiado larga y no pude cerrarla. Probá con instrucciones más acotadas.";
  }
  const d = detalle.toLowerCase();
  if (d.includes("credit balance") || d.includes("billing")) {
    return "La cuenta de Anthropic se quedó sin crédito. Hay que recargarla para poder redactar.";
  }
  if (d.includes("rate_limit") || d.includes("429")) {
    return "Demasiadas consultas seguidas. Esperá unos segundos y probá otra vez.";
  }
  if (d.includes("overloaded")) {
    return "El modelo está sobrecargado en este momento. Probá de nuevo en un minuto.";
  }
  return "Se cortó la conexión con el modelo. Probá de nuevo en un momento.";
}

// Mismo criterio que `fichaTextoOpcional` en schemas.ts: vacío o sólo
// espacios es "sin instrucciones", no una instrucción vacía.
function normalizarInstrucciones(v: string | null | undefined): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t.length > 0 ? t : null;
}

// El título del escrito es la suma que escribió el redactor (primera línea
// `# ...`), en su capitalización normal; si no la puso, el del modelo.
function tituloDelEscrito(contenido: string, tituloModelo: string): string {
  const primera = contenido.split("\n")[0]?.trim() ?? "";
  const suma = primera.startsWith("# ") ? primera.slice(2).trim() : "";
  return suma ? capitalizarSuma(suma) : tituloModelo;
}

// Lo que se le muestra al abogado como vista previa de lo generado: el
// arranque del escrito sin la suma, que ya va aparte como título.
function extractoDelEscrito(contenido: string): string {
  const lineas = contenido.split("\n");
  const sinTitulo = lineas[0]?.trim().startsWith("# ") ? lineas.slice(1) : lineas;
  return sinTitulo.join("\n").trim().slice(0, 300);
}

const CAMPOS_PERFIL: (keyof PerfilProfesional)[] = [
  "nombre_completo",
  "matricula",
  "domicilio_constituido",
  "domicilio_electronico",
];

// ————————————————————————————————————————————————————————————————
// Preparación (gratis), compartida por las dos entradas
// ————————————————————————————————————————————————————————————————

type Preparado = {
  ok: true;
  caso: Caso;
  partes: ParteCaso[];
  perfil: PerfilProfesional;
  modelo: ModeloEscrito;
  datos: DatosEscrito;
};

// Sondeo → propiedad → carga en paralelo → datos del encabezado. Tira ante
// un error de la base (igual que `casoEsDelUsuario`): un `false` acá se
// leería como "la causa no es tuya", y eso no es lo que pasó.
async function preparar(
  casoId: string,
  usuarioId: string,
  modeloId: string,
): Promise<Preparado | PrevueloEscritoFallo> {
  // Sondeo gratis antes de cualquier otra cosa: si la tabla no existe, una
  // redacción se cobraría y después no se podría guardar.
  if (!(await migracionEscritosAplicada())) {
    return {
      ok: false,
      motivo: "sin_migracion",
      detalle: MENSAJE_SIN_MIGRACION_ESCRITOS,
    };
  }

  // La barrera de propiedad va ANTES de la carga: `partes_caso` no tiene
  // `usuario_id`, así que sin este guard el SELECT de partes leería las de
  // una causa ajena aunque después se descartaran.
  if (!(await casoEsDelUsuario(casoId, usuarioId))) {
    return { ok: false, motivo: "caso_ajeno" };
  }

  const supabase = createServerClient();
  const [casoRes, partesRes, perfil, modelo] = await Promise.all([
    supabase
      .from("casos")
      .select(COLS_CASO)
      .eq("id", casoId)
      .eq("usuario_id", usuarioId)
      .maybeSingle(),
    supabase
      .from("partes_caso")
      .select(COLS_PARTE)
      .eq("caso_id", casoId)
      .order("creado_en", { ascending: true }),
    getPerfilProfesional(usuarioId),
    obtenerModelo(modeloId, usuarioId),
  ]);
  if (casoRes.error) throw new Error(casoRes.error.message);
  // Pasó el guard y ahora no está: la causa se borró entre medio. Misma
  // respuesta que si nunca hubiera sido suya.
  if (!casoRes.data) return { ok: false, motivo: "caso_ajeno" };
  if (partesRes.error) throw new Error(partesRes.error.message);
  if (!modelo) {
    return {
      ok: false,
      motivo: "modelo_inexistente",
      detalle: `No existe un modelo con id «${modeloId}» en el catálogo del estudio ni entre los modelos del abogado.`,
    };
  }

  const caso = casoRes.data as unknown as Caso;
  const partes = (partesRes.data ?? []) as ParteCaso[];
  return {
    ok: true,
    caso,
    partes,
    perfil,
    modelo,
    datos: armarDatosEscrito(caso, partes, perfil),
  };
}

// ————————————————————————————————————————————————————————————————
// Pre-vuelo (gratis)
// ————————————————————————————————————————————————————————————————

/**
 * Qué se va a usar y qué va a faltar si se genera este escrito para esta
 * causa. NO llama al modelo ni escribe nada. Tira ante un error de la base.
 */
export async function prevueloEscrito(
  input: PrevueloEscritoInput,
): Promise<PrevueloEscritoResultado> {
  const prep = await preparar(input.casoId, input.usuarioId, input.modeloId);
  if (!prep.ok) return prep;
  const { caso, perfil, modelo, datos } = prep;

  // Por etiqueta y no por clave de placeholder: es lo que el abogado lee, y
  // coincide con lo que el redactor escribe en la marca [COMPLETAR: etiqueta].
  const datos_usados: Record<string, string> = {};
  for (const d of datos.datos) {
    if (d.valor !== null) datos_usados[d.label] = d.valor;
  }

  return {
    ok: true,
    modelo: {
      id: modelo.id,
      titulo: modelo.titulo,
      ...(modelo.numero !== null ? { numero: modelo.numero } : {}),
      origen: modelo.origen,
    },
    caso: { id: caso.id, nombre: nombreCaso(caso) },
    datos_usados,
    faltantes: datos.faltantes.map((d) => d.label),
    perfil_incompleto: CAMPOS_PERFIL.filter((k) => !perfil[k]?.trim()),
    instrucciones: normalizarInstrucciones(input.instrucciones),
    costo_estimado_usd: COSTO_ESTIMADO_ESCRITO_USD,
    duracion_estimada_s: DURACION_ESTIMADA_ESCRITO_S,
  };
}

// ————————————————————————————————————————————————————————————————
// Generación (paga)
// ————————————————————————————————————————————————————————————————

/**
 * La secuencia completa. No tira: todo fallo vuelve como `{ ok: false }`, con
 * `etapa` para saber si se gastó plata y `code` cuando la falla fue del
 * modelo. Los tokens parciales de una redacción cortada SE COBRARON y quedan
 * registrados en `ejecuciones` igual que en el éxito.
 */
export async function generarEscritoParaCaso(
  input: GenerarEscritoParaCasoInput,
): Promise<GenerarEscritoResultado> {
  const t0 = Date.now();
  const { casoId, usuarioId, modeloId } = input;
  const nivel = input.nivel ?? NIVEL_DEFAULT;
  const { modelId } = MODELO_POR_NIVEL[nivel];
  const instrucciones = normalizarInstrucciones(input.instrucciones);

  // --- Preparación (gratis) ---
  let mensaje: string;
  let modeloTitulo: string;
  try {
    const prep = await preparar(casoId, usuarioId, modeloId);
    if (!prep.ok) return prep;
    const { caso, modelo, datos } = prep;
    modeloTitulo = modelo.titulo;

    // El contexto completo de la causa, mapa incluido: la etapa procesal es lo
    // que le dice al redactor si el escrito llega a tiempo o tarde.
    const { contextoMarkdown } = await buildContextoCaso(casoId, {
      incluirMapa: true,
    });
    mensaje = armarMensajeEscrito({
      modelo,
      datos,
      nombreCausa: nombreCaso(caso),
      instrucciones,
      contextoCaso: contextoMarkdown,
    });
  } catch (e) {
    console.error("[generar-escrito] error preparando la generación:", e);
    return {
      ok: false,
      motivo: "error",
      etapa: "preparacion",
      code: null,
      mensaje: "No pude cargar los datos de la causa.",
      ...(e instanceof Error ? { detalle: e.message } : {}),
    };
  }

  // --- Redacción (paga) ---
  const supabase = createServerClient();
  try {
    const res = await runEscrito({ mensaje, modelId });
    const latencia_ms = Date.now() - t0;

    const { data: ejec, error: ejecErr } = await supabase
      .from("ejecuciones")
      .insert({
        usuario_id: usuarioId,
        tipo: "generar_escrito",
        modelo: modelId,
        input_tokens: inputTokensParaCuota(res.usage),
        output_tokens: res.usage.output_tokens,
        costo_usd: res.costo_usd,
        latencia_ms,
        metadata: {
          caso_id: casoId,
          modelo_escrito_id: modeloId,
          modelo_escrito_titulo: modeloTitulo,
          nivel,
          instrucciones,
          usage: res.usage,
          busquedas: res.busquedas,
          consultas_repositorio: res.consultas_repositorio,
          iterations: res.iterations,
          degraded_response: res.degraded_response,
        },
      })
      .select("id")
      .single();
    if (ejecErr) {
      // Ya se cobró: el escrito se guarda igual. Queda en logs para
      // reconciliar (y es el síntoma de que falta correr la migración que
      // suma 'generar_escrito' al CHECK).
      console.error("[generar-escrito] insert ejecucion falló:", ejecErr);
    }

    const escrito = await insertarEscrito({
      casoId,
      usuarioId,
      modeloId,
      modeloTitulo,
      titulo: tituloDelEscrito(res.contenido, modeloTitulo),
      contenido: res.contenido,
      instrucciones,
      ejecucionId: ejec?.id ?? null,
    });

    return {
      ok: true,
      escrito,
      ejecucion_id: escrito.ejecucion_id,
      marcas_pendientes: contarPendientes(escrito.contenido),
      extracto: extractoDelEscrito(escrito.contenido),
      metadata: {
        costo_usd: res.costo_usd,
        busquedas: res.busquedas.length,
        consultas_repositorio: res.consultas_repositorio.length,
        degraded_response: res.degraded_response,
      },
    };
  } catch (e) {
    const latencia_ms = Date.now() - t0;
    if (e instanceof AgentError) {
      // Los tokens parciales SE COBRARON: se registran igual.
      const { error: ejecErrFallo } = await supabase.from("ejecuciones").insert({
        usuario_id: usuarioId,
        tipo: "generar_escrito",
        modelo: modelId,
        input_tokens: inputTokensParaCuota(e.partialUsage),
        output_tokens: e.partialUsage.output_tokens,
        costo_usd: e.partialCostoUsd,
        latencia_ms,
        metadata: {
          caso_id: casoId,
          modelo_escrito_id: modeloId,
          nivel,
          error_code: e.code,
          error_message: e.message,
          usage: e.partialUsage,
          busquedas: e.partialBusquedas,
          iterations: e.partialIterations,
        },
      });
      if (ejecErrFallo) {
        console.error(
          "[generar-escrito] no pude registrar la ejecución fallida:",
          ejecErrFallo,
        );
      }
      console.error(`[generar-escrito] AgentError ${e.code}:`, e.message);
      return {
        ok: false,
        motivo: "error",
        etapa: "redaccion",
        code: e.code,
        mensaje: mensajeDeErrorDeApi(e.code, e.message),
        detalle: e.message,
      };
    }
    console.error("[generar-escrito] error inesperado:", e);
    return {
      ok: false,
      motivo: "error",
      etapa: "redaccion",
      code: null,
      mensaje: "No pude redactar el escrito.",
      ...(e instanceof Error ? { detalle: e.message } : {}),
    };
  }
}
