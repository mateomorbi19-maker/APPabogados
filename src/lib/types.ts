// Tipos compartidos entre server y client para la feature "Mis casos".
// Reusan tipos definidos en schemas.ts donde aplica.

import type { Estrategia, RolEstrategia } from "./schemas";
import type { CategoriaEvento } from "./casos/categorias";
import type { Adjunto } from "./casos/adjuntos";

export type RolCaso = "defensor" | "querellante" | "ambos";
// `tipo` es el ORIGEN del evento (quién lo creó). NO confundir con la
// CATEGORÍA procesal (que vive en `categoria`). El antiguo valor
// `'agente'` se removió en el PR4 sub-PR2 cuando el chat con el agente
// pasó a tablas dedicadas (conversaciones_caso + mensajes_conversacion);
// el timeline solo lleva eventos creados por el abogado o por el server.
export type TipoEvento = "manual" | "sistema";
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

// === Chat persistente con el agente (PR4 sub-PR2) ===

export type EstadoConversacion = "activa" | "archivada";
export type RolMensaje = "usuario" | "agente";

export type Conversacion = {
  id: string;
  caso_id: string;
  titulo: string;
  estado: EstadoConversacion;
  creada_en: string;
  actualizada_en: string;
  archivada_en: string | null;
};

export type MensajeConversacion = {
  id: string;
  conversacion_id: string;
  rol: RolMensaje;
  contenido: string;
  adjuntos: Adjunto[];
  // Solo poblado cuando rol='agente': JSON parseado de la respuesta
  // (analisis + recomendaciones + busquedas + degraded_response).
  respuesta_estructurada: Record<string, unknown> | null;
  ejecucion_id: string | null;
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
