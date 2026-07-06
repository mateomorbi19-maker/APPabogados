// Ícono lineal (lucide) por etapa, para el render del nodo. Vive en su propio
// módulo (y NO en plantilla-base.ts) a propósito: plantilla-base se importa
// del lado server (queries, simulación) y no debe arrastrar lucide-react.
// ⚠️ Acoplado a los TÍTULOS de FLUJO_POR_FUERO — al editar un título allá,
// actualizar el mapping acá. Muchos títulos se comparten entre fueros y usan
// el mismo ícono. Los nodos con título fuera de template (agregados a mano por
// el abogado o propuestos por la IA) caen a ICONO_DEFAULT.
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
