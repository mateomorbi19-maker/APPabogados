import "server-only";
// Serialización COMPACTA del mapa procesal para que el agente del chat lo lea
// como texto. Sin IO propio (recibe los nodos ya cargados), pero queda del lado
// server porque reusa `serializarEsquemaFuero` de simulacion.ts — fuente única
// del render del esquema canónico, que sí es server-only. Lo consumen
// build-contexto-caso (una vez por turno, para el bloque de contexto) y cada
// tool de escritura del chat (para devolver `arbol_actualizado`, así el modelo
// nunca opera sobre un estado viejo).
//
// Formato de una línea (contrato con el system prompt y con mapa-tools):
//   - [<id-corto>] <titulo> · etapa <n> (<label>) · <estado> · <tipo>[ · RIESGO ALTO]
// El id-corto son los primeros 8 chars del uuid: alcanza para que el modelo
// referencie un nodo sin gastar 36 caracteres por línea. La resolución del
// prefijo (y el error por prefijo ambiguo) vive en coherencia.ts.

import { calcularLayout } from "./layout";
import { ETAPA_LABEL, type Etapa } from "./etapas";
import { serializarEsquemaFuero } from "./simulacion";
import { FUERO_LABEL, type Fuero, type NodoProcesalDB } from "./types";

export const ID_CORTO_CHARS = 8;

export function idCorto(id: string): string {
  return id.slice(0, ID_CORTO_CHARS);
}

// La DB guarda 'desbloqueado' para lo que el abogado lee como "posible" en el
// mapa (ver plantilla-base.ts). Traducimos para que el vocabulario del chat y
// el de la UI sean el mismo y el modelo no invente un tercer término.
const ESTADO_LABEL: Record<NodoProcesalDB["estado"], string> = {
  ocurrido: "ocurrido",
  desbloqueado: "posible",
  bloqueado: "bloqueado",
};

// Etapa (1-6) de cada nodo. NO se reimplementa la derivación: se reusa
// calcularLayout, que es la fuente única (ancla por título de etapa troncal +
// herencia del ancestro más cercano — ver etapas.ts). Si mañana cambia la
// regla de anclas, este serializador la hereda sin tocarse.
export function etapasPorNodo(nodos: NodoProcesalDB[]): Map<string, Etapa> {
  if (nodos.length === 0) return new Map();
  const { nodes } = calcularLayout(nodos);
  return new Map(nodes.map((n) => [n.id, n.data.etapa]));
}

export function lineaNodo(n: NodoProcesalDB, etapa: Etapa): string {
  const partes = [
    `[${idCorto(n.id)}] ${n.titulo}`,
    `etapa ${etapa} (${ETAPA_LABEL[etapa]})`,
    ESTADO_LABEL[n.estado],
    n.tipo,
  ];
  if (n.riesgo_alto) partes.push("RIESGO ALTO");
  return partes.join(" · ");
}

// Árbol indentado, una línea por nodo. Los hijos van ordenados por created_at
// (el orden en que vienen de getNodosByCaso), así el listado es estable entre
// turnos y el modelo no percibe "movimiento" donde no lo hubo.
export function serializarArbolMapa(
  nodos: NodoProcesalDB[],
  fuero: Fuero | null,
): string {
  if (nodos.length === 0) {
    return "(el mapa procesal de este caso todavía no está inicializado)";
  }

  const etapas = etapasPorNodo(nodos);
  const hijos = new Map<string | null, NodoProcesalDB[]>();
  for (const n of nodos) {
    const arr = hijos.get(n.padre_id) ?? [];
    arr.push(n);
    hijos.set(n.padre_id, arr);
  }

  const lineas: string[] = [];
  const visitados = new Set<string>();
  const walk = (padreId: string | null, depth: number): void => {
    for (const n of hijos.get(padreId) ?? []) {
      // Guard anti-ciclo: imposible por construcción (self-FK + inserts en
      // árbol), pero un ciclo colgaría el turno entero en vez de degradar.
      if (visitados.has(n.id)) continue;
      visitados.add(n.id);
      lineas.push(`${"  ".repeat(depth)}- ${lineaNodo(n, etapas.get(n.id) ?? 1)}`);
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);

  // Huérfanos: nodos cuyo padre no está en el set (no debería pasar, pero si
  // pasara el modelo tiene que verlos igual — si no, "desaparecen" del mapa).
  const huerfanos = nodos.filter((n) => !visitados.has(n.id));
  for (const n of huerfanos) {
    lineas.push(`- ${lineaNodo(n, etapas.get(n.id) ?? 1)} · (sin padre visible)`);
  }

  const encabezado = fuero
    ? `Fuero: ${FUERO_LABEL[fuero]} · ${nodos.length} nodos`
    : `Fuero: (sin asignar) · ${nodos.length} nodos`;
  return `${encabezado}\n${lineas.join("\n")}`;
}

// Bloque markdown completo para el contexto del caso: estado real del mapa +
// esquema canónico del fuero (para que el modelo sepa cuál es el flujo legal
// correcto antes de proponer cambios). `serializarEsquemaFuero` se reusa de
// simulacion.ts — misma fuente (FLUJO_POR_FUERO), sin duplicar el render.
export function serializarSeccionMapa(
  nodos: NodoProcesalDB[],
  fuero: Fuero | null,
): string {
  const lineas: string[] = [];
  lineas.push("## Mapa procesal del caso");
  lineas.push("");

  if (nodos.length === 0) {
    lineas.push(
      "El mapa procesal de este caso TODAVÍA NO ESTÁ INICIALIZADO: no hay ningún nodo cargado.",
    );
    lineas.push(
      "No podés crear, editar, eliminar ni marcar nodos hasta que exista el mapa. Si el abogado " +
        "te pide algo sobre el mapa, explicale que primero tiene que inicializarlo desde la vista " +
        '"Mapa procesal" del caso, eligiendo el fuero (Nación / Prov. de Buenos Aires / Federal).',
    );
    return lineas.join("\n");
  }

  lineas.push(
    "Estado actual del mapa (árbol indentado; el identificador entre corchetes es el id corto " +
      "del nodo — usalo para referenciarlo en las herramientas del mapa):",
  );
  lineas.push("");
  lineas.push(serializarArbolMapa(nodos, fuero));
  lineas.push("");

  if (fuero) {
    lineas.push(
      `Esquema canónico del fuero ${FUERO_LABEL[fuero]} (flujo legal de referencia: ` +
        "etapas y desenlaces estructurales válidos). Cualquier nodo que NO figure acá es una " +
        "rama hipotética o una incidencia propia de este caso, no parte del flujo estándar:",
    );
    lineas.push("");
    lineas.push(serializarEsquemaFuero(fuero));
  } else {
    lineas.push(
      "El caso no tiene fuero asignado, así que no hay esquema canónico contra el cual validar " +
        "el flujo. Avisale al abogado antes de proponer cambios estructurales.",
    );
  }

  return lineas.join("\n");
}
