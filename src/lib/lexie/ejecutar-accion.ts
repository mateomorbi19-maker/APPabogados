import "server-only";
import type { AccionLexie } from "@/lib/lexie/acciones";
import type { CtxEjecucion, DominioLexie } from "@/lib/agent/lexie-dominio";
import { DOMINIO_AGENDA } from "@/lib/agent/agenda-tools";
import { DOMINIO_FICHA } from "@/lib/agent/ficha-tools";
import { DOMINIO_ESCRITOS } from "@/lib/agent/escritos-tools";
import { DOMINIO_CORREO } from "@/lib/agent/correo-tools";

// El ÚNICO ejecutor de acciones pendientes. Lo llaman los dos caminos de
// confirmación —el botón de la tarjeta (la ruta, sin modelo) y el texto (la
// tool, con `{clave, confirmar: true}`)— y siempre ejecuta el PAYLOAD
// PERSISTIDO: nunca nada que venga en el body ni en el input nuevo del modelo.
// Es lo que hace verdadera la promesa «confirmar es ejecutar exactamente lo
// que leíste».

export const DOMINIOS_LEXIE: DominioLexie[] = [
  DOMINIO_AGENDA,
  DOMINIO_FICHA,
  DOMINIO_ESCRITOS,
  DOMINIO_CORREO,
];

/**
 * Ejecuta una pendiente. Nunca tira: un fallo vuelve como acción `error` con
 * el mensaje, porque el caller ya reservó la clave y tiene que dejar rastro
 * del resultado sea cual sea.
 */
export async function ejecutarAccionPendiente(
  accion: AccionLexie,
  ctx: CtxEjecucion,
): Promise<AccionLexie> {
  if (accion.estado !== "pendiente" && accion.estado !== "en_curso") {
    return {
      ...accion,
      estado: "error",
      error: `La acción no está pendiente (estado ${accion.estado}).`,
    };
  }
  try {
    for (const d of DOMINIOS_LEXIE) {
      const r = await d.ejecutarPendiente(accion, ctx);
      if (r) return r;
    }
    return {
      ...accion,
      payload: undefined,
      estado: "error",
      error: `No hay ejecutor para la herramienta ${accion.tool}.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ejecutar-accion] ${accion.tool} falló:`, msg);
    return { ...accion, payload: undefined, estado: "error", error: msg };
  }
}
