// Tipos compartidos entre server y client para la feature "Mis casos".
// Reusan tipos definidos en schemas.ts donde aplica.

import type { Estrategia, RolEstrategia } from "./schemas";
import type { CategoriaEvento } from "./casos/categorias";
import type { Adjunto } from "./casos/adjuntos";

export type RolCaso = "defensor" | "querellante" | "ambos";
// `tipo` es el ORIGEN del evento (quién lo creó). NO confundir con la
// CATEGORÍA procesal (que vive en `categoria`). Ver MIGRATION_LOG.md
// entrada del 2026-05-07 PR1 para el mapeo.
export type TipoEvento = "manual" | "sistema" | "agente";
export type EstadoEvento = "sucedido" | "pendiente";

export type EventoCaso = {
  id: string;
  tipo: TipoEvento;
  categoria: CategoriaEvento | null;
  descripcion: string;
  ocurrido_en: string;
  estado: EstadoEvento;
  creado_en: string;
  adjuntos: Adjunto[];
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
