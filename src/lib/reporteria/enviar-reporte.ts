import "server-only";
import { leerParte } from "@/lib/casos/escritura";
import { casoEsDelUsuario } from "@/lib/casos/propiedad";
import { getGmailClientEnvio, gmailErrorMessage } from "@/lib/gmail/client";
import { enviarMensaje } from "@/lib/gmail/mensajes";
import { plantillaPorId } from "./plantillas";
import { renderizarAsunto } from "./render";
import { normalizarTelefonoAr } from "./telefono";
import {
  obtenerReporte,
  registrarMessageId,
  reservarEnvio,
  revertirEnvio,
} from "./queries";
import {
  contarMarcasReporte,
  marcasReporte,
  type CanalReporte,
  type ReporteCliente,
} from "./types";

// Enviar (o marcar como enviado) un reporte. Es la ÚNICA pieza de la
// reportería que sale del sistema, y por eso concentra las reglas duras:
//
//   1. Sólo un borrador se envía, y una sola vez: `reservarEnvio` es un
//      UPDATE condicional (borrador → enviado) que deja afuera al doble click
//      y a la segunda pestaña ANTES de tocar Gmail.
//   2. No sale con huecos: cualquier marca [FALTA: …] o [REDACTAR: …] en el
//      texto rechaza el envío.
//   3. La dirección es la de la PARTE, leída de la base en este mismo momento,
//      y si el cliente manda `para` tiene que coincidir letra por letra: es
//      la confirmación de que el abogado leyó la dirección completa.
//   4. El correo sale por el Gmail del abogado autenticado (token de Clerk);
//      si falta el scope de envío, se rechaza sin marcar nada.
//   5. Si Gmail rechaza el envío, la reserva se revierte y el reporte vuelve
//      a borrador.
//
// WHATSAPP no sale de la app tampoco, pero desde el link directo ya no es un
// «marcar a mano»: el abogado abre wa.me con el texto cargado, lo manda desde
// su propio WhatsApp y vuelve a confirmar. Como el destinatario es un número
// concreto, se le aplican las MISMAS cuatro reglas que al correo —incluida la
// tercera, la que importa—: el teléfono se relee de `partes_caso`, se
// normaliza a E.164 y el `para` que manda el cliente tiene que coincidir. Un
// número mal interpretado no falla: le abre el chat a otra persona.
//
// COPIA sigue siendo la salida manual sin destinatario: el abogado copió el
// texto y lo mandó por donde quiso. Es el escape cuando no hay teléfono
// cargado o cuando el número no se puede interpretar.

export type EnviarReporteInput = {
  casoId: string;
  /** Del servidor. */
  usuarioId: string;
  clerkUserId: string;
  reporteId: string;
  canal: CanalReporte;
  /**
   * El destinatario tal como lo vio el abogado: la dirección de correo, o el
   * teléfono normalizado en E.164. Obligatorio para email y para whatsapp.
   */
  para?: string | null;
};

export type EnviarReporteResultado =
  | { ok: true; reporte: ReporteCliente; enviado_a: string }
  | {
      ok: false;
      motivo:
        | "caso_ajeno"
        | "no_existe"
        | "ya_enviado"
        | "marcas_pendientes"
        | "sin_email"
        | "sin_telefono"
        | "telefono_invalido"
        | "destinatario_no_coincide"
        | "sin_gmail"
        | "gmail_rechazo";
      mensaje: string;
      pendientes?: string[];
    };

