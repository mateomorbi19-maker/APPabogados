import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase/server";
import {
  buildContextoCaso,
  type ContextoCasoResult,
} from "@/lib/casos/build-contexto-caso";
import type { Adjunto } from "@/lib/casos/adjuntos";

// Builder del contexto para una llamada al agente desde el chat.
// Devuelve:
//   - contextoMarkdown: igual al de buildContextoCaso (caso + estrategia +
//     timeline). Se inyecta en el ÚLTIMO mensaje del usuario (no en cada
//     uno) para que el modelo siempre vea el estado actual del caso al
//     responder.
//   - adjuntosHistoricos: lo que ya devuelve buildContextoCaso (referencias
//     a adjuntos del timeline; no se mandan al modelo, solo se mencionan).
//   - mensajesPrevios: array de Anthropic.MessageParam con los mensajes
//     anteriores de la conversación reconstruidos. NO incluye el mensaje
//     del usuario que se está enviando AHORA (se filtra por id si se
//     pasa `excluirMensajeId`).
//
// Decisiones:
// - Adjuntos en mensajes históricos del usuario: solo referenciados como
//   texto (filename + descripción). NO se re-bajan del bucket ni se
//   mandan como contenido nativo; sería costoso y rara vez útil. Si el
//   abogado necesita que el agente vuelva a ver un adjunto histórico
//   puntual, lo re-adjunta en el mensaje nuevo.
// - Mensajes históricos del agente: se reinyectan con el JSON
//   estructurado SIN las búsquedas ni metadata de ejecución (esos no
//   son contenido semántico del análisis). El modelo ve sus respuestas
//   previas en el formato JSON estricto que sigue.

export type ContextoConversacionResult = ContextoCasoResult & {
  mensajesPrevios: Anthropic.MessageParam[];
};

type MensajeRow = {
  id: string;
  rol: "usuario" | "agente";
  contenido: string;
  adjuntos: Adjunto[] | null;
  respuesta_estructurada: Record<string, unknown> | null;
  creado_en: string;
};

const FECHA_AR = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Buenos_Aires",
});

function fmtFechaAR(iso: string): string {
  return FECHA_AR.format(new Date(iso));
}

function textoMensajeUsuario(msg: MensajeRow): string {
  const partes: string[] = [];
  partes.push(`[Mensaje del abogado · ${fmtFechaAR(msg.creado_en)}]`);
  partes.push(msg.contenido);
  if (msg.adjuntos && msg.adjuntos.length > 0) {
    partes.push("");
    partes.push("Adjuntos enviados con este mensaje:");
    for (const a of msg.adjuntos) {
      const desc = a.descripcion?.trim() ? ` (${a.descripcion.trim()})` : "";
      partes.push(`  - ${a.filename}${desc}`);
    }
  }
  return partes.join("\n");
}

function textoMensajeAgente(msg: MensajeRow): string {
  // Solo enviamos el contenido semántico (no búsquedas / ejecucion_id /
  // degraded_response — son metadata de auditoría, no contenido).
  const fuente = msg.respuesta_estructurada;
  if (fuente && typeof fuente === "object") {
    // Modo conversacional (y fallback del parser): el contenido real
    // vive en `respuesta`; analisis/recomendaciones son null. Antes se
    // reinyectaba {analisis:null,recomendaciones:null} y el modelo
    // perdía toda su prosa previa en el modo más frecuente (bug A-5
    // de la auditoría) — encima viendo ejemplos malformados de su
    // propio formato de salida.
    if (typeof fuente.respuesta === "string" && fuente.respuesta.trim()) {
      return JSON.stringify({
        modo: "conversacional",
        respuesta: fuente.respuesta,
        analisis: null,
        recomendaciones: null,
      });
    }
    const obj = {
      modo: "analisis",
      respuesta: null,
      analisis: fuente.analisis,
      recomendaciones: fuente.recomendaciones,
    };
    return JSON.stringify(obj);
  }
  // Fallback: si por alguna razón el respuesta_estructurada está null
  // (mensaje creado defensivamente sin parsear), volvemos al contenido
  // crudo persistido (que también es JSON-string en ese caso).
  return msg.contenido;
}

