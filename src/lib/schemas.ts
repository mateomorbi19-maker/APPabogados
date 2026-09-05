import { z } from "zod";
import { CATEGORIAS_EVENTO } from "@/lib/casos/categorias";
import { MIME_TYPES_PERMITIDOS } from "@/lib/casos/adjuntos";
import { NIVELES_MODELO, NIVEL_DEFAULT } from "@/lib/agent/modelos";
import { CATEGORIAS_ESCRITO, ROLES_SUGERIDOS } from "@/lib/escritos/types";

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
  // Autorización explícita del abogado para que el agente funde las estrategias
  // en el Repositorio interno del estudio (jurisprudencia y doctrina). Default
  // false: el material del estudio se usa cuando el abogado lo decide, no por
  // omisión. El formulario lo ofrece marcado, pero la decisión viaja igual.
  usar_repositorio: z.boolean().default(false),
});
export type AnalizarCasoInput = z.infer<typeof analizarCasoInputSchema>;

// Tipo de pregunta del pre-análisis. Solo hay dos, y ninguno es de respuesta
// única: "opciones" siempre es multi-selección (más un campo "Otro" que agrega
// el formulario, no el modelo) y "texto" es respuesta libre.
//
// El preprocess mapea los cuatro tipos del modelo viejo (select/radio/checkbox/
// text) para que las ejecuciones ya guardadas en `ejecuciones.metadata` sigan
// abriéndose en el historial. Es traducción de lectura: el prompt actual solo
// emite los dos nuevos.
export const tipoPreguntaSchema = z.preprocess((v) => {
  if (v === "select" || v === "radio" || v === "checkbox") return "opciones";
  if (v === "text") return "texto";
  return v;
}, z.enum(["opciones", "texto"]));
export type TipoPregunta = z.infer<typeof tipoPreguntaSchema>;

export const preguntaSchema = z.object({
  id: z.string(),
  tipo: tipoPreguntaSchema,
  label: z.string(),
  opciones: z.array(z.string()).optional(),
  valor_sugerido: z.union([z.string(), z.null()]).optional(),
  requerido: z.boolean(),
  /** El propósito diagnóstico: qué cambia en la estrategia según la respuesta. */
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
  // SIN piso: el protocolo de nudos de diagnóstico dice que si el relato ya
  // alcanza para diagnosticar no se pregunta nada, y un array vacío es
  // exactamente ese resultado — no una respuesta degenerada. El formulario sabe
  // renderizarse sin preguntas.
  //
  // El techo del contrato es 8 (vive en el prompt); .max(15) es un margen
  // defensivo contra un modelo desbocado y, de paso, deja seguir abriendo en el
  // historial las ejecuciones del modelo viejo, que llegaban a 12.
  preguntas: z.array(preguntaSchema).max(15),
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

// Cita al Repositorio interno del estudio dentro de una estrategia. El
// `documento_id` es el slug del catálogo, así que el UI puede linkear a
// /dashboard/repositorio/<id> y el abogado verifica el fallo en un click —
// que es lo que distingue esto de una cita de memoria del modelo.
export const citaRepositorioSchema = z.object({
  documento_id: z.string().default(""),
  /** Cita ya formateada por el servidor al devolver el resultado de la tool. */
  cita: z.string().min(1),
  tipo: z.enum(["fallo", "doctrina"]).default("fallo"),
  /** La regla que el documento sienta, en las palabras del propio documento. */
  holding: z.string().default(""),
  /** Qué le aporta a ESTA estrategia en particular. */
  aporte: z.string().default(""),
});
export type CitaRepositorio = z.infer<typeof citaRepositorioSchema>;

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
  // Precedentes del Repositorio interno que respaldan esta estrategia. Vacío
  // cuando el abogado no autorizó el repositorio, o cuando lo autorizó y no hay
  // nada con ratio aplicable — que es un resultado legítimo y no una falla.
  jurisprudencia_aplicable: z.array(citaRepositorioSchema).default([]),
  // Se completa SÓLO cuando `jurisprudencia_aplicable` queda vacía: la frase
  // que explica que no se recuperaron fallos con ratio directamente aplicable.
  // Está separada del array para que el UI pueda distinguir "no se buscó" de
  // "se buscó y no había".
  nota_jurisprudencia: z.string().default(""),
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

// Registro de cada consulta al Repositorio interno, espejo de `busquedaSchema`
// para el RAG normativo. Se persiste en metadata para poder medir si el agente
// encuentra precedentes o busca al vacío.
export const fuenteRepositorioSchema = z.object({
  documento_id: z.string(),
  cita: z.string(),
  tipo: z.enum(["fallo", "doctrina"]),
});
export type FuenteRepositorio = z.infer<typeof fuenteRepositorioSchema>;

export const consultaRepositorioSchema = z.object({
  consulta: z.string(),
  coleccion: z.enum(["jurisprudencia", "doctrina"]).nullable(),
  documentos_devueltos: z.number(),
  similitud_top: z.number().nullable(),
  documento_ids: z.array(z.string()).default([]),
  documentos: z.array(fuenteRepositorioSchema).default([]),
});
export type ConsultaRepositorioRegistro = z.infer<
  typeof consultaRepositorioSchema
>;

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
  // Consultas al Repositorio interno. Array vacío cuando el abogado no lo
  // autorizó; el cliente lo usa para distinguir "no se consultó" de
  // "se consultó y no había nada aplicable".
  consultas_repositorio: z.array(consultaRepositorioSchema).default([]),
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
  // Ficha (F4). Opcionales: el paso de creación los OFRECE porque es el único
  // momento en que el abogado tiene el expediente delante, pero no los exige
  // —una causa se puede abrir desde el celular con el relato y nada más.
  caratula: fichaTextoOpcional(500),
  expediente_numero: fichaTextoOpcional(120),
});
export type CrearCasoInput = z.infer<typeof crearCasoInputSchema>;

