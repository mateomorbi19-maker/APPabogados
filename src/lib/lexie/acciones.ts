// Acciones de LEXIE: lo que el agente HIZO, INTENTÓ o DEJÓ PENDIENTE en un
// turno. Módulo PURO (sin server-only, sin React, sin DOM): lo importan las
// tools del servidor, la ruta y la tarjeta de la ventana.
//
// === Por qué existe ===
//
// Hasta la Fase 11 LEXIE era de solo lectura y lo único que quedaba de un turno
// era la prosa del modelo más `herramientas_usadas` (nombres de tools). Con
// escrituras eso no alcanza: el abogado tiene que ver EXACTAMENTE qué se creó,
// qué se envió y qué quedó esperando su confirmación, y el servidor tiene que
// poder sembrar esas pendientes en el turno siguiente. El precedente es
// `AccionMapa` del chat del caso (schemas.ts), con dos diferencias:
//
//   1. Es agnóstica del dominio. Una sola forma sirve para un evento creado,
//      un correo enviado, una ficha editada o un escrito generado: el detalle
//      va en `vista_previa` (lo que se muestra) y en `datos` (ids y links).
//   2. Tiene un ciclo de vida: `pendiente` → `en_curso` → `ok` | `error`, o
//      `pendiente` → `descartada`. El estado intermedio `en_curso` es lo que
//      impide que un doble click o un reintento ejecuten dos veces.
//
// La regla que gobierna todo: `acciones[]` LO ARMA EL SERVIDOR desde las tool
// calls reales. El modelo nunca lo emite, y si su texto trajera esa clave, la
// ruta la pisa.

export const ESTADOS_ACCION = [
  "ok",
  "rechazada",
  "pendiente",
  "en_curso",
  "descartada",
  "error",
] as const;
export type EstadoAccion = (typeof ESTADOS_ACCION)[number];

/** Con qué sección de la app se relaciona, para el ícono y el link. */
export const SECCIONES_ACCION = [
  "agenda",
  "bandeja",
  "causa",
  "escritos",
  "modelos",
] as const;
export type SeccionAccion = (typeof SECCIONES_ACCION)[number];

export type AccionLexie = {
  /** Nombre de la tool que la produjo (o que la va a ejecutar al confirmar). */
  tool: string;
  estado: EstadoAccion;
  /**
   * Clave de confirmación: `${tool}:${sha256(payload canónico).slice(0, 16)}`.
   * Sólo tiene sentido en pendientes y en lo que salió de una pendiente. Ata
   * el CONTENIDO exacto: cambiar una coma es otra clave y otra confirmación.
   */
  clave?: string;
  /** Una línea legible para la tarjeta: "Audiencia Pérez, mar 10/09 10:00". */
  resumen: string;
  seccion?: SeccionAccion;
  /** En rechazos y errores: por qué, y qué hacer. */
  motivo?: string;
  sugerencia?: string;
  /**
   * Lo que el abogado ve antes de confirmar (o lo que se hizo). Pares
   * clave/valor ya formateados por el servidor: direcciones completas, fecha
   * con día de semana, el cuerpo entero de un correo. La tarjeta los pinta
   * en orden.
   */
  vista_previa?: Record<string, unknown>;
  /**
   * SÓLO en pendientes: el payload normalizado que el servidor va a ejecutar
   * al confirmar. Nunca se reemplaza por el input nuevo del modelo.
   */
  payload?: Record<string, unknown>;
  /** Ids y link de lo que se tocó. `href` es interno y lo resuelve el servidor. */
  datos?: { href?: string } & Record<string, unknown>;
  /** Estado anterior, cuando la acción pisa o borra algo. Para deshacer a mano. */
  antes?: Record<string, unknown>;
  confirmado_por?: "click" | "texto";
  error?: string;
};

/**
 * Serialización canónica: claves ordenadas en todos los niveles, sin
 * `undefined`. Dos payloads iguales en contenido dan el mismo string aunque el
 * modelo (o el servidor) los haya construido en otro orden.
 */
export function jsonCanonico(v: unknown): string {
  return JSON.stringify(canonizar(v));
}

function canonizar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonizar);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val === undefined) continue;
      out[k] = canonizar(val);
    }
    return out;
  }
  return v;
}

/** Las pendientes que todavía esperan al abogado. */
export function pendientesVivas(acciones: AccionLexie[]): AccionLexie[] {
  return acciones.filter((a) => a.estado === "pendiente" && !!a.clave);
}

/** Cuántas quedaron efectivamente aplicadas. */
export function accionesEjecutadas(acciones: AccionLexie[]): AccionLexie[] {
  return acciones.filter((a) => a.estado === "ok");
}

export const ETIQUETA_ESTADO: Record<EstadoAccion, string> = {
  ok: "Hecho",
  rechazada: "No se hizo",
  pendiente: "Esperando tu confirmación",
  en_curso: "En curso",
  descartada: "Descartada",
  error: "Falló",
};

export const ETIQUETA_SECCION: Record<SeccionAccion, string> = {
  agenda: "Agenda",
  bandeja: "Bandeja de entrada",
  causa: "Causa",
  escritos: "Escritos",
  modelos: "Modelos de escrito",
};

/** Link interno a la sección, cuando la acción no trae uno más específico. */
export const HREF_SECCION: Record<SeccionAccion, string> = {
  agenda: "/dashboard/agenda",
  bandeja: "/dashboard/bandeja",
  causa: "/dashboard/mis-casos",
  escritos: "/dashboard/mis-casos",
  modelos: "/dashboard/mis-casos",
};

/**
 * Texto que se le pega al mensaje del agente cuando se reconstruye el
 * historial para el modelo. Es la memoria entre turnos: sin esto, en el turno
 * N+1 el modelo no sabe qué ya creó (y lo duplica) ni qué clave tiene que
 * mandar para confirmar. NO se muestra al abogado: la tarjeta ya lo dice.
 */
export function notaAccionesParaModelo(acciones: AccionLexie[]): string | null {
  if (acciones.length === 0) return null;
  const lineas = acciones.map((a) => {
    const ids = a.datos
      ? Object.entries(a.datos)
          .filter(([k, v]) => k !== "href" && (typeof v === "string" || typeof v === "number"))
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(", ")
      : "";
    switch (a.estado) {
      case "ok":
        return `- HECHA ${a.tool}: ${a.resumen}${ids ? ` (${ids})` : ""}`;
      case "pendiente":
        return `- PENDIENTE ${a.tool} (clave ${a.clave}): ${a.resumen}. Si el abogado confirma, llamá ${a.tool} con {clave: "${a.clave}", confirmar: true} y NADA más; si cambia algo, volvé a emitir sin clave.`;
      case "en_curso":
        return `- EN CURSO ${a.tool}: ${a.resumen}`;
      case "descartada":
        return `- DESCARTADA por el abogado ${a.tool}: ${a.resumen}`;
      case "error":
        return `- FALLÓ ${a.tool}: ${a.resumen}${a.error ? ` — ${a.error}` : ""}`;
      case "rechazada":
        return `- RECHAZADA ${a.tool}: ${a.resumen}${a.motivo ? ` — ${a.motivo}` : ""}`;
    }
  });
  return (
    "[NOTA DEL SISTEMA — no forma parte de tu formato de respuesta. Acciones de este turno:\n" +
    lineas.join("\n") +
    "\n]"
  );
}
