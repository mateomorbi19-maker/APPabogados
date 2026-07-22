// Armado del CONTENIDO DE SISTEMA de una sesión del Simulador de Audiencias.
//
// El guion vive en un .md aparte (guion-pp.md) y NO en un string TS: es
// contenido legal provisional que se reemplaza entero cuando llegue la versión
// validada por el Dr. Gonzalo. Swappear un archivo es más barato y más
// auditable que editar un template literal.
//
// El system se arma concatenando 4 bloques, en este orden:
//   1. el guion (THÉMIS, reglas de la audiencia, artículos habilitados)
//   2. ## CONFIGURACIÓN DE LA SESIÓN  (rol del usuario, dificultad, magistrado)
//   3. ## CONTEXTO DEL CASO           (reusa buildContextoCaso — no se reimplementa)
//   4. ## ESTRATEGIA FORMULADA        (lo que el bloque 3 NO trae — ver nota abajo)
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { buildContextoCaso } from "@/lib/casos/build-contexto-caso";
import { createServerClient } from "@/lib/supabase/server";
import type {
  DificultadSimulacion,
  MagistradoPerfil,
  RolUsuarioSimulacion,
} from "@/lib/types";

// Ruta relativa a la raíz del proyecto. En `output: 'standalone'` el archivo
// se copia con esta misma ruta dentro de .next/standalone gracias a
// `outputFileTracingIncludes` en next.config.ts (Next no puede trazar un
// readFileSync dinámico por sí solo).
const GUION_PATH = "src/lib/simulador/guion-pp.md";

// El .md se lee una sola vez por proceso: es inmutable en runtime y se
// reinyecta en CADA turno de CADA sesión.
let guionCache: string | null = null;

