import { normalizarTexto } from "@/lib/repositorio/texto";
import type { ModeloEscritoResumen } from "./types";

export type ComplejidadEscrito = "complejo" | "mero_tramite";

export const COMPLEJIDAD_ESCRITO_LABEL: Record<ComplejidadEscrito, string> = {
  complejo: "Complejo",
  mero_tramite: "Mero trámite",
};

// Criterio organizativo del catálogo, no calificación procesal: mero trámite
// identifica gestiones administrativas o de impulso sin argumentación de fondo.
// Recursos, nulidades, libertad y pedidos probatorios que requieren valoración
// quedan como complejos. La extensión del escrito no determina la etiqueta.
// Lista revisada sobre los 136 resúmenes y los cuerpos de los casos dudosos.
// Los modelos nuevos quedan como complejos hasta revisar e incorporar su slug.
const MODELOS_DE_MERO_TRAMITE = new Set([
  "aceptacion-de-cargo-de-defensor-y-constitucion-de-domicilio",
  "solicitud-de-vista-del-legajo-y-extraccion-de-copias",
  "pronto-despacho-urgimiento",
  "aporte-de-datos-de-testigos-en-la-investigacion-penal-preparatoria",
  "designacion-de-defensor-por-el-imputado",
  "detenido-incomunicado-solicita-autorizar-a-su-letrada-a-compulsar-electronicamen",
]);

// Para modelos propios/LEXIE sólo reconocemos encabezados administrativos
// completos. Buscar palabras sueltas ("vista", "oficios", "acompaña") marcaría
// erróneamente como simples contestaciones de fondo o pedidos de prueba.
// Tanto el título como cada punto de la suma deben estar reconocidos: un
// pedido mixto o una descripción desconocida conserva la etiqueta Complejo.
const ENCABEZADOS_DE_MERO_TRAMITE = [
  /^(?:aceptacion (?:de|del) cargo de defensor(?:a)?|acepta cargo)(?: y constitucion de domicilio)?$/,
  /^(?:constitucion de|constituye|constituyo) domicilio(?: procesal| electronico)?$/,
  /^(?:designacion de defensor(?:a)?(?: por el imputado)?|designa defensor(?:a)?)$/,
  /^(?:solicitud de|solicita) vista(?: del legajo| del expediente| de la causa)?(?: y (?:extraccion de )?copias(?: digitales)?)?$/,
  /^(?:solicitud de|solicita|extraccion de) copias(?: digitales)?(?: del legajo| del expediente| de la causa)?$/,
  /^(?:(?:solicitud de|solicita) )?pronto despacho(?: urgimiento)?$/,
  /^urgimiento$/,
  /^(?:aporte de datos|aporta datos|aporta informacion) de testigos(?: en la investigacion penal preparatoria)?$/,
  /^solicita participacion$/,
  /^detenido incomunicado solicita autorizar a su letrada a compulsar electronicamente la causa$/,
  /^solicita a letrada que compulse de forma electronica la causa$/,
  /^(?:solicitud de|solicita) acceso (?:electronico|informatico|digital) (?:al expediente|a la causa|al legajo)$/,
  /^(?:acompanamiento de|acompana) (?:bono|ius previsional|constancia de pago)(?: y (?:bono|ius previsional))?$/,
  /^(?:informa|denuncia|constituye) nuevo domicilio(?: procesal| electronico)?$/,
];

function esEncabezadoDeMeroTramite(texto: string): boolean {
  const partes = texto.split(/[.;\n]+/).map(normalizarTexto).filter(Boolean);
  return (
    partes.length > 0 &&
    partes.every((parte) =>
      ENCABEZADOS_DE_MERO_TRAMITE.some((patron) => patron.test(parte)),
    )
  );
}

/** Clasificación compartida por etiquetas y filtros, sin cargar el catálogo. */
export function complejidadModelo(
  modelo: Pick<
    ModeloEscritoResumen,
    "id" | "origen" | "titulo" | "suma" | "categoria"
  >,
): ComplejidadEscrito {
  if (modelo.origen === "estudio") {
    return MODELOS_DE_MERO_TRAMITE.has(modelo.id) ? "mero_tramite" : "complejo";
  }

  // Una categoría sustantiva prevalece sobre un encabezado administrativo.
  if (!["actos_iniciales", "prueba", "otro"].includes(modelo.categoria)) {
    return "complejo";
  }

  // El diálogo agrega "(propio)" al duplicar un modelo del estudio.
  const titulo = modelo.titulo.replace(/\s*\((?:propio|copia)\)\s*$/i, "");
  return esEncabezadoDeMeroTramite(titulo) &&
    esEncabezadoDeMeroTramite(modelo.suma)
    ? "mero_tramite"
    : "complejo";
}
