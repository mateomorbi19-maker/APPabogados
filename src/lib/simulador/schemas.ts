// Esquemas Zod del Simulador de Audiencias. Convenciones de
// src/lib/schemas.ts: validación en el borde de cada route, enums como
// allowlist, tipos inferidos exportados al lado del schema.
//
// Los valores de los enums replican los CHECK de las tablas
// (migración 20260721120000). Los union types equivalentes viven en
// src/lib/types.ts; el `satisfies` de cada enum falla el type-check si se
// desincronizan.
import { z } from "zod";
import type {
  DificultadSimulacion,
  MagistradoPerfil,
  RolUsuarioSimulacion,
} from "@/lib/types";

export const rolUsuarioSimulacionSchema = z.enum([
  "defensa",
  "fiscal",
  "querellante",
]) satisfies z.ZodType<RolUsuarioSimulacion>;

export const dificultadSimulacionSchema = z.enum([
  "a_guiada",
  "b_estandar",
  "c_adversarial",
]) satisfies z.ZodType<DificultadSimulacion>;

export const magistradoPerfilSchema = z.enum([
  "garantista",
  "restrictivo",
  "neutro",
]) satisfies z.ZodType<MagistradoPerfil>;

// === Inputs ===

// El `tipo_audiencia` NO se acepta del cliente: hoy hay uno solo
// ('prision_preventiva', default de la tabla). Cuando haya más, se suma acá
// como enum y se recrea el CHECK con una migración.
export const crearSimulacionInputSchema = z.object({
  rol_usuario: rolUsuarioSimulacionSchema,
  dificultad: dificultadSimulacionSchema.default("b_estandar"),
  magistrado_perfil: magistradoPerfilSchema.default("neutro"),
});
export type CrearSimulacionInput = z.infer<typeof crearSimulacionInputSchema>;

// Una intervención del abogado en la audiencia. El tope de 5000 es la misma
// cota que usa eventos_agenda.notas: generoso para un alegato, acotado para
// que un pegado accidental no infle el contexto de todos los turnos siguientes.
export const crearTurnoInputSchema = z.object({
  contenido: z
    .string()
    .trim()
    .min(1, "La intervención no puede estar vacía")
    .max(5000, "La intervención no puede superar los 5000 caracteres"),
});
export type CrearTurnoInput = z.infer<typeof crearTurnoInputSchema>;

// === Output del debriefing ===
// SIN jurisprudencia: el corpus no tiene fallos y el guion prohíbe citarlos
// (ver AUDIT-HEARSIM.md §4.1). No hay campo donde alojarlos y no se piden.

export const dimensionDebriefingSchema = z.object({
  nombre: z.string().min(1),
  puntaje: z.number().min(0).max(10),
  comentario: z.string().min(1),
});
export type DimensionDebriefing = z.infer<typeof dimensionDebriefingSchema>;

export const debriefingSchema = z.object({
  puntuacion_general: z.number().min(0).max(10),
  fidelidad_estrategia: z.number().min(0).max(10),
  dimensiones: z.array(dimensionDebriefingSchema).min(3).max(4),
  momentos_clave: z.array(z.string()).default([]),
  oportunidades_perdidas: z.array(z.string()).default([]),
  resultado_probable: z.string().min(1),
  proximos_pasos: z.array(z.string()).default([]),
});
export type Debriefing = z.infer<typeof debriefingSchema>;
