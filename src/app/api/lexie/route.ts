import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { enforceTokenLimit } from "@/lib/auth/enforce-rate";
import { jsonResponse } from "@/lib/http";
import { createServerClient } from "@/lib/supabase/server";
import { MODELO_POR_NIVEL, NIVELES_MODELO, NIVEL_DEFAULT } from "@/lib/agent/modelos";
import { AgentError } from "@/lib/agent/run-agent";
import { AgentLexieError, runLexie } from "@/lib/agent/run-lexie";
import { LEXIE_SYSTEM_PROMPT } from "@/lib/agent/lexie-prompt";
import { cargarDatosLexie, construirContextoModelo } from "@/lib/lexie/contexto";
import { describirUbicacion, lineaDeUbicacion } from "@/lib/lexie/ubicacion";
import { resolverNombreEntidad } from "@/lib/lexie/resolver-ubicacion";
import { getGmailClient } from "@/lib/gmail/client";
import { ejecutarAccionPendiente } from "@/lib/lexie/ejecutar-accion";
import { pendientesVivas, type AccionLexie } from "@/lib/lexie/acciones";
import {
  accionesDeMensaje,
  actualizarMensajeAgente,
  archivarConversacionActiva,
  esMensajeDeBoton,
  getMensajes,
  getOCrearConversacionActiva,
  guardarTurno,
  hayCambiosDesde,
  inputTokensParaCuota,
  insertarParBoton,
  insertarParDeCorte,
  mensajesDelAbogado,
  ponerTituloSiFalta,
  reconstruirHistorial,
  reservarPendiente,
  sembrarHilosLeidos,
  sembrarPendientes,
  ultimoMensajeAgente,
  ultimoTurnoTuvoAccionesOk,
  type MensajeLexie,
} from "@/lib/lexie/queries";

// POST /api/lexie — un turno de conversación con la asistente global, o la
// confirmación/descarte de una acción pendiente por el botón de la tarjeta.
//
// Latencia medida del chat por caso: 40-90 s con varias búsquedas. LEXIE tiene
// presupuestos más chicos, pero un turno que consulta agenda + repositorio +
// normativa puede acercarse. 120 s da margen sin dejar la request colgada para
// siempre.
//
// OJO: maxDuration es inerte en Easypanel — ahí el timeout real lo impone el
// proxy, no Next. Sirve para Vercel y como documentación de la expectativa.
export const maxDuration = 120;

// El body admite EXACTAMENTE una de tres cosas: un mensaje (turno del modelo),
// o la clave de una acción pendiente a confirmar o a descartar (camino del
// botón, sin modelo). La clave no es fabricable: es el sha256 de un payload que
// sólo el servidor generó y persistió, vale únicamente contra el último
// mensaje del agente de la conversación propia, y se consume al ejecutar.
const bodySchema = z
  .object({
    mensaje: z.string().min(1, "El mensaje no puede estar vacío").max(4000).optional(),
    nivel: z.enum(NIVELES_MODELO).optional(),
    // En qué pantalla de la app está parado el abogado. Se manda SOLO el
    // pathname: el nombre de lo que tiene abierto lo resuelve el servidor, y
    // recién después de verificar que la causa sea suya (ver resolver-ubicacion).
    pathname: z.string().max(512).optional(),
    confirmar_accion: z.string().min(1).max(120).optional(),
    descartar_accion: z.string().min(1).max(120).optional(),
  })
  .refine(
    (b) =>
      [b.mensaje, b.confirmar_accion, b.descartar_accion].filter(
        (x) => x !== undefined,
      ).length === 1,
    "Mandá un mensaje, o la clave de una acción a confirmar o descartar.",
  );

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

/** Un mensaje como lo ve el cliente: con sus acciones ya validadas. */
function mensajeParaCliente(m: MensajeLexie) {
  return {
    id: m.id,
    tipo: m.tipo,
    contenido: m.contenido,
    creado_en: m.creado_en,
    acciones: accionesDeMensaje(m),
    origen: esMensajeDeBoton(m) ? ("boton" as const) : undefined,
  };
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
        // Las acciones viajan con cada mensaje: las tarjetas (incluidas las
        // pendientes con su botón) sobreviven a cerrar y reabrir la ventana.
        mensajes: mensajes.map(mensajeParaCliente),
      },
      200,
    );
  } catch (e) {
    console.error("[GET lexie] error:", e);
    return jsonResponse({ ok: false, error: "No pude abrir LEXIE." }, 500);
  }
}

