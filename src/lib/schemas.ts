import { z } from "zod";
import { CATEGORIAS_EVENTO } from "@/lib/casos/categorias";
import { MIME_TYPES_PERMITIDOS } from "@/lib/casos/adjuntos";

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
  // Opcional para tolerar respuestas previas a la incorporación del campo
  // (ej: tests viejos cacheados). Si está presente y truthy, el frontend
  // habilita el botón "Seleccionar como estrategia principal" en cada card.
  ejecucion_id: z.string().uuid().optional(),
  defensor: seccionAnalisisSchema.optional(),
  querellante: seccionAnalisisSchema.optional(),
  metadata: analisisMetadataSchema.optional().default({}),
  busquedas: z.array(busquedaSchema).default([]),
});
export type AnalizarCasoResponse = z.infer<typeof analizarCasoResponseSchema>;

// === Fase 5.1 — shape del jsonb `metadata` de la tabla `ejecuciones` ===
//
// Schema laxo: TODOS los campos son opcionales y `passthrough()` para tolerar
// filas viejas (pre-Fase 4) o futuras (post-5.1). El componente que consume
// esto valida `metadata.resultado` por separado contra `analisisOutputSchema`
// o `preAnalisisOutputSchema` según `ejecucion.tipo`.
//
// Ojo: `resultado` queda como `unknown` porque su forma depende del `tipo`
// de la ejecución y se valida en runtime cuando el modal lo consume.
export const ejecucionMetadataSchema = z
  .object({
    caso: z.string().optional(),
    contexto: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()]),
      )
      .optional(),
    rol: rolSchema.optional(),
    resultado: z.unknown().optional(),
    busquedas: z.array(busquedaSchema).optional(),
    parseo_intento: z
      .union([z.literal(1), z.literal(2), z.literal(3)])
      .nullable()
      .optional(),
    iterations: z.number().optional(),
    cache_creation_input_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
    error: z.string().optional(),
    parseo_error: z.string().optional(),
  })
  .passthrough();
export type EjecucionMetadata = z.infer<typeof ejecucionMetadataSchema>;

// === Feature "Mis casos" ===

export const rolEstrategiaSchema = z.enum(["defensor", "querellante"]);
export type RolEstrategia = z.infer<typeof rolEstrategiaSchema>;

export const crearCasoInputSchema = z.object({
  titulo: z.string().min(1).max(500),
  ejecucion_origen_id: z.string().uuid(),
  rol_estrategia: rolEstrategiaSchema,
  idx_estrategia: z.number().int().min(0).max(2),
});
export type CrearCasoInput = z.infer<typeof crearCasoInputSchema>;

// Cada adjunto en el body apunta a un objeto ya subido al bucket
// `eventos-caso-adjuntos` vía signed URL. El cliente sube primero (PUT
// directo al storage) y luego pega el storage_path en el evento.
//
// El server NO baja el archivo para verificar mime/size aquí — confía en
// los metadatos que vienen y en la validación previa del endpoint
// upload-url. Sí valida que el storage_path empiece con
// {usuario_id}/{caso_id}/ para que un usuario no pueda referenciar
// adjuntos de otro caso suyo en el evento equivocado.
export const adjuntoInputSchema = z.object({
  filename: z.string().min(1).max(255),
  storage_path: z.string().min(1).max(500),
  mime_type: z.enum(MIME_TYPES_PERMITIDOS),
  size_bytes: z.number().int().positive(),
  descripcion: z.string().max(500).default(""),
});
export type AdjuntoInput = z.infer<typeof adjuntoInputSchema>;

// Categoría procesal manual: las dos categorías del agente
// (consulta_agente, respuesta_agente) las setea el server desde su
// propio endpoint en PR3, no las acepta este form.
const CATEGORIAS_MANUALES_TUPLE = [
  "audiencia",
  "escrito_presentado",
  "resolucion_recibida",
  "prueba_incorporada",
  "otro",
] as const satisfies ReadonlyArray<(typeof CATEGORIAS_EVENTO)[number]>;

// Validación de fecha "razonable" del evento: parseable + año entre 2020 y 2050.
// Frontend puede omitirla; el server la default-ea a now().
export const crearEventoInputSchema = z.object({
  descripcion: z.string().min(20).max(2000),
  ocurrido_en: z
    .string()
    .datetime({ offset: true })
    .refine((v) => {
      const y = new Date(v).getUTCFullYear();
      return y >= 2020 && y <= 2050;
    }, "Fecha fuera de rango razonable (2020–2050)")
    .optional(),
  estado: z.enum(["sucedido", "pendiente"]).optional(),
  categoria: z.enum(CATEGORIAS_MANUALES_TUPLE),
  adjuntos: z.array(adjuntoInputSchema).max(20).default([]),
});
export type CrearEventoInput = z.infer<typeof crearEventoInputSchema>;

// Body del endpoint que pide signed URL para upload directo al bucket.
// El server valida + genera el storage path canónico; el cliente
// recibe la URL firmada y sube el archivo con PUT.
export const adjuntoUploadUrlInputSchema = z.object({
  filename: z.string().min(1).max(255),
  mime_type: z.enum(MIME_TYPES_PERMITIDOS),
  size_bytes: z.number().int().positive(),
});
export type AdjuntoUploadUrlInput = z.infer<typeof adjuntoUploadUrlInputSchema>;

// === Consulta continua al agente (PR3) ===
//
// Shape de la respuesta del agente. El server la persiste como JSON
// dentro de `eventos_caso.descripcion` del evento `respuesta_agente`,
// y el cliente la parsea + valida con este schema antes de renderizar.
// Defensa en profundidad: si el modelo se aparta del formato, el
// cliente cae a un fallback con mensaje y no rompe el árbol de render.

export const recomendacionSchema = z.object({
  prioridad: z.enum(["alta", "media", "baja"]),
  accion: z.string().min(1),
  plazo: z.string().default("Sin plazo definido"),
  fundamento: z.string().default(""),
});
export type Recomendacion = z.infer<typeof recomendacionSchema>;

export const respuestaConsultaSchema = z.object({
  analisis: z.object({
    tesis_central: z.string(),
    fundamento_legal: z.array(z.string()).default([]),
    consideraciones: z.string().default(""),
  }),
  recomendaciones: z.array(recomendacionSchema).default([]),
  // Campos enriquecidos por el server al persistir.
  degraded_response: z.boolean().optional(),
  ejecucion_id: z.string().uuid().optional(),
  busquedas: z.array(busquedaSchema).optional(),
});
export type RespuestaConsulta = z.infer<typeof respuestaConsultaSchema>;
