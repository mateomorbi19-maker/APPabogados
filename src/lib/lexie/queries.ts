import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase/server";
import type { RunAgentUsage } from "@/lib/agent/run-agent";
import { accionLexieSchema } from "@/lib/schemas";
import {
  notaAccionesParaModelo,
  pendientesVivas,
  type AccionLexie,
} from "@/lib/lexie/acciones";

export type ConversacionLexie = {
  id: string;
  usuario_id: string;
  titulo: string | null;
  archivada: boolean;
  creado_en: string;
  actualizado_en: string;
};

export type MensajeLexie = {
  id: string;
  conversacion_id: string;
  tipo: "usuario" | "agente";
  contenido: string;
  metadata: Record<string, unknown>;
  creado_en: string;
};

/**
 * La conversación activa del abogado, creándola si no hay ninguna.
 *
 * A diferencia del chat por caso —que tiene un partial unique index para
 * garantizar una sola conversación activa— acá alcanza con tomar la más
 * reciente sin archivar. Si por una carrera quedaran dos, se usa la última y
 * la otra queda como historial: no rompe nada.
 */
export async function getOCrearConversacionActiva(
  usuarioId: string,
): Promise<ConversacionLexie> {
  const supabase = createServerClient();

  const { data: existente, error: errSel } = await supabase
    .from("conversaciones_lexie")
    .select("*")
    .eq("usuario_id", usuarioId)
    .eq("archivada", false)
    .order("actualizado_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (errSel) throw new Error(`getConversacionActiva: ${errSel.message}`);
  if (existente) return existente as ConversacionLexie;

  const { data: creada, error: errIns } = await supabase
    .from("conversaciones_lexie")
    .insert({ usuario_id: usuarioId })
    .select("*")
    .single();
  if (errIns || !creada) {
    throw new Error(`crearConversacion: ${errIns?.message ?? "sin fila"}`);
  }
  return creada as ConversacionLexie;
}

export async function getMensajes(
  conversacionId: string,
): Promise<MensajeLexie[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("mensajes_lexie")
    .select("*")
    .eq("conversacion_id", conversacionId)
    .order("creado_en", { ascending: true });
  if (error) throw new Error(`getMensajes: ${error.message}`);
  return (data ?? []) as MensajeLexie[];
}

/**
 * Cuántos mensajes del hilo se le re-mandan al modelo en cada turno.
 *
 * Existe porque el hilo NO tenía techo: `getMensajes` trae la conversación
 * entera y la ruta la re-manda completa en cada vuelta, mientras `archivada`
 * nunca se escribía desde ningún lado. Una conversación activa crecía para
 * siempre hasta reventar la ventana del modelo con `prompt is too long`, y a
 * partir de ahí TODOS los turnos siguientes fallaban igual, sin forma de salir
 * desde la app. Es el mismo modo de falla que brickeó una conversación del chat
 * por caso, por otra vía.
 *
 * 24 son unos 12 intercambios: mucho más de lo que dura una consulta de trabajo
 * diario ("¿qué tengo mañana?"), y acotado a unos pocos miles de tokens.
 */
const MAX_MENSAJES_HISTORIAL = 24;

export type HistorialReconstruido = {
  mensajes: Anthropic.MessageParam[];
  /**
   * Se recortó el arranque del hilo. La ruta lo usa para volver a inyectar el
   * bloque de contexto: si el mensaje que lo traía quedó afuera del recorte,
   * LEXIE perdería la lista de causas y la agenda sin enterarse.
   */
  truncado: boolean;
};

/**
 * Historial en el formato de la Messages API.
 *
 * SANEO DEL INVARIANTE user/assistant: la API rechaza dos mensajes seguidos del
 * mismo rol con un 400, y una conversación que queda en ese estado no se puede
 * volver a usar NUNCA — cada turno siguiente falla igual. Ya pasó en producción
 * en el chat del caso: un turno que murió después de insertar el mensaje del
 * usuario dejó un `user` huérfano y brickeó la conversación.
 *
 * Acá eso se evita por diseño en la ruta (los dos mensajes se insertan recién
 * cuando el agente respondió), pero el saneo queda igual como red: es barato y
 * el modo de falla es demasiado caro.
 */
export function reconstruirHistorial(
  mensajes: MensajeLexie[],
  maxMensajes: number = MAX_MENSAJES_HISTORIAL,
): HistorialReconstruido {
  const out: Anthropic.MessageParam[] = [];
  for (const m of mensajes) {
    const role = m.tipo === "usuario" ? "user" : "assistant";
    let contenido = m.contenido.trim();
    if (contenido.length === 0) continue;
    // Memoria entre turnos: al mensaje del agente se le pega una nota con las
    // acciones de ese turno (hechas y pendientes, con su clave). Sin esto, en
    // el turno siguiente el modelo no sabe qué ya creó (y lo duplica) ni qué
    // clave mandar para confirmar. No se persiste ni se muestra al abogado:
    // se arma al reconstruir, y la tarjeta ya le dice lo mismo a él.
    if (m.tipo === "agente") {
      const nota = notaAccionesParaModelo(accionesDeMensaje(m));
      if (nota) contenido = `${contenido}\n\n${nota}`;
    }
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.role === role) {
      // Dos del mismo rol seguidos: se fusionan en vez de descartarse, así no
      // se pierde lo que el abogado escribió.
      ultimo.content = `${ultimo.content as string}\n\n${contenido}`;
      continue;
    }
    out.push({ role, content: contenido });
  }
  // La API exige que el historial previo termine en assistant (el mensaje nuevo
  // del usuario se agrega después). Si terminara en user, ese user quedaría
  // pegado al nuevo.
  while (out.length > 0 && out[out.length - 1].role === "user") out.pop();

  // El recorte va al final, sobre el historial ya saneado: recortar antes
  // podría partir un par fusionado y devolver el invariante roto.
  let truncado = false;
  if (out.length > maxMensajes) {
    out.splice(0, out.length - maxMensajes);
    truncado = true;
  }
  // La API también exige que el PRIMER mensaje sea del usuario. Un recorte que
  // cae justo sobre una respuesta del agente dejaría un `assistant` al frente y
  // devolvería un 400 en cada turno — exactamente el bug que este techo vino a
  // evitar.
  while (out.length > 0 && out[0].role === "assistant") {
    out.shift();
    truncado = true;
  }

  return { mensajes: out, truncado };
}

