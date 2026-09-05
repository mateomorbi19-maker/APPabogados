import "server-only";
import { createHash } from "node:crypto";
import {
  jsonCanonico,
  type AccionLexie,
  type SeccionAccion,
} from "@/lib/lexie/acciones";

// El protocolo de confirmación de LEXIE, del lado de las tools.
//
// === Cómo funciona ===
//
// TURNO N. La tool valida todo lo validable, arma el payload FINAL (para/cc
// resueltos, el evento a borrar leído de la base, el diff campo a campo…),
// registra una acción `pendiente` con `clave = sha256(payload)` y devuelve un
// tool_result con `requiere_confirmacion: true`. El modelo se lo muestra al
// abogado tal cual. La ruta persiste la pendiente en metadata del mensaje.
//
// TURNO N+1. La ruta siembra las pendientes vivas en `ctx.accionesPendientes`
// (un Map que se construye UNA vez por turno y ninguna tool puede poblar).
// El abogado confirma de dos formas:
//   - Con el BOTÓN de la tarjeta: la ruta ejecuta el payload persistido sin
//     pasar por el modelo (ver ejecutar-accion.ts). Este archivo no interviene.
//   - Por TEXTO ("dale, mandalo"): el modelo vuelve a llamar la tool con
//     `{clave, confirmar: true}`. `resolverConfirmacion` verifica que la clave
//     esté sembrada y no consumida, y la tool ejecuta el MISMO payload
//     persistido, no lo que el modelo mandó ahora.
//
// === Por qué el modelo no puede autoconfirmarse ===
//
// (1) El Map sale del turno ANTERIOR persistido: un rechazo emitido en la
//     iteración 1 no existe en la iteración 2 del mismo turno.
// (2) Ninguna tool da de alta en el Map; sólo se consume.
// (3) La clave ata el contenido: si el modelo re-redactó el correo, el hash
//     no coincide con nada sembrado y se rechaza.
// (4) La última vuelta del motor sale sin tools.
// Es el mismo esquema que `rechazosConfirmables` del mapa procesal, con la
// clave atada al contenido en vez de a acción+nodo.

export function claveAccion(tool: string, payload: unknown): string {
  const h = createHash("sha256").update(jsonCanonico(payload)).digest("hex");
  return `${tool}:${h.slice(0, 16)}`;
}

export type ContextoConfirmacion = {
  accionesPendientes: ReadonlyMap<string, AccionLexie>;
  clavesConsumidas: Set<string>;
};

export type ResolucionConfirmacion =
  /** Primer llamado: la tool tiene que registrar la pendiente y devolverla. */
  | { modo: "emitir"; clave: string }
  /** Clave sembrada y viva: ejecutar el payload PERSISTIDO en `pendiente`. */
  | { modo: "ejecutar"; pendiente: AccionLexie }
  /** confirmar sin siembra, contenido cambiado, o ya consumida. */
  | { modo: "rechazar"; motivo: string; sugerencia: string };

export function resolverConfirmacion(
  ctx: ContextoConfirmacion,
  tool: string,
  payloadNormalizado: Record<string, unknown>,
  pedido: { clave?: string | undefined; confirmar?: boolean | undefined },
): ResolucionConfirmacion {
  const claveNueva = claveAccion(tool, payloadNormalizado);
  const quiereConfirmar = pedido.confirmar === true || !!pedido.clave;
  if (!quiereConfirmar) return { modo: "emitir", clave: claveNueva };

  // Si mandó clave, vale la clave (ejecuta lo persistido aunque el input nuevo
  // difiera). Si sólo mandó confirmar:true, el contenido tiene que ser
  // idéntico al que el abogado vio.
  const buscada = pedido.clave ?? claveNueva;
  const pendiente = ctx.accionesPendientes.get(buscada);
  if (!pendiente || pendiente.tool !== tool) {
    if (pedido.clave) {
      return {
        modo: "rechazar",
        motivo:
          "Esa clave no corresponde a ninguna acción pendiente de este hilo: o ya se ejecutó, o se descartó, o nunca existió.",
        sugerencia:
          "No inventes claves. Si el abogado quiere esta acción, emitila de nuevo SIN clave ni confirmar para que vea la vista previa y la confirme.",
      };
    }
    return {
      modo: "rechazar",
      motivo:
        "Mandaste confirmar: true sin que esta acción, con este contenido exacto, se le haya mostrado antes al abogado — el servidor no registra ninguna pendiente igual.",
      sugerencia:
        "Emitila sin confirmar para que el abogado vea la vista previa. Si ya la vio y cambiaste algo (una palabra, un destinatario, una fecha), es OTRA acción y también hay que mostrarla de nuevo. Nunca confirmes en el mismo mensaje en que la mostraste.",
    };
  }
  if (ctx.clavesConsumidas.has(buscada)) {
    return {
      modo: "rechazar",
      motivo: "Esa acción ya se ejecutó en este mismo mensaje.",
      sugerencia: "No la repitas. Contale al abogado el resultado que ya obtuviste.",
    };
  }
  return { modo: "ejecutar", pendiente };
}

export type PendienteInput = {
  tool: string;
  clave: string;
  resumen: string;
  seccion: SeccionAccion;
  vista_previa: Record<string, unknown>;
  payload: Record<string, unknown>;
  antes?: Record<string, unknown>;
  /** Qué tiene que hacer el modelo con esto. Se agrega a la sugerencia base. */
  nota?: string;
};

/** Arma la acción pendiente y el tool_result que la acompaña. */
export function emitirPendiente(p: PendienteInput): {
  accion: AccionLexie;
  contentJSON: string;
} {
  const accion: AccionLexie = {
    tool: p.tool,
    estado: "pendiente",
    clave: p.clave,
    resumen: p.resumen,
    seccion: p.seccion,
    vista_previa: p.vista_previa,
    payload: p.payload,
    ...(p.antes ? { antes: p.antes } : {}),
  };
  const contentJSON = JSON.stringify({
    ok: false,
    requiere_confirmacion: true,
    clave: p.clave,
    vista_previa: p.vista_previa,
    sugerencia:
      "Mostrale al abogado esta vista previa TAL CUAL (direcciones completas, fecha con día de semana, el texto íntegro), en tu propio mensaje. " +
      "Él la confirma con el botón de la tarjeta o diciéndotelo. Si te lo dice, recién en tu PRÓXIMO mensaje llamá esta misma herramienta con {clave: \"" +
      p.clave +
      "\", confirmar: true} y ningún otro campo. NO la vuelvas a llamar en este mensaje." +
      (p.nota ? ` ${p.nota}` : ""),
  });
  return { accion, contentJSON };
}

/** tool_result de un rechazo de confirmación (sin is_error: el modelo lo relata). */
export function jsonRechazoConfirmacion(
  r: Extract<ResolucionConfirmacion, { modo: "rechazar" }>,
): string {
  return JSON.stringify({ ok: false, motivo: r.motivo, sugerencia: r.sugerencia });
}

/** Marca la clave como consumida y devuelve una copia de la acción resuelta. */
export function consumir(
  ctx: ContextoConfirmacion,
  pendiente: AccionLexie,
  resultado: Partial<AccionLexie> & { estado: "ok" | "error" | "rechazada" },
): AccionLexie {
  if (pendiente.clave) ctx.clavesConsumidas.add(pendiente.clave);
  const { payload: _payload, ...sinPayload } = pendiente;
  void _payload;
  return {
    ...sinPayload,
    ...resultado,
    confirmado_por: "texto",
  };
}
