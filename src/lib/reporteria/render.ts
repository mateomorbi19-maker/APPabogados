// Render determinístico de una plantilla de reporte. Módulo PURO.
//
// Es el paso (a) del análisis de agosto: «el borrador se arma solo con los
// datos, sin IA; sale más seco pero es exacto». Lo que produce esta función
// es lo que el modelo recibe después para pulir la prosa (paso (b)), y es
// también lo que se guarda como `contenido` cuando la variante no pasa por el
// modelo (prisión preventiva, condena).
//
// Dos reglas:
//   1. Una variable sin valor se escribe como `[FALTA: label]`, salvo que sea
//      opcional: entonces se omite. Nunca se rellena con nada verosímil.
//      Los datos de la ficha y los derivados de la causa no llegan a esta
//      regla: su frase va en un bloque {{#SI_HAY_X}} de la plantilla y, si el
//      dato falta, se omite o se generaliza. La ficha incompleta no bloquea.
//   2. Los bloques {{#TAG}}…{{/TAG}} se incluyen o se quitan enteros. Admiten
//      anidamiento con tags distintos (SE_RECURRE adentro de DESFAVORABLE).

import { camposAplicables, type DefinicionPlantilla, type VarianteReporte } from "./plantillas";

export type ValoresRender = Record<string, string | null | undefined>;

