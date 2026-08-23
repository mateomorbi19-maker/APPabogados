// Tipos compartidos entre server y client para la feature "Mis casos".
// Reusan tipos definidos en schemas.ts donde aplica.

import type { Estrategia, RolEstrategia } from "./schemas";
import type { CategoriaEvento } from "./casos/categorias";
import type { Adjunto } from "./casos/adjuntos";
// `import type` se borra en compilación: no arrastra el zod de ese módulo al
// bundle del cliente, que es el motivo por el que `Fuero` no vivía acá.
import type { Fuero } from "./mapa-procesal/types";

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

// === Simulador de Audiencias (HearSim) ===
// Espejo de las tablas `simulaciones_audiencia` y `turnos_simulacion`
// (migración 20260721120000). Los union types replican los CHECK
// constraints: si se agrega un valor allá, hay que agregarlo acá.

export type TipoAudiencia = "prision_preventiva";
// Rol que asume el abogado usuario DENTRO de la simulación. No es `RolCaso`:
// aquel es la perspectiva del análisis y admite 'ambos' pero no 'fiscal'.
export type RolUsuarioSimulacion = "defensa" | "fiscal" | "querellante";
export type DificultadSimulacion = "a_guiada" | "b_estandar" | "c_adversarial";
export type MagistradoPerfil = "garantista" | "restrictivo" | "neutro";
export type EstadoSimulacion = "en_curso" | "finalizada" | "abandonada";
export type EmisorTurno =
  | "usuario"
  | "juez"
  | "secretario"
  | "fiscal"
  | "querellante"
  | "defensor"
  | "imputado"
  | "testigo"
  | "perito"
  | "sistema";

export type SimulacionAudiencia = {
  id: string;
  caso_id: string;
  tipo_audiencia: TipoAudiencia;
  rol_usuario: RolUsuarioSimulacion;
  dificultad: DificultadSimulacion;
  magistrado_perfil: MagistradoPerfil;
  estado: EstadoSimulacion;
  // Devolución post-audiencia. NULL mientras estado='en_curso'.
  debriefing: Record<string, unknown> | null;
  creada_en: string;
  actualizada_en: string;
  finalizada_en: string | null;
};

export type TurnoSimulacion = {
  id: string;
  simulacion_id: string;
  emisor: EmisorTurno;
  // Nombre del personaje cuando `emisor` no lo identifica solo (ej: varios
  // testigos en la misma audiencia).
  emisor_nombre: string | null;
  contenido: string;
  // Datos propios del turno (fase, objeciones, scoring parcial). A diferencia
  // de MensajeConversacion, acá el turno tiene su propio jsonb.
  metadata: Record<string, unknown>;
  ejecucion_id: string | null;
  creado_en: string;
};

// Valores admitidos por el CHECK de `ejecuciones.tipo` (migración
// 20260721120000). Hasta ahora el repo no declaraba esta unión en ningún
// lado: `tipo` viaja como `string` en las filas leídas de la DB (ver
// admin/types.ts, hooks/use-consumo.tsx). Se declara acá para que el tipo
// nuevo tenga un lugar canónico; las filas siguen tipadas como `string`
// porque la DB puede devolver valores previos a cualquier CHECK.
export type TipoEjecucion =
  | "pre_analisis"
  | "analizar_caso"
  | "consulta_caso"
  | "simular_mapa"
  | "simular_audiencia"
  | "lexie";

// === Ficha de causa (Fase 9) ===

// El estado de la causa PARA EL ESTUDIO. No confundir con la ETAPA PROCESAL
// (instrucción, juicio, recursos…), que no se persiste: la deriva el mapa
// procesal del nodo `ocurrido` más profundo. En el mockup son los dos badges
// de la cabecera y es la confusión más fácil de cometer.
export type EstadoSeguimiento = "activa" | "en_espera" | "archivada";

// Rol PROCESAL de la persona. Es ortogonal a `es_cliente`: nuestro cliente
// puede ser el imputado (defensa) o la víctima (querella).
export type RolParte =
  | "imputado"
  | "victima"
  | "querellante"
  | "denunciante"
  | "testigo"
  | "otro";

// Solo tiene sentido para imputados; `null` para el resto.
export type SituacionLibertad =
  | "libre"
  | "detenido"
  | "prision_preventiva"
  | "prision_domiciliaria"
  | "excarcelado";

export type ParteCaso = {
  id: string;
  caso_id: string;
  nombre: string;
  rol: RolParte;
  es_cliente: boolean;
  situacion_libertad: SituacionLibertad | null;
  creado_en: string;
};

export type Caso = {
  id: string;
  usuario_id: string;
  // Nombre de trabajo. Hoy lo siembra `sugerirTitulo()` con los primeros 60
  // chars del relato, así que en 4 de 8 causas es un pedazo de texto. NO se
  // pisa con la carátula: conviven, y `nombreCaso()` decide cuál se muestra.
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
  // Lo escribe el mapa procesal al inicializarse, y desde la ficha (F3).
  fuero: Fuero | null;
  // --- Ficha. Todo nullable a propósito: el campo que falta se muestra
  // VACÍO con opción de cargarlo, nunca relleno con un valor verosímil.
  caratula: string | null;
  expediente_numero: string | null;
  organismo: string | null;
  secretaria: string | null;
  juez: string | null;
  fiscalia: string | null;
  delitos: string[] | null;
  estado_seguimiento: EstadoSeguimiento;
};

// Subconjunto que alcanza para nombrar una causa en un header o un breadcrumb.
// Lo consumen las vistas inmersivas (mapa, simulador, chat) y la agenda, que
// no necesitan el expediente entero para escribir el título de la pantalla.
export type CasoNombrable = Pick<Caso, "id" | "titulo" | "caratula">;

export type CasoConEventos = Caso & {
  eventos: EventoCaso[];
};