export async function enviarReporte(
  input: EnviarReporteInput,
): Promise<EnviarReporteResultado> {
  if (!(await casoEsDelUsuario(input.casoId, input.usuarioId))) {
    return { ok: false, motivo: "caso_ajeno", mensaje: "Caso no encontrado" };
  }
  const reporte = await obtenerReporte(input.reporteId, input.casoId, input.usuarioId);
  if (!reporte) {
    return { ok: false, motivo: "no_existe", mensaje: "Reporte no encontrado" };
  }
  if (reporte.estado !== "borrador") {
    return {
      ok: false,
      motivo: "ya_enviado",
      mensaje:
        reporte.estado === "enviado"
          ? "Este reporte ya se envió. Si querés mandar otro, generá uno nuevo."
          : "Este reporte está descartado.",
    };
  }
  const pendientes = marcasReporte(reporte.contenido);
  if (pendientes.length > 0) {
    const n = contarMarcasReporte(reporte.contenido);
    return {
      ok: false,
      motivo: "marcas_pendientes",
      mensaje: `El mensaje todavía tiene ${n} dato${n === 1 ? "" : "s"} por completar. Editalo y cerrá las marcas [FALTA] y [REDACTAR] antes de enviarlo.`,
      pendientes,
    };
  }

  // El contacto se lee AHORA de la parte, no del reporte: si el abogado
  // corrigió el mail después de generar, sale al corregido.
  const parte = reporte.parte_id
    ? await leerParte(input.casoId, reporte.parte_id)
    : null;
  const plantilla = plantillaPorId(reporte.plantilla);
  const asunto =
    reporte.asunto?.trim() ||
    (plantilla ? renderizarAsunto(plantilla, valoresDe(reporte)) : "Novedades de tu causa");

  // === Correo ===
  if (input.canal === "email") {
    const email = parte?.email?.trim().toLowerCase() ?? null;
    if (!email) {
      return {
        ok: false,
        motivo: "sin_email",
        mensaje: `${reporte.destinatario_nombre} no tiene correo cargado. Cargalo en Partes y volvé a intentar, o mandalo por otro canal.`,
      };
    }
    const confirmado = input.para?.trim().toLowerCase() ?? "";
    if (confirmado !== email) {
      return {
        ok: false,
        motivo: "destinatario_no_coincide",
        mensaje: `La dirección confirmada no coincide con la cargada para ${reporte.destinatario_nombre} (${email}). Revisala antes de enviar.`,
      };
    }
    const gmail = await getGmailClientEnvio(input.clerkUserId);
    if (!gmail) {
      return {
        ok: false,
        motivo: "sin_gmail",
        mensaje:
          "Gmail no está conectado o falta el permiso de envío. Volvé a entrar con Google aceptando el permiso de correo, o mandá el reporte por otro canal.",
      };
    }

    // Reserva ANTES de enviar: si otra pestaña ya lo mandó, acá termina.
    const reservado = await reservarEnvio(input.reporteId, input.casoId, input.usuarioId, {
      canal: "email",
      enviadoA: email,
      contenidoEnviado: reporte.contenido,
      asunto,
    });
    if (!reservado) {
      return {
        ok: false,
        motivo: "ya_enviado",
        mensaje: "Este reporte ya se estaba enviando desde otra ventana.",
      };
    }
    try {
      const r = await enviarMensaje(gmail, {
        para: [email],
        asunto,
        cuerpo: reporte.contenido,
      });
      const final =
        (await registrarMessageId(input.reporteId, input.casoId, input.usuarioId, r.id)) ??
        reservado;
      return { ok: true, reporte: final, enviado_a: email };
    } catch (e) {
      const detalle = gmailErrorMessage(e);
      console.error("[reporteria] Gmail rechazó el envío:", detalle);
      try {
        await revertirEnvio(input.reporteId, input.casoId, input.usuarioId);
      } catch (e2) {
        console.error("[reporteria] no se pudo revertir la reserva:", e2);
      }
      return {
        ok: false,
        motivo: "gmail_rechazo",
        mensaje: `Gmail rechazó el envío: ${detalle}. El reporte sigue como borrador.`,
      };
    }
  }

  // === WhatsApp: el abogado lo mandó desde su propio WhatsApp ===
  // El link se lo abrió la app con el texto cargado, pero el «enviar» lo tocó
  // él adentro de WhatsApp. Acá se registra a QUÉ NÚMERO, releído de la ficha
  // y comparado con el que vio en pantalla.
  if (input.canal === "whatsapp") {
    const tel = normalizarTelefonoAr(parte?.telefono);
    if (!tel.ok) {
      return {
        ok: false,
        motivo: tel.motivo === "vacio" ? "sin_telefono" : "telefono_invalido",
        mensaje:
          tel.motivo === "vacio"
            ? `${reporte.destinatario_nombre} no tiene teléfono cargado. Cargalo en Partes y volvé a intentar, o marcá el reporte como copiado a mano.`
            : `${tel.mensaje} Corregilo en Partes, o marcá el reporte como copiado a mano.`,
      };
    }
    const confirmado = (input.para ?? "").replace(/\D/g, "");
    if (confirmado !== tel.e164) {
      return {
        ok: false,
        motivo: "destinatario_no_coincide",
        mensaje: `El número confirmado no coincide con el cargado para ${reporte.destinatario_nombre} (${tel.visible}). Revisalo antes de registrar el envío.`,
      };
    }
    const reservadoWa = await reservarEnvio(input.reporteId, input.casoId, input.usuarioId, {
      canal: "whatsapp",
      enviadoA: `WhatsApp ${tel.visible}`,
      contenidoEnviado: reporte.contenido,
      asunto: reporte.asunto,
    });
    if (!reservadoWa) {
      return {
        ok: false,
        motivo: "ya_enviado",
        mensaje: "Este reporte ya figura como enviado.",
      };
    }
    return { ok: true, reporte: reservadoWa, enviado_a: `WhatsApp ${tel.visible}` };
  }

  // === Copia: salida manual, sin destinatario registrado ===
  const enviadoA = "copiado a mano";
  const reservado = await reservarEnvio(input.reporteId, input.casoId, input.usuarioId, {
    canal: input.canal,
    enviadoA,
    contenidoEnviado: reporte.contenido,
    asunto: reporte.asunto,
  });
  if (!reservado) {
    return {
      ok: false,
      motivo: "ya_enviado",
      mensaje: "Este reporte ya figura como enviado.",
    };
  }
  return { ok: true, reporte: reservado, enviado_a: enviadoA };
}

function valoresDe(r: ReporteCliente): Record<string, string | null> {
  const v = (r.datos as { valores?: Record<string, string | null> } | null)?.valores;
  return v ?? {};
}