const RE_VARIABLE = /\{\{([A-ZÁÉÍÓÚÑ_0-9]+)\}\}/g;
// El bloque más externo con ese nombre: `{{#X}}` hasta el `{{/X}}` que le
// corresponde. Como cada tag aparece una sola vez por plantilla, el primer
// cierre con el mismo nombre es el correcto.
const RE_BLOQUE = /\{\{#([A-Z_0-9]+)\}\}([\s\S]*?)\{\{\/\1\}\}/;

/** Variables `{{X}}` que aparecen en un texto (sin repetir). */
export function variablesDe(texto: string): string[] {
  const out = new Set<string>();
  for (const m of texto.matchAll(RE_VARIABLE)) out.add(m[1]);
  return [...out];
}

/** Tags `{{#X}}` que aparecen en un texto (sin repetir). */
export function condicionesDe(texto: string): string[] {
  const out = new Set<string>();
  for (const m of texto.matchAll(/\{\{#([A-Z_0-9]+)\}\}/g)) out.add(m[1]);
  return [...out];
}

/** Resuelve los bloques condicionales, de afuera hacia adentro. */
export function resolverBloques(
  texto: string,
  condiciones: Record<string, boolean>,
): string {
  let t = texto;
  // Cota de seguridad: una plantilla tiene menos de 20 bloques; el bucle no
  // puede quedarse colgado aunque un tag no tenga cierre (el regex no matchea
  // y se sale).
  for (let i = 0; i < 50; i++) {
    const m = RE_BLOQUE.exec(t);
    if (!m) break;
    const [entero, tag, interior] = m;
    t = t.replace(entero, condiciones[tag] ? interior : "");
  }
  return t;
}

export function sustituirVariables(
  texto: string,
  valores: ValoresRender,
  labels: Record<string, string>,
  opcionales: ReadonlySet<string>,
): string {
  return texto.replace(RE_VARIABLE, (_m, clave: string) => {
    const v = valores[clave];
    const limpio = typeof v === "string" ? v.trim() : "";
    if (limpio.length > 0) return limpio;
    if (opcionales.has(clave)) return "";
    return `[FALTA: ${labels[clave] ?? clave.toLowerCase().replace(/_/g, " ")}]`;
  });
}

/**
 * Limpieza de los restos que dejan los bloques quitados y las opcionales
 * vacías: espacios dobles, «. .», líneas en blanco de más. No toca el interior
 * de las marcas [FALTA: …].
 */
export function limpiarTexto(texto: string): string {
  return texto
    .split("\n")
    .map((l) =>
      l
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\s+([,.;:!?])/g, "$1")
        .replace(/\(\s*\)/g, "")
        .replace(/\.\s*\./g, ".")
        .trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type EntradaRender = {
  plantilla: DefinicionPlantilla;
  variante: VarianteReporte | null;
  /** «defensor» | «querellante» | «ambos». Decide qué juego de valores y condiciones usa la variante. */
  rolEstudio: string;
  /** Valores del sistema y de la ficha, por clave. */
  valoresSistema: ValoresRender;
  /** Lo que el abogado escribió en el formulario: variables y checkboxes. */
  criterio: Record<string, unknown>;
};

export type ResultadoRender = {
  texto: string;
  /** Los valores finales que se usaron (sistema + variante + criterio). */
  valores: Record<string, string | null>;
  condiciones: Record<string, boolean>;
  /** Claves de variables que quedaron como [FALTA: …]. */
  faltantes: string[];
  sin_ia: boolean;
};

/**
 * Combina las tres capas de valores —sistema, variante, criterio— en ese
 * orden de precedencia (el abogado pisa a la variante, la variante pisa al
 * sistema), evalúa las condiciones y renderiza.
 */
export function renderizarReporte(e: EntradaRender): ResultadoRender {
  const { plantilla: p, variante, criterio } = e;
  const esQuerella = e.rolEstudio === "querellante";

  // 1. Valores por capa.
  const valores: Record<string, string | null> = {};
  for (const v of p.variables) {
    const s = e.valoresSistema[v.clave];
    valores[v.clave] = typeof s === "string" && s.trim() ? s.trim() : null;
  }
  const valoresVariante =
    (esQuerella ? variante?.valores_querella : null) ?? variante?.valores ?? {};
  for (const [k, v] of Object.entries(valoresVariante)) {
    // Los valores de la variante pueden nombrar otra variable del sistema
    // ({{NOMBRE_IMPUTADO}}): se resuelve acá, con la misma regla de faltante.
    valores[k] = sustituirVariables(v, e.valoresSistema, labelsDe(p), new Set()).trim();
  }
  const campos = camposAplicables(p, variante?.id ?? null, criterio);
  for (const c of campos) {
    if (c.tipo === "checkbox") continue;
    const crudo = criterio[c.clave];
    if (typeof crudo !== "string") continue;
    const t = crudo.trim();
    if (!t) continue;
    if (c.tipo === "opciones") {
      const op = c.opciones?.find((o) => o.valor === t);
      valores[c.clave] = op ? op.texto : t;
    } else {
      valores[c.clave] = t;
    }
  }

  // 2. Condiciones.
  const encendidasPorVariante = new Set(
    (esQuerella ? variante?.condiciones_querella : null) ?? variante?.condiciones ?? [],
  );
  const condiciones: Record<string, boolean> = {};
  for (const c of p.condiciones) {
    switch (c.fuente) {
      case "variante":
        condiciones[c.tag] = encendidasPorVariante.has(c.tag);
        break;
      case "criterio":
        condiciones[c.tag] = criterio[c.tag] === true;
        break;
      case "variable": {
        const hay = !!(c.variable && valores[c.variable]);
        condiciones[c.tag] = c.negada ? !hay : hay;
        break;
      }
    }
  }

  // 3. Texto.
  const labels = labelsDe(p);
  const opcionales = new Set(p.variables.filter((v) => v.opcional).map((v) => v.clave));
  // Un campo de criterio no requerido que aplica a esta variante también se
  // omite si está vacío: es opcional por construcción del formulario.
  for (const c of campos) {
    if (c.tipo !== "checkbox" && !c.requerido) opcionales.add(c.clave);
  }

  let texto: string;
  const sinIa = !!variante?.sin_ia;
  if (variante?.sin_ia) {
    // La cabecera también lleva bloques ({{#SI_HAY_JUEZ}}): se resuelven igual
    // que en el texto de la plantilla.
    texto = resolverBloques(
      [
        variante.sin_ia.cabecera,
        "",
        "[REDACTAR: cuerpo del mensaje — qué significa, qué va a hacer la defensa y qué viene]",
        "",
        variante.sin_ia.cierre,
      ].join("\n"),
      condiciones,
    );
  } else {
    texto = resolverBloques(p.texto, condiciones);
  }
  texto = limpiarTexto(sustituirVariables(texto, valores, labels, opcionales));

  const faltantes = variablesDe(sinIa ? texto : resolverBloques(p.texto, condiciones)).filter(
    (k) => !valores[k] && !opcionales.has(k),
  );
  // En sin_ia las variables ya se sustituyeron: se cuentan las marcas del texto.
  const faltantesFinal = sinIa
    ? Array.from(texto.matchAll(/\[FALTA: ([^\]]+)\]/g)).map((m) => m[1])
    : faltantes;

  return { texto, valores, condiciones, faltantes: faltantesFinal, sin_ia: sinIa };
}

function labelsDe(p: DefinicionPlantilla): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of p.variables) out[v.clave] = v.label;
  // Variables auxiliares que pueden aparecer en valores de variante.
  out.NOMBRE_IMPUTADO = "nombre del imputado";
  return out;
}

/** El asunto del correo, con las mismas variables que el texto. */
export function renderizarAsunto(
  p: DefinicionPlantilla,
  valores: ValoresRender,
): string {
  return limpiarTexto(sustituirVariables(p.asunto, valores, labelsDe(p), new Set()));
}
