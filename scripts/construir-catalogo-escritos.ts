// Generador del catálogo de modelos de escritos del estudio.
//
//   Lee   scripts/data/50-modelos-escritos-penales.md  (el documento de Gonzalo)
//   Emite src/lib/escritos/catalogo-estudio.ts         (CATALOGO_ESTUDIO)
//
// Uso: npx tsx scripts/construir-catalogo-escritos.ts
//
// Por qué un módulo TS y no filas en Supabase: son 50 modelos que redactó el
// estudio, iguales para los tres abogados. Versionados en git se corrigen con
// un diff que Gonzalo puede leer, no dependen de una migración ni de un seed, y
// la búsqueda sale en memoria. Los modelos PROPIOS de cada abogado —que sí son
// datos— van a la tabla `modelos_escrito`. Ver src/lib/escritos/types.ts.
//
// El parser es deliberadamente estricto: si un modelo no trae Suma o Cuerpo
// tipo, el script ABORTA en vez de emitir un catálogo con agujeros. Es mejor
// que falle acá que descubrirlo cuando un abogado elige el modelo 37 y le sale
// un escrito vacío.
//
// Formato que espera (el del documento original):
//
//   # I. Sección                      ← categoría, por número romano
//   ## 12. Título del modelo           ← número + título
//   **Suma:** ...
//   **Cuándo:** ...
//   **Base normativa (orientativa):** ...   (el paréntesis es opcional)
//   **Objeto:** ...                         (opcional)
//   **Cuerpo tipo:**                        (o "Cuerpo tipo (impugnación):")
//   > párrafo citado
//   > párrafo citado
//   **Claves:** ...
//   ---

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  CategoriaEscrito,
  ModeloEscrito,
  RolSugerido,
} from "../src/lib/escritos/types";
import { slugificar } from "../src/lib/repositorio/texto";

const RAIZ = process.cwd();
const ENTRADA = path.join(RAIZ, "scripts/data/50-modelos-escritos-penales.md");
const SALIDA = path.join(RAIZ, "src/lib/escritos/catalogo-estudio.ts");

// Las nueve secciones del documento, por su número romano.
const CATEGORIA_POR_ROMANO: Record<string, CategoriaEscrito> = {
  I: "actos_iniciales",
  II: "libertad_coercion",
  III: "prueba",
  IV: "victima_querella",
  V: "nulidades_garantias",
  VI: "salidas_alternativas",
  VII: "juicio",
  VIII: "recursos",
  IX: "ejecucion",
};

// Para quién está pensado cada modelo. No está en el documento: se deduce del
// contenido ("en mi carácter de defensor", "en representación de la víctima")
// y se fija acá a mano para que el filtro por rol de la causa y la
// recomendación de LEXIE tengan un dato y no una adivinanza.
const ROL_POR_NUMERO: Record<number, RolSugerido> = {
  1: "defensor",
  2: "defensor",
  3: "querellante",
  4: "querellante",
  5: "defensor",
  6: "ambos",
  7: "defensor",
  8: "defensor",
  9: "defensor",
  10: "defensor",
  11: "defensor",
  12: "defensor",
  13: "defensor",
  14: "defensor",
  15: "ambos",
  16: "ambos",
  17: "ambos",
  18: "ambos",
  19: "ambos",
  20: "ambos",
  21: "defensor",
  22: "querellante",
  23: "querellante",
  24: "defensor",
  25: "defensor",
  26: "defensor",
  27: "defensor",
  28: "defensor",
  29: "ambos",
  30: "ambos",
  31: "ambos",
  32: "defensor",
  33: "defensor",
  34: "defensor",
  35: "defensor",
  36: "defensor",
  37: "defensor",
  38: "defensor",
  39: "defensor",
  40: "ambos",
  41: "ambos",
  42: "defensor",
  43: "ambos",
  44: "ambos",
  45: "ambos",
  46: "ambos",
  47: "ambos",
  48: "defensor",
  49: "defensor",
  50: "defensor",
};

// ————————————————————————————————————————————————————————————————
// Parser
// ————————————————————————————————————————————————————————————————

type Bloque = {
  numero: number;
  titulo: string;
  categoria: CategoriaEscrito;
  lineas: string[];
};

