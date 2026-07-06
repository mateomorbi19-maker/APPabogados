// Plantillas del mapa procesal POR FUERO (Fase A del rediseño fuero-aware).
//
// ⚠️ FUENTE ÚNICA DE VERDAD del flujo de cada fuero. El contenido legal viene
// de los 3 diagramas HTML validados por los abogados (Nación / PBA / Federal),
// traducidos a nodos macro en PLAN_MAPA_PROCESAL.md §3.2 — NO re-derivar ni
// "mejorar" sin OK legal. Para ajustar un flujo, editá su entrada en
// `FLUJO_POR_FUERO`: cada fila es un nodo con su `padre` (por `key`). El render
// (xyflow + dagre, layout vertical TB) se regenera solo a partir de estos datos.
//
// Convención del árbol (macro, ~13-16 nodos por fuero):
// - Cada etapa troncal es hija de la etapa anterior.
// - Los desenlaces/salidas de una etapa cuelgan como HOJAS de esa etapa (así la
//   etapa con >=2 hijos se pinta "decisión pendiente" en el layout).
// - Desenlaces gravosos para el imputado (prisión preventiva, condena) llevan
//   `riesgoAlto: true`. Nunca los favorables (sobreseimiento, absolución).
// - La `descripcion` puebla el panel de detalle (sub-etapas, artículos, órganos).
//
// Estado inicial — "todo posible": todos los nodos arrancan "posible" (azul,
// estado `desbloqueado`) y el abogado los marca "ejecutado" (verde, `ocurrido`)
// a medida que avanza el caso. La ÚNICA excepción es la raíz "Actos Iniciales",
// que arranca `ocurrido`: es el hecho que da origen al caso y preserva las
// invariantes existentes (índice único `WHERE tipo='raiz'` y el guard
// `.neq tipo raiz` de `marcarComoOcurrido`).

import type { LucideIcon } from "lucide-react";
import {
  Archive,
  BadgeCheck,
  Circle,
  CircleCheck,
  CircleDashed,
  CirclePause,
  FileSignature,
  FileText,
  FolderCheck,
  Gavel,
  Handshake,
  Hourglass,
  Landmark,
  Lock,
  RotateCcw,
  Route,
  Scale,
  Search,
  Users,
} from "lucide-react";
import type { Fuero, NodoProcesalInsert } from "./types";

type NodoTemplate = {
  key: string; // identificador local para cablear padre→hijo antes del insert
  titulo: string;
  padre: string | null; // key del padre, o null para la raíz
  riesgoAlto?: boolean;
  descripcion?: string; // detalle legal para el panel (sub-etapas, artículos)
};

