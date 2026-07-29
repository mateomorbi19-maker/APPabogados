// ============================================================================
// DATOS DE DEMOSTRACIÓN — NADA DE ESTO ES REAL.
//
// Ninguna de estas personas, causas, fiscalías, direcciones de email ni
// expedientes existe: son inventados para que la sección Bandeja de entrada se
// pueda navegar, diseñar y probar HOY, antes de que estén concedidos los
// scopes de Gmail. Los dominios son de ejemplo y los IPP/expedientes son
// ficticios.
//
// Se sirven ÚNICAMENTE cuando no hay conexión con Gmail, y siempre con la
// bandera `demo: true` en la respuesta de la API para que la UI los marque
// como tales. Toda operación de ESCRITURA sobre datos demo devuelve 409: no se
// simula nunca un envío ni un borrado.
//
// Todos los ids arrancan con `demo-`.
// ============================================================================

import type { HiloCompleto, HiloResumen, MensajeCompleto } from "./types";

// Las fechas se calculan relativas al arranque del proceso para que el listado
// se vea vivo ("hace 2 horas") en vez de anclado a una fecha que envejece.
const AHORA = Date.now();
const HORA = 3_600_000;
const DIA = 24 * HORA;

function hace(ms: number): string {
  return new Date(AHORA - ms).toISOString();
}

function cuerpoHtml(parrafos: string[]): string {
  return parrafos
    .map((p) => `<p style="margin: 0 0 12px">${p}</p>`)
    .join("\n");
}

function cuerpoTexto(parrafos: string[]): string {
  return parrafos.join("\n\n");
}

type SemillaMensaje = {
  id: string;
  de: { nombre: string; email: string };
  para: { nombre: string; email: string }[];
  cc?: { nombre: string; email: string }[];
  asunto: string;
  fecha: string;
  parrafos: string[];
  adjuntos?: { id: string; filename: string; mime_type: string; size_bytes: number }[];
  leido?: boolean;
  destacado?: boolean;
  etiquetas?: string[];
};

function armarMensaje(threadId: string, s: SemillaMensaje): MensajeCompleto {
  return {
    id: s.id,
    thread_id: threadId,
    de: s.de,
    para: s.para,
    cc: s.cc ?? [],
    asunto: s.asunto,
    fecha: s.fecha,
    cuerpo_html: cuerpoHtml(s.parrafos),
    cuerpo_texto: cuerpoTexto(s.parrafos),
    adjuntos: s.adjuntos ?? [],
    leido: s.leido ?? true,
    destacado: s.destacado ?? false,
    etiquetas: s.etiquetas ?? ["INBOX"],
    message_id_header: `<${s.id}@demo.local>`,
    references_header: null,
  };
}

const YO = { nombre: "Estudio Morbiducci", email: "estudio@ejemplo.com.ar" };

// === Semillas de los 8 hilos ===

type SemillaHilo = {
  id: string;
  asunto: string;
  mensajes: SemillaMensaje[];
};

