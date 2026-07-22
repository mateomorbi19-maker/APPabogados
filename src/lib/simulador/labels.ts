// Etiquetas de UI del Simulador de Audiencias. Módulo PURO (sin
// "server-only" / "use client"): lo importan los componentes cliente y, si
// hiciera falta, el server.
//
// NO confundir con las etiquetas de src/lib/simulador/contexto.ts: aquellas
// van dentro del prompt y describen el rol para el modelo ("Defensa (defensor
// del imputado)"); estas son para el abogado, en la pantalla.

import type {
  DificultadSimulacion,
  EstadoSimulacion,
  MagistradoPerfil,
  RolUsuarioSimulacion,
  TipoAudiencia,
} from "@/lib/types";

// Pie del encabezado de la escena. El fuero es fijo mientras el guion sea solo
// CPP PBA (ver FUERO_SOPORTADO en la página del simulador).
export const TIPO_AUDIENCIA_LABEL: Record<TipoAudiencia, string> = {
  prision_preventiva:
    "Audiencia de prisión preventiva · CPP Buenos Aires (Ley 11.922)",
};

export type OpcionConfig<T extends string> = {
  value: T;
  label: string;
  descripcion: string;
};

export const ROLES_USUARIO: ReadonlyArray<OpcionConfig<RolUsuarioSimulacion>> = [
  {
    value: "defensa",
    label: "Defensa",
    descripcion: "Litigás por el imputado contra el pedido de prisión preventiva.",
  },
  {
    value: "fiscal",
    label: "Fiscal",
    descripcion: "Fundamentás el pedido de coerción como Agente Fiscal.",
  },
  {
    value: "querellante",
    label: "Querellante",
    descripcion: "Representás a la víctima y acompañás o ampliás la acusación.",
  },
];

export const DIFICULTADES: ReadonlyArray<OpcionConfig<DificultadSimulacion>> = [
  {
    value: "a_guiada",
    label: "Guiada",
    descripcion:
      "La sala te da orientaciones sutiles basadas en tu estrategia, sin resolver por vos.",
  },
  {
    value: "b_estandar",
    label: "Estándar",
    descripcion: "Sin ayudas. Juez y fiscal realistas, como una audiencia común.",
  },
  {
    value: "c_adversarial",
    label: "Adversarial",
    descripcion:
      "El fiscal explota los puntos críticos reales del caso y aparecen incidentes.",
  },
];

export const MAGISTRADOS: ReadonlyArray<OpcionConfig<MagistradoPerfil>> = [
  {
    value: "garantista",
    label: "Garantista",
    descripcion:
      "Exige fundamento concreto para toda restricción. Escéptico ante la preventiva.",
  },
  {
    value: "neutro",
    label: "Neutro",
    descripcion: "Equilibrado. Resuelve con base estrictamente normativa.",
  },
  {
    value: "restrictivo",
    label: "Restrictivo",
    descripcion:
      "Proclive a acompañar a la acusación. Le exige prueba concreta a la defensa.",
  },
];

export const ESTADO_SIMULACION_LABEL: Record<EstadoSimulacion, string> = {
  en_curso: "En curso",
  finalizada: "Finalizada",
  abandonada: "Abandonada",
};

// Cómo se rotula al usuario en el transcript, según el rol que asumió.
export const ROL_USUARIO_EN_SALA: Record<RolUsuarioSimulacion, string> = {
  defensa: "Vos (Defensa)",
  fiscal: "Vos (Agente Fiscal)",
  querellante: "Vos (Querellante)",
};

export function labelDe<T extends string>(
  opciones: ReadonlyArray<OpcionConfig<T>>,
  value: T,
): string {
  return opciones.find((o) => o.value === value)?.label ?? value;
}
