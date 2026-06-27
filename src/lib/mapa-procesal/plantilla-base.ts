// Plantilla inicial del mapa procesal — PRIMERA VERSIÓN, a validar con experto.
//
// ⚠️ FUENTE ÚNICA DE VERDAD del flujo. Vocabulario y estructura son PROVISORIOS
// (vocabulario CPPF). Para ajustar el mapa, editá `FLUJO` acá abajo: cada fila
// es un nodo con su `padre` (por `key`). El render (xyflow + dagre, layout
// vertical TB) se regenera solo a partir de estos datos — no hay que tocar nada
// más.
//
// Estructura: tronco secuencial con bifurcaciones que sigue el orden real del
// proceso penal (fase inicial expandida):
//
//   Denuncia (raíz)
//   └─ Inicio de la investigación
//      └─ Medidas de investigación
//         └─ Identificación del imputado
//            ├─ Persona a identificar
//            └─ Formalización (audiencia)
//               ├─ Prisión preventiva        [riesgo alto]
//               └─ Cierre de la investigación
//                  ├─ Elevación a juicio
//                  ├─ Sobreseimiento
//                  └─ Suspensión a prueba
//
// Estado inicial — "todo posible": al inicializar, todos los nodos arrancan
// "posible" (azul, estado `desbloqueado`) y el abogado los va marcando como
// "ejecutado" (verde, estado `ocurrido`) a medida que avanza el caso. La ÚNICA
// excepción es la raíz "Denuncia", que arranca `ocurrido`: es el hecho que da
// origen al caso (ya pasó) y, además, mantener la raíz en `ocurrido` preserva
// las invariantes existentes (índice único `WHERE tipo='raiz'` y el guard
// `.neq tipo raiz` de `marcarComoOcurrido`) sin tocar la mecánica.

import type { LucideIcon } from "lucide-react";
import {
  Circle,
  CircleCheck,
  CirclePause,
  FileText,
  Fingerprint,
  FolderCheck,
  Landmark,
  Lock,
  ScanSearch,
  Scale,
  Search,
  UserSearch,
} from "lucide-react";
import type { NodoProcesalInsert } from "./types";

type NodoTemplate = {
  key: string; // identificador local para cablear padre→hijo antes del insert
  titulo: string;
  padre: string | null; // key del padre, o null para la raíz
  riesgoAlto?: boolean;
};

const FLUJO: NodoTemplate[] = [
  { key: "denuncia", titulo: "Denuncia", padre: null },
  { key: "inicio", titulo: "Inicio de la investigación", padre: "denuncia" },
  { key: "medidas", titulo: "Medidas de investigación", padre: "inicio" },
  { key: "identificacion", titulo: "Identificación del imputado", padre: "medidas" },
  { key: "persona", titulo: "Persona a identificar", padre: "identificacion" },
  { key: "formalizacion", titulo: "Formalización (audiencia)", padre: "identificacion" },
  { key: "prision", titulo: "Prisión preventiva", padre: "formalizacion", riesgoAlto: true },
  { key: "cierre", titulo: "Cierre de la investigación", padre: "formalizacion" },
  { key: "elevacion", titulo: "Elevación a juicio", padre: "cierre" },
  { key: "sobreseimiento", titulo: "Sobreseimiento", padre: "cierre" },
  { key: "suspension", titulo: "Suspensión a prueba", padre: "cierre" },
];

export function generarPlantillaBase(casoId: string): NodoProcesalInsert[] {
  // Pre-generamos un UUID por cada nodo del template para poder cablear padre_id
  // entre nodos del mismo batch antes de insertar (mismo patrón de siempre).
  const idPorKey = new Map<string, string>(
    FLUJO.map((n) => [n.key, crypto.randomUUID()]),
  );
  const idDe = (key: string): string => {
    const id = idPorKey.get(key);
    if (!id) throw new Error(`Template del mapa inconsistente: falta key "${key}"`);
    return id;
  };

  return FLUJO.map((n) => {
    const esRaiz = n.padre === null;
    return {
      id: idDe(n.key),
      caso_id: casoId,
      titulo: n.titulo,
      descripcion: null,
      tipo: esRaiz ? "raiz" : "prediccion",
      // Raíz "ocurrido" (ya pasó); el resto "desbloqueado" = "posible" (azul).
      estado: esRaiz ? "ocurrido" : "desbloqueado",
      padre_id: n.padre ? idDe(n.padre) : null,
      riesgo_alto: n.riesgoAlto ?? false,
    };
  });
}

// Ícono lineal (lucide) por etapa, para el render del nodo. ⚠️ PROVISORIO y
// acoplado a los TÍTULOS de `FLUJO` de arriba — vive acá a propósito para que
// título e ícono se editen en el mismo lugar. Si el vocabulario cambia tras
// validar con el experto legal, se actualiza acá. Los nodos con título fuera del
// template (agregados a mano por el abogado) caen a ICONO_DEFAULT.
export const ICONO_DEFAULT: LucideIcon = Circle;

export const ICONO_POR_TITULO: Record<string, LucideIcon> = {
  Denuncia: FileText,
  "Inicio de la investigación": Search,
  "Medidas de investigación": ScanSearch,
  "Identificación del imputado": Fingerprint,
  "Persona a identificar": UserSearch,
  "Formalización (audiencia)": Landmark,
  "Prisión preventiva": Lock,
  "Cierre de la investigación": FolderCheck,
  "Elevación a juicio": Scale,
  Sobreseimiento: CircleCheck,
  "Suspensión a prueba": CirclePause,
};

export function iconoDeNodo(titulo: string): LucideIcon {
  return ICONO_POR_TITULO[titulo] ?? ICONO_DEFAULT;
}
