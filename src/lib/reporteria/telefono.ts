// Teléfonos argentinos → E.164, para armar el link directo de WhatsApp.
// Módulo PURO: lo importan el servicio de envío, el diálogo del reporte, las
// tools de LEXIE y el script de verificación.
//
// POR QUÉ ESTO EXISTE. `partes_caso.telefono` es texto libre, y el mismo
// celular se escribe de seis formas distintas:
//
//   +54 9 11 5555-5555   11 15 5555-5555   (011) 15-5555-5555
//   1155555555           15-5555-5555      +5491155555555
//
// `wa.me` necesita UN número sin espacios ni signos, con código de país y con
// el 9 del móvil. Convertir mal ese número no falla: le abre el chat de OTRA
// persona, con la estrategia de la causa ya escrita en el campo de texto.
//
// LA REGLA, ENTONCES, ES LA MISMA QUE LA DEL DATO FALTANTE: lo que no se puede
// resolver con certeza NO se adivina. Se devuelve `ambiguo` con el motivo, el
// abogado corrige el número en la ficha, y recién ahí aparece el botón. Y lo
// que sí se resuelve se muestra FORMATEADO EN PANTALLA antes de abrir WhatsApp,
// igual que la dirección de correo: el control final es que el abogado lea el
// número completo.
//
// LA ARITMÉTICA DEL PLAN DE NUMERACIÓN ARGENTINO, que es de donde sale todo:
//
//   - El número nacional significativo (área + abonado) tiene SIEMPRE 10
//     dígitos. 11 + 8 en AMBA, 223 + 7 en Mar del Plata, 2966 + 6 en Río
//     Gallegos.
//   - El `0` que se antepone para llamar de larga distancia no va en E.164.
//   - El `15` que se antepone para llamar a un celular desde un fijo TAMPOCO
//     va: se reemplaza por un `9` que se escribe después del código de país.
//     Por eso un número con 15 tiene 12 dígitos y hay que sacarle dos.
//   - Los códigos de área son PREFIJOS LIBRES: si `223` es un código, ningún
//     código de 4 dígitos empieza con `223`. Eso es lo que hace que encontrar
//     el `15` sea determinístico y no una adivinanza.

/** El único código de área de 2 dígitos. Ningún otro empieza con 1. */
const AREA_2 = "11";

/**
 * Los 35 códigos de área de 3 dígitos. Todo lo que no está acá ni empieza con
 * 11 es un código de 4 dígitos.
 */
const AREAS_3 = new Set([
  "220", "221", "223", "230", "236", "237", "249",
  "260", "261", "263", "264", "266", "280", "291", "297", "299",
  "341", "342", "343", "345", "348",
  "351", "353", "358", "362", "364", "370", "376", "379",
  "380", "381", "383", "385", "387", "388",
]);

/** Cuántos dígitos tiene el código de área de un número nacional. */
function largoDeArea(nsn: string): 2 | 3 | 4 {
  if (nsn.startsWith(AREA_2)) return 2;
  if (AREAS_3.has(nsn.slice(0, 3))) return 3;
  return 4;
}

export type TelefonoOk = {
  ok: true;
  /** Sólo dígitos, con código de país. Es lo que come `wa.me`. */
  e164: string;
  /** Para mostrar en pantalla: «+54 9 11 5555-5555». */
  visible: string;
  /** false cuando el número vino en formato internacional de otro país. */
  argentino: boolean;
};

export type TelefonoError = {
  ok: false;
  motivo: "vacio" | "ambiguo" | "invalido";
  /** Redactado para mostrárselo al abogado tal cual. */
  mensaje: string;
};

export type TelefonoNormalizado = TelefonoOk | TelefonoError;

const MIN_DIGITOS_INTERNACIONAL = 8;
const MAX_DIGITOS_INTERNACIONAL = 15; // El techo de E.164.

/**
 * Interpreta un teléfono cargado a mano y devuelve su forma E.164, o el motivo
 * exacto por el que no se puede.
 *
 * Un número escrito con `+` y un código de país que no es el 54 se toma tal
 * cual: el `+` es una declaración explícita de formato internacional, y un
 * cliente en el exterior es un caso real.
 */
