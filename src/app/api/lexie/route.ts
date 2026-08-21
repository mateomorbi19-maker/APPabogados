import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { enforceTokenLimit } from "@/lib/auth/enforce-rate";
import { jsonResponse } from "@/lib/http";
import { createServerClient } from "@/lib/supabase/server";
import { MODELO_POR_NIVEL, NIVELES_MODELO, NIVEL_DEFAULT } from "@/lib/agent/modelos";
import { AgentError } from "@/lib/agent/run-agent";
import { runLexie } from "@/lib/agent/run-lexie";
import { LEXIE_SYSTEM_PROMPT } from "@/lib/agent/lexie-prompt";
import { cargarDatosLexie, construirContextoModelo } from "@/lib/lexie/contexto";
import {
  getMensajes,
  getOCrearConversacionActiva,
  guardarTurno,
  inputTokensParaCuota,
  ponerTituloSiFalta,
  reconstruirHistorial,
} from "@/lib/lexie/queries";

// POST /api/lexie — un turno de conversación con la asistente global.
//
// Latencia medida del chat por caso: 40-90 s con varias búsquedas. LEXIE tiene
// presupuestos más chicos, pero un turno que consulta agenda + repositorio +
// normativa puede acercarse. 120 s da margen sin dejar la request colgada para
// siempre.
//
// OJO: maxDuration es inerte en Easypanel — ahí el timeout real lo impone el
// proxy, no Next. Sirve para Vercel y como documentación de la expectativa.
export const maxDuration = 120;

const bodySchema = z.object({
  mensaje: z.string().min(1, "El mensaje no puede estar vacío").max(4000),
  nivel: z.enum(NIVELES_MODELO).optional(),
});

// GET /api/lexie — lo que el panel necesita para abrirse: el saludo y el hilo
// que haya quedado abierto.
//
// El SALUDO se arma acá, server-side, con string templates sobre datos ya
// calculados: no hay ninguna llamada al modelo. Un abogado que abre y cierra la
// app ocho veces en el día no paga ocho saludos, y la hora y los vencimientos
// —lo único que acá tiene que ser exacto— son aritmética, no inferencia.
//
// Se llama al ABRIR el panel, no al cargar cada página: nadie paga dos queries
// por entrar a la Bandeja.
export async function GET() {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  try {
    const [datos, conv] = await Promise.all([
      cargarDatosLexie(wl.usuario_id, wl.nombre),
      getOCrearConversacionActiva(wl.usuario_id),
    ]);
    const mensajes = await getMensajes(conv.id);

    return jsonResponse(
      {
        ok: true,
        saludo: datos.saludo,
        conversacion_id: conv.id,
        mensajes: mensajes.map((m) => ({
          id: m.id,
          tipo: m.tipo,
          contenido: m.contenido,
          creado_en: m.creado_en,
        })),
      },
      200,
    );
  } catch (e) {
    console.error("[GET lexie] error:", e);
    return jsonResponse({ ok: false, error: "No pude abrir LEXIE." }, 500);
  }
}

