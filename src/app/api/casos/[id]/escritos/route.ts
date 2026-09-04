import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { enforceTokenLimit } from "@/lib/auth/enforce-rate";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";
import { COLS_CASO, COLS_PARTE } from "@/lib/casos/columnas";
import { nombreCaso } from "@/lib/casos/nombre";
import { buildContextoCaso } from "@/lib/casos/build-contexto-caso";
import { MODELO_POR_NIVEL } from "@/lib/agent/modelos";
import { AgentError } from "@/lib/agent/run-agent";
import { inputTokensParaCuota } from "@/lib/lexie/queries";
import { generarEscritoInputSchema } from "@/lib/schemas";
import type { Caso, ParteCaso } from "@/lib/types";
import { armarDatosEscrito } from "@/lib/escritos/datos-causa";
import { armarMensajeEscrito } from "@/lib/escritos/prompt";
import {
  getPerfilProfesional,
  insertarEscrito,
  listarEscritos,
  migracionEscritosAplicada,
  obtenerModelo,
} from "@/lib/escritos/queries";
import { runEscrito } from "@/lib/escritos/run-escrito";
import { esModeloDelEstudio, esUuid } from "@/lib/escritos/types";

// Latencia medida del chat del caso con varias búsquedas: 40-90 s. El redactor
// tiene presupuestos más chicos (4 + 3) pero escribe una salida larga: 120 s
// da margen. maxDuration es inerte en Easypanel (el timeout lo pone el proxy).
export const maxDuration = 120;

const uuidSchema = z.string().uuid();

