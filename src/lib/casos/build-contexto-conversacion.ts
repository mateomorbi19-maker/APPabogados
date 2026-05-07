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
  // Solo enviamos analisis + recomendaciones (no búsquedas / ejecucion_id /
  // degraded_response — son metadata de auditoría, no contenido).
  const fuente = msg.respuesta_estructurada;
  if (fuente && typeof fuente === "object") {
    const obj = {
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

  const mensajesPrevios: Anthropic.MessageParam[] = mensajesFiltrados.map(
    (m) => {
      if (m.rol === "usuario") {
        return {
          role: "user",
          content: textoMensajeUsuario(m),
        };
      }
      return {
        role: "assistant",
        content: textoMensajeAgente(m),
      };
    },
  );

  return {
    ...caso,
    mensajesPrevios,
  };
}
