import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { gmail_v1 } from "@googleapis/gmail";
import type { FamiliaTools } from "@/lib/agent/motor";
import type { AccionLexie } from "@/lib/lexie/acciones";
import type { ContextoLexie, ResultadoToolLexie } from "@/lib/agent/lexie-tools";


// El contrato que cumple cada DOMINIO de LEXIE (agenda, ficha, escritos,
// correo). Existe para que los cuatro se puedan escribir por separado sin
// tocar los archivos compartidos: run-lexie.ts, ejecutar-accion.ts,
// lexie-prompt.ts y lexie-manual.ts los importan por este contrato y no
// vuelven a cambiar cuando un dominio suma una tool.
//
// Cada dominio exporta:
//   - `familias(ctx)`: sus familias de tools, ya con `habilitada` resuelta
//     desde el contexto (por ejemplo, correo sólo si `ctx.gmail` no es null).
//   - `ejecutarPendiente(accion, ctx)`: cómo se ejecuta una acción PENDIENTE
//     de ese dominio cuando el abogado la confirma. Devuelve null si la tool
//     no es suya.
//   - `prompt` y `manual`: los tramos del system prompt y del manual de la app
//     que describen esas capacidades. Vacíos mientras el dominio no existe.

/** Una familia de LEXIE: igual que la del motor, pero `ejecutar` puede devolver `accion`. */
export type FamiliaLexie = Omit<FamiliaTools<ContextoLexie>, "ejecutar"> & {
  ejecutar: (
    tu: Anthropic.ToolUseBlock,
    ctx: ContextoLexie,
  ) => Promise<ResultadoToolLexie>;
};

/**
 * Contexto del servidor para ejecutar una pendiente por el BOTÓN (sin modelo).
 * Todo sale de la sesión autenticada; nada del body.
 */
export type CtxEjecucion = {
  usuarioId: string;
  nombre: string;
  clerkUserId: string;
  /** Sólo en el camino del botón; las tools no lo necesitan. */
  conversacionId?: string;
  /** Resuelto a demanda: sólo las acciones de correo lo necesitan. */
  gmail: () => Promise<gmail_v1.Gmail | null>;
};

/** El contexto de ejecución cuando la confirmación llega por TEXTO (desde una tool). */
export function ctxEjecucionDesdeTools(ctx: ContextoLexie): CtxEjecucion {
  return {
    usuarioId: ctx.usuarioId,
    nombre: ctx.nombre,
    clerkUserId: ctx.clerkUserId,
    gmail: async () => ctx.gmail,
  };
}

/**
 * Ejecuta una pendiente confirmada por TEXTO: el mismo ejecutor que usa el
 * botón, el mismo payload persistido, y la clave queda consumida para que el
 * modelo no la repita en la misma vuelta. El tool_result le dice al modelo
 * sólo lo que pasó; la tarjeta ya muestra el detalle.
 */
export async function ejecutarPorTexto(
  ctx: ContextoLexie,
  pendiente: AccionLexie,
  dominio: DominioLexie,
): Promise<ResultadoToolLexie> {
  if (pendiente.clave) ctx.clavesConsumidas.add(pendiente.clave);
  const r = await dominio.ejecutarPendiente(pendiente, ctxEjecucionDesdeTools(ctx));
  const base: AccionLexie = r ?? {
    ...pendiente,
    estado: "error",
    error: `No hay ejecutor para ${pendiente.tool}.`,
  };
  const accion: AccionLexie = { ...base, payload: undefined, confirmado_por: "texto" };
  const contentJSON =
    accion.estado === "ok"
      ? JSON.stringify({ ok: true, resumen: accion.resumen, ...(accion.datos ?? {}) })
      : JSON.stringify({
          ok: false,
          motivo: accion.error ?? accion.motivo ?? "No se pudo ejecutar.",
          sugerencia: accion.sugerencia ?? "Contale al abogado qué pasó, sin adornos.",
        });
  return { contentJSON, accion };
}

export type DominioLexie = {
  nombre: string;
  familias: (ctx: ContextoLexie) => FamiliaLexie[];
  ejecutarPendiente: (
    accion: AccionLexie,
    ctx: CtxEjecucion,
  ) => Promise<AccionLexie | null>;
  prompt: string;
  manual: string;
};

/** Acción resuelta a partir de una pendiente, sin el payload (ya no hace falta). */
export function resolverPendiente(
  pendiente: AccionLexie,
  resultado: Partial<AccionLexie> & { estado: "ok" | "error" | "rechazada" },
): AccionLexie {
  const { payload: _payload, ...sinPayload } = pendiente;
  void _payload;
  return { ...sinPayload, ...resultado };
}