export function cargarGuion(): string {
  if (guionCache !== null) return guionCache;
  const abs = path.join(process.cwd(), GUION_PATH);
  try {
    guionCache = fs.readFileSync(abs, "utf8");
  } catch (e) {
    throw new Error(
      `No se pudo leer el guion del simulador en ${abs}. ` +
        `Si esto pasa en el deploy, revisá outputFileTracingIncludes en ` +
        `next.config.ts. Causa: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return guionCache;
}

export const LABEL_ROL_USUARIO: Record<RolUsuarioSimulacion, string> = {
  defensa: "Defensa (defensor del imputado)",
  fiscal: "Agente Fiscal (Ministerio Público Fiscal)",
  querellante: "Querellante / particular damnificado",
};

export const LABEL_DIFICULTAD: Record<DificultadSimulacion, string> = {
  a_guiada: "a_guiada",
  b_estandar: "b_estandar",
  c_adversarial: "c_adversarial",
};

export const LABEL_MAGISTRADO: Record<MagistradoPerfil, string> = {
  garantista: "garantista",
  neutro: "neutro",
  restrictivo: "restrictivo",
};

// Los roles que NO ocupa el usuario los interpreta el modelo. Se explicita
// para que no quede implícito en el guion.
const CONTRAPARTE: Record<RolUsuarioSimulacion, string> = {
  defensa:
    "El modelo interpreta al Juez de Garantías, al Secretario/OGA, al Agente Fiscal, a la querella (si el caso la tiene) y al imputado.",
  fiscal:
    "El modelo interpreta al Juez de Garantías, al Secretario/OGA, a la Defensa, a la querella (si el caso la tiene) y al imputado.",
  querellante:
    "El modelo interpreta al Juez de Garantías, al Secretario/OGA, al Agente Fiscal, a la Defensa y al imputado.",
};

export type ConfigSesion = {
  rol_usuario: RolUsuarioSimulacion;
  dificultad: DificultadSimulacion;
  magistrado_perfil: MagistradoPerfil;
};

function bloqueConfiguracion(cfg: ConfigSesion): string {
  return [
    "## CONFIGURACIÓN DE LA SESIÓN",
    "",
    `- Rol del usuario: ${LABEL_ROL_USUARIO[cfg.rol_usuario]}`,
    `- Nivel de dificultad: ${LABEL_DIFICULTAD[cfg.dificultad]}`,
    `- Perfil del magistrado: ${LABEL_MAGISTRADO[cfg.magistrado_perfil]}`,
    `- ${CONTRAPARTE[cfg.rol_usuario]}`,
    "",
    "Aplicá el nivel de dificultad y el perfil del magistrado tal como los define el guion.",
  ].join("\n");
}

type CasoEstrategiaLite = {
  estrategia_seleccionada_rol: string;
  estrategia_snapshot: Record<string, unknown> | null;
  ejecucion_origen_id: string | null;
};

// Bloque 4. NOTA IMPORTANTE: buildContextoCaso YA serializa la estrategia
// elegida (nombre, tesis central, fundamento legal, doctrina, fortalezas,
// riesgos y pasos procesales) en su propia sección. Duplicarla acá gastaría
// tokens en cada turno sin agregar nada. Este bloque aporta SOLO lo que aquel
// no trae y que una audiencia sí necesita:
//   · el PERFIL de la estrategia (conservadora/moderada/agresiva) y su resumen
//     ejecutivo — que definen el tono con el que el usuario va a litigar;
//   · los imputados identificados y los delitos imputables, que viven en
//     ejecuciones.metadata.resultado[rol] y que NINGÚN consumidor leía hasta
//     ahora (hallazgo de AUDIT-HEARSIM.md, capa A).
async function bloqueEstrategia(casoId: string): Promise<string> {
  const supabase = createServerClient();
  const { data: casoRaw, error } = await supabase
    .from("casos")
    .select(
      "estrategia_seleccionada_rol, estrategia_snapshot, ejecucion_origen_id",
    )
    .eq("id", casoId)
    .maybeSingle();

  const lineas: string[] = ["## ESTRATEGIA FORMULADA", ""];

  if (error || !casoRaw) {
    lineas.push("(no se pudo recuperar la estrategia del caso)");
    return lineas.join("\n");
  }
  const caso = casoRaw as CasoEstrategiaLite;
  const snap = (caso.estrategia_snapshot ?? {}) as {
    nombre?: unknown;
    tipo?: unknown;
    resumen_ejecutivo?: unknown;
  };

  if (typeof snap.tipo === "string" && snap.tipo) {
    lineas.push(`- Perfil elegido: ${snap.tipo} (rol ${caso.estrategia_seleccionada_rol})`);
  }
  if (typeof snap.nombre === "string" && snap.nombre) {
    lineas.push(`- Nombre: ${snap.nombre}`);
  }
  if (typeof snap.resumen_ejecutivo === "string" && snap.resumen_ejecutivo) {
    lineas.push("- Resumen ejecutivo:");
    lineas.push(`  ${snap.resumen_ejecutivo}`);
  }

  // Imputados y delitos: viven en la sección del rol elegido dentro del
  // resultado de la ejecución de origen.
  if (caso.ejecucion_origen_id) {
    const { data: ejec } = await supabase
      .from("ejecuciones")
      .select("metadata")
      .eq("id", caso.ejecucion_origen_id)
      .maybeSingle();
    const meta = (ejec?.metadata ?? null) as Record<string, unknown> | null;
    const resultado = (meta?.resultado ?? null) as Record<string, unknown> | null;
    const seccion = (resultado?.[caso.estrategia_seleccionada_rol] ?? null) as {
      imputados_identificados?: unknown;
      delitos_imputables?: unknown;
    } | null;

    const imputados = Array.isArray(seccion?.imputados_identificados)
      ? seccion.imputados_identificados.filter(
          (x): x is string => typeof x === "string" && x.length > 0,
        )
      : [];
    const delitos = Array.isArray(seccion?.delitos_imputables)
      ? seccion.delitos_imputables.filter(
          (x): x is string => typeof x === "string" && x.length > 0,
        )
      : [];

    if (imputados.length > 0) {
      lineas.push(`- Imputados identificados: ${imputados.join(", ")}`);
    }
    if (delitos.length > 0) {
      lineas.push(`- Delitos imputables según el análisis: ${delitos.join(", ")}`);
    }
  }

  if (lineas.length === 2) {
    lineas.push("(el caso no tiene estrategia registrada)");
  }
  lineas.push("");
  lineas.push(
    "El detalle de la estrategia (tesis central, fundamento legal, fortalezas, riesgos y " +
      "pasos procesales) está en el bloque CONTEXTO DEL CASO, más arriba. No lo repitas: usalo.",
  );
  return lineas.join("\n");
}

// Contenido de sistema completo de la sesión. Se recalcula en cada turno
// (barato: 2 queries + una lectura cacheada) para que el modelo siempre vea el
// estado actual del expediente, igual que hace el chat por caso.
export async function buildSystemSimulacion(input: {
  casoId: string;
  config: ConfigSesion;
}): Promise<string> {
  const { casoId, config } = input;
  const [ctx, estrategia] = await Promise.all([
    buildContextoCaso(casoId),
    bloqueEstrategia(casoId),
  ]);

  return [
    cargarGuion(),
    "",
    "---",
    "",
    bloqueConfiguracion(config),
    "",
    "---",
    "",
    // buildContextoCaso ya abre con "# CONTEXTO DEL CASO".
    ctx.contextoMarkdown,
    "",
    "---",
    "",
    estrategia,
  ].join("\n");
}
