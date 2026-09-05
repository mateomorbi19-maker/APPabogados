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
  conversacionId: string;
  /** Resuelto a demanda: sólo las acciones de correo lo necesitan. */
  gmail: () => Promise<gmail_v1.Gmail | null>;
};

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
