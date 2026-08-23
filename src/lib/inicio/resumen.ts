// Resumen contextual del panel de inicio.
//
// Reemplaza al "¿Qué querés hacer hoy?" genérico: la línea bajo el saludo tiene
// que decirle al abogado qué lo está esperando, no preguntarle qué quiere hacer.
// La lógica vive acá —módulo puro, sin `server-only` ni `use client`— para que
// la pueda usar tanto el render del server como cualquier test.
//
// VENTANA: 7 días corridos desde ahora, no la semana calendario. Un viernes a
// la tarde "esta semana" son 2 días y el indicador quedaría siempre vacío justo
// cuando más sirve; los 7 días corridos siempre miden lo mismo. El texto lo
// dice explícitamente para que nadie lea "esta semana" y cuente otra cosa.

export const DIAS_VENTANA = 7;

export type EventoResumen = {
  id: string;
  titulo: string;
  tipo: string;
  fecha_inicio: string;
  todo_el_dia: boolean;
};

export type CasoResumen = {
  id: string;
  /** Nombre YA RESUELTO por `nombreCaso()`: la carátula si está cargada. */
  titulo: string;
  /** `true` si todavía se llama por el título automático del relato. */
  sin_caratula: boolean;
  rol: string;
  actualizado_en: string;
};

export type ResumenInicio = {
  /** Línea contextual bajo "Hola, {nombre}". */
  linea: string;
  /** Eventos que caen dentro de la ventana, en orden cronológico. */
  enVentana: EventoResumen[];
  vencimientos: number;
  audiencias: number;
  /** El primer evento con plazo de la ventana, si hay alguno. */
  proximoVencimiento: EventoResumen | undefined;
  /** Hay algo dentro de las próximas 48 h: habilita el tono de alerta. */
  urgente: boolean;
  /** Desglose por rol de las causas, ya ordenado y listo para renderizar. */
  porRol: Array<{ rol: string; cantidad: number }>;
};

// Tipos de evento que cuentan como "vencimiento" para el indicador. Presentar
// un escrito tiene plazo igual que un vencimiento procesal: si se pasa, se
// perdió el derecho. Los demás tipos (reuniones, trámites) no.
const TIPOS_VENCIMIENTO = new Set(["vencimiento_procesal", "presentacion_escrito"]);

const MS_DIA = 86_400_000;

function plural(n: number, singular: string, pluralForma: string): string {
  return `${n} ${n === 1 ? singular : pluralForma}`;
}

/** Une frases con comas y una "y" final: ["a","b","c"] → "a, b y c". */
function enumerar(partes: string[]): string {
  if (partes.length === 0) return "";
  if (partes.length === 1) return partes[0];
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

export function construirResumen({
  casos,
  eventos,
  ahora = new Date(),
}: {
  casos: CasoResumen[];
  /** Eventos FUTUROS del usuario, ya ordenados por fecha_inicio ascendente. */
  eventos: EventoResumen[];
  ahora?: Date;
}): ResumenInicio {
  const t0 = ahora.getTime();
  const finVentana = t0 + DIAS_VENTANA * MS_DIA;

  const enVentana = eventos.filter((e) => {
    const t = new Date(e.fecha_inicio).getTime();
    return t >= t0 && t <= finVentana;
  });

  // `eventos` ya viene ordenado por fecha ascendente, así que el primero del
  // filtrado ES el próximo con plazo.
  const conPlazo = enVentana.filter((e) => TIPOS_VENCIMIENTO.has(e.tipo));
  const vencimientos = conPlazo.length;
  const audiencias = enVentana.filter((e) => e.tipo === "audiencia").length;
  const urgente = enVentana.some(
    (e) => new Date(e.fecha_inicio).getTime() <= t0 + 2 * MS_DIA,
  );

  // Desglose por rol, ordenado de mayor a menor para que el dato dominante
  // aparezca primero.
  const conteo = new Map<string, number>();
  for (const c of casos) conteo.set(c.rol, (conteo.get(c.rol) ?? 0) + 1);
  const porRol = [...conteo.entries()]
    .map(([rol, cantidad]) => ({ rol, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);

  return {
    linea: armarLinea({ casos: casos.length, vencimientos, audiencias, enVentana }),
    enVentana,
    vencimientos,
    audiencias,
    proximoVencimiento: conPlazo[0],
    urgente,
    porRol,
  };
}

function armarLinea({
  casos,
  vencimientos,
  audiencias,
  enVentana,
}: {
  casos: number;
  vencimientos: number;
  audiencias: number;
  enVentana: EventoResumen[];
}): string {
  const partes: string[] = [];
  if (vencimientos > 0) {
    partes.push(plural(vencimientos, "vencimiento", "vencimientos"));
  }
  if (audiencias > 0) {
    partes.push(plural(audiencias, "audiencia", "audiencias"));
  }
  // El resto de los eventos de la ventana se agrupa: interesa que no queden
  // invisibles, pero no merecen su propia categoría en una sola línea.
  const otros = enVentana.length - vencimientos - audiencias;
  if (otros > 0) {
    partes.push(plural(otros, "evento más", "eventos más"));
  }

  if (partes.length > 0) {
    return `Tenés ${enumerar(partes)} en los próximos ${DIAS_VENTANA} días.`;
  }

  // Sin nada en la ventana: la línea igual tiene que decir algo verdadero.
  if (casos > 0) {
    return `${plural(casos, "causa activa", "causas activas")}, sin vencimientos en los próximos ${DIAS_VENTANA} días.`;
  }
  return "Todavía no tenés causas cargadas. Empezá analizando un caso.";
}
