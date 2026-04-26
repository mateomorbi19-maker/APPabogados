import { z } from "zod";

export const rolSchema = z.enum(["defensor", "querellante", "ambos"]);
export type RolInput = z.infer<typeof rolSchema>;

export const contextoSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .default({});

export const preAnalisisInputSchema = z.object({
  caso: z.string().min(20, "El caso debe tener al menos 20 caracteres"),
});
export type PreAnalisisInput = z.infer<typeof preAnalisisInputSchema>;

export const analizarCasoInputSchema = z.object({
  caso: z.string().min(20, "El caso debe tener al menos 20 caracteres"),
  rol: rolSchema,
  contexto: contextoSchema.optional(),
});
export type AnalizarCasoInput = z.infer<typeof analizarCasoInputSchema>;

export const preguntaSchema = z.object({
  id: z.string(),
  tipo: z.enum(["select", "radio", "text", "checkbox"]),
  label: z.string(),
  opciones: z.array(z.string()).optional(),
  valor_sugerido: z.union([z.string(), z.null()]).optional(),
  requerido: z.boolean(),
  motivo: z.string(),
});

export const preAnalisisOutputSchema = z.object({
  resumen_preliminar: z.string(),
  datos_detectados: z.object({
    jurisdiccion_inferida: z.union([z.string(), z.null()]),
    delitos_posibles: z.array(z.string()),
    hay_detenidos: z.union([z.literal("Sí"), z.literal("No"), z.null()]),
    etapa_procesal: z.union([z.string(), z.null()]),
  }),
  preguntas: z.array(preguntaSchema),
});
export type PreAnalisisOutput = z.infer<typeof preAnalisisOutputSchema>;

// === Fase 4.5 — output del análisis profundo y respuesta de /api/analizar-caso ===
//
// El servidor ya parsea el JSON del modelo (parseWithRecovery). Acá repetimos
// la validación en el cliente como defensa en profundidad: si el contrato del
// endpoint cambia o el parser server-side deja pasar algo malformado, el
// cliente cae a "respuesta del modelo en formato inesperado" en vez de explotar.
//
// Los campos no-críticos van con default([]) / default("") para tolerar el
// caso del intento 3 del parser (truncado): el JSON puede llegar incompleto
// pero parseable, y queremos renderizar lo que haya en vez de fallar.

export const estrategiaSchema = z.object({
  numero: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  nombre: z.string(),
  tesis_central: z.string(),
  fundamento_legal: z.array(z.string()).default([]),
  doctrina_aplicable: z.string().default(""),
  fortalezas: z.array(z.string()).default([]),
  riesgos: z.array(z.string()).default([]),
  pasos_procesales: z.array(z.string()).default([]),
});
export type Estrategia = z.infer<typeof estrategiaSchema>;

export const seccionAnalisisSchema = z.object({
  rol: z.string(),
  imputados_identificados: z.array(z.string()).default([]),
  delitos_imputables: z.array(z.string()).default([]),
  estrategias: z.array(estrategiaSchema).default([]),
});
export type SeccionAnalisis = z.infer<typeof seccionAnalisisSchema>;

export const analisisMetadataSchema = z
  .object({
    conceptos_extraidos: z.array(z.string()).optional(),
    articulos_consultados: z.array(z.string()).optional(),
    timestamp: z.string().optional(),
    warning: z.string().optional(),
  })
  .passthrough();

export const analisisOutputSchema = z.object({
  defensor: seccionAnalisisSchema.optional(),
  querellante: seccionAnalisisSchema.optional(),
  metadata: analisisMetadataSchema.optional().default({}),
});
export type AnalisisOutput = z.infer<typeof analisisOutputSchema>;

export const busquedaSchema = z.object({
  query: z.string(),
  chunks_devueltos: z.number(),
  similarity_top: z.number().nullable(),
});
export type Busqueda = z.infer<typeof busquedaSchema>;

export const analizarCasoResponseSchema = z.object({
  ok: z.literal(true),
  defensor: seccionAnalisisSchema.optional(),
  querellante: seccionAnalisisSchema.optional(),
  metadata: analisisMetadataSchema.optional().default({}),
  busquedas: z.array(busquedaSchema).default([]),
});
export type AnalizarCasoResponse = z.infer<typeof analizarCasoResponseSchema>;