export async function buildContextoConversacion(
  casoId: string,
  conversacionId: string,
  opciones: { excluirMensajeId?: string } = {},
): Promise<ContextoConversacionResult> {
  const supabase = createServerClient();

  // Contexto del caso (markdown + adjuntos históricos del timeline).
  const caso = await buildContextoCaso(casoId);

  // Mensajes de la conversación. Si se pasa excluirMensajeId, lo
  // filtramos — sirve para el flujo donde el endpoint INSERTA el
  // mensaje del usuario antes de armar el contexto (queda registro
  // aunque el agente falle) pero ese mensaje va aparte como user
  // content del último call, no como mensajePrevio.
  const { data, error } = await supabase
    .from("mensajes_conversacion")
    .select("id, rol, contenido, adjuntos, respuesta_estructurada, creado_en")
    .eq("conversacion_id", conversacionId)
    .order("creado_en", { ascending: true });

  if (error) {
    throw new Error(
      `buildContextoConversacion: error cargando mensajes: ${error.message}`,
    );
  }

  const todos = (data ?? []) as MensajeRow[];
  const mensajesFiltrados = opciones.excluirMensajeId
    ? todos.filter((m) => m.id !== opciones.excluirMensajeId)
    : todos;

  // === Garantía del invariante del loop (bug A-1 de la auditoría) ===
  //
  // runAgentConsulta exige que mensajesPrevios alterne user/assistant y
  // termine en assistant (o esté vacío), porque el mensaje nuevo del
  // usuario se appendea después. Un turno fallido (error de API,
  // storage, contexto) deja en la DB un mensaje 'usuario' SIN respuesta
  // del agente; sin este saneo, el próximo turno arma [user, user] →
  // Anthropic rechaza con 400 → el turno vuelve a fallar → la
  // conversación queda permanentemente inusable (pasó en prod:
  // conversación 639abf52).
  //
  // Saneo en dos pasos:
  //   1. Colapsar mensajes consecutivos del mismo rol en uno solo
  //      (concatenados), para que la secuencia siempre alterne.
  //   2. Si la secuencia termina en 'user' (huérfano de un turno
  //      fallido), sacarlo del history y reinyectar su texto como
  //      sección del contexto markdown — así el modelo no pierde lo
  //      que el abogado escribió, sin romper la alternancia.
  type Turno = { role: "user" | "assistant"; text: string };
  const turnos: Turno[] = mensajesFiltrados.map((m) =>
    m.rol === "usuario"
      ? { role: "user", text: textoMensajeUsuario(m) }
      : { role: "assistant", text: textoMensajeAgente(m) },
  );

  const colapsados: Turno[] = [];
  for (const t of turnos) {
    const prev = colapsados[colapsados.length - 1];
    if (prev && prev.role === t.role) {
      prev.text = `${prev.text}\n\n${t.text}`;
    } else {
      colapsados.push({ ...t });
    }
  }

  // Defensivo: la API exige que el primer mensaje sea 'user'. Un
  // assistant inicial no puede ocurrir por el flujo de la app (el
  // mensaje del agente siempre se inserta después de uno del usuario),
  // pero si apareciera lo descartamos antes que romper el turno.
  while (colapsados.length > 0 && colapsados[0].role === "assistant") {
    colapsados.shift();
  }

  let pendienteSinRespuesta: string | null = null;
  if (
    colapsados.length > 0 &&
    colapsados[colapsados.length - 1].role === "user"
  ) {
    pendienteSinRespuesta = colapsados.pop()?.text ?? null;
  }

  const mensajesPrevios: Anthropic.MessageParam[] = colapsados.map((t) => ({
    role: t.role,
    content: t.text,
  }));

  let contextoMarkdown = caso.contextoMarkdown;
  if (pendienteSinRespuesta) {
    contextoMarkdown +=
      `\n\n---\n\n## MENSAJE PREVIO DEL ABOGADO SIN RESPUESTA\n\n` +
      `El siguiente mensaje fue enviado antes en esta conversación pero ` +
      `no llegó a ser respondido por un error técnico. Tenelo en cuenta ` +
      `al responder la pregunta actual:\n\n${pendienteSinRespuesta}`;
  }

  return {
    ...caso,
    contextoMarkdown,
    mensajesPrevios,
  };
}
