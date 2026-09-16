// Generador del catálogo de modelos de escritos del estudio.
//
//   Lee   scripts/data/50-modelos-escritos-penales.md   (el documento redactado)
//         scripts/data/modelos-estudio-drive/*.md       (los modelos reales de Gonzalo)
//   Emite src/lib/escritos/catalogo-estudio.ts          (CATALOGO_ESTUDIO, resúmenes)
//         src/lib/escritos/catalogo-estudio-cuerpos.ts  (CUERPOS, los textos)
//
// Uso: npx tsx scripts/construir-catalogo-escritos.ts
//
// === Dos fuentes, un catálogo ===
//
// 1. Los 50 REDACTADOS: un solo documento con el cuerpo tipo de cada escrito,
//    corto y abstracto. Son plantillas escritas para ser plantillas.
// 2. Los 89 REALES (Fase 13): escritos que el estudio efectivamente presentó,
//    que Gonzalo compartió por Drive. Se bajaron, se les sacaron los datos de
//    las causas (nombres, DNI, números de expediente, fechas) reemplazándolos
//    por placeholders, y quedaron uno por archivo con su frontmatter. Son
//    largos y concretos: traen la argumentación completa, con sus citas y sus
//    fallos, que es justamente lo que un modelo abstracto no puede dar.
//
// Los dos grupos son `origen: "estudio"` —son del estudio, iguales para los
// tres abogados— y conviven numerados 1..139. Ninguna otra parte de la app
// cambia por esto.
//
// === Por qué dos módulos de salida ===
//
// Los cuerpos suman ~650 KB y el promedio es 7 KB por modelo (el más largo,
// 47 KB). El listado —lo que usan la búsqueda del diálogo, la tool de LEXIE y
// el filtro— no los necesita: sólo hace falta el cuerpo del ÚNICO modelo que
// se va a redactar. Con todo en un módulo, cada `listarModelos()` arrastraría
// los 650 KB. Por eso el catálogo liviano va aparte y los cuerpos se cargan
// con un `await import()` desde `obtenerModelo`. El catálogo NO entra en el
// bundle del cliente en ningún caso: sólo lo importa `queries.ts`, que es
// server-only, y el diálogo recibe los resúmenes por `/api/escritos/modelos`.
//
// === Formato que espera de cada fuente ===
//
// (1) El documento de los 50:
//
//   # I. Sección                      ← categoría, por número romano
//   ## 12. Título del modelo           ← número + título
//   **Suma:** ...
//   **Cuándo:** ...
//   **Base normativa (orientativa):** ...   (el paréntesis es opcional)
//   **Cuerpo tipo:**                        (o "Cuerpo tipo (impugnación):")
//   > párrafo citado
//   **Claves:** ...
//   ---
//
// (2) Cada archivo de `modelos-estudio-drive/` (el slug es el nombre del archivo):
//
//   ---
//   titulo: ...
//   suma: ...
//   cuando: ...
//   base_normativa: ...
//   claves: ...
//   categoria: recursos
//   rol_sugerido: defensor
//   tipo_documento: escrito_judicial | carta_documento | otro
//   fuero: nacion | federal | pba | desconocido
//   drive_id: ...
//   ---
//   <el escrito completo, con placeholders {{ASI}}>
//
// El parser es deliberadamente estricto en las dos: si a un modelo le falta la
// suma o el cuerpo, el script ABORTA en vez de emitir un catálogo con
// agujeros. Es mejor que falle acá que descubrirlo cuando un abogado elige el
// modelo 37 y le sale un escrito vacío.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CATEGORIAS_ESCRITO,
  ROLES_SUGERIDOS,
  type CategoriaEscrito,
  type ModeloEscrito,
  type RolSugerido,
} from "../src/lib/escritos/types";
import { slugificar } from "../src/lib/repositorio/texto";

const RAIZ = process.cwd();
const ENTRADA_50 = path.join(RAIZ, "scripts/data/50-modelos-escritos-penales.md");
const ENTRADA_DRIVE = path.join(RAIZ, "scripts/data/modelos-estudio-drive");
const SALIDA = path.join(RAIZ, "src/lib/escritos/catalogo-estudio.ts");
const SALIDA_CUERPOS = path.join(RAIZ, "src/lib/escritos/catalogo-estudio-cuerpos.ts");

// Las nueve secciones del documento de los 50, por su número romano.
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

// Para quién está pensado cada modelo de los 50. No está en el documento: se
// deduce del contenido ("en mi carácter de defensor", "en representación de la
// víctima") y se fija acá a mano para que el filtro por rol de la causa y la
// recomendación de LEXIE tengan un dato y no una adivinanza. Los de Drive lo
// traen en su frontmatter.
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
// Fuente 1: el documento de los 50
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
// Fuente 2: los modelos reales de Drive
// ————————————————————————————————————————————————————————————————

function esCategoria(v: string): v is CategoriaEscrito {
  return (CATEGORIAS_ESCRITO as readonly string[]).includes(v);
}

function esRol(v: string): v is RolSugerido {
  return (ROLES_SUGERIDOS as readonly string[]).includes(v);
}