export async function POST(req: Request) {
  const t0 = Date.now();

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body inválido" }, 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Body inválido" },
      400,
    );
  }
  const { mensaje } = parsed.data;

  // El cliente manda el NIVEL, nunca el model ID: el mapeo se resuelve acá.
  const nivel = parsed.data.nivel ?? NIVEL_DEFAULT;
  const { modelId } = MODELO_POR_NIVEL[nivel];

  const rate = await enforceTokenLimit(wl.usuario_id);
  if (!rate.ok) {
    return jsonResponse(
      {
        ok: false,
        error: `Alcanzaste el límite mensual de ${rate.limite.toLocaleString("es-AR")} tokens.`,
      },
      429,
    );
  }

  let conversacionId: string;
  let contextoInicial: string | null = null;
  let mensajesPrevios;
  let nombre = wl.nombre;

  try {
    const conv = await getOCrearConversacionActiva(wl.usuario_id);
    conversacionId = conv.id;
    const historial = await getMensajes(conv.id);
    mensajesPrevios = reconstruirHistorial(historial);

    // El contexto pesado (causas + agenda + fecha) va SOLO en el primer
    // mensaje del hilo. Después ya vive en el historial, que además queda
    // dentro del prefijo cacheado del motor.
    if (mensajesPrevios.length === 0) {
      const datos = await cargarDatosLexie(wl.usuario_id, wl.nombre);
      nombre = datos.nombre;
      contextoInicial = construirContextoModelo(datos);
    }
  } catch (e) {
    console.error("[POST lexie] error preparando la conversación:", e);
    return jsonResponse(
      { ok: false, error: "No se pudo abrir la conversación." },
      500,
    );
  }

  const supabase = createServerClient();

  try {
    const res = await runLexie({
      pregunta: mensaje,
      contextoInicial,
      systemPrompt: LEXIE_SYSTEM_PROMPT,
      modelId,
      mensajesPrevios,
      usuarioId: wl.usuario_id,
      nombre,
    });

    // Persistir el turno ANTES de responder, pero DESPUÉS de que el agente
    // contestó: así nunca queda un mensaje de usuario huérfano si el turno
    // muere, que es lo que brickea una conversación para siempre.
    const { idUsuario, idAgente } = await guardarTurno({
      conversacionId,
      pregunta: mensaje,
      respuesta: res.rawText,
      metadataAgente: {
        busquedas: res.busquedas,
        consultas_repositorio: res.consultas_repositorio,
        herramientas_usadas: res.herramientas_usadas,
        degraded_response: res.degraded_response,
      },
    });
    await ponerTituloSiFalta(conversacionId, mensaje);

    const latencia_ms = Date.now() - t0;
    const { error: ejecErr } = await supabase.from("ejecuciones").insert({
      usuario_id: wl.usuario_id,
      tipo: "lexie",
      modelo: modelId,
      // Ver inputTokensParaCuota: suma los tres buckets de entrada para que la
      // columna siga significando lo mismo que antes del prompt caching.
      input_tokens: inputTokensParaCuota(res.usage),
      output_tokens: res.usage.output_tokens,
      costo_usd: res.costo_usd,
      latencia_ms,
      metadata: {
        conversacion_id: conversacionId,
        mensaje_usuario_id: idUsuario,
        mensaje_agente_id: idAgente,
        nivel,
        pregunta: mensaje,
        usage: res.usage,
        busquedas: res.busquedas,
        consultas_repositorio: res.consultas_repositorio,
        herramientas_usadas: res.herramientas_usadas,
        iterations: res.iterations,
        degraded_response: res.degraded_response,
        contexto_inyectado: contextoInicial !== null,
      },
    });
    if (ejecErr) {
      // El turno ya se respondió y ya se cobró: un fallo del tracking no puede
      // tirar abajo la respuesta del abogado. Queda en logs para reconciliar.
      console.error("[POST lexie] insert ejecucion falló:", ejecErr);
    }

    return jsonResponse(
      {
        ok: true,
        conversacion_id: conversacionId,
        respuesta: res.rawText,
        metadata: {
          herramientas_usadas: res.herramientas_usadas,
          consultas_repositorio: res.consultas_repositorio,
          degraded_response: res.degraded_response,
          costo_usd: res.costo_usd,
        },
      },
      200,
    );
  } catch (e) {
    const latencia_ms = Date.now() - t0;

    if (e instanceof AgentError) {
      // Los tokens parciales SE COBRARON: se registran igual, si no el consumo
      // del mes queda por debajo del gasto real.
      await supabase.from("ejecuciones").insert({
        usuario_id: wl.usuario_id,
        tipo: "lexie",
        modelo: modelId,
        input_tokens: inputTokensParaCuota(e.partialUsage),
        output_tokens: e.partialUsage.output_tokens,
        costo_usd: e.partialCostoUsd,
        latencia_ms,
        metadata: {
          conversacion_id: conversacionId,
          nivel,
          pregunta: mensaje,
          error_code: e.code,
          error_message: e.message,
          usage: e.partialUsage,
          busquedas: e.partialBusquedas,
          iterations: e.partialIterations,
        },
      });

      const amigable =
        e.code === "API_ERROR"
          ? "Se cortó la conexión con el modelo. Probá de nuevo en un momento."
          : "La consulta se hizo demasiado larga y no pude cerrarla. Probá acotarla un poco.";
      console.error(`[POST lexie] AgentError ${e.code}:`, e.message);
      return jsonResponse({ ok: false, error: amigable, code: e.code }, 502);
    }

    console.error("[POST lexie] error inesperado:", e);
    return jsonResponse(
      { ok: false, error: "No pude procesar la consulta." },
      500,
    );
  }
}
