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
): Anthropic.MessageParam[] {
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
  return out;
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
      { conversacion_id: conversacionId, tipo: "usuario", contenido: pregunta },
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
  return (data as { actualizado_en: string }).actualizado_en > desdeIso;
}