/**
 * Archiva la conversación activa del abogado. El próximo GET/POST arranca una
 * nueva por `getOCrearConversacionActiva`.
 *
 * Es la salida de emergencia que no existía: `archivada` se leía pero no se
 * escribía en ningún lado del código, así que un hilo que quedaba en mal estado
 * —o simplemente muy largo— no se podía resetear ni desde el UI ni desde la API.
 */
export async function archivarConversacionActiva(
  usuarioId: string,
): Promise<void> {
  const supabase = createServerClient();
  // El filtro por usuario_id va DENTRO del update: el server entra con
  // service_role y bypassa RLS, así que es el único control de propiedad real.
  const { error } = await supabase
    .from("conversaciones_lexie")
    .update({ archivada: true })
    .eq("usuario_id", usuarioId)
    .eq("archivada", false);
  if (error) throw new Error(`archivarConversacion: ${error.message}`);
}

export async function guardarTurno({
  conversacionId,
  pregunta,
  respuesta,
  metadataAgente,
}: {
  conversacionId: string;
  pregunta: string;
  respuesta: string;
  metadataAgente: Record<string, unknown>;
}): Promise<{ idUsuario: string; idAgente: string }> {
  const supabase = createServerClient();
  // Los dos juntos y DESPUÉS de que el agente contestó. Si el turno falla, no
  // queda nada persistido y el abogado simplemente reintenta.
  const { data, error } = await supabase
    .from("mensajes_lexie")
    .insert([
      {
        conversacion_id: conversacionId,
        tipo: "usuario",
        contenido: pregunta,
        // `metadata: {}` EXPLÍCITO, aunque la columna tenga DEFAULT '{}'.
        //
        // En un insert por LOTES, PostgREST arma una sola sentencia con la
        // UNIÓN de las claves de todos los objetos del array: como la fila del
        // agente trae `metadata`, esta fila recibe un NULL explícito en esa
        // columna en vez de omitirla, y un NULL explícito NO dispara el
        // DEFAULT. Resultado: "null value in column metadata violates
        // not-null constraint", y el turno entero se cae DESPUÉS de que el
        // modelo ya contestó y ya se cobró.
        //
        // No se había visto nunca porque hasta hoy ningún turno de LEXIE llegó
        // hasta acá: morían antes, en el primer messages.create, mientras la
        // cuenta de Anthropic estuvo en cero.
        metadata: {},
      },
      {
        conversacion_id: conversacionId,
        tipo: "agente",
        contenido: respuesta,
        metadata: metadataAgente,
      },
    ])
    .select("id, tipo, creado_en")
    .order("creado_en", { ascending: true });
  if (error || !data || data.length < 2) {
    throw new Error(`guardarTurno: ${error?.message ?? "insert incompleto"}`);
  }
  const idUsuario = data.find((d) => d.tipo === "usuario")?.id as string;
  const idAgente = data.find((d) => d.tipo === "agente")?.id as string;

  await supabase
    .from("conversaciones_lexie")
    .update({ actualizado_en: new Date().toISOString() })
    .eq("id", conversacionId);

  return { idUsuario, idAgente };
}

