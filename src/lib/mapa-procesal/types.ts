// Tipos + validación del Mapa procesal (Fase 1).
import { z } from "zod";

export type TipoNodo = "raiz" | "real" | "prediccion";
export type EstadoNodo = "ocurrido" | "desbloqueado" | "bloqueado";

// === Fuero (Fase A del rediseño fuero-aware) ===
// El fuero define qué plantilla procesal instancia el mapa. Se persiste en
// casos.fuero al inicializar (la IA lo sugiere, el abogado lo confirma).
export const FUEROS = ["nacion", "pba", "federal"] as const;
export type Fuero = (typeof FUEROS)[number];

export const FUERO_LABEL: Record<Fuero, string> = {
  nacion: "Nación (CPPN Ley 23.984)",
  pba: "Prov. Buenos Aires (CPP Ley 11.922)",
  federal: "Federal (CPPF Ley 27.063)",
};

// Reusable en el borde de las API routes.
export const fueroSchema = z.enum(FUEROS);

export interface NodoProcesalDB {
  id: string;
  caso_id: string;
  titulo: string;
  descripcion: string | null;
  tipo: TipoNodo;
  estado: EstadoNodo;
  padre_id: string | null;
  posicion_x: number;
  posicion_y: number;
  // Marca de "riesgo alto" (render rojo). Persiste en DB; toggleable desde el
  // panel de detalle. Default false.
  riesgo_alto: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// Fila para insertar la plantilla base. El id se pre-genera (crypto.randomUUID)
// para poder cablear padre_id entre nodos del mismo batch antes de insertar.
// Las posiciones vienen sembradas por dagre (Fase E: "memoria del mapa").
export interface NodoProcesalInsert {
  id: string;
  caso_id: string;
  titulo: string;
  descripcion: string | null;
  tipo: TipoNodo;
  estado: EstadoNodo;
  padre_id: string | null;
  riesgo_alto: boolean;
  posicion_x: number;
  posicion_y: number;
}

// === Validación de input (zod en el borde de las API routes) ===

export const crearNodoSchema = z.object({
  padre_id: z.string().uuid(),
  titulo: z.string().trim().min(1, "El título es obligatorio").max(200),
  descripcion: z.string().trim().max(2000).nullish(),
});
export type CrearNodoInput = z.infer<typeof crearNodoSchema>;

export const editarNodoSchema = z.object({
  titulo: z.string().trim().min(1).max(200).optional(),
  descripcion: z.string().trim().max(2000).nullish(),
  estado: z.enum(["ocurrido", "desbloqueado", "bloqueado"]).optional(),
  riesgo_alto: z.boolean().optional(),
  // Posición del nodo en el canvas (auto-guardado al arrastrar, Fase E).
  posicion_x: z.number().finite().optional(),
  posicion_y: z.number().finite().optional(),
});
export type EditarNodoInput = z.infer<typeof editarNodoSchema>;

// === Simulación de ramas con IA (Fase C) ===

// Input del POST /api/casos/[id]/mapa/simular.
export const simularInputSchema = z.object({
  nodo_id: z.string().uuid(),
});
export type SimularInput = z.infer<typeof simularInputSchema>;

// Output del modelo (validado post-parseo). Entre 2 y 5 ramas hijas.
export const ramasSimuladasSchema = z.object({
  ramas: z
    .array(
      z.object({
        titulo: z.string().trim().min(1).max(200),
        descripcion: z.string().trim().min(1).max(2000),
        riesgo_alto: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(5),
});
export type RamaSimulada = z.infer<typeof ramasSimuladasSchema>["ramas"][number];

// === Restauración (deshacer borrado) ===
// El cliente captura el subárbol ANTES de borrar y lo re-inserta con los
// MISMOS ids (el schema acepta UUIDs provistos — mismo patrón que la
// plantilla). La raíz jamás se restaura (no se puede borrar).
export const restaurarNodosSchema = z.object({
  nodos: z
    .array(
      z.object({
        id: z.string().uuid(),
        titulo: z.string().trim().min(1).max(200),
        descripcion: z.string().max(2000).nullable(),
        tipo: z.enum(["real", "prediccion"]),
        estado: z.enum(["ocurrido", "desbloqueado", "bloqueado"]),
        padre_id: z.string().uuid(),
        riesgo_alto: z.boolean(),
        posicion_x: z.number().finite(),
        posicion_y: z.number().finite(),
      }),
    )
    .min(1)
    .max(200),
});
export type RestaurarNodosInput = z.infer<typeof restaurarNodosSchema>;

// Batch de posiciones: siembra de mapas pre-Fase E y botón "Reordenar".
export const posicionesBatchSchema = z.object({
  posiciones: z
    .array(
      z.object({
        id: z.string().uuid(),
        posicion_x: z.number().finite(),
        posicion_y: z.number().finite(),
      }),
    )
    .min(1)
    .max(200),
});
export type PosicionesBatchInput = z.infer<typeof posicionesBatchSchema>;
