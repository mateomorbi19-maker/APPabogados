// Renderer de markdown liviano para las respuestas de LEXIE.
//
// Cubre exactamente lo que el system prompt le autoriza a usar —párrafos,
// viñetas y negritas— y nada más. No es un parser de markdown y no quiere
// serlo: sin librería nueva, sin `dangerouslySetInnerHTML`, y sin la
// posibilidad de que el modelo inyecte HTML en la página escribiendo un tag
// en su respuesta.
//
// (El chat por caso hoy muestra los `**` crudos. Se arregla acá primero
// porque LEXIE es la que tiene la instrucción explícita de usarlos.)

import { Fragment, type ReactNode } from "react";

/** Parte una línea en tramos normales y en negrita. */
function conNegritas(linea: string): ReactNode[] {
  // El split con grupo de captura conserva el contenido entre ** **, así que
  // los índices impares del array son los tramos a resaltar.
  const tramos = linea.split(/\*\*(.+?)\*\*/g);
  return tramos.map((t, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-[var(--el-text)]">
        {t}
      </strong>
    ) : (
      <Fragment key={i}>{t}</Fragment>
    ),
  );
}

const ES_VINETA = /^\s*[-*•]\s+/;

export function TextoLexie({ texto }: { texto: string }) {
  const bloques = texto
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-[var(--el-text-soft)]">
      {bloques.map((bloque, i) => {
        const lineas = bloque.split("\n");
        const esLista = lineas.every((l) => ES_VINETA.test(l));

        if (esLista) {
          return (
            <ul key={i} className="ml-1 space-y-1.5">
              {lineas.map((l, j) => (
                <li key={j} className="flex gap-2">
                  <span
                    aria-hidden
                    className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-[var(--el-violet-light)]"
                  />
                  <span>{conNegritas(l.replace(ES_VINETA, ""))}</span>
                </li>
              ))}
            </ul>
          );
        }

        // Encabezado markdown (## Algo): se degrada a una línea destacada en
        // vez de un <h2>, que dentro de una burbuja de chat rompe la escala.
        if (/^#{1,4}\s+/.test(bloque)) {
          return (
            <p key={i} className="font-semibold text-[var(--el-text)]">
              {conNegritas(bloque.replace(/^#{1,4}\s+/, ""))}
            </p>
          );
        }

        return (
          <p key={i} className="whitespace-pre-wrap">
            {conNegritas(bloque)}
          </p>
        );
      })}
    </div>
  );
}