function partirEnBloques(md: string): Bloque[] {
  const bloques: Bloque[] = [];
  let categoria: CategoriaEscrito | null = null;
  let actual: Bloque | null = null;

  for (const cruda of md.split(/\r?\n/)) {
    const linea = cruda.replace(/\s+$/, "");

    const seccion = linea.match(/^# ([IVX]+)\.\s+(.+)$/);
    if (seccion) {
      const cat = CATEGORIA_POR_ROMANO[seccion[1]];
      if (!cat) throw new Error(`Sección sin categoría: "${linea}"`);
      categoria = cat;
      continue;
    }

    const modelo = linea.match(/^## (\d+)\.\s+(.+)$/);
    if (modelo) {
      if (!categoria) throw new Error(`Modelo antes de la primera sección: "${linea}"`);
      actual = {
        numero: Number(modelo[1]),
        titulo: modelo[2].trim(),
        categoria,
        lineas: [],
      };
      bloques.push(actual);
      continue;
    }

    // "## Anexo — Checklist" y "## Convención" no son modelos: cortan el bloque.
    if (/^## /.test(linea)) {
      actual = null;
      continue;
    }

    if (actual) actual.lineas.push(linea);
  }
  return bloques;
}

/** Valor de una línea `**Etiqueta:** valor`. La etiqueta admite un paréntesis. */
function campo(lineas: string[], etiqueta: string): string | null {
  const re = new RegExp(`^\\*\\*${etiqueta}(?: \\([^)]*\\))?:\\*\\*\\s*(.*)$`);
  for (const l of lineas) {
    const m = l.match(re);
    if (m) return m[1].trim() || null;
  }
  return null;
}

/**
 * El cuerpo tipo: las líneas citadas (`> ...`) que siguen a la etiqueta
 * "**Cuerpo tipo:**" hasta la próxima etiqueta en negrita o el separador.
 * Cada línea citada es un párrafo. Se sacan los `**` de las etiquetas internas
 * ("**II. Hechos.**" queda "II. Hechos.") y se conserva todo lo demás tal cual,
 * placeholders incluidos.
 */
function cuerpo(lineas: string[]): string | null {
  const inicio = lineas.findIndex((l) => /^\*\*Cuerpo tipo/.test(l));
  if (inicio < 0) return null;
  const parrafos: string[] = [];
  for (let i = inicio + 1; i < lineas.length; i++) {
    const l = lineas[i];
    if (/^\*\*[^*]+:\*\*/.test(l) || l === "---") break;
    const m = l.match(/^>\s?(.*)$/);
    if (!m) continue;
    const texto = m[1].trim();
    if (texto.length === 0) continue;
    parrafos.push(texto.replace(/\*\*/g, ""));
  }
  return parrafos.length > 0 ? parrafos.join("\n\n") : null;
}

function aModelo(b: Bloque): ModeloEscrito {
  const suma = campo(b.lineas, "Suma");
  const cuerpoTipo = cuerpo(b.lineas);
  if (!suma) throw new Error(`Modelo ${b.numero} sin Suma`);
  if (!cuerpoTipo) throw new Error(`Modelo ${b.numero} sin Cuerpo tipo`);
  const rol = ROL_POR_NUMERO[b.numero];
  if (!rol) throw new Error(`Modelo ${b.numero} sin rol sugerido en ROL_POR_NUMERO`);

  return {
    id: slugificar(b.titulo, 80),
    origen: "estudio",
    numero: b.numero,
    categoria: b.categoria,
    titulo: b.titulo,
    suma,
    cuando: campo(b.lineas, "Cuándo"),
    base_normativa: campo(b.lineas, "Base normativa"),
    cuerpo: cuerpoTipo,
    claves: campo(b.lineas, "Claves"),
    rol_sugerido: rol,
    creado_en: null,
  };
}

// ————————————————————————————————————————————————————————————————
// Main
// ————————————————————————————————————————————————————————————————

function main() {
  const md = readFileSync(ENTRADA, "utf8");
  const bloques = partirEnBloques(md);
  const modelos = bloques.map(aModelo);

  // Ids únicos: dos títulos que slugifiquen igual serían dos modelos que la
  // URL y LEXIE no pueden distinguir.
  const vistos = new Set<string>();
  for (const m of modelos) {
    if (vistos.has(m.id)) throw new Error(`Slug duplicado: ${m.id}`);
    vistos.add(m.id);
  }

  const cabecera = [
    "// GENERADO por scripts/construir-catalogo-escritos.ts — NO EDITAR A MANO.",
    "// Fuente: scripts/data/50-modelos-escritos-penales.md (redactado por el estudio).",
    "// Para corregir un modelo: editar el .md y volver a correr el script.",
    "//",
    "// Las citas de artículos son ORIENTATIVAS: la numeración cambia entre el CPPF,",
    "// el CPPN y los códigos provinciales, y el redactor (y el abogado) tienen que",
    "// verificarlas contra el texto vigente del fuero de la causa.",
    "",
    'import type { ModeloEscrito } from "./types";',
    "",
    "export const CATALOGO_ESTUDIO: readonly ModeloEscrito[] = ",
  ].join("\n");

  const cuerpoTs = JSON.stringify(modelos, null, 2);
  writeFileSync(SALIDA, `${cabecera}${cuerpoTs};\n`, "utf8");

  const porCategoria = new Map<string, number>();
  for (const m of modelos) {
    porCategoria.set(m.categoria, (porCategoria.get(m.categoria) ?? 0) + 1);
  }
  console.log(`✓ ${modelos.length} modelos → ${path.relative(RAIZ, SALIDA)}`);
  for (const [cat, n] of porCategoria) console.log(`  ${cat}: ${n}`);
}

main();
