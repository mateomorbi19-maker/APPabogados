// Fase D: color por ETAPA (las 6 macro-fases del proceso, comunes a los 3
// fueros). Es un canal visual SEPARADO del color de estado (que sigue mandando
// en el orbe: ejecutada/riesgo/decisión/posible) — la etapa se muestra como
// chip numerado. Paleta tomada del HTML federal de referencia, adaptada al
// tema dark.
//
// La etapa de un nodo NO se persiste: se deriva en el layout. Los títulos
// "ancla" de abajo (las etapas troncales de FLUJO_POR_FUERO) fijan la fase;
// cualquier otro nodo (desenlaces, incidencias manuales, ramas simuladas por
// IA) HEREDA la etapa de su ancestro más cercano con ancla. ⚠️ Acoplado a los
// títulos de plantilla-base.ts — si se renombra una etapa troncal, actualizar.

export type Etapa = 1 | 2 | 3 | 4 | 5 | 6;

export const ETAPA_LABEL: Record<Etapa, string> = {
  1: "Inicio del proceso",
  2: "Investigación",
  3: "Etapa intermedia",
  4: "Juicio",
  5: "Recursos e impugnaciones",
  6: "Ejecución",
};

export const ETAPA_COLOR: Record<Etapa, string> = {
  1: "#d4553e", // rojo ladrillo
  2: "#4a7fb5", // azul
  3: "#3fa89c", // teal
  4: "#6bbf5a", // verde
  5: "#8a6fc9", // violeta
  6: "#d98a3d", // naranja
};

// Títulos ancla (etapas troncales de los 3 fueros).
export const ETAPA_ANCHOR_POR_TITULO: Record<string, Etapa> = {
  "Actos Iniciales": 1,
  "Instrucción (Sumario)": 2,
  "Investigación Penal Preparatoria": 2,
  "Crítica Instructoria y Elevación": 3,
  "Crítica y Elevación a Juicio": 3,
  "Control de la Acusación": 3,
  "Juicio Oral": 4,
  "Juicio Oral y Público": 4,
  Recursos: 5,
  "Impugnaciones y Recursos": 5,
  "Control de las Decisiones Judiciales": 5,
  Ejecución: 6,
  "Ejecución Penal": 6,
};