// === Acciones (Fase 11) ===
//
// Las acciones de un turno viven en `mensajes_lexie.metadata.acciones` del
// mensaje del agente. No hay columna propia ni migración: la columna ya era
// jsonb NOT NULL DEFAULT '{}' (verificado contra la base el 2026-09-05).

/** Acciones persistidas en un mensaje, validadas best-effort. */
export function accionesDeMensaje(m: MensajeLexie): AccionLexie[] {
  const crudas = (m.metadata as { acciones?: unknown })?.acciones;
  if (!Array.isArray(crudas)) return [];
  const out: AccionLexie[] = [];
  for (const c of crudas) {
    const p = accionLexieSchema.safeParse(c);
    if (p.success) out.push(p.data as AccionLexie);
  }
  return out;
}

/** ¿El mensaje lo insertó el botón Confirmar/Cancelar, y no el abogado ni el modelo? */
export function esMensajeDeBoton(m: MensajeLexie): boolean {
  return (m.metadata as { origen?: unknown })?.origen === "boton";
}

export function ultimoMensajeAgente(historial: MensajeLexie[]): MensajeLexie | null {
  for (let i = historial.length - 1; i >= 0; i--) {
    if (historial[i].tipo === "agente") return historial[i];
  }
  return null;
}

/**
 * Las pendientes que siguen esperando al abogado. Se leen SIEMPRE del último
 * mensaje del agente: cuando el botón inserta su par «Confirmé…/Hecho», copia
 * ahí las pendientes que siguen vivas (ver insertarParBoton), así este
 * invariante se mantiene y confirmar la primera tarjeta no mata la segunda.
 */
export function sembrarPendientes(historial: MensajeLexie[]): AccionLexie[] {
  const ultimo = ultimoMensajeAgente(historial);
  if (!ultimo) return [];
  return pendientesVivas(accionesDeMensaje(ultimo));
}

