// Plantilla inicial del mapa procesal: etapas estándar del proceso penal
// federal argentino (CPPF). Se genera al inicializar el mapa de un caso.
//
// Estados iniciales:
//   - raíz "Hecho imputado": ocurrido (tipo raiz).
//   - hijos directos de la raíz: DESBLOQUEADO (tipo prediccion).
//   - resto (nietos): bloqueado.
//
// NOTA sobre "Juicio oral": el diagrama del spec lo mostraba como bloqueado,
// pero la mecánica de desbloqueo (marcar un nodo ocurrido desbloquea SOLO sus
// hijos directos) dejaría a "Juicio oral" — hijo directo de la raíz, ya
// ocurrida — sin forma de desbloquearse nunca (su subárbol quedaría inalcanzable
// y los nodos bloqueados no son interactivos). Por coherencia con la mecánica y
// con la regla "los hijos directos de la raíz arrancan desbloqueados", los TRES
// hijos directos arrancan desbloqueados.

import type { NodoProcesalInsert } from "./types";

type Rama = { titulo: string; hijos?: { titulo: string }[] };

const ESTRUCTURA: Rama[] = [
  {
    titulo: "Investigación preparatoria",
    hijos: [
      { titulo: "Acto de imputación" },
      { titulo: "Prisión preventiva" },
      { titulo: "Medidas de prueba" },
    ],
  },
  {
    titulo: "Etapa intermedia",
    hijos: [
      { titulo: "Sobreseimiento" },
      { titulo: "Suspensión de juicio a prueba" },
      { titulo: "Apertura a juicio oral" },
    ],
  },
  {
    titulo: "Juicio oral",
    hijos: [
      { titulo: "Sentencia absolutoria" },
      { titulo: "Sentencia condenatoria" },
      { titulo: "Juicio abreviado" },
    ],
  },
];

export function generarPlantillaBase(casoId: string): NodoProcesalInsert[] {
  const nodos: NodoProcesalInsert[] = [];

  const raizId = crypto.randomUUID();
  nodos.push({
    id: raizId,
    caso_id: casoId,
    titulo: "Hecho imputado",
    descripcion: null,
    tipo: "raiz",
    estado: "ocurrido",
    padre_id: null,
  });

  for (const rama of ESTRUCTURA) {
    const ramaId = crypto.randomUUID();
    nodos.push({
      id: ramaId,
      caso_id: casoId,
      titulo: rama.titulo,
      descripcion: null,
      tipo: "prediccion",
      estado: "desbloqueado",
      padre_id: raizId,
    });
    for (const hijo of rama.hijos ?? []) {
      nodos.push({
        id: crypto.randomUUID(),
        caso_id: casoId,
        titulo: hijo.titulo,
        descripcion: null,
        tipo: "prediccion",
        estado: "bloqueado",
        padre_id: ramaId,
      });
    }
  }

  return nodos;
}
