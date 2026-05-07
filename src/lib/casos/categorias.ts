// Categoría procesal de un evento del caso. Mapea al CHECK constraint
// de eventos_caso.categoria. Los valores `consulta_agente` y
// `respuesta_agente` existieron en el PR3 y se removieron en el PR4
// sub-PR2 cuando el chat con el agente pasó a tablas dedicadas
// (conversaciones_caso + mensajes_conversacion).

export const CATEGORIAS_EVENTO = [
  "audiencia",
  "escrito_presentado",
  "resolucion_recibida",
  "prueba_incorporada",
  "otro",
] as const;

export type CategoriaEvento = (typeof CATEGORIAS_EVENTO)[number];

// Las únicas categorías que el abogado puede elegir desde el form.
// Hoy son todas (no hay categorías reservadas para el server después
// del PR4 sub-PR2). Mantengo la indirección por si en el futuro
// reaparecen categorías auto-generadas por el sistema.
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
  otro: "Otro",
};