// === FEDERAL — CPPF Ley 27.063 (sistema acusatorio) ===
const FLUJO_FEDERAL: NodoTemplate[] = [
  {
    key: "actos_iniciales",
    titulo: "Actos Iniciales",
    padre: null,
    descripcion:
      "Notitia criminis: denuncia (arts. 244-249), prevención policial (arts. 90 y 250) o querella (arts. 82-89). El fiscal decide el curso de la acción (arts. 251-253). Libro II · Título I CPPF.",
  },
  {
    key: "desestimacion",
    titulo: "Desestimación / Archivo",
    padre: "actos_iniciales",
    descripcion: "Cierre temprano de las actuaciones por decisión del fiscal.",
  },
  {
    key: "oportunidad",
    titulo: "Criterios de oportunidad",
    padre: "actos_iniciales",
    descripcion:
      "El fiscal puede prescindir total o parcialmente de la acción penal: insignificancia, pena natural, colaboración (art. 31 CPPF).",
  },
  {
    key: "ipp",
    titulo: "Investigación Penal Preparatoria",
    padre: "actos_iniciales",
    descripcion:
      "Etapa desformalizada a cargo del fiscal, bajo control del juez de garantías. Formalización en audiencia (arts. 254-260), producción de prueba (arts. 134-198). Plazo: hasta 1 año prorrogable; vencido, archivo de pleno derecho (arts. 232-233).",
  },
  {
    key: "prision",
    titulo: "Prisión preventiva",
    padre: "ipp",
    riesgoAlto: true,
    descripcion:
      "Medida de coerción excepcional y revisable, último recurso (arts. 210-226).",
  },
  {
    key: "sobreseimiento_ipp",
    titulo: "Sobreseimiento",
    padre: "ipp",
    descripcion: "Cierre definitivo a favor del imputado.",
  },
  {
    key: "sjp",
    titulo: "Suspensión del juicio a prueba",
    padre: "ipp",
    descripcion:
      "Probation: el imputado se somete a reglas de conducta; cumplidas, se extingue la acción penal (art. 76 bis CP).",
  },
  {
    key: "abreviado",
    titulo: "Juicio abreviado",
    padre: "ipp",
    descripcion:
      "Acuerdo sobre hechos y pena que evita el debate (art. 288 y conc.).",
  },
  {
    key: "conciliacion",
    titulo: "Conciliación / Reparación",
    padre: "ipp",
    descripcion:
      "Acuerdo entre víctima e imputado que extingue la acción penal (art. 34 CPPF).",
  },
  {
    key: "control_acusacion",
    titulo: "Control de la Acusación",
    padre: "ipp",
    descripcion:
      "Etapa intermedia (Libro III). Audiencia de control oral (arts. 279-287): se depura la acusación, se ofrece la prueba y se dicta el auto de apertura a juicio (arts. 288-289).",
  },
  {
    key: "sobreseimiento_control",
    titulo: "Sobreseimiento",
    padre: "control_acusacion",
    descripcion: "Cierre a favor del imputado sin llegar a juicio.",
  },
  {
    key: "juicio",
    titulo: "Juicio Oral y Público",
    padre: "control_acusacion",
    descripcion:
      "Núcleo del proceso acusatorio: oral, público, contradictorio, continuo y concentrado (arts. 290-320). Si hay condena, se abre la cesura para debatir la pena.",
  },
  {
    key: "absolucion",
    titulo: "Absolución",
    padre: "juicio",
    descripcion: "Sentencia favorable al imputado.",
  },
  {
    key: "condena",
    titulo: "Condena",
    padre: "juicio",
    riesgoAlto: true,
    descripcion:
      "Sentencia condenatoria; abre la cesura de pena y, firme, la etapa de ejecución.",
  },
  {
    key: "recursos",
    titulo: "Control de las Decisiones Judiciales",
    padre: "juicio",
    descripcion:
      "Impugnación ordinaria (doble conforme, 'Casal'), extraordinaria y revisión (arts. 322-339). Ante el tribunal de impugnación, la Cámara Federal de Casación y la CSJN.",
  },
  {
    key: "ejecucion",
    titulo: "Ejecución",
    padre: "recursos",
    descripcion:
      "Firme la sentencia, interviene el juez de ejecución (arts. 340-358). Régimen progresivo, libertad condicional, penas no privativas y ejecución civil.",
  },
];

// === NACIÓN — CPPN Ley 23.984 (sistema mixto) ===
const FLUJO_NACION: NodoTemplate[] = [
  {
    key: "actos_iniciales",
    titulo: "Actos Iniciales",
    padre: null,
    descripcion:
      "Denuncia (arts. 174-177), prevención policial (arts. 183-187) o querella. Intervienen el Juez de Instrucción y el Ministerio Público Fiscal. Libro II · Título I CPPN.",
  },
  {
    key: "desestimacion",
    titulo: "Desestimación / Incompetencia",
    padre: "actos_iniciales",
    descripcion:
      "Desestimación de la denuncia (art. 180), remisión por incompetencia o archivo de las actuaciones.",
  },
  {
    key: "instruccion",
    titulo: "Instrucción (Sumario)",
    padre: "actos_iniciales",
    descripcion:
      "Investigación dirigida por el Juez de Instrucción (art. 194), delegable al fiscal (art. 196). Indagatoria (arts. 294-304), procesamiento (art. 306). Plazo: 4 meses prorrogable (art. 207).",
  },
  {
    key: "prision",
    titulo: "Prisión preventiva",
    padre: "instruccion",
    riesgoAlto: true,
    descripcion:
      "Medida cautelar sobre la libertad del imputado (arts. 280-333). Exención de prisión y excarcelación.",
  },
  {
    key: "falta_merito",
    titulo: "Falta de mérito",
    padre: "instruccion",
    descripcion:
      "No hay mérito suficiente para procesar ni para sobreseer (art. 309).",
  },
  {
    key: "sobreseimiento_instruccion",
    titulo: "Sobreseimiento",
    padre: "instruccion",
    descripcion: "Cierre total o parcial de la causa (arts. 334-338).",
  },
  {
    key: "critica",
    titulo: "Crítica Instructoria y Elevación",
    padre: "instruccion",
    descripcion:
      "Etapa intermedia, escrita. Vista al fiscal y al querellante (art. 346), requerimiento de elevación a juicio (art. 347), oposición de la defensa (art. 349). Libro II · Título V CPPN.",
  },
  {
    key: "sobreseimiento_critica",
    titulo: "Sobreseimiento",
    padre: "critica",
    descripcion: "Si corresponde en la crítica instructoria (art. 350).",
  },
  {
    key: "juicio",
    titulo: "Juicio Oral",
    padre: "critica",
    descripcion:
      "Plenario ante el Tribunal Oral. Debate oral, público y contradictorio (arts. 354-404).",
  },
  {
    key: "absolucion",
    titulo: "Absolución",
    padre: "juicio",
    descripcion: "Sentencia absolutoria (arts. 398-404).",
  },
  {
    key: "condena",
    titulo: "Condena",
    padre: "juicio",
    riesgoAlto: true,
    descripcion: "Sentencia condenatoria (arts. 398-404).",
  },
  {
    key: "recursos",
    titulo: "Recursos",
    padre: "juicio",
    descripcion:
      "Reposición, apelación, casación, inconstitucionalidad y revisión (arts. 432-491). Cámara Nacional de Apelaciones, Cámara Federal de Casación y CSJN (art. 14 Ley 48).",
  },
  {
    key: "ejecucion",
    titulo: "Ejecución",
    padre: "recursos",
    descripcion:
      "Juez de Ejecución Penal (art. 490). Cómputo de la pena (arts. 493-494), libertad condicional, multas e inhabilitación.",
  },
];

