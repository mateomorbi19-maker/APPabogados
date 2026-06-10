// Tipos + validación del Mapa procesal (Fase 1).
import { z } from "zod";

export type TipoNodo = "raiz" | "real" | "prediccion";
export type EstadoNodo = "ocurrido" | "desbloqueado" | "bloqueado";

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
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// Fila para insertar la plantilla base. El id se pre-genera (crypto.randomUUID)
// para poder cablear padre_id entre nodos del mismo batch antes de insertar.
export interface NodoProcesalInsert {
  id: string;
  caso_id: string;
  titulo: string;
  descripcion: string | null;
  tipo: TipoNodo;
  estado: EstadoNodo;
  padre_id: string | null;
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
});
export type EditarNodoInput = z.infer<typeof editarNodoSchema>;
