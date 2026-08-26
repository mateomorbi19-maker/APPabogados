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
import { describirUbicacion, lineaDeUbicacion } from "@/lib/lexie/ubicacion";
import { resolverNombreEntidad } from "@/lib/lexie/resolver-ubicacion";
import {
  archivarConversacionActiva,
  getMensajes,
  getOCrearConversacionActiva,
  guardarTurno,
  hayCambiosDesde,
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
  // En qué pantalla de la app está parado el abogado. Se manda SOLO el
  // pathname: el nombre de lo que tiene abierto lo resuelve el servidor, y
  // recién después de verificar que la causa sea suya (ver resolver-ubicacion).
  // Opcional a propósito — un cliente viejo, o una pantalla que no mapea a
  // ninguna sección, mandan el turno sin esto y funciona igual.
  pathname: z.string().max(512).optional(),
});

// Traduce el mensaje crudo de la API de Anthropic a algo que el abogado pueda
// accionar. Antes TODO `API_ERROR` decía "probá de nuevo en un momento", que es
// un consejo inútil cuando la causa es determinística: entre el 21 y el 23 de
// agosto de 2026 la cuenta se quedó sin crédito y los tres abogados leyeron ese
// mismo mensaje reintentando algo que no podía funcionar.
function mensajeDeErrorDeApi(code: string, detalle: string): string {
  if (code !== "API_ERROR") {
    return "La consulta se hizo demasiado larga y no pude cerrarla. Probá acotarla un poco, o empezá una conversación nueva.";
  }
  const d = detalle.toLowerCase();
  if (d.includes("credit balance") || d.includes("billing")) {
    return "La cuenta de Anthropic se quedó sin crédito. Hay que recargarla para que pueda contestar.";
  }
  if (d.includes("authentication") || d.includes("invalid x-api-key")) {
    return "La clave de Anthropic no es válida. Es un problema de configuración, no tuyo.";
  }
  if (d.includes("rate_limit") || d.includes("429")) {
    return "Demasiadas consultas seguidas. Esperá unos segundos y probá otra vez.";
  }
  if (d.includes("prompt is too long") || d.includes("context")) {
    return "Esta conversación se hizo muy larga. Empezá una nueva con el botón de arriba y volvé a preguntarme.";
  }
  if (d.includes("overloaded")) {
    return "El modelo está sobrecargado en este momento. Probá de nuevo en un minuto.";
  }
  return "Se cortó la conexión con el modelo. Probá de nuevo en un momento.";
}

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