const SEMILLAS: SemillaHilo[] = [
  {
    id: "demo-1",
    asunto: "Vista conferida — IPP 07-00-012345-25 (Gómez, Ricardo)",
    mensajes: [
      {
        id: "demo-1-m1",
        de: {
          nombre: "UFI N° 3 — San Isidro",
          email: "ufi3.sanisidro@ejemplo-mpba.gob.ar",
        },
        para: [YO],
        asunto: "Vista conferida — IPP 07-00-012345-25 (Gómez, Ricardo)",
        fecha: hace(2 * HORA),
        leido: false,
        parrafos: [
          "Se le confiere vista de las actuaciones por el término de cinco (5) días hábiles, a los efectos previstos en el art. 336 del CPP de la Provincia de Buenos Aires.",
          "Se acompaña copia digital de la cédula y del dictamen fiscal obrante a fs. 214/219.",
          "Sin otro particular, saluda atte.",
        ],
        adjuntos: [
          {
            id: "demo-adj-1",
            filename: "cedula-vista-IPP-012345-25.pdf",
            mime_type: "application/pdf",
            size_bytes: 184_320,
          },
        ],
        etiquetas: ["INBOX", "UNREAD", "IMPORTANT"],
      },
    ],
  },
  {
    id: "demo-2",
    asunto: "Fijación de audiencia — excarcelación (Autos: Paredes, Damián)",
    mensajes: [
      {
        id: "demo-2-m1",
        de: {
          nombre: "Juzgado de Garantías N° 5 — San Martín",
          email: "garantias5.sm@ejemplo-jusbuenosaires.gov.ar",
        },
        para: [YO],
        asunto: "Fijación de audiencia — excarcelación (Autos: Paredes, Damián)",
        fecha: hace(1 * DIA + 3 * HORA),
        parrafos: [
          "Se hace saber que ha quedado fijada audiencia en los términos del art. 169 del CPPBA para el día jueves próximo a las 10:00 hs, en la sala 2 del edificio de Ricardo Balbín 1753.",
          "Se solicita confirmar asistencia por esta vía.",
        ],
      },
      {
        id: "demo-2-m2",
        de: {
          nombre: "Juzgado de Garantías N° 5 — San Martín",
          email: "garantias5.sm@ejemplo-jusbuenosaires.gov.ar",
        },
        para: [YO],
        asunto: "RE: Fijación de audiencia — excarcelación",
        fecha: hace(20 * HORA),
        leido: false,
        parrafos: [
          "Se rectifica el horario informado: la audiencia pasa a las 11:30 hs del mismo día, por superposición con otra causa.",
          "Rogamos tomar nota.",
        ],
        etiquetas: ["INBOX", "UNREAD"],
      },
    ],
  },
  {
    id: "demo-3",
    asunto: "Perito calígrafo para la pericia de firma",
    mensajes: [
      {
        id: "demo-3-m1",
        de: { nombre: "Marcela Ruiz", email: "mruiz@ejemplo-estudio.com.ar" },
        para: [YO],
        asunto: "Perito calígrafo para la pericia de firma",
        fecha: hace(3 * DIA),
        parrafos: [
          "Che, ¿tenés algún calígrafo de confianza para proponer como perito de parte? Es por la causa de defraudación que te comenté.",
          "Necesito el nombre antes del viernes para incluirlo en el escrito.",
        ],
        destacado: true,
      },
      {
        id: "demo-3-m2",
        de: YO,
        para: [{ nombre: "Marcela Ruiz", email: "mruiz@ejemplo-estudio.com.ar" }],
        asunto: "RE: Perito calígrafo para la pericia de firma",
        fecha: hace(3 * DIA - 4 * HORA),
        parrafos: [
          "Sí, trabajo seguido con el Lic. Fernando Aliaga. Muy serio y contesta rápido los puntos de pericia.",
          "Te paso el contacto por privado.",
        ],
        etiquetas: ["SENT"],
      },
      {
        id: "demo-3-m3",
        de: { nombre: "Marcela Ruiz", email: "mruiz@ejemplo-estudio.com.ar" },
        para: [YO],
        asunto: "RE: Perito calígrafo para la pericia de firma",
        fecha: hace(2 * DIA - 6 * HORA),
        parrafos: [
          "Perfecto, ya lo contacté y aceptó. Gracias!",
        ],
        destacado: true,
        etiquetas: ["INBOX", "STARRED"],
      },
    ],
  },
  {
    id: "demo-4",
    asunto: "Consulta sobre mi causa",
    mensajes: [
      {
        id: "demo-4-m1",
        de: { nombre: "Sergio Palma", email: "sergio.palma@ejemplo-mail.com" },
        para: [YO],
        asunto: "Consulta sobre mi causa",
        fecha: hace(6 * HORA),
        leido: false,
        parrafos: [
          "Buenas tardes doctor, ¿cómo le va? Quería saber si hubo alguna novedad con la presentación que hicimos el mes pasado.",
          "Me llegó una notificación al domicilio pero no la entiendo bien. Se la puedo llevar mañana si le sirve.",
          "Muchas gracias.",
        ],
        etiquetas: ["INBOX", "UNREAD"],
      },
    ],
  },
  {
    id: "demo-5",
    asunto: "Jornada de actualización en litigación oral — inscripción abierta",
    mensajes: [
      {
        id: "demo-5-m1",
        de: {
          nombre: "Colegio de Abogados de San Isidro",
          email: "capacitacion@ejemplo-casi.org.ar",
        },
        para: [YO],
        asunto: "Jornada de actualización en litigación oral — inscripción abierta",
        fecha: hace(4 * DIA),
        parrafos: [
          "Se encuentra abierta la inscripción a la jornada de actualización en técnicas de litigación oral, con foco en examen y contraexamen de testigos.",
          "Cupos limitados. La inscripción es sin cargo para matriculados con la cuota al día.",
        ],
        etiquetas: ["INBOX", "CATEGORY_PROMOTIONS"],
      },
    ],
  },
  {
    id: "demo-6",
    asunto: "Cargo de presentación — Expte. FSM 4521/2025",
    mensajes: [
      {
        id: "demo-6-m1",
        de: {
          nombre: "Mesa de Entradas — Juzgado Federal N° 2",
          email: "mesaentradas.jf2@ejemplo-pjn.gov.ar",
        },
        para: [YO],
        asunto: "Cargo de presentación — Expte. FSM 4521/2025",
        fecha: hace(5 * DIA),
        parrafos: [
          "Se acusa recibo de la presentación electrónica ingresada el día de la fecha, la que ha quedado registrada bajo el cargo que se adjunta.",
          "El escrito pasa a despacho.",
        ],
        adjuntos: [
          {
            id: "demo-adj-2",
            filename: "cargo-FSM-4521-2025.pdf",
            mime_type: "application/pdf",
            size_bytes: 62_100,
          },
        ],
      },
    ],
  },
  {
    id: "demo-7",
    asunto: "Informe preliminar — pericia contable",
    mensajes: [
      {
        id: "demo-7-m1",
        de: {
          nombre: "Cra. Alicia Benítez",
          email: "abenitez@ejemplo-peritos.com.ar",
        },
        para: [YO],
        asunto: "Informe preliminar — pericia contable",
        fecha: hace(8 * DIA),
        parrafos: [
          "Doctor, le acerco el borrador del informe con el detalle de los movimientos observados entre marzo y septiembre.",
          "Todavía falta cruzar dos extractos, pero el cuadro general ya está armado.",
        ],
        adjuntos: [
          {
            id: "demo-adj-3",
            filename: "informe-preliminar-movimientos.xlsx",
            mime_type:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            size_bytes: 41_984,
          },
        ],
      },
      {
        id: "demo-7-m2",
        de: YO,
        para: [
          { nombre: "Cra. Alicia Benítez", email: "abenitez@ejemplo-peritos.com.ar" },
        ],
        asunto: "RE: Informe preliminar — pericia contable",
        fecha: hace(7 * DIA),
        parrafos: [
          "Recibido, gracias. Le pido que en la versión final incluya el detalle por cuenta, porque es lo que vamos a discutir en la audiencia.",
        ],
        etiquetas: ["SENT"],
      },
    ],
  },
  {
    id: "demo-8",
    asunto: "Notificación electrónica — cédula disponible",
    mensajes: [
      {
        id: "demo-8-m1",
        de: {
          nombre: "Notificaciones Electrónicas",
          email: "no-responder@ejemplo-notificaciones.gov.ar",
        },
        para: [YO],
        asunto: "Notificación electrónica — cédula disponible",
        fecha: hace(11 * HORA),
        leido: false,
        parrafos: [
          "Usted tiene una nueva cédula disponible en su domicilio electrónico constituido.",
          "Este mensaje es generado automáticamente. Por favor no responda.",
        ],
        etiquetas: ["INBOX", "UNREAD"],
      },
    ],
  },
];