/** Hilos de correo leídos en el turno anterior (mismo mensaje que las pendientes). */
export function sembrarHilosLeidos(historial: MensajeLexie[]): string[] {
  const ultimo = ultimoMensajeAgente(historial);
  const h = (ultimo?.metadata as { hilos_leidos?: unknown })?.hilos_leidos;
  return Array.isArray(h) ? h.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Lo que el ABOGADO escribió en el hilo, sin los mensajes que insertó el
 * botón. Es el insumo de los guards de "dato dictado" (DNI, matrícula,
 * direcciones nuevas): un «Confirmé: enviar correo a x@y» no cuenta como que
 * el abogado dictó esa dirección.
 */
export function mensajesDelAbogado(historial: MensajeLexie[]): string[] {
  return historial
    .filter((m) => m.tipo === "usuario" && !esMensajeDeBoton(m))
    .map((m) => m.contenido);
}

/**
 * ¿El último turno del agente dejó alguna acción aplicada? La ruta lo usa
 * para volver a inyectar el contexto (causas + agenda): `hayCambiosDesde`
 * sólo mira `casos.actualizado_en`, y un evento creado o una parte agregada
 * no lo mueven.
 */
export function ultimoTurnoTuvoAccionesOk(historial: MensajeLexie[]): boolean {
  const ultimo = ultimoMensajeAgente(historial);
  return !!ultimo && accionesDeMensaje(ultimo).some((a) => a.estado === "ok");
}

/**
 * RESERVA atómica de una pendiente antes de ejecutarla. Es lo que impide la
 * doble ejecución: un doble click, dos pestañas, o reabrir la ventana durante
 * los 40 s de un escrito. El UPDATE lleva en el WHERE la condición jsonb de
 * que la acción con esa clave siga `pendiente` (`@>` de PostgREST); la
 * segunda request encuentra `en_curso` y afecta 0 filas.
 *
 * Devuelve la acción reservada (ya como `en_curso`) o null si no estaba
 * pendiente en ese mensaje.
 */
export async function reservarPendiente(
  mensajeId: string,
  clave: string,
  aEstado: "en_curso" | "descartada",
): Promise<AccionLexie | null> {
  const supabase = createServerClient();
  const { data: fila, error: errSel } = await supabase
    .from("mensajes_lexie")
    .select("id, metadata")
    .eq("id", mensajeId)
    .maybeSingle();
  if (errSel || !fila) return null;
  const meta = (fila.metadata ?? {}) as Record<string, unknown>;
  const acciones = Array.isArray(meta.acciones) ? (meta.acciones as unknown[]) : [];
  let reservada: AccionLexie | null = null;
  const nuevas = acciones.map((c) => {
    const p = accionLexieSchema.safeParse(c);
    if (!p.success) return c;
    const a = p.data as AccionLexie;
    if (a.clave === clave && a.estado === "pendiente") {
      reservada = { ...a, estado: aEstado };
      return reservada;
    }
    return c;
  });
  if (!reservada) return null;

  const { data: upd, error: errUpd } = await supabase
    .from("mensajes_lexie")
    .update({ metadata: { ...meta, acciones: nuevas } })
    .eq("id", mensajeId)
    .contains("metadata", { acciones: [{ clave, estado: "pendiente" }] })
    .select("id");
  if (errUpd) throw new Error(`reservarPendiente: ${errUpd.message}`);
  if (!upd || upd.length === 0) return null;
  return reservada;
}

/**
 * El par de mensajes que deja el botón Confirmar/Cancelar. Va con
 * `metadata.origen = 'boton'` en los DOS (las filas de un lote tienen que
 * traer las mismas claves, ver guardarTurno) y el mensaje del agente copia
 * las pendientes que siguen vivas más los hilos leídos, para que el próximo
 * turno las siga viendo en el último mensaje del agente.
 */
export async function insertarParBoton({
  conversacionId,
  textoUsuario,
  textoAgente,
  acciones,
  hilosLeidos,
}: {
  conversacionId: string;
  textoUsuario: string;
  textoAgente: string;
  acciones: AccionLexie[];
  hilosLeidos: string[];
}): Promise<{ idUsuario: string; idAgente: string }> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("mensajes_lexie")
    .insert([
      {
        conversacion_id: conversacionId,
        tipo: "usuario",
        contenido: textoUsuario,
        metadata: { origen: "boton" },
      },
      {
        conversacion_id: conversacionId,
        tipo: "agente",
        contenido: textoAgente,
        metadata: { origen: "boton", acciones, hilos_leidos: hilosLeidos },
      },
    ])
    .select("id, tipo, creado_en")
    .order("creado_en", { ascending: true });
  if (error || !data || data.length < 2) {
    throw new Error(`insertarParBoton: ${error?.message ?? "insert incompleto"}`);
  }
  await supabase
    .from("conversaciones_lexie")
    .update({ actualizado_en: new Date().toISOString() })
    .eq("id", conversacionId);
  return {
    idUsuario: data.find((d) => d.tipo === "usuario")?.id as string,
    idAgente: data.find((d) => d.tipo === "agente")?.id as string,
  };
}

/** Actualiza el texto y una acción (por clave) del mensaje del agente del par. */
export async function actualizarMensajeAgente(
  mensajeId: string,
  contenido: string,
  accionResuelta: AccionLexie,
): Promise<void> {
  const supabase = createServerClient();
  const { data: fila, error: errSel } = await supabase
    .from("mensajes_lexie")
    .select("metadata")
    .eq("id", mensajeId)
    .maybeSingle();
  if (errSel || !fila) throw new Error(`actualizarMensajeAgente: ${errSel?.message ?? "sin fila"}`);
  const meta = (fila.metadata ?? {}) as Record<string, unknown>;
  const acciones = Array.isArray(meta.acciones) ? (meta.acciones as unknown[]) : [];
  const nuevas = acciones.map((c) => {
    const p = accionLexieSchema.safeParse(c);
    return p.success && p.data.clave === accionResuelta.clave ? accionResuelta : c;
  });
  const { error } = await supabase
    .from("mensajes_lexie")
    .update({ contenido, metadata: { ...meta, acciones: nuevas } })
    .eq("id", mensajeId);
  if (error) throw new Error(`actualizarMensajeAgente: ${error.message}`);
}

/**
 * Mensaje de CORTE cuando el turno murió a mitad de camino con acciones ya
 * aplicadas. Va en PAR (la pregunta original del abogado + el corte del
 * agente): `guardarTurno` inserta los dos juntos al final, así que si acá se
 * insertara sólo el del agente, `reconstruirHistorial` lo fusionaría con el
 * agente anterior y el pedido que disparó la acción desaparecería del hilo.
 */
