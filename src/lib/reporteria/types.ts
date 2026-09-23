// Tipos del dominio de reportería al cliente (Fase 12). Módulo PURO: sin
// "server-only" ni "use client", lo importan las rutas, los diálogos de la
// ficha, las tools de LEXIE y el script de verificación.
//
// Un REPORTE es un mensaje del abogado a su cliente sobre el estado de la
// causa, armado desde una de las seis plantillas del estudio (P-01…P-06).
// Ver docs/PLAN_REPORTERIA.md para las decisiones.

export const PLANTILLAS_REPORTE = [
  "P01",
  "P02",
  "P03",
  "P04",
  "P05",
  "P06",
] as const;
export type PlantillaReporte = (typeof PLANTILLAS_REPORTE)[number];

export const CANALES_REPORTE = ["email", "whatsapp", "copia"] as const;
export type CanalReporte = (typeof CANALES_REPORTE)[number];

export const CANAL_REPORTE_LABEL: Record<CanalReporte, string> = {
  email: "Correo electrónico",
  whatsapp: "WhatsApp",
  copia: "Copiar el texto",
};

export const ESTADOS_REPORTE = ["borrador", "enviado", "descartado"] as const;
export type EstadoReporte = (typeof ESTADOS_REPORTE)[number];

export const ESTADO_REPORTE_LABEL: Record<EstadoReporte, string> = {
  borrador: "Borrador",
  enviado: "Enviado",
  descartado: "Descartado",
};

/**
 * Un reporte persistido en `reportes_cliente`. `contenido_generado` es lo que
 * produjo el sistema y no se toca; `contenido` es lo que el abogado edita;
 * `contenido_enviado` es lo que efectivamente salió.
 */
export type ReporteCliente = {
  id: string;
  caso_id: string;
  /** Null si la persona se borró después: el registro sobrevive a la parte. */
  parte_id: string | null;
  destinatario_nombre: string;
  plantilla: PlantillaReporte;
  variante: string | null;
  canal: CanalReporte;
  estado: EstadoReporte;
  /** Sólo con canal email. */
  asunto: string | null;
  contenido_generado: string;
  contenido: string;
  contenido_enviado: string | null;
  /** Lo que el abogado tipeó en el formulario (criterio profesional). */
  criterio: Record<string, unknown>;
  /** El esqueleto de datos que usó el sistema, para auditar. */
  datos: Record<string, unknown>;
  /** true en las variantes que no pasan por el modelo (prisión preventiva, condena). */
  sin_ia: boolean;
  enviado_en: string | null;
  /** La dirección o el teléfono EXACTOS a los que salió. */
  enviado_a: string | null;
  gmail_message_id: string | null;
  ejecucion_id: string | null;
  creado_en: string;
  actualizado_en: string;
};

/** Lo que ve la lista de la ficha: sin los textos, con las marcas contadas. */
export type ReporteClienteLista = Omit<
  ReporteCliente,
  "contenido_generado" | "contenido" | "contenido_enviado" | "criterio" | "datos"
> & {
  pendientes: number;
};

/**
 * Las marcas que deja el sistema donde falta un dato o donde el cuerpo lo
 * tiene que escribir el abogado. Se conservan LITERALES en el texto y el envío
 * se rechaza mientras quede una: el mensaje sale firmado por el abogado y va a
 * un cliente. Es la regla del dato faltante de los escritos, con más razón.
 *
 *   [FALTA: fecha de la audiencia]   — dato que la ficha no tiene
 *   [REDACTAR: cuerpo del mensaje]   — párrafo que escribe el abogado (sin IA)
 */
export const MARCA_REPORTE_RE = /\[(?:FALTA|REDACTAR):[^\]]*\]/g;

export function contarMarcasReporte(texto: string): number {
  return texto.match(MARCA_REPORTE_RE)?.length ?? 0;
}

export function marcasReporte(texto: string): string[] {
  return Array.from(new Set(texto.match(MARCA_REPORTE_RE) ?? []));
}

const TIENE_MARCA_RE = /\[(?:FALTA|REDACTAR):[^\]]*\]/;

/**
 * Saca del texto las oraciones que tienen una marca, para que un dato sin
 * completar no trabe el envío. Si la marca viene después de dos puntos, se
 * conserva lo de antes: «…no te preocupés todavía: [REDACTAR: …].» queda
 * «…no te preocupés todavía.». Los párrafos que se vacían desaparecen.
 *
 * No se aplica sola: el detalle la corre A LA VISTA del abogado antes de
 * abrir WhatsApp o el correo, y guarda el resultado. El server sigue
 * rechazando un texto con marcas, así que lo que sale es siempre lo que quedó
 * en pantalla.
 */
export function quitarFrasesIncompletas(texto: string): string {
  const lineas = texto.split("\n").map((linea) => {
    if (!TIENE_MARCA_RE.test(linea)) return linea;
    return linea
      .split(/(?<=[.!?])\s+/)
      .map((oracion) => {
        const marca = oracion.search(TIENE_MARCA_RE);
        if (marca < 0) return oracion;
        const dosPuntos = oracion.lastIndexOf(":", marca);
        const antes = dosPuntos > 0 ? oracion.slice(0, dosPuntos).trim() : "";
        return antes && !TIENE_MARCA_RE.test(antes) ? `${antes}.` : "";
      })
      .filter(Boolean)
      .join(" ");
  });
  return lineas
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cuántos días sin reporte disparan la tarjeta del Inicio. */
export const DIAS_SIN_REPORTE_AVISO = 30;

/** El estudio, tal como firma el reporte mensual (P-06). */
export const NOMBRE_ESTUDIO = "BraCar Asociados";