// Traducción del error crudo de la API a algo que el abogado pueda accionar.
// Copiado del criterio de /api/lexie: "probá de nuevo" es un consejo inútil
// cuando la causa es que la cuenta se quedó sin crédito.
function mensajeDeErrorDeApi(code: string, detalle: string): string {
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

// === GET /api/casos/[id]/escritos — los escritos de la causa ===
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  try {
    // El filtro de propiedad va en la query (usuario_id es columna de la
    // tabla): un caso ajeno devuelve lista vacía, no sus escritos.
    const escritos = await listarEscritos(id, wl.usuario_id);
    return jsonResponse({ ok: true, escritos }, 200);
  } catch (e) {
    console.error("[GET escritos] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error listando los escritos",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}

// === POST /api/casos/[id]/escritos — redactar un escrito nuevo ===
//
// Orden de las operaciones, y por qué:
//   1. validar body, auth, cupo mensual (todo gratis, antes de gastar);
//   2. cargar caso + partes + perfil + modelo (gratis);
//   3. correr el redactor (paga);
//   4. registrar la ejecución (tokens reales) y recién después el escrito con
//      el `ejecucion_id`. Si el tracking falla, el escrito se guarda igual con
//      ejecucion_id null: la plata ya se gastó y el texto es lo que el abogado
//      vino a buscar.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const t0 = Date.now();
  const { id: casoId } = await params;
  if (!uuidSchema.safeParse(casoId).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = generarEscritoInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }
  const { modelo_id, nivel } = parsed.data;
  const instrucciones = parsed.data.instrucciones ?? null;
  if (!esModeloDelEstudio(modelo_id) && !esUuid(modelo_id)) {
    return jsonResponse({ ok: false, error: "modelo_id inválido" }, 400);
  }
  const { modelId } = MODELO_POR_NIVEL[nivel];

  let rate;
  try {
    rate = await enforceTokenLimit(wl.usuario_id);
  } catch (e) {
    console.error("[POST escritos] enforceTokenLimit falló:", e);
    return jsonResponse(
      { ok: false, error: "No pude verificar tu consumo del mes. Probá de nuevo." },
      500,
    );
  }
  if (!rate.ok) {
    return jsonResponse(
      {
        ok: false,
        error: `Alcanzaste el límite mensual de ${rate.limite.toLocaleString("es-AR")} tokens.`,
      },
      429,
    );
  }

  // Sondeo gratis antes de gastar: si la tabla no existe, la redacción se
  // cobraría y después no se podría guardar.
  if (!(await migracionEscritosAplicada())) {
    return jsonResponse(
      {
        ok: false,
        error:
          "Falta aplicar la migración de escritos en la base (20260904120000_escritos.sql). Hasta entonces no se pueden generar escritos.",
      },
      503,
    );
  }

  const supabase = createServerClient();

  // --- Carga (gratis) ---
  let caso: Caso;
  let partes: ParteCaso[];
  let mensaje: string;
  let modeloTitulo: string;
  try {
    const [casoRes, partesRes, perfil, modelo] = await Promise.all([
      supabase
        .from("casos")
        .select(COLS_CASO)
        .eq("id", casoId)
        .eq("usuario_id", wl.usuario_id)
        .maybeSingle(),
      supabase
        .from("partes_caso")
        .select(COLS_PARTE)
        .eq("caso_id", casoId)
        .order("creado_en", { ascending: true }),
      getPerfilProfesional(wl.usuario_id),
      obtenerModelo(modelo_id, wl.usuario_id),
    ]);
    if (casoRes.error) throw new Error(casoRes.error.message);
    if (!casoRes.data) {
      // 404 y no 403: un 403 confirmaría que la causa existe.
      return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
    }
    if (partesRes.error) throw new Error(partesRes.error.message);
    if (!modelo) {
      return jsonResponse({ ok: false, error: "Modelo no encontrado" }, 404);
    }
    caso = casoRes.data as unknown as Caso;
    partes = (partesRes.data ?? []) as ParteCaso[];
    modeloTitulo = modelo.titulo;

    const datos = armarDatosEscrito(caso, partes, perfil);
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
    console.error("[POST escritos] error preparando la generación:", e);
    return jsonResponse(
      {
        ok: false,
        error: "No pude cargar los datos de la causa.",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }

  // --- Redacción (paga) ---
  try {
    const res = await runEscrito({ mensaje, modelId });
    const latencia_ms = Date.now() - t0;

    const { data: ejec, error: ejecErr } = await supabase
      .from("ejecuciones")
      .insert({
        usuario_id: wl.usuario_id,
        tipo: "generar_escrito",
        modelo: modelId,
        input_tokens: inputTokensParaCuota(res.usage),
        output_tokens: res.usage.output_tokens,
        costo_usd: res.costo_usd,
        latencia_ms,
        metadata: {
          caso_id: casoId,
          modelo_escrito_id: modelo_id,
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
      console.error("[POST escritos] insert ejecucion falló:", ejecErr);
    }

    // El título del escrito es la suma que escribió el redactor (primera línea
    // `# ...`), en su capitalización normal; si no la puso, el del modelo.
    const primera = res.contenido.split("\n")[0]?.trim() ?? "";
    const suma = primera.startsWith("# ") ? primera.slice(2).trim() : "";
    const titulo = suma ? capitalizarSuma(suma) : modeloTitulo;

    const escrito = await insertarEscrito({
      casoId,
      usuarioId: wl.usuario_id,
      modeloId: modelo_id,
      modeloTitulo,
      titulo,
      contenido: res.contenido,
      instrucciones,
      ejecucionId: ejec?.id ?? null,
    });

    return jsonResponse(
      {
        ok: true,
        escrito,
        metadata: {
          costo_usd: res.costo_usd,
          busquedas: res.busquedas.length,
          consultas_repositorio: res.consultas_repositorio.length,
          degraded_response: res.degraded_response,
        },
      },
      201,
    );
  } catch (e) {
    const latencia_ms = Date.now() - t0;
    if (e instanceof AgentError) {
      // Los tokens parciales SE COBRARON: se registran igual.
      const { error: ejecErrFallo } = await supabase.from("ejecuciones").insert({
        usuario_id: wl.usuario_id,
        tipo: "generar_escrito",
        modelo: modelId,
        input_tokens: inputTokensParaCuota(e.partialUsage),
        output_tokens: e.partialUsage.output_tokens,
        costo_usd: e.partialCostoUsd,
        latencia_ms,
        metadata: {
          caso_id: casoId,
          modelo_escrito_id: modelo_id,
          nivel,
          error_code: e.code,
          error_message: e.message,
          usage: e.partialUsage,
          busquedas: e.partialBusquedas,
          iterations: e.partialIterations,
        },
      });
      if (ejecErrFallo) {
        console.error("[POST escritos] no pude registrar la ejecución fallida:", ejecErrFallo);
      }
      console.error(`[POST escritos] AgentError ${e.code}:`, e.message);
      return jsonResponse(
        { ok: false, error: mensajeDeErrorDeApi(e.code, e.message), code: e.code },
        502,
      );
    }
    console.error("[POST escritos] error inesperado:", e);
    return jsonResponse(
      {
        ok: false,
        error: "No pude redactar el escrito.",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}

// "SOLICITA EXCARCELACIÓN. OFRECE CAUCIÓN." → "Solicita excarcelación. Ofrece caución."
// Sólo para el título de la lista: en el PDF la suma va en mayúsculas.
function capitalizarSuma(suma: string): string {
  const s = suma.replace(/\.\s*$/, "").toLowerCase();
  return s
    .split(/(\.\s+)/)
    .map((t) => (t.length > 0 ? t[0].toUpperCase() + t.slice(1) : t))
    .join("")
    .slice(0, 300);
}