// === Ficha de causa (Fase 9) ===

// Los campos de la ficha son texto libre que después sale impreso en un
// escrito o en un mensaje al cliente, así que se normalizan en el borde:
// se recorta el espacio y la cadena vacía se guarda como NULL, no como "".
// Sin eso, un input que se abre y se cierra sin escribir dejaría `caratula`
// en "" y `nombreCaso()` tendría que defenderse de una causa llamada "".
function fichaTextoOpcional(max: number) {
  return z
    .string()
    .max(max)
    .transform((v) => {
      const t = v.trim();
      return t.length > 0 ? t : null;
    })
    .nullable()
    .optional();
}

export const estadoSeguimientoSchema = z.enum([
  "activa",
  "en_espera",
  "archivada",
]);

export const rolParteSchema = z.enum([
  "imputado",
  "victima",
  "querellante",
  "denunciante",
  "testigo",
  "otro",
]);

export const situacionLibertadSchema = z.enum([
  "libre",
  "detenido",
  "prision_preventiva",
  "prision_domiciliaria",
  "excarcelado",
]);

// PATCH del caso. TODO opcional: el formulario manda solo lo que cambió, y
// `.strict()` para que un campo de más sea un 400 explícito y no algo que se
// ignora en silencio.
//
// ⚠️ Este schema NO es la lista blanca de escritura. La lista blanca vive en
// el handler, que enumera las columnas a mano. Derramar `parsed.data` en el
// UPDATE haría que agregar un campo acá alcance para poder mover
// `usuario_id` o `estrategia_snapshot`.
export const editarCasoInputSchema = z
  .object({
    caratula: fichaTextoOpcional(500),
    expediente_numero: fichaTextoOpcional(120),
    organismo: fichaTextoOpcional(300),
    secretaria: fichaTextoOpcional(200),
    juez: fichaTextoOpcional(200),
    fiscalia: fichaTextoOpcional(300),
    // Se normaliza acá y no en el UI: recorta, descarta vacíos, deduplica
    // (ignorando mayúsculas) y topea en 20. Un array vacío se guarda como
    // NULL para que "sin delitos cargados" sea un solo valor y no dos.
    delitos: z
      .array(z.string().max(200))
      .max(20)
      .transform((arr) => {
        const vistos = new Set<string>();
        const out: string[] = [];
        for (const d of arr) {
          const t = d.trim();
          if (!t) continue;
          const k = t.toLowerCase();
          if (vistos.has(k)) continue;
          vistos.add(k);
          out.push(t);
        }
        return out.length > 0 ? out : null;
      })
      .nullable()
      .optional(),
    estado_seguimiento: estadoSeguimientoSchema.optional(),
    // El fuero pasa a ser editable desde la ficha. Hasta ahora lo escribía
    // SOLO el mapa procesal al inicializarse.
    fuero: z.enum(["nacion", "pba", "federal"]).nullable().optional(),
    // El título de trabajo sigue siendo editable: es lo que ve el abogado
    // mientras no cargue la carátula, y hasta la Fase 9 era inmutable.
    //
    // El `.trim()` va ANTES del `.min(1)`: sin eso, "   " pasaba la validación
    // y llegaba al UPDATE, donde el handler lo recortaba y guardaba "" en una
    // columna NOT NULL — o sea una causa sin nombre visible, con 200 OK.
    titulo: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type EditarCasoInput = z.infer<typeof editarCasoInputSchema>;

export const crearParteInputSchema = z.object({
  nombre: z.string().min(1).max(300),
  rol: rolParteSchema,
  es_cliente: z.boolean().default(false),
  situacion_libertad: situacionLibertadSchema.nullable().optional(),
  // DNI u otro documento, texto libre (Fase 10, escritos). Misma
  // normalización que la ficha: "" se guarda como NULL.
  documento: fichaTextoOpcional(80),
});
export type CrearParteInput = z.infer<typeof crearParteInputSchema>;

export const editarParteInputSchema = z
  .object({
    nombre: z.string().min(1).max(300).optional(),
    rol: rolParteSchema.optional(),
    es_cliente: z.boolean().optional(),
    situacion_libertad: situacionLibertadSchema.nullable().optional(),
    documento: fichaTextoOpcional(80),
  })
  .strict();
export type EditarParteInput = z.infer<typeof editarParteInputSchema>;

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

// === Acciones del agente sobre el mapa procesal (chat ↔ mapa) ===
//
// Registro de lo que el agente EFECTIVAMENTE hizo (o intentó hacer) sobre el
// mapa durante un turno del chat. Lo arma el SERVIDOR a partir de las tool
// calls reales — NO viene en el JSON que emite el modelo. Dos motivos:
//   (a) el modelo no puede mentir sobre lo que ejecutó, y
//   (b) el contrato JSON de salida (que es frágil y ya tiene dos modos) no se
//       toca.
// Los rechazos por incoherencia también entran acá, con ok=false: son parte
// del valor de la feature (el abogado tiene que ver qué se frenó y por qué).
export const accionMapaSchema = z.object({
  accion: z.enum([
    "crear",
    "editar",
    "eliminar",
    "marcar_ocurrido",
    "simular",
  ]),
  ok: z.boolean(),
  // uuid completo del nodo afectado (o del padre, en 'crear' rechazado).
  nodo_id: z.string().nullable().default(null),
  titulo: z.string().nullable().default(null),
  advertencias: z.array(z.string()).default([]),
  // Solo en rechazos: por qué no se ejecutó, qué regla lo frenó y qué hacer.
  motivo: z.string().optional(),
  regla: z.string().optional(),
  sugerencia: z.string().optional(),
  // true cuando el rechazo se levanta si el abogado confirma (el modelo debe
  // volver a llamar la tool con confirmar: true).
  requiere_confirmacion: z.boolean().optional(),
  // Solo en 'simular': las ramas que se insertaron.
  creados: z
    .array(z.object({ id: z.string(), titulo: z.string() }))
    .optional(),
});
export type AccionMapa = z.infer<typeof accionMapaSchema>;

// === Acciones de LEXIE (Fase 11) ===
//
// Misma idea que `accionMapaSchema` pero agnóstica del dominio: sirve para un
// evento creado, un correo enviado, una ficha editada o un escrito generado.
// Se persiste en `mensajes_lexie.metadata.acciones` y en `ejecuciones.metadata`;
// el cliente la valida al pintar la tarjeta. La forma canónica y las reglas
// viven en src/lib/lexie/acciones.ts (módulo puro); acá va sólo la validación
// del borde. `.passthrough()` en `datos`/`vista_previa`/`payload` a propósito:
// cada tool decide qué guarda ahí, y Zod haría strip de lo que no declare.
const registroLaxoSchema = z.record(z.string(), z.unknown());
export const accionLexieSchema = z.object({
  tool: z.string().min(1).max(80),
  estado: z.enum([
    "ok",
    "rechazada",
    "pendiente",
    "en_curso",
    "descartada",
    "error",
  ]),
  clave: z.string().min(1).max(120).optional(),
  resumen: z.string().max(600),
  seccion: z.enum(["agenda", "bandeja", "causa", "escritos", "modelos"]).optional(),
  motivo: z.string().optional(),
  sugerencia: z.string().optional(),
  vista_previa: registroLaxoSchema.optional(),
  payload: registroLaxoSchema.optional(),
  datos: registroLaxoSchema.optional(),
  antes: registroLaxoSchema.optional(),
  confirmado_por: z.enum(["click", "texto"]).optional(),
  error: z.string().optional(),
});
export type AccionLexieValidada = z.infer<typeof accionLexieSchema>;

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
  // Acciones sobre el mapa procesal ejecutadas en este turno. Zod hace strip
  // de las claves que no declara, así que sin esta línea la UI nunca las vería
  // aunque el server las persista.
  acciones: z.array(accionMapaSchema).optional(),
  // Documentos del Repositorio que el agente CONSULTÓ en este turno. Lo arma el
  // servidor con lo que la búsqueda devolvió de verdad — el modelo no puede
  // agregar una fuente que no existe. Ojo: consultados, no necesariamente
  // usados; el label de la UI lo dice así.
  fuentes_repositorio: z.array(fuenteRepositorioSchema).optional(),
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
  acciones: z.array(accionMapaSchema).optional(),
  // Documentos del Repositorio que el agente CONSULTÓ en este turno. Lo arma el
  // servidor con lo que la búsqueda devolvió de verdad — el modelo no puede
  // agregar una fuente que no existe. Ojo: consultados, no necesariamente
  // usados; el label de la UI lo dice así.
  fuentes_repositorio: z.array(fuenteRepositorioSchema).optional(),
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

// === Escritos judiciales (Fase 10) ===

// Un modelo de escrito PROPIO del abogado. Los del estudio no pasan por acá:
// viven en código y no se editan desde la app.
export const modeloEscritoInputSchema = z
  .object({
    categoria: z.enum(CATEGORIAS_ESCRITO).default("otro"),
    titulo: z.string().trim().min(3).max(200),
    suma: z.string().trim().min(3).max(300),
    cuando: fichaTextoOpcional(500),
    base_normativa: fichaTextoOpcional(1000),
    // El cuerpo tipo. 20.000 caracteres son unas seis páginas: más que eso es
    // un escrito entero pegado como modelo, que igual sirve.
    cuerpo: z.string().trim().min(20).max(20000),
    claves: fichaTextoOpcional(1000),
    rol_sugerido: z.enum(ROLES_SUGERIDOS).default("ambos"),
  })
  .strict();
export type ModeloEscritoInput = z.infer<typeof modeloEscritoInputSchema>;

export const editarModeloEscritoInputSchema = z
  .object({
    categoria: z.enum(CATEGORIAS_ESCRITO).optional(),
    titulo: z.string().trim().min(3).max(200).optional(),
    suma: z.string().trim().min(3).max(300).optional(),
    cuando: fichaTextoOpcional(500),
    base_normativa: fichaTextoOpcional(1000),
    cuerpo: z.string().trim().min(20).max(20000).optional(),
    claves: fichaTextoOpcional(1000),
    rol_sugerido: z.enum(ROLES_SUGERIDOS).optional(),
  })
  .strict();
export type EditarModeloEscritoInput = z.infer<
  typeof editarModeloEscritoInputSchema
>;

// Generar un escrito para una causa. `modelo_id` es slug del catálogo o UUID
// de un modelo propio; el server resuelve cuál y verifica propiedad.
export const generarEscritoInputSchema = z
  .object({
    modelo_id: z.string().trim().min(1).max(120),
    instrucciones: fichaTextoOpcional(4000),
    nivel: z.enum(NIVELES_MODELO).default(NIVEL_DEFAULT),
  })
  .strict();
export type GenerarEscritoInput = z.infer<typeof generarEscritoInputSchema>;

// Editar un escrito generado: el abogado corrige el texto antes de presentar.
export const editarEscritoInputSchema = z
  .object({
    titulo: z.string().trim().min(1).max(300).optional(),
    contenido: z.string().min(1).max(200000).optional(),
  })
  .strict();
export type EditarEscritoInput = z.infer<typeof editarEscritoInputSchema>;

// Perfil profesional del abogado (usuarios). Todo opcional y anulable: el
// formulario manda sólo lo que cambió, y "" se guarda como NULL.
export const perfilProfesionalInputSchema = z
  .object({
    nombre_completo: fichaTextoOpcional(200),
    matricula: fichaTextoOpcional(120),
    domicilio_constituido: fichaTextoOpcional(300),
    domicilio_electronico: fichaTextoOpcional(120),
  })
  .strict();
export type PerfilProfesionalInput = z.infer<typeof perfilProfesionalInputSchema>;