// === Derivación de los shapes que consume la API ===

function aResumen(s: SemillaHilo): HiloResumen {
  const mensajes = s.mensajes;
  const ultimo = mensajes[mensajes.length - 1];
  const etiquetas = new Set<string>();
  let leido = true;
  let destacado = false;
  let conAdjuntos = false;

  for (const m of mensajes) {
    for (const e of m.etiquetas ?? ["INBOX"]) etiquetas.add(e);
    if (m.leido === false) leido = false;
    if (m.destacado) destacado = true;
    if ((m.adjuntos ?? []).length > 0) conAdjuntos = true;
  }

  return {
    id: s.id,
    thread_id: s.id,
    remitente: ultimo.de,
    destinatarios: [...ultimo.para, ...(ultimo.cc ?? [])].map((d) => d.email),
    asunto: s.asunto,
    fragmento: ultimo.parrafos[0].slice(0, 160),
    fecha: ultimo.fecha,
    leido,
    destacado,
    tiene_adjuntos: conAdjuntos,
    cantidad_mensajes: mensajes.length,
    etiquetas: Array.from(etiquetas).sort(),
  };
}

/** Listado de la bandeja en modo demo, del más nuevo al más viejo. */
export const HILOS_DEMO: HiloResumen[] = SEMILLAS.map(aResumen).sort(
  (a, b) => Date.parse(b.fecha) - Date.parse(a.fecha),
);

/**
 * Detalle por thread_id en modo demo.
 *
 * Es un Map y no un objeto plano a propósito: el id viene de la URL y
 * `gmailIdSchema` acepta `__proto__`, `constructor`, `toString`… Con un objeto
 * plano esas claves resuelven contra Object.prototype, el guard `if (!hilo)`
 * no las filtra y la ruta responde 200 con un cuerpo que no cumple su propio
 * contrato en vez del 404 que corresponde. `.get()` no consulta el prototipo.
 */
export const HILOS_COMPLETOS_DEMO: ReadonlyMap<string, HiloCompleto> = new Map(
  SEMILLAS.map((s): [string, HiloCompleto] => [
    s.id,
    {
      id: s.id,
      asunto: s.asunto,
      mensajes: s.mensajes.map((m) => armarMensaje(s.id, m)),
    },
  ]),
);

/**
 * Filtra los hilos demo imitando el comportamiento de los buzones y de la
 * búsqueda, para que la navegación se sienta real sin credenciales.
 */
export function filtrarHilosDemo(buzon: string, q?: string): HiloResumen[] {
  let out = HILOS_DEMO.filter((h) => {
    if (buzon === "STARRED") return h.destacado;
    // No hay semillas en la papelera: ningún hilo demo se puede borrar.
    if (buzon === "TRASH") return false;
    return h.etiquetas.includes(buzon);
  });

  const termino = (q ?? "").trim().toLowerCase();
  if (termino.length > 0) {
    out = out.filter(
      (h) =>
        h.asunto.toLowerCase().includes(termino) ||
        h.fragmento.toLowerCase().includes(termino) ||
        h.remitente.nombre.toLowerCase().includes(termino) ||
        h.remitente.email.toLowerCase().includes(termino),
    );
  }
  return out;
}

export function esIdDemo(id: string): boolean {
  return id.startsWith("demo-");
}
