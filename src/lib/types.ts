// Tipos compartidos entre server y client para la feature "Mis casos".
// Reusan tipos definidos en schemas.ts donde aplica.

import type { Estrategia, RolEstrategia } from "./schemas";

export type RolCaso = "defensor" | "querellante" | "ambos";
export type TipoEvento = "manual" | "sistema" | "agente";
export type EstadoEvento = "sucedido" | "pendiente";

export type EventoCaso = {
  id: string;
  tipo: TipoEvento;
  descripcion: string;
  ocurrido_en: string;
  estado: EstadoEvento;
  creado_en: string;
};

export type Caso = {
  id: string;
  usuario_id: string;
  titulo: string;
  caso_descripcion: string;
  contexto: Record<string, unknown> | null;
  rol: RolCaso;
  ejecucion_origen_id: string | null;
  estrategia_seleccionada_rol: RolEstrategia;
  estrategia_seleccionada_idx: number;
  estrategia_snapshot: Estrategia;
  creado_en: string;
  actualizado_en: string;
};

export type CasoConEventos = Caso & {
  eventos: EventoCaso[];
};
