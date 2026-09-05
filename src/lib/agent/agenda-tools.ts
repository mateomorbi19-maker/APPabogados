import "server-only";
import type { DominioLexie } from "@/lib/agent/lexie-dominio";

// Dominio AGENDA de LEXIE: crear, editar y eliminar eventos. Se completa en
// el sub-paso 11.4. Mientras tanto exporta el contrato vacío para que los
// archivos compartidos ya estén cableados.

export const DOMINIO_AGENDA: DominioLexie = {
  nombre: "agenda",
  familias: () => [],
  ejecutarPendiente: async () => null,
  prompt: "",
  manual: "",
};
