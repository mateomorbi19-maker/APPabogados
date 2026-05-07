// Categoría procesal de un evento del caso. Mapea al CHECK constraint
// de eventos_caso.categoria (migración 20260507120000).
//
// Mantenido como tupla de literales para que zod pueda construir un enum
// directo sin importar este array como mutable. Si agregás un valor acá,
// también va al CHECK en SQL — son la misma fuente de verdad lógica
// expresada en dos lenguajes.

export const CATEGORIAS_EVENTO = [
  "audiencia",
  "escrito_presentado",
  "resolucion_recibida",
  "prueba_incorporada",
  "consulta_agente",
  "respuesta_agente",
  "otro",
] as const;

export type CategoriaEvento = (typeof CATEGORIAS_EVENTO)[number];

// Labels en español para UI. Solo las que el abogado puede elegir
// explícitamente desde el form. `consulta_agente` y `respuesta_agente`
// los crea el server desde el endpoint de consulta (PR3); el form de
// agregar evento manual las omite.
export const CATEGORIAS_MANUALES: ReadonlyArray<{
  value: CategoriaEvento;
  label: string;
}> = [
  { value: "audiencia", label: "Audiencia" },
  { value: "escrito_presentado", label: "Escrito presentado" },
  { value: "resolucion_recibida", label: "Resolución recibida" },
  { value: "prueba_incorporada", label: "Prueba incorporada" },
  { value: "otro", label: "Otro" },
];

export const CATEGORIA_LABEL: Record<CategoriaEvento, string> = {
  audiencia: "Audiencia",
  escrito_presentado: "Escrito presentado",
  resolucion_recibida: "Resolución recibida",
  prueba_incorporada: "Prueba incorporada",
  consulta_agente: "Consulta al agente",
  respuesta_agente: "Análisis del agente",
  otro: "Otro",
};