// DELETE /api/lexie — archiva la conversación activa. El próximo GET arranca
// una nueva, vacía. Descarta de paso las acciones pendientes: deseable.
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

// === El camino del BOTÓN: confirmar o descartar una pendiente, sin modelo ===
//
// El servidor ejecuta EXACTAMENTE el payload persistido: cero tokens, la
// latencia de la operación, y sale byte a byte lo que el abogado leyó en la
// tarjeta. Es la pieza que saca al modelo del camino del consentimiento para
// un correo a un tercero.
//
// Orden de las cosas, y por qué:
//   1. RESERVAR la clave (pendiente → en_curso) con un UPDATE condicional.
//      Antes de ejecutar nada: un doble click o dos pestañas encuentran la
//      acción ya en curso y reciben 409 en vez de mandar dos correos.
//   2. INSERTAR el par «Confirmé…/Ejecutando…» ANTES de ejecutar: si el proxy
//      corta a los 40 s de un escrito, al reabrir la ventana hay rastro.
//   3. EJECUTAR y actualizar el mensaje del agente con el resultado.
// No se inserta fila en `ejecuciones`: no hubo modelo. La única excepción es
// la fila 'generar_escrito' que persiste el propio servicio de escritos.
async function manejarBoton(
  wl: { usuario_id: string; nombre: string; clerk_user_id: string },
  clave: string,
  modo: "confirmar" | "descartar",
) {
  const conv = await getOCrearConversacionActiva(wl.usuario_id);
  const historial = await getMensajes(conv.id);
  const ultimo = ultimoMensajeAgente(historial);
  const pendientes = ultimo ? pendientesVivas(accionesDeMensaje(ultimo)) : [];
  const accion = pendientes.find((a) => a.clave === clave);
  if (!ultimo || !accion) {
    return jsonResponse(
      {
        ok: false,
        error:
          "Esa acción ya no está pendiente: se ejecutó, se descartó, o quedó superada por un mensaje posterior.",
      },
      409,
    );
  }

  // El cupo mensual se controla sólo cuando la acción confirmada gasta tokens
  // (generar un escrito). Confirmar un correo o un borrado no llama a ningún
  // modelo, y un abogado sobre el tope tiene que poder cerrar lo que empezó.
  if (modo === "confirmar" && accion.tool === "generar_escrito_causa") {
    let rate;
    try {
      rate = await enforceTokenLimit(wl.usuario_id);
    } catch (e) {
      console.error("[POST lexie/boton] enforceTokenLimit falló:", e);
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
  }

  const reservada = await reservarPendiente(
    ultimo.id,
    clave,
    modo === "confirmar" ? "en_curso" : "descartada",
  );
  if (!reservada) {
    return jsonResponse(
      { ok: false, error: "Esa acción ya se está ejecutando o ya no está pendiente." },
      409,
    );
  }

  const otrasVivas = pendientes.filter((a) => a.clave !== clave);
  const hilos = sembrarHilosLeidos(historial);

  if (modo === "descartar") {
    const descartada: AccionLexie = { ...reservada, payload: undefined, estado: "descartada" };
    const par = await insertarParBoton({
      conversacionId: conv.id,
      textoUsuario: `Descarté: ${accion.resumen}`,
      textoAgente: "Descartada. No hice nada.",
      acciones: [descartada, ...otrasVivas],
      hilosLeidos: hilos,
    });
    return jsonResponse(
      {
        ok: true,
        accion: descartada,
        mensajes: [
          { id: par.idUsuario, tipo: "usuario", contenido: `Descarté: ${accion.resumen}`, creado_en: new Date().toISOString(), acciones: [], origen: "boton" },
          { id: par.idAgente, tipo: "agente", contenido: "Descartada. No hice nada.", creado_en: new Date().toISOString(), acciones: [descartada, ...otrasVivas], origen: "boton" },
        ],
      },
      200,
    );
  }

  const textoUsuario = `Confirmé: ${accion.resumen}`;
  const par = await insertarParBoton({
    conversacionId: conv.id,
    textoUsuario,
    textoAgente: "Ejecutando…",
    acciones: [reservada, ...otrasVivas],
    hilosLeidos: hilos,
  });

  const resuelta = await ejecutarAccionPendiente(reservada, {
    usuarioId: wl.usuario_id,
    nombre: wl.nombre,
    clerkUserId: wl.clerk_user_id,
    conversacionId: conv.id,
    gmail: () => getGmailClient(wl.clerk_user_id),
  });
  const final: AccionLexie = {
    ...resuelta,
    payload: undefined,
    confirmado_por: "click",
  };
  const textoAgente =
    final.estado === "ok"
      ? `Hecho: ${final.resumen}`
      : `No pude: ${final.resumen}${final.error ? ` — ${final.error}` : ""}`;
  try {
    await actualizarMensajeAgente(par.idAgente, textoAgente, final);
  } catch (e) {
    // La acción YA se ejecutó: un fallo al actualizar el rastro no puede
    // convertirse en un "no se hizo" para el abogado. Queda en logs.
    console.error("[POST lexie/boton] no pude actualizar el mensaje del par:", e);
  }

  return jsonResponse(
    {
      ok: true,
      accion: final,
      mensajes: [
        { id: par.idUsuario, tipo: "usuario", contenido: textoUsuario, creado_en: new Date().toISOString(), acciones: [], origen: "boton" },
        { id: par.idAgente, tipo: "agente", contenido: textoAgente, creado_en: new Date().toISOString(), acciones: [final, ...otrasVivas], origen: "boton" },
      ],
    },
    200,
  );
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

  if (parsed.data.confirmar_accion || parsed.data.descartar_accion) {
    try {
      return await manejarBoton(
        wl,
        (parsed.data.confirmar_accion ?? parsed.data.descartar_accion) as string,
        parsed.data.confirmar_accion ? "confirmar" : "descartar",
      );
    } catch (e) {
      console.error("[POST lexie/boton] error:", e);
      return jsonResponse(
        { ok: false, error: "No pude procesar la confirmación." },
        500,
      );
    }
  }

  const mensaje = parsed.data.mensaje as string;

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
  let casoIdEnPantalla: string | null = null;
  let accionesPendientes: AccionLexie[] = [];
  let hilosLeidosPrevios: string[] = [];
  let mensajesAbogado: string[] = [];

  try {
    const conv = await getOCrearConversacionActiva(wl.usuario_id);
    conversacionId = conv.id;
    const historial = await getMensajes(conv.id);
    const reconstruido = reconstruirHistorial(historial);
    mensajesPrevios = reconstruido.mensajes;
    const truncado = reconstruido.truncado;

    // Siembra del turno anterior: las pendientes que el abogado ya vio (y
    // puede confirmar por texto) y los hilos de correo que ya leyó. Se leen
    // del último mensaje del agente, no del historial recortado.
    accionesPendientes = sembrarPendientes(historial);
    hilosLeidosPrevios = sembrarHilosLeidos(historial);
    mensajesAbogado = [...mensajesDelAbogado(historial), mensaje];

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
      // El id del pathname lo eligió el browser: sólo vale si el nombre
      // resolvió, porque resolverNombreEntidad verifica propiedad en la misma
      // query que trae el nombre.
      casoIdEnPantalla =
        ubicacion.entidad?.tipo === "caso" && nombreEntidad !== null
          ? ubicacion.entidad.id
          : null;
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
    // Los disparadores: `MAX(casos.actualizado_en) > último mensaje del hilo`,
    // o que el último turno del agente haya dejado acciones aplicadas (un
    // evento creado o una parte agregada no mueven `casos.actualizado_en`).
    // Es auto-limitante: apenas se re-inyecta, el mensaje nuevo pasa a ser el
    // último y no vuelve a dispararse hasta el próximo cambio real.
    //
    // Y es barato en caché: el prefijo cacheado va hasta el final del historial
    // previo, así que agregar contenido DESPUÉS no lo invalida — se paga una
    // vez, como cualquier turno nuevo.
    const debeRefrescar =
      mensajesPrevios.length > 0 &&
      (ultimoTurnoTuvoAccionesOk(historial) ||
        (await hayCambiosDesde(
          wl.usuario_id,
          historial[historial.length - 1]?.creado_en ?? null,
        )));

    // Y también si el hilo se recortó: el bloque de contexto viajaba pegado al
    // PRIMER mensaje de la conversación, así que un recorte se lo lleva puesto
    // y LEXIE se queda sin la lista de causas ni la agenda, sin enterarse.
    if (mensajesPrevios.length === 0 || debeRefrescar || truncado) {
      const datos = await cargarDatosLexie(wl.usuario_id, wl.nombre);
      nombre = datos.nombre;
      contextoInicial = construirContextoModelo(datos);
      if (debeRefrescar) {
        contextoInicial =
          "NOTA: el abogado actualizó datos de alguna causa desde tu último mensaje, o vos misma cambiaste algo en el turno anterior. " +
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

  // Gmail se resuelve UNA vez por turno. Null sin Google o sin scope: las
  // familias de correo no se declaran y el modelo sabe cómo reconectar. Nunca
  // datos demo al modelo.
  const gmail = await getGmailClient(wl.clerk_user_id).catch(() => null);

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
      clerkUserId: wl.clerk_user_id,
      gmail,
      mensajesAbogado,
      casoIdEnPantalla,
      accionesPendientes,
      hilosLeidosPrevios,
    });

    // Persistir el turno ANTES de responder, pero DESPUÉS de que el agente
    // contestó: así nunca queda un mensaje de usuario huérfano si el turno
    // muere, que es lo que brickea una conversación para siempre.
    //
    // Las acciones van en la metadata del mensaje del agente: es de donde el
    // turno siguiente siembra las pendientes y donde el GET las lee para
    // pintar las tarjetas.
    const { idUsuario, idAgente } = await guardarTurno({
      conversacionId,
      pregunta: mensaje,
      respuesta: res.rawText,
      metadataAgente: {
        busquedas: res.busquedas,
        consultas_repositorio: res.consultas_repositorio,
        herramientas_usadas: res.herramientas_usadas,
        degraded_response: res.degraded_response,
        acciones: res.acciones,
        hilos_leidos: res.hilos_leidos,
        correo_leido: res.correo_leido,
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
        acciones: res.acciones,
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
        mensaje_usuario_id: idUsuario,
        mensaje_agente_id: idAgente,
        // Las arma el servidor desde las tool calls reales; el modelo no puede
        // sumar una acción que no ejecutó ni ocultar una que sí.
        acciones: res.acciones,
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
      const accionesParciales =
        e instanceof AgentLexieError ? e.partialAcciones : [];

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
          acciones: accionesParciales,
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

      // Si el turno alcanzó a HACER algo antes de morir, el hilo tiene que
      // decirlo. Sin esto, un correo enviado seguido de un fallo de API
      // desaparece de la conversación y el abogado lo manda dos veces.
      if (accionesParciales.length > 0) {
        const hechas = accionesParciales.filter((a) => a.estado === "ok").length;
        try {
          await insertarParDeCorte({
            conversacionId,
            pregunta: mensaje,
            textoCorte:
              hechas > 0
                ? `El turno se cortó antes de que pudiera contestarte, pero ${hechas === 1 ? "esta acción QUEDÓ APLICADA" : `estas ${hechas} acciones QUEDARON APLICADAS`}. Revisá la tarjeta antes de pedírmelo de nuevo.`
                : "El turno se cortó antes de que pudiera contestarte. Lo que quedó pendiente está en la tarjeta.",
            acciones: accionesParciales,
            hilosLeidos: [],
          });
        } catch (errCorte) {
          console.error("[POST lexie] no pude insertar el mensaje de corte:", errCorte);
        }
      }

      const amigable = mensajeDeErrorDeApi(e.code, e.message);
      console.error(`[POST lexie] AgentError ${e.code}:`, e.message);
      return jsonResponse(
        { ok: false, error: amigable, code: e.code, acciones: accionesParciales },
        502,
      );
    }

    console.error("[POST lexie] error inesperado:", e);
    return jsonResponse(
      { ok: false, error: "No pude procesar la consulta." },
      500,
    );
  }
}