// DELETE /api/lexie — archiva la conversación activa. El próximo GET arranca
// una nueva, vacía.
//
// Es la salida de emergencia que faltaba. `conversaciones_lexie.archivada` se
// leía en getOCrearConversacionActiva pero no se escribía en ningún lado del
// código: un hilo que quedaba en mal estado —o simplemente muy largo— no se
// podía resetear ni desde el UI ni desde la API, y cada turno siguiente fallaba
// igual. El chat por caso sí tenía "Nueva conversación" desde el día uno.
export async function DELETE() {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  try {
    await archivarConversacionActiva(wl.usuario_id);
    return jsonResponse({ ok: true }, 200);
  } catch (e) {
    console.error("[DELETE lexie] error:", e);
    return jsonResponse(
      { ok: false, error: "No pude cerrar la conversación." },
      500,
    );
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

  // enforceTokenLimit THROWEA si la vista de consumo falla (es fallo de infra).
  // Sin este try, ese throw salía como un 500 de Next en HTML, el `r.json()` del
  // cliente reventaba, y el abogado leía "se cortó la conexión" —que apunta al
  // modelo— cuando el problema estaba en la base.
  let rate;
  try {
    rate = await enforceTokenLimit(wl.usuario_id);
  } catch (e) {
    console.error("[POST lexie] enforceTokenLimit falló:", e);
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

  let conversacionId: string;
  let contextoInicial: string | null = null;
  let mensajesPrevios;
  let nombre = wl.nombre;
  let lineaUbicacion: string | null = null;

  try {
    const conv = await getOCrearConversacionActiva(wl.usuario_id);
    conversacionId = conv.id;
    const historial = await getMensajes(conv.id);
    const reconstruido = reconstruirHistorial(historial);
    mensajesPrevios = reconstruido.mensajes;
    const truncado = reconstruido.truncado;

    // La pantalla en la que está parado ahora. Se lee por turno y no al abrir
    // el panel: la ventana de LEXIE no se desmonta al navegar, así que una
    // ubicación capturada al abrirla quedaría stale apenas cambie de sección.
    const ubicacion = parsed.data.pathname
      ? describirUbicacion(parsed.data.pathname)
      : null;
    if (ubicacion) {
      const nombreEntidad = await resolverNombreEntidad(
        ubicacion,
        wl.usuario_id,
      );
      lineaUbicacion = lineaDeUbicacion(ubicacion, nombreEntidad);
    }

    // El contexto pesado (causas + agenda + fecha) va en el primer mensaje del
    // hilo. Después ya vive en el historial, dentro del prefijo cacheado.
    //
    // Pero se REFRESCA si algo cambió desde el último mensaje. Sin esto, el
    // contexto quedaba congelado para siempre: la conversación activa no se
    // archiva sola ni se puede resetear desde el UI, así que el abogado podía
    // corregir una carátula, cargar el juzgado y los imputados, y LEXIE seguía
    // leyendo la versión vieja hasta que alguien archivara la fila a mano.
    //
    // El disparador es `MAX(casos.actualizado_en) > último mensaje del hilo`.
    // Es auto-limitante: apenas se re-inyecta, el mensaje nuevo pasa a ser el
    // último y no vuelve a dispararse hasta el próximo cambio real.
    //
    // Y es barato en caché: el prefijo cacheado va hasta el final del historial
    // previo, así que agregar contenido DESPUÉS no lo invalida — se paga una
    // vez, como cualquier turno nuevo. La alternativa "mandarlo en todos los
    // turnos" sí rompía el prefijo (medido: un turno de chat pasó de USD 0,0517
    // a 0,0362 gracias al caching).
    const debeRefrescar =
      mensajesPrevios.length > 0 &&
      (await hayCambiosDesde(
        wl.usuario_id,
        historial[historial.length - 1]?.creado_en ?? null,
      ));

    // Y también si el hilo se recortó: el bloque de contexto viajaba pegado al
    // PRIMER mensaje de la conversación, así que un recorte se lo lleva puesto
    // y LEXIE se queda sin la lista de causas ni la agenda, sin enterarse.
    if (mensajesPrevios.length === 0 || debeRefrescar || truncado) {
      const datos = await cargarDatosLexie(wl.usuario_id, wl.nombre);
      nombre = datos.nombre;
      contextoInicial = construirContextoModelo(datos);
      if (debeRefrescar) {
        contextoInicial =
          "NOTA: el abogado actualizó datos de alguna causa desde tu último mensaje. " +
          "Este bloque REEMPLAZA al que viste antes en esta conversación; si algo " +
          "difiere, vale lo de acá.\n\n" +
          contextoInicial;
      }
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
      // La línea de pantalla va SOLO al modelo. Lo que se persiste (y lo que se
      // ve en el hilo) es el mensaje tal como lo escribió el abogado: si se
      // guardara con el prefijo, el corchete aparecería en el chat y volvería a
      // entrar por el historial en cada turno siguiente, ya vencido.
      pregunta: lineaUbicacion ? `${lineaUbicacion}\n\n${mensaje}` : mensaje,
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
      const { error: ejecErrFallo } = await supabase.from("ejecuciones").insert({
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

      // Este chequeo faltaba, y es la razón por la que hoy no hay UNA sola fila
      // que documente los fallos del 21 al 23 de agosto: el insert se caía en
      // silencio y el único rastro del apagón quedaba en logs efímeros.
      if (ejecErrFallo) {
        console.error(
          "[POST lexie] no pude registrar la ejecución fallida:",
          ejecErrFallo,
        );
      }

      const amigable = mensajeDeErrorDeApi(e.code, e.message);
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
