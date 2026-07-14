import { z } from "zod";
import { CATEGORIAS_EVENTO } from "@/lib/casos/categorias";
import { MIME_TYPES_PERMITIDOS } from "@/lib/casos/adjuntos";
import { NIVELES_MODELO, NIVEL_DEFAULT } from "@/lib/agent/modelos";

export const rolSchema = z.enum(["defensor", "querellante", "ambos"]);
export type RolInput = z.infer<typeof rolSchema>;

export const contextoSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .default({});

export const preAnalisisInputSchema = z.object({
  caso: z.string().min(20, "El caso debe tener al menos 20 caracteres"),
  rol: rolSchema,
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

// Códigos canónicos de los 5 flags estratégicos que el pre-análisis detecta.
// El SYSTEM_PROMPT del análisis profundo re-detecta los mismos flags por su
// cuenta (no recibe esta lista como input); este array se persiste en
// metadata para observabilidad en /admin.
export const flagEstrategicoSchema = z.enum([
  "prescripcion_riesgo",
  "competencia_cuestionable",
  "nulidades",
  "conexidad",
  "menores",
]);
export type FlagEstrategico = z.infer<typeof flagEstrategicoSchema>;

export const preAnalisisOutputSchema = z.object({
  resumen_preliminar: z.string(),
  datos_detectados: z.object({
    jurisdiccion_inferida: z.union([z.string(), z.null()]),
    delitos_posibles: z.array(z.string()),
    hay_detenidos: z.union([z.literal("Sí"), z.literal("No"), z.null()]),
    etapa_procesal: z.union([z.string(), z.null()]),
  }),
  // Default a [] para tolerar respuestas previas al modelo de 4 categorías
  // (filas viejas del historial no tienen este campo).
  flags_detectados: z.array(flagEstrategicoSchema).default([]),
  // Cap 4-12 por contrato del prompt; .max(15) deja 3 de margen defensivo
  // contra respuestas degeneradas del modelo. .min(1) es el mínimo absoluto
  // para considerar el output utilizable; el server rechaza con 502 cualquier
  // respuesta que no cumpla este shape.
  preguntas: z.array(preguntaSchema).min(1).max(15),
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

// Tres perfiles fijos de estrategia. El prompt al modelo le exige una por
// cada uno, en este orden (conservadora, moderada, agresiva). El UI les
// asigna color y label visible al usuario.
export const tipoEstrategiaSchema = z.enum([
  "conservadora",
  "moderada",
  "agresiva",
]);
export type TipoEstrategia = z.infer<typeof tipoEstrategiaSchema>;

const baseEstrategiaSchema = z.object({
  numero: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  nombre: z.string(),
  tipo: tipoEstrategiaSchema,
  // Preview de 60-120 palabras pensado para mostrar en la card colapsada.
  // 120 palabras en español ≈ 600-720 chars típicos, pero el modelo se
  // pasa con cierta regularidad cuando la estrategia es compleja (caso
  // real: 842 chars en una agresiva). El cap .max(1500) da margen amplio
  // para que el cliente nunca rechace el output válido por verbosidad.
  // La regla "60-120 palabras" sigue viviendo en el prompt — el cap es
  // defensa de borde, no contrato.
  resumen_ejecutivo: z.string().min(1).max(1500),
  tesis_central: z.string(),
  fundamento_legal: z.array(z.string()).default([]),
  doctrina_aplicable: z.string().default(""),
  fortalezas: z.array(z.string()).default([]),
  riesgos: z.array(z.string()).default([]),
  pasos_procesales: z.array(z.string()).default([]),
});

// Preprocess para compatibilidad con ejecuciones viejas (pre-rediseño)
// que no tienen `tipo` ni `resumen_ejecutivo` en su `estrategia_snapshot`
// ni en `metadata.resultado.{defensor,querellante}.estrategias`:
//   - `tipo`: se deriva del `numero` (1 → conservadora, 2 → moderada,
//     3 → agresiva). Cubre el caso de las 27+ ejecuciones históricas
//     que tienen numero 1/2/3 sin tipo asociado.
//   - `resumen_ejecutivo`: se deriva de la primera oración de
//     `tesis_central`, truncada a 200 chars. Es un fallback razonable
//     porque tesis_central está pensado como 2-3 oraciones y la primera
//     suele resumir el planteo. Si tesis_central viniera vacío, queda
//     "Sin resumen disponible" como último recurso (no debería pasar,
//     porque tesis_central es required en el schema).
export const estrategiaSchema = z.preprocess((raw) => {
  if (typeof raw !== "object" || raw === null) return raw;
  const v: Record<string, unknown> = { ...(raw as Record<string, unknown>) };

  if (typeof v.tipo !== "string") {
    const n = Number(v.numero);
    v.tipo = n === 1 ? "conservadora" : n === 2 ? "moderada" : "agresiva";
  }

  if (typeof v.resumen_ejecutivo !== "string" || v.resumen_ejecutivo.length === 0) {
    const tesis = typeof v.tesis_central === "string" ? v.tesis_central : "";
    const primera = tesis.split(/(?<=[.!?])\s/)[0] ?? tesis;
    const truncada = primera.slice(0, 200).trim();
    v.resumen_ejecutivo = truncada.length > 0 ? truncada : "Sin resumen disponible";
  }

  return v;
}, baseEstrategiaSchema);
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

// Preview liviano de cada chunk recuperado por el RAG (contenido truncado).
// Se devuelve solo para debug/medición; no se renderiza en la UI del abogado.
export const chunkRecuperadoSchema = z.object({
  contenido: z.string(),
  articulo: z.string().nullable(),
  tipo_documento: z.string().nullable(),
  similarity: z.number(),
});
export type ChunkRecuperado = z.infer<typeof chunkRecuperadoSchema>;

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
  // Grounding (PASO 0 + Intervención 1): sin_grounding = true si hubo
  // búsquedas pero ninguna recuperó chunks. chunks_recuperados es para
  // debug/medición. Ambos opcionales para tolerar respuestas viejas.
  sin_grounding: z.boolean().optional(),
  chunks_recuperados: z.array(chunkRecuperadoSchema).optional(),
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
  categoria: z.enum(CATEGORIAS_EVENTO),
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

// Discriminated union por `modo`: 'conversacional' (prosa libre) vs
// 'analisis' (estructura completa con tesis/fundamento/recomendaciones).
// El modelo decide qué modo usar según la pregunta del abogado — el
// system prompt lo guía. Cliente y server validan con este schema.
//
// Campos enriquecidos al persistir (degraded_response, ejecucion_id,
// busquedas) son ortogonales al modo; van como `.optional()` en cada
// branch del union.
const respuestaConversacionalSchema = z.object({
  modo: z.literal("conversacional"),
  respuesta: z.string().min(1),
  analisis: z.null(),
  recomendaciones: z.null(),
  degraded_response: z.boolean().optional(),
  ejecucion_id: z.string().uuid().optional(),
  busquedas: z.array(busquedaSchema).optional(),
  // Si el parser falló y el server cayó al fallback con texto crudo,
  // este flag aparece true en el panel admin para investigación.
  parser_fallback: z.boolean().optional(),
});

const respuestaAnalisisSchema = z.object({
  modo: z.literal("analisis"),
  respuesta: z.null(),
  analisis: z.object({
    tesis_central: z.string().min(1),
    fundamento_legal: z.array(z.string()).min(1),
    consideraciones: z.string().min(1),
  }),
  recomendaciones: z.array(recomendacionSchema).min(1),
  degraded_response: z.boolean().optional(),
  ejecucion_id: z.string().uuid().optional(),
  busquedas: z.array(busquedaSchema).optional(),
  parser_fallback: z.boolean().optional(),
});

export const respuestaConsultaSchema = z.discriminatedUnion("modo", [
  respuestaConversacionalSchema,
  respuestaAnalisisSchema,
]);
export type RespuestaConsulta = z.infer<typeof respuestaConsultaSchema>;

// === Chat persistente (PR4 sub-PR2) ===

export const crearConversacionInputSchema = z.object({
  // Título opcional: si no viene, el server genera "Conversación del DD/MM/YYYY"
  // (con hora si ya hay una con el mismo título base ese día).
  titulo: z.string().min(1).max(200).optional(),
});
export type CrearConversacionInput = z.infer<typeof crearConversacionInputSchema>;

export const renombrarConversacionInputSchema = z.object({
  titulo: z.string().min(1).max(200),
});
export type RenombrarConversacionInput = z.infer<
  typeof renombrarConversacionInputSchema
>;

// Mensaje del usuario al agente. El server inserta el mensaje del
// usuario, llama al agente, y crea el mensaje del agente.
// `nivel` (Bajo/Medio/Alto) es un enum-allowlist: el cliente NUNCA
// manda un model ID crudo — el server lo resuelve desde
// MODELO_POR_NIVEL (src/lib/agent/modelos.ts). Default 'medio'
// preserva el comportamiento histórico (Sonnet).
export const crearMensajeInputSchema = z.object({
  contenido: z.string().min(1).max(5000),
  adjuntos: z.array(adjuntoInputSchema).max(20).default([]),
  nivel: z.enum(NIVELES_MODELO).default(NIVEL_DEFAULT),
});
export type CrearMensajeInput = z.infer<typeof crearMensajeInputSchema>;