function leerDrive(desdeNumero: number): ModeloEscrito[] {
  let archivos: string[];
  try {
    archivos = readdirSync(ENTRADA_DRIVE)
      .filter((f) => f.endsWith(".md"))
      .sort();
  } catch {
    console.warn(`  (sin ${path.relative(RAIZ, ENTRADA_DRIVE)}: se emite sólo el documento de los 50)`);
    return [];
  }

  const out: ModeloEscrito[] = [];
  let n = desdeNumero;
  for (const archivo of archivos) {
    const slug = archivo.slice(0, -3);
    const crudo = readFileSync(path.join(ENTRADA_DRIVE, archivo), "utf8");
    const m = crudo.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!m) throw new Error(`${archivo}: sin frontmatter`);

    const meta: Record<string, string> = {};
    for (const linea of m[1].split(/\r?\n/)) {
      const i = linea.indexOf(":");
      if (i < 0) continue;
      meta[linea.slice(0, i).trim()] = linea.slice(i + 1).trim();
    }
    const cuerpoTexto = m[2].trim();

    const titulo = meta.titulo;
    const suma = meta.suma;
    if (!titulo) throw new Error(`${archivo}: sin titulo`);
    if (!suma) throw new Error(`${archivo}: sin suma`);
    if (cuerpoTexto.length < 200) {
      throw new Error(`${archivo}: cuerpo demasiado corto (${cuerpoTexto.length} caracteres)`);
    }
    const categoria = meta.categoria ?? "";
    if (!esCategoria(categoria)) throw new Error(`${archivo}: categoría inválida "${categoria}"`);
    const rol = meta.rol_sugerido ?? "";
    if (!esRol(rol)) throw new Error(`${archivo}: rol_sugerido inválido "${rol}"`);

    out.push({
      id: slug,
      origen: "estudio",
      numero: n++,
      categoria,
      titulo,
      suma,
      cuando: meta.cuando || null,
      base_normativa: meta.base_normativa || null,
      cuerpo: cuerpoTexto,
      claves: meta.claves || null,
      rol_sugerido: rol,
      creado_en: null,
    });
  }
  return out;
}

// ————————————————————————————————————————————————————————————————
// Main
// ————————————————————————————————————————————————————————————————

const CABECERA_COMUN = [
  "// GENERADO por scripts/construir-catalogo-escritos.ts — NO EDITAR A MANO.",
  "// Fuentes: scripts/data/50-modelos-escritos-penales.md (los 50 redactados)",
  "//          scripts/data/modelos-estudio-drive/*.md     (los 89 reales de Gonzalo)",
  "// Para corregir un modelo: editar su fuente y volver a correr el script.",
  "//",
  "// Las citas de artículos son ORIENTATIVAS: la numeración cambia entre el CPPF,",
  "// el CPPN y los códigos provinciales, y el redactor (y el abogado) tienen que",
  "// verificarlas contra el texto vigente del fuero de la causa.",
].join("\n");

function main() {
  const md = readFileSync(ENTRADA_50, "utf8");
  const redactados = partirEnBloques(md).map(aModelo);
  const reales = leerDrive(redactados.length + 1);
  const modelos = [...redactados, ...reales];

  // Ids únicos: dos títulos que slugifiquen igual serían dos modelos que la
  // URL y LEXIE no pueden distinguir.
  const vistos = new Set<string>();
  for (const m of modelos) {
    if (vistos.has(m.id)) throw new Error(`Slug duplicado: ${m.id}`);
    vistos.add(m.id);
  }

  // --- Catálogo liviano: todo menos el cuerpo ---
  const resumenes = modelos.map(({ cuerpo: _c, ...resto }) => {
    void _c;
    return resto;
  });
  const cabecera = [
    CABECERA_COMUN,
    "//",
    "// Los CUERPOS no están acá: viven en ./catalogo-estudio-cuerpos y se cargan",
    "// con un import dinámico desde `obtenerModelo`. El listado, la búsqueda y la",
    "// recomendación de LEXIE sólo necesitan estos resúmenes.",
    "",
    'import type { ModeloEscritoResumen } from "./types";',
    "",
    "export const CATALOGO_ESTUDIO: readonly ModeloEscritoResumen[] = ",
  ].join("\n");
  writeFileSync(SALIDA, `${cabecera}${JSON.stringify(resumenes, null, 2)};\n`, "utf8");

  // --- Cuerpos: el módulo pesado, de carga diferida ---
  const cuerpos: Record<string, string> = {};
  for (const m of modelos) cuerpos[m.id] = m.cuerpo;
  const cabeceraCuerpos = [
    CABECERA_COMUN,
    "//",
    "// Módulo PESADO (cientos de KB): se carga con `await import()` sólo cuando",
    "// hay que redactar un escrito concreto. Nunca desde el listado.",
    "",
    "export const CUERPOS: Readonly<Record<string, string>> = ",
  ].join("\n");
  writeFileSync(
    SALIDA_CUERPOS,
    `${cabeceraCuerpos}${JSON.stringify(cuerpos, null, 2)};\n`,
    "utf8",
  );

  const porCategoria = new Map<string, number>();
  for (const m of modelos) {
    porCategoria.set(m.categoria, (porCategoria.get(m.categoria) ?? 0) + 1);
  }
  const bytes = modelos.reduce((a, m) => a + m.cuerpo.length, 0);
  console.log(
    `✓ ${modelos.length} modelos (${redactados.length} redactados + ${reales.length} reales) → ${path.relative(RAIZ, SALIDA)}`,
  );
  console.log(
    `  cuerpos: ${(bytes / 1024).toFixed(0)} KB → ${path.relative(RAIZ, SALIDA_CUERPOS)}`,
  );
  for (const [cat, n] of [...porCategoria].sort()) console.log(`  ${cat}: ${n}`);
}

main();
