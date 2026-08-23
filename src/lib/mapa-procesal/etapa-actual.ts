// En qué etapa procesal está una causa.
//
// El badge "Instrucción" de la cabecera de la ficha NO es un campo que se
// tipea: se deriva del mapa procesal. La alternativa —una columna `etapa` en
// `casos`— crea dos verdades sobre el mismo hecho, y se contradicen el primer
// día: el abogado marca un nodo como ocurrido en el mapa y la ficha sigue
// diciendo la etapa vieja, o al revés. Y después hay que decidir cuál manda.
//
// Acá no se reimplementa nada de la derivación: `etapasPorNodo` ya resuelve la
// etapa de cada nodo (ancla por título de etapa troncal + herencia del ancestro
// más cercano, ver etapas.ts) y es la misma función que usa el layout del mapa
// y el serializador que ve el agente. Lo único que se agrega es "cuál de todas
// es la etapa ACTUAL".
//
// La respuesta es el nodo `ocurrido` de etapa más alta. Se apoya en la regla
// R5 de coherencia.ts, que garantiza que los nodos ocurridos forman un camino
// sin agujeros: sin esa regla habría que reconstruir el camino desde la raíz.

import type { NodoProcesalDB } from "./types";
import { etapasPorNodo } from "./serializar";
import { ETAPA_LABEL, type Etapa } from "./etapas";

export type EtapaActual = {
  etapa: Etapa;
  label: string;
  /** El nodo concreto que la fija. Sirve para explicar de dónde salió. */
  nodoTitulo: string;
};

/**
 * La etapa procesal vigente, o `null` si el mapa no está inicializado o si
 * todavía no se marcó ningún nodo como ocurrido.
 *
 * `null` NO se rellena con "Etapa 1": una causa cuyo mapa nadie tocó no está
 * en la etapa 1, está sin información. El UI muestra "Sin mapa" con el link
 * para iniciarlo, que es la misma regla que el resto de la ficha.
 */
export function etapaActual(nodos: NodoProcesalDB[]): EtapaActual | null {
  if (nodos.length === 0) return null;

  const ocurridos = nodos.filter((n) => n.estado === "ocurrido");
  if (ocurridos.length === 0) return null;

  const porNodo = etapasPorNodo(nodos);

  let mejor: EtapaActual | null = null;
  for (const n of ocurridos) {
    const e = porNodo.get(n.id);
    if (e === undefined) continue;
    if (mejor === null || e > mejor.etapa) {
      mejor = { etapa: e, label: ETAPA_LABEL[e], nodoTitulo: n.titulo };
    }
  }
  return mejor;
}