// === PBA — CPP Ley 11.922 (acusatorio provincial) ===
const FLUJO_PBA: NodoTemplate[] = [
  {
    key: "actos_iniciales",
    titulo: "Actos Iniciales",
    padre: null,
    descripcion:
      "Denuncia (arts. 285-289), prevención policial (arts. 293-296) o querella. El Agente Fiscal dirige; el Juez de Garantías controla. Libro II · Título I CPP BA.",
  },
  {
    key: "desestimacion",
    titulo: "Desestimación / Archivo",
    padre: "actos_iniciales",
    descripcion:
      "Desestimación o archivo fiscal (art. 290); remisión por incompetencia.",
  },
  {
    key: "oportunidad",
    titulo: "Criterios de oportunidad",
    padre: "actos_iniciales",
    descripcion:
      "El fiscal puede no promover o desistir la acción: insignificancia, pena natural, conciliación (art. 56 bis).",
  },
  {
    key: "ipp",
    titulo: "Investigación Penal Preparatoria",
    padre: "actos_iniciales",
    descripcion:
      "A cargo del Agente Fiscal (arts. 56 y 266), control jurisdiccional del Juez de Garantías (art. 23). Declaración del imputado (art. 308). Plazo: 4 meses prorrogable (art. 282).",
  },
  {
    key: "prision",
    titulo: "Prisión preventiva",
    padre: "ipp",
    riesgoAlto: true,
    descripcion:
      "Medidas de coerción personal: detención, prisión preventiva y alternativas (arts. 144-208).",
  },
  {
    key: "sobreseimiento_ipp",
    titulo: "Sobreseimiento",
    padre: "ipp",
    descripcion: "Cierre definitivo a favor del imputado (arts. 321-326).",
  },
  {
    key: "sjp",
    titulo: "Suspensión del proceso a prueba",
    padre: "ipp",
    descripcion:
      "Reglas de conducta y reparación; cumplidas, se extingue la acción penal (art. 404 CPP BA · art. 76 bis CP).",
  },
  {
    key: "abreviado",
    titulo: "Juicio abreviado",
    padre: "ipp",
    descripcion:
      "Acuerdo entre fiscal e imputado sobre hechos, calificación y pena (arts. 395-403).",
  },
  {
    key: "critica",
    titulo: "Crítica y Elevación a Juicio",
    padre: "ipp",
    descripcion:
      "Etapa intermedia. Requerimiento fiscal (art. 334), oposición de la defensa en 15 días (art. 336), decisión del Juez de Garantías: auto de elevación (art. 337).",
  },
  {
    key: "sobreseimiento_critica",
    titulo: "Sobreseimiento",
    padre: "critica",
    descripcion: "Si procede en la etapa intermedia (arts. 321 y ss.).",
  },
  {
    key: "juicio",
    titulo: "Juicio Oral",
    padre: "critica",
    descripcion:
      "Tribunal en lo Criminal, colegiado o unipersonal (arts. 22 y 22 bis). Debate (arts. 338-375), veredicto y cesura (arts. 372-375).",
  },
  {
    key: "jurados",
    titulo: "Juicio por Jurados",
    padre: "juicio",
    descripcion:
      "Ley 14.543. Delitos dolosos con pena máxima superior a 15 años; jurado popular de 12 integrantes.",
  },
  {
    key: "absolucion",
    titulo: "Absolución",
    padre: "juicio",
    descripcion: "Veredicto absolutorio.",
  },
  {
    key: "condena",
    titulo: "Condena",
    padre: "juicio",
    riesgoAlto: true,
    descripcion:
      "Veredicto de culpabilidad; cesura del debate y sentencia (arts. 372-375).",
  },
  {
    key: "recursos",
    titulo: "Impugnaciones y Recursos",
    padre: "juicio",
    descripcion:
      "Apelación (Cámara de Apelación y Garantías), casación (Tribunal de Casación bonaerense), SCBA y CSJN (arts. 401-467).",
  },
  {
    key: "ejecucion",
    titulo: "Ejecución Penal",
    padre: "recursos",
    descripcion:
      "Juez de Ejecución (art. 25). Ley 12.256: régimen progresivo, salidas transitorias, libertad condicional (arts. 497-535).",
  },
];