export async function insertarParDeCorte({
  conversacionId,
  pregunta,
  textoCorte,
  acciones,
  hilosLeidos,
}: {
  conversacionId: string;
  pregunta: string;
  textoCorte: string;
  acciones: AccionLexie[];
  hilosLeidos: string[];
}): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase.from("mensajes_lexie").insert([
    {
      conversacion_id: conversacionId,
      tipo: "usuario",
      contenido: pregunta,
      metadata: {},
    },
    {
      conversacion_id: conversacionId,
      tipo: "agente",
      contenido: textoCorte,
      metadata: { corte: true, acciones, hilos_leidos: hilosLeidos },
    },
  ]);
  if (error) throw new Error(`insertarParDeCorte: ${error.message}`);
}

/** Título de la conversación a partir de la primera pregunta. */
export async function ponerTituloSiFalta(
  conversacionId: string,
  pregunta: string,
): Promise<void> {
  const supabase = createServerClient();
  const titulo =
    pregunta.trim().length > 60
      ? `${pregunta.trim().slice(0, 57)}…`
      : pregunta.trim();
  await supabase
    .from("conversaciones_lexie")
    .update({ titulo })
    .eq("id", conversacionId)
    .is("titulo", null);
}

/**
 * Tokens de entrada a registrar en `ejecuciones.input_tokens`.
 *
 * === Por qué se suman los tres buckets ===
 *
 * `ejecuciones` no tiene columnas de caché, y `total_tokens` es una columna
 * GENERADA como input + output. Con el prompt caching activo, el SDK devuelve
 * el input repartido en tres: `input_tokens` (fresco), `cache_creation` (lo que
 * se escribió al caché) y `cache_read` (lo que se leyó de él).
 *
 * Si guardáramos solo el bucket fresco, un turno que lee 10.000 tokens de caché
 * registraría 128. El tope mensual de 1.000.000 dejaría de proteger de un día
 * para el otro, y el consumo de agosto no sería comparable con el de julio
 * aunque el trabajo fuera idéntico.
 *
 * Así que la columna conserva el significado que SIEMPRE tuvo —tokens de
 * entrada procesados— y el desglose por bucket queda en `metadata.usage` para
 * auditar. El `costo_usd`, que es el número económico real, lo calcula
 * pricing.ts con los cuatro buckets por separado y a su precio correcto.
 */
export function inputTokensParaCuota(usage: RunAgentUsage): number {
  return (
    usage.input_tokens +
    usage.cache_creation_input_tokens +
    usage.cache_read_input_tokens
  );
}

/**
 * ¿Cambió alguna causa del abogado desde `desdeIso`?
 *
 * Lo usa la ruta de LEXIE para decidir si tiene que volver a inyectar el bloque
 * de contexto en un hilo que ya está andando. Sin esto, el contexto queda
 * congelado en el primer mensaje: la conversación activa no se archiva sola ni
 * se puede resetear desde el UI, así que una carátula corregida no llegaría
 * nunca al modelo.
 *
 * Es UNA fila: se pide el `actualizado_en` más alto con limit 1, apoyándose en
 * el orden, no en un agregado. `casos.actualizado_en` lo bumpea un trigger en
 * cada UPDATE del caso y también al tocar sus eventos, así que cubre tanto
 * editar la ficha como cargar un movimiento.
 *
 * Ante un error de la query devuelve `false` — no refrescar es peor que
 * refrescar de más, pero mucho menos malo que romper el turno entero por una
 * optimización de contexto.
 */
export async function hayCambiosDesde(
  usuarioId: string,
  desdeIso: string | null,
): Promise<boolean> {
  if (!desdeIso) return false;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("casos")
    .select("actualizado_en")
    .eq("usuario_id", usuarioId)
    .order("actualizado_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return false;

  // Comparar como INSTANTES, no como strings. Los dos lados son `timestamptz`
  // serializados por PostgREST, y difieren en la cantidad de dígitos
  // fraccionarios ("...:35.993285+00:00" contra "...:35.99+00:00") y a veces en
  // el offset. Lexicográficamente eso daba `true` de forma permanente, y el
  // bloque de contexto —las 40 causas y la agenda— se re-inyectaba en TODOS los
  // turnos, rompiendo justo el prefijo cacheado que este chequeo venía a cuidar.
  const ultimo = Date.parse((data as { actualizado_en: string }).actualizado_en);
  const desde = Date.parse(desdeIso);
  if (Number.isNaN(ultimo) || Number.isNaN(desde)) return false;
  return ultimo > desde;
}
