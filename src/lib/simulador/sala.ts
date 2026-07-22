// Elenco y disposición de la VISTA DE SALA del simulador.
//
// Módulo PURO (sin "server-only" / "use client"), igual que labels.ts: define
// QUIÉN puede estar en la sala, con qué color y en qué lugar. No parsea, no
// consulta y no sabe nada de turnos — eso vive en el view-model (M2+).
//
// Separación deliberada respecto de avatar-rol.tsx: acá va lo SEMÁNTICO (rol,
// etiqueta, color, asiento); allá va lo pictórico (piel, pelo, corbata). Así el
// avatar se puede reemplazar entero por pixel-art sin tocar este archivo.
//
// Paleta: la del mockup lexstrategy_sala.html (decisión de Mateo, 2026-07-22).
// El violeta queda reservado para el usuario — es el `--primary` de la marca y
// ya significa "vos" en las burbujas propias del transcript.

import type { RolUsuarioSimulacion } from "@/lib/types";

// Roles que el guion puede hacer hablar en la sala (guion-pp.md, "Roles").
// Coincide con el allowlist del parser de turno-sala.tsx.
export type RolSala =
  | "juez"
  | "secretario"
  | "fiscal"
  | "querellante"
  | "defensa"
  | "imputado"
  | "testigo"
  | "perito";

export type FichaRol = {
  // Nombre en la placa cuando NO hay un nombre propio del expediente. El guion
  // sí inventa nombres ("Dr. Martín Ulloa") pero viven dentro del texto del
  // turno, no en una columna: extraerlos es otro problema.
  nombre: string;
  // Función procesal, debajo del nombre.
  rol: string;
  // Nombre de la custom property CSS (definida en globals.css).
  colorVar: string;
};

export const ELENCO: Record<RolSala, FichaRol> = {
  juez: {
    nombre: "Juez de Garantías",
    rol: "Estrado",
    colorVar: "--el-sala-juez",
  },
  secretario: {
    nombre: "Secretaría",
    rol: "OGA",
    colorVar: "--el-sala-secretario",
  },
  fiscal: {
    nombre: "Agente Fiscal",
    rol: "Ministerio Público",
    colorVar: "--el-sala-fiscal",
  },
  querellante: {
    nombre: "Querella",
    rol: "Particular damnificado",
    colorVar: "--el-sala-querellante",
  },
  defensa: {
    nombre: "Defensa",
    rol: "Defensor técnico",
    colorVar: "--el-sala-defensa",
  },
  imputado: {
    nombre: "Imputado",
    rol: "Asistido por la defensa",
    colorVar: "--el-sala-imputado",
  },
  testigo: {
    nombre: "Testigo",
    rol: "Declarante",
    colorVar: "--el-sala-testigo",
  },
  perito: {
    nombre: "Perito",
    rol: "Auxiliar técnico",
    colorVar: "--el-sala-perito",
  },
};

export type Asiento = {
  rol: RolSala;
  // Posición en % dentro del escenario (el asiento se centra con
  // translate(-50%,-50%)). Valores del Apéndice A del brief.
  x: number;
  y: number;
  // Tamaño del marco. El juez es el más grande (preside); secretario,
  // querellante e imputado son los chicos.
  tam: "sm" | "md" | "lg";
  // El querellante solo se sienta si la causa lo tiene. Los testigos y peritos
  // no tienen asiento fijo: entran, declaran y se van.
  opcional?: boolean;
};

// Disposición de la sala. El ORDEN importa solo para el DOM; la posición la da
// x/y. Testigo y perito no figuran a propósito.
export const ASIENTOS: ReadonlyArray<Asiento> = [
  { rol: "juez", x: 50, y: 19, tam: "lg" },
  { rol: "secretario", x: 36, y: 31, tam: "sm" },
  { rol: "fiscal", x: 17.5, y: 67, tam: "md" },
  { rol: "querellante", x: 29, y: 71, tam: "sm", opcional: true },
  { rol: "defensa", x: 67, y: 67, tam: "md" },
  { rol: "imputado", x: 87, y: 70, tam: "sm" },
];

// Qué asiento ocupa el abogado según el rol que asumió al configurar la
// sesión. NO se puede hardcodear en "defensa": el simulador admite litigar
// como fiscal o como querellante, y en esos casos la defensa es un personaje
// más del modelo.
export const ASIENTO_DEL_USUARIO: Record<RolUsuarioSimulacion, RolSala> = {
  defensa: "defensa",
  fiscal: "fiscal",
  querellante: "querellante",
};

export const colorDe = (rol: RolSala): string => `var(${ELENCO[rol].colorVar})`;