export function normalizarTelefonoAr(crudo: string | null | undefined): TelefonoNormalizado {
  const texto = (crudo ?? "").trim();
  if (!texto) {
    return { ok: false, motivo: "vacio", mensaje: "No hay teléfono cargado." };
  }

  // Un `+` que no está al principio no es formato internacional: es un número
  // con basura adentro. Se ignora y se sigue por los dígitos.
  const internacionalExplicito = texto.startsWith("+") || texto.startsWith("00");
  let d = texto.replace(/\D/g, "");
  if (texto.startsWith("00")) d = d.slice(2);

  if (d.length === 0) {
    return {
      ok: false,
      motivo: "invalido",
      mensaje: `«${texto}» no tiene ningún número.`,
    };
  }

  // === Otro país: se respeta lo que escribió el abogado ===
  if (internacionalExplicito && !d.startsWith("54")) {
    if (d.length < MIN_DIGITOS_INTERNACIONAL || d.length > MAX_DIGITOS_INTERNACIONAL) {
      return {
        ok: false,
        motivo: "invalido",
        mensaje: `«${texto}» no parece un número internacional válido (${d.length} dígitos).`,
      };
    }
    return { ok: true, e164: d, visible: `+${d}`, argentino: false };
  }

  // === Argentina ===
  // Ningún código de área argentino empieza con 5, así que un `54` adelante es
  // siempre el código de país y nunca el principio del número.
  if (d.startsWith("54")) d = d.slice(2);
  // El 0 de larga distancia.
  if (d.startsWith("0")) d = d.slice(1);
  // El 9 del móvil, si ya venía puesto. Se saca acá y se vuelve a poner al
  // final, para no tener dos caminos distintos según cómo lo hayan escrito.
  if (d.startsWith("9") && (d.length === 11 || d.length === 13)) d = d.slice(1);

  // Un `15` al principio es un celular local SIN código de área: no hay forma
  // de saber de qué ciudad es.
  if (d.startsWith("15")) {
    return {
      ok: false,
      motivo: "ambiguo",
      mensaje: `«${texto}» arranca con 15 y no dice el código de área, así que no se sabe de qué ciudad es. Escribilo como +54 9 11 5555-5555.`,
    };
  }

  // Número nacional limpio: área + abonado, 10 dígitos.
  if (d.length === 10) return exito(d);

  // Con el 15 adentro: 12 dígitos. Dónde está depende del largo del área, y
  // como los códigos son prefijos libres el largo se resuelve sin ambigüedad.
  if (d.length === 12) {
    const area = largoDeArea(d);
    if (d.slice(area, area + 2) === "15") {
      return exito(d.slice(0, area) + d.slice(area + 2));
    }
    return {
      ok: false,
      motivo: "invalido",
      mensaje: `«${texto}» tiene 12 dígitos pero no se le reconoce el 15 del celular. Escribilo como +54 9 11 5555-5555.`,
    };
  }

  if (d.length === 8) {
    return {
      ok: false,
      motivo: "ambiguo",
      mensaje: `«${texto}» no tiene código de área, así que no se sabe de qué ciudad es. Escribilo como +54 9 11 5555-5555.`,
    };
  }

  return {
    ok: false,
    motivo: "invalido",
    mensaje: `«${texto}» tiene ${d.length} dígitos y un celular argentino tiene 10 sin contar el 0 ni el 15. Escribilo como +54 9 11 5555-5555.`,
  };
}

function exito(nsn: string): TelefonoNormalizado {
  const area = largoDeArea(nsn);
  const codigo = nsn.slice(0, area);
  const abonado = nsn.slice(area);
  return {
    ok: true,
    e164: `549${nsn}`,
    visible: `+54 9 ${codigo} ${abonado.slice(0, abonado.length - 4)}-${abonado.slice(-4)}`,
    argentino: true,
  };
}

/**
 * Largo máximo de la URL de WhatsApp antes de avisar. No es un límite de
 * WhatsApp sino del navegador y de la barra de direcciones: arriba de ~2.000
 * caracteres algunos clientes recortan la URL en silencio, y un mensaje
 * recortado a la mitad es peor que no mandarlo. Pasado ese techo el diálogo
 * ofrece copiar el texto en vez de abrir el link.
 */
export const MAX_URL_WHATSAPP = 2000;

/** El link de «click to chat». Sin `+`: wa.me quiere sólo dígitos. */
export function enlaceWhatsApp(e164: string, texto: string): string {
  return `https://wa.me/${e164}?text=${encodeURIComponent(texto)}`;
}

/** true cuando el texto es tan largo que conviene copiarlo en vez de linkearlo. */
export function textoDemasiadoLargoParaLink(e164: string, texto: string): boolean {
  return enlaceWhatsApp(e164, texto).length > MAX_URL_WHATSAPP;
}
