import { z } from "zod";
import { estadoSeguimientoSchema, rolParteSchema, situacionLibertadSchema } from "@/lib/schemas";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGINAS = 100;
export const MAX_TEXTO_CARGA = 50_000;

const textoNullable = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable().default(null);
export const parteCargaSchema = z.object({
  nombre: z.string().trim().min(1, "Completá el nombre de la persona").max(300),
  rol: rolParteSchema,
  es_cliente: z.boolean().default(false),
  situacion_libertad: situacionLibertadSchema.nullable().default(null),
  documento: textoNullable(80),
}).strict().refine((p) => p.rol === "imputado" || p.situacion_libertad === null, {
  message: "La situación de libertad corresponde únicamente a imputados", path: ["situacion_libertad"],
});

// Mismo contrato para el modelo y la revisión; nunca acepta claves de control.
export const fichaCargaSchema = z.object({
  titulo: z.string().trim().max(500),
  caso_descripcion: z.string().trim().max(MAX_TEXTO_CARGA),
  rol: z.enum(["defensor", "querellante", "ambos"]).nullable().default(null),
  caratula: textoNullable(500),
  expediente_numero: textoNullable(120),
  organismo: textoNullable(300),
  secretaria: textoNullable(200),
  juez: textoNullable(200),
  fiscalia: textoNullable(300),
  delitos: z.array(z.string().trim().max(200)).max(20).default([]).transform((ds) => {
    const vistos = new Set<string>();
    return ds.filter((d) => {
      if (!d || vistos.has(d.toLocaleLowerCase("es-AR"))) return false;
      vistos.add(d.toLocaleLowerCase("es-AR"));
      return true;
    });
  }),
  fuero: z.enum(["nacion", "pba", "federal"]).nullable().default(null),
  estado_seguimiento: estadoSeguimientoSchema.default("activa"),
  partes: z.array(parteCargaSchema).max(40).default([]),
}).strict();
export type FichaCarga = z.infer<typeof fichaCargaSchema>;

export const guardarCargaSchema = z.object({
  id: z.string().uuid(),
  ficha: fichaCargaSchema.superRefine((f, ctx) => {
    if (!f.titulo) ctx.addIssue({ code: "custom", path: ["titulo"], message: "Completá el título de la causa" });
    if (!f.caso_descripcion) ctx.addIssue({ code: "custom", path: ["caso_descripcion"], message: "Completá los antecedentes de la causa" });
    if (!f.rol) ctx.addIssue({ code: "custom", path: ["rol"], message: "Elegí tu rol en la causa" });
    const nombres = new Set<string>();
    f.partes.forEach((p, i) => {
      const clave = p.nombre.toLocaleLowerCase("es-AR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (nombres.has(clave)) ctx.addIssue({ code: "custom", path: ["partes", i, "nombre"], message: "Esta persona está repetida; revisá la lista" });
      nombres.add(clave);
    });
  }),
}).strict();
export type GuardarCarga = z.infer<typeof guardarCargaSchema>;

export const salidaCargaSchema = z.object({
  ficha: fichaCargaSchema,
  advertencias: z.array(z.string().trim().min(1).max(1000)).max(30).default([]),
}).strict();

export function parsearFichaExtraida(texto: string): z.infer<typeof salidaCargaSchema> {
  // Sólo quitar fences: reparar JSON truncado podría convertir un expediente
  // incompleto en una extracción aparentemente correcta.
  const limpio = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return salidaCargaSchema.parse(JSON.parse(limpio));
}
