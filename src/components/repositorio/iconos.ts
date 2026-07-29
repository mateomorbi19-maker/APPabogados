// `COLECCIONES[c].icono` guarda el NOMBRE del ícono ("Gavel"), no el componente:
// types.ts es importable desde el cliente y no puede depender de lucide. El
// mapeo nombre → componente se resuelve acá con un Record explícito, por el
// mismo motivo por el que no se construyen clases de Tailwind en runtime:
// nada de indexar el barrel de lucide con un string dinámico.

import { BookOpen, Gavel, type LucideIcon } from "lucide-react";
import type { Coleccion } from "@/lib/repositorio/types";

export const ICONO_COLECCION: Record<Coleccion, LucideIcon> = {
  jurisprudencia: Gavel,
  doctrina: BookOpen,
};
