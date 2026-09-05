import "server-only";
import type { DominioLexie } from "@/lib/agent/lexie-dominio";

// Dominio FICHA de LEXIE. Se completa en su sub-paso de la Fase 11. Mientras
// tanto exporta el contrato vacío para que los archivos compartidos ya estén
// cableados.

export const DOMINIO_FICHA: DominioLexie = {
  nombre: "ficha",
  familias: () => [],
  ejecutarPendiente: async () => null,
  prompt: "",
  manual: "",
};
