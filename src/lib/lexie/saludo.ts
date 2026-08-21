// Protocolo de inicio de sesión de LEXIE.
//
// Módulo PURO —sin `server-only` ni `use client`, igual que inicio/resumen.ts—
// para que lo pueda usar el render del servidor y también un test.
//
// === Por qué esto NO lo escribe el modelo ===
//
// El saludo se arma con string templates sobre datos ya calculados, no con una
// llamada a Claude. Tres motivos, en orden de peso:
//
// 1. Cada apertura de sesión sería un request pago. El abogado que abre la app
//    ocho veces por día para mirar algo y cerrarla pagaría ocho saludos.
// 2. La hora y los vencimientos son DATOS. Pedirle al modelo que calcule si
//    faltan menos de 48 horas es darle la oportunidad de equivocarse en lo
//    único que acá tiene que ser exacto.
// 3. Es instantáneo. Un saludo que tarda cuatro segundos en aparecer es peor
//    que no tener saludo.
//
// El modelo entra recién cuando el abogado contesta.

import type { ResumenInicio, EventoResumen } from "@/lib/inicio/resumen";

export type Saludo = {
  /** "Buenas tardes, Mateo." */
  encabezado: string;
  /** La línea de rapport contextual. Puede ser vacía. */
  rapport: string;
  /** Invitación a la acción con la que cierra. */
  cierre: string;
  /** Hay algo dentro de las próximas 48 h: el UI lo marca distinto. */
  urgente: boolean;
};

const MS_DIA = 86_400_000;

/**
 * Franja del día según la hora de pared argentina.
 *
 * Los cortes son los que fijó Gonzalo: 05–11:59 mañana, 12–18:59 tarde,
 * 19–04:59 noche. La franja de noche cruza la medianoche, por eso es el `else`
 * y no un rango.
 */
export function franjaHoraria(hora: number): "manana" | "tarde" | "noche" {
  if (hora >= 5 && hora < 12) return "manana";
  if (hora >= 12 && hora < 19) return "tarde";
  return "noche";
}

const ENCABEZADO: Record<ReturnType<typeof franjaHoraria>, string> = {
  manana: "Buenos días",
  tarde: "Buenas tardes",
  noche: "Buenas noches",
};

const RAPPORT_PERSONAL: Record<ReturnType<typeof franjaHoraria>, string> = {
  manana: "¿Cómo arrancaste el día?",
  tarde: "¿Cómo va la tarde?",
  noche: "¿Cómo estuvo el día?",
};

/** Fecha del evento en palabras, para meter en una oración. */
function cuandoEnPalabras(iso: string, ahora: Date): string {
  const t = new Date(iso).getTime();
  const dias = Math.floor((t - ahora.getTime()) / MS_DIA);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "mañana";
  if (dias < 7) {
    const DOW = ["el domingo", "el lunes", "el martes", "el miércoles", "el jueves", "el viernes", "el sábado"];
    return DOW[new Date(iso).getDay()];
  }
  return `el ${new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long" })}`;
}

function contar(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Arma el saludo completo.
 *
 * La PRIORIDAD del rapport es la que definió Gonzalo, y es la misma que ya
 * implementa `armarLinea` en inicio/resumen.ts:
 *
 *   1. Urgencias — algo dentro de las próximas 48 h.
 *   2. Agenda del día — hay eventos hoy, pero nada urgente.
 *   3. Rapport personal — no hay nada; entonces el saludo es humano.
 *
 * Un solo comentario, nunca dos. El saludo no es un tablero.
 */
export function construirSaludo({
  nombre,
  hora,
  resumen,
  ahora = new Date(),
}: {
  nombre: string;
  /** Hora de pared argentina (0-23). */
  hora: number;
  resumen: ResumenInicio;
  ahora?: Date;
}): Saludo {
  const franja = franjaHoraria(hora);
  const encabezado = `${ENCABEZADO[franja]}, ${nombre}.`;
  const cierre = "¿En qué empezamos?";

  // — Prioridad 1: urgencias —
  if (resumen.urgente) {
    const criticos = resumen.enVentana.filter(
      (e) => new Date(e.fecha_inicio).getTime() <= ahora.getTime() + 2 * MS_DIA,
    );
    const proximo: EventoResumen | undefined = criticos[0];
    if (proximo) {
      const cuando = cuandoEnPalabras(proximo.fecha_inicio, ahora);
      const resto =
        criticos.length > 1
          ? ` (y ${contar(criticos.length - 1, "cosa más", "cosas más")} en las próximas 48 horas)`
          : "";
      return {
        encabezado,
        rapport: `Antes de arrancar: «${proximo.titulo}» es ${cuando}${resto}. ¿Te lo detallo?`,
        cierre,
        urgente: true,
      };
    }
  }

  // — Prioridad 2: agenda del día —
  const hoyKey = ahora.toDateString();
  const deHoy = resumen.enVentana.filter(
    (e) => new Date(e.fecha_inicio).toDateString() === hoyKey,
  );
  if (deHoy.length > 0) {
    return {
      encabezado,
      rapport: `Hoy tenés ${contar(deHoy.length, "compromiso", "compromisos")} en la agenda. ¿Te los repaso?`,
      cierre,
      urgente: false,
    };
  }

  // — Prioridad 3: rapport personal —
  // El día de la semana pisa al genérico cuando dice algo más específico: un
  // lunes a la mañana y un viernes a la tarde no son un miércoles cualquiera.
  const dow = ahora.getDay();
  let rapport = RAPPORT_PERSONAL[franja];
  if (dow === 1 && franja === "manana") {
    // Neutro a propósito: "Bienvenido" asume el género de quien lee, y el
    // saludo lo van a ver tres personas distintas.
    rapport = "Arrancamos la semana. ¿Cómo venimos?";
  } else if (dow === 5 && (franja === "tarde" || franja === "noche")) {
    rapport = "Última parte de la semana. ¿Cerramos algo importante hoy?";
  }

  return { encabezado, rapport, cierre, urgente: false };
}