export const FLUJO_POR_FUERO: Record<Fuero, NodoTemplate[]> = {
  federal: FLUJO_FEDERAL,
  nacion: FLUJO_NACION,
  pba: FLUJO_PBA,
};

export function generarPlantillaBase(
  casoId: string,
  fuero: Fuero,
): NodoProcesalInsert[] {
  const flujo = FLUJO_POR_FUERO[fuero];
  // Pre-generamos un UUID por cada nodo del template para poder cablear padre_id
  // entre nodos del mismo batch antes de insertar (mismo patrón de siempre).
  const idPorKey = new Map<string, string>(
    flujo.map((n) => [n.key, crypto.randomUUID()]),
  );
  const idDe = (key: string): string => {
    const id = idPorKey.get(key);
    if (!id)
      throw new Error(
        `Template del mapa (${fuero}) inconsistente: falta key "${key}"`,
      );
    return id;
  };

  return flujo.map((n) => {
    const esRaiz = n.padre === null;
    return {
      id: idDe(n.key),
      caso_id: casoId,
      titulo: n.titulo,
      descripcion: n.descripcion ?? null,
      tipo: esRaiz ? "raiz" : "prediccion",
      // Raíz "ocurrido" (ya pasó); el resto "desbloqueado" = "posible" (azul).
      estado: esRaiz ? "ocurrido" : "desbloqueado",
      padre_id: n.padre ? idDe(n.padre) : null,
      riesgo_alto: n.riesgoAlto ?? false,
    };
  });
}

// Ícono lineal (lucide) por etapa, para el render del nodo. Acoplado a los
// TÍTULOS de los flujos de arriba — vive acá a propósito para que título e
// ícono se editen en el mismo lugar. Muchos títulos se comparten entre fueros
// (Sobreseimiento, Condena, Prisión preventiva...) y usan el mismo ícono. Los
// nodos con título fuera de template (agregados a mano por el abogado o
// propuestos por la IA) caen a ICONO_DEFAULT.
export const ICONO_DEFAULT: LucideIcon = Circle;

export const ICONO_POR_TITULO: Record<string, LucideIcon> = {
  "Actos Iniciales": FileText,
  "Desestimación / Archivo": Archive,
  "Desestimación / Incompetencia": Archive,
  "Criterios de oportunidad": Route,
  "Instrucción (Sumario)": Search,
  "Investigación Penal Preparatoria": Search,
  "Prisión preventiva": Lock,
  "Falta de mérito": CircleDashed,
  Sobreseimiento: CircleCheck,
  "Suspensión del juicio a prueba": CirclePause,
  "Suspensión del proceso a prueba": CirclePause,
  "Juicio abreviado": FileSignature,
  "Conciliación / Reparación": Handshake,
  "Control de la Acusación": Landmark,
  "Crítica Instructoria y Elevación": FolderCheck,
  "Crítica y Elevación a Juicio": FolderCheck,
  "Juicio Oral": Scale,
  "Juicio Oral y Público": Scale,
  "Juicio por Jurados": Users,
  Absolución: BadgeCheck,
  Condena: Gavel,
  Recursos: RotateCcw,
  "Impugnaciones y Recursos": RotateCcw,
  "Control de las Decisiones Judiciales": RotateCcw,
  Ejecución: Hourglass,
  "Ejecución Penal": Hourglass,
};

export function iconoDeNodo(titulo: string): LucideIcon {
  return ICONO_POR_TITULO[titulo] ?? ICONO_DEFAULT;
}
