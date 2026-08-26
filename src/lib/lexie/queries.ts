import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase/server";
import type { RunAgentUsage } from "@/lib/agent/run-agent";

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
    const contenido = m.contenido.trim();
    if (contenido.length === 0) continue;
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
