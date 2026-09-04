// Tipos del dominio de escritos judiciales. Módulo PURO (sin "server-only" ni
// "use client"): lo importan el cliente (los diálogos), el server (rutas y
// tools de LEXIE) y el script que genera el catálogo.
//
// === Dos orígenes de modelos, dos lugares donde viven ===
//
// Gonzalo lo pidió textual: "diferenciar por flujos el modelo de escrito que
// trajo el abogado del que nosotros cargamos". Eso acá es `origen`:
//
//   estudio  Los 50 modelos que redactó el estudio. Viven en un módulo
//            generado y versionado (catalogo-estudio.ts), igual que el
//            catálogo del Repositorio: entran en memoria de sobra, se
//            corrigen por git y no dependen de una migración. Son iguales
//            para los tres abogados y NO se editan desde la app.
//   abogado  Los que cada abogado carga con "Nuevo modelo". Viven en la tabla
//            `modelos_escrito` y sólo los ve su dueño.
//   lexie    Los que LEXIE redactó desde afuera del catálogo y el abogado le
//            pidió guardar. Misma tabla y misma visibilidad que `abogado`;
//            el origen distinto es para que se vea de dónde salió.
//
// Un modelo del estudio se identifica por su `slug` (estable, legible: la
// URL y LEXIE lo usan tal cual); uno de la tabla, por su UUID. `id` es lo uno
// o lo otro, y `esModeloDelEstudio()` es la única forma correcta de saber cuál.

export const CATEGORIAS_ESCRITO = [
  "actos_iniciales",
  "libertad_coercion",
  "prueba",
  "victima_querella",
  "nulidades_garantias",
  "salidas_alternativas",
  "juicio",
  "recursos",
  "ejecucion",
  "otro",
] as const;
export type CategoriaEscrito = (typeof CATEGORIAS_ESCRITO)[number];

export const CATEGORIA_ESCRITO_LABEL: Record<CategoriaEscrito, string> = {
  actos_iniciales: "Actos iniciales y constitución de partes",
  libertad_coercion: "Libertad y medidas de coerción",
  prueba: "Prueba e investigación",
  victima_querella: "Víctima y querella",
  nulidades_garantias: "Nulidades, excepciones y garantías",
  salidas_alternativas: "Salidas alternativas y resolución anticipada",
  juicio: "Etapa de juicio",
  recursos: "Recursos",
  ejecucion: "Ejecución de la pena",
  otro: "Otros",
};

export const ORIGENES_MODELO = ["estudio", "abogado", "lexie"] as const;
export type OrigenModelo = (typeof ORIGENES_MODELO)[number];

export const ORIGEN_MODELO_LABEL: Record<OrigenModelo, string> = {
  estudio: "Del estudio",
  abogado: "Propio",
  lexie: "Redactado por LEXIE",
};

// Para quién está pensado el modelo. Filtra el catálogo según el rol con el
// que el estudio actúa en la causa, y es lo primero que LEXIE mira al
// recomendar: una denuncia penal no es un escrito de la defensa.
export const ROLES_SUGERIDOS = ["defensor", "querellante", "ambos"] as const;
export type RolSugerido = (typeof ROLES_SUGERIDOS)[number];

export type ModeloEscrito = {
  /** Slug (modelo del estudio) o UUID (modelo de la tabla). */
  id: string;
  origen: OrigenModelo;
  /** 1..50 en los del estudio; null en los demás. */
  numero: number | null;
  categoria: CategoriaEscrito;
  titulo: string;
  /** La SUMA: el encabezado en mayúsculas ("SOLICITA EXCARCELACIÓN."). */
  suma: string;
  /** En qué momento procesal se presenta. */
  cuando: string | null;
  /** Normas que lo sostienen. Orientativas: se verifican contra el código vigente. */
  base_normativa: string | null;
  /** Cuerpo tipo, con placeholders {{ASI}} donde va el dato de la causa. */
  cuerpo: string;
  /** Recomendaciones prácticas del redactor. */
  claves: string | null;
  rol_sugerido: RolSugerido;
  /** Sólo los de la tabla. */
  creado_en: string | null;
};

/** Lo que ve el listado: el modelo sin el cuerpo, que es lo pesado. */
export type ModeloEscritoResumen = Omit<ModeloEscrito, "cuerpo">;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Slug del catálogo del estudio: minúsculas, dígitos y guiones. */
export const SLUG_MODELO_RE = /^[a-z0-9][a-z0-9-]{1,79}$/;

/** `true` si el id apunta al catálogo versionado y no a la tabla. */
export function esModeloDelEstudio(id: string): boolean {
  return !UUID_RE.test(id) && SLUG_MODELO_RE.test(id);
}

export function esUuid(id: string): boolean {
  return UUID_RE.test(id);
}

// === Escritos generados para una causa ===

export const ESTADOS_ESCRITO = ["borrador", "presentado"] as const;
export type EstadoEscrito = (typeof ESTADOS_ESCRITO)[number];

export const ESTADO_ESCRITO_LABEL: Record<EstadoEscrito, string> = {
  borrador: "Borrador",
  presentado: "Presentado",
};

/**
 * Un escrito ya redactado para una causa concreta. El texto vive en
 * `contenido` como markdown liviano (ver render.ts); el PDF se arma a pedido
 * a partir de ese texto, así que editarlo y volver a descargar no cuesta
 * tokens.
 */
export type EscritoGenerado = {
  id: string;
  caso_id: string;
  /** Slug o UUID del modelo con el que se generó. Null si el modelo se borró. */
  modelo_id: string | null;
  /** Nombre del modelo en el momento de generar: sobrevive al modelo. */
  modelo_titulo: string;
  titulo: string;
  contenido: string;
  /** Lo que el abogado pidió al generar, para saber después qué se le indicó al modelo. */
  instrucciones: string | null;
  estado: EstadoEscrito;
  /** Cuándo se marcó como presentado. */
  presentado_en: string | null;
  /** Fila de `ejecuciones` que lo generó, para el drill-down de consumo. */
  ejecucion_id: string | null;
  creado_en: string;
  actualizado_en: string;
};

/**
 * Lo que ve la lista de escritos de una causa: sin el texto, pero con cuántas
 * marcas [COMPLETAR] quedan, que es lo que decide si está listo para presentar.
 */
export type EscritoGeneradoLista = Omit<EscritoGenerado, "contenido"> & {
  pendientes: number;
};

/**
 * Marca que deja el redactor donde falta un dato que la ficha no tiene. Se
 * conserva LITERAL en el texto y en el PDF: el escrito sale firmado por el
 * abogado, así que un hueco visible es mejor que un dato verosímil inventado.
 * Es la misma regla que rige la ficha ("el campo vacío se muestra vacío").
 */
export const MARCA_COMPLETAR_RE = /\[COMPLETAR:[^\]]*\]/g;

export function contarPendientes(contenido: string): number {
  return contenido.match(MARCA_COMPLETAR_RE)?.length ?? 0;
}

// === Perfil profesional del abogado ===
//
// Lo que va en el encabezado de todo escrito y no cambia de una causa a otra.
// Vive en `usuarios` (migración 20260904120000); `nombre` y `email` NO están
// acá porque son el identificador lógico del sistema y los administra Clerk.
export type PerfilProfesional = {
  /** Cómo firma ("Dr. Mateo Morbiducci"). */
  nombre_completo: string | null;
  /** Tomo y folio como se escriben ("T° 123 F° 456 C.P.A.C.F."). */
  matricula: string | null;
  domicilio_constituido: string | null;
  domicilio_electronico: string | null;
};
