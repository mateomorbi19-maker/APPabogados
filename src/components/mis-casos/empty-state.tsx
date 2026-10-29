import { FolderOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

// Empty state cuando el usuario todavía no creó ningún caso. Tono sobrio,
// ícono neutro de lucide. Lo render el shell tanto en la columna izquierda
// como ocupando el ancho completo si querés (acá lo usamos solo en el
// shell cuando no hay casos en absoluto).
export function MisCasosEmptyState({ onCargar }: { onCargar: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <FolderOpen className="size-8 text-muted-foreground" />
      </div>
      <h2 className="font-serif text-2xl mb-2">Todavía no tenés casos guardados</h2>
      <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
        Cargá un PDF o contá los hechos para crear una causa y empezar a trabajar.
        También podés guardar una estrategia desde un análisis.
      </p>
      <Button className="mt-5" onClick={onCargar}>
        <Plus className="size-4" /> Cargar nueva causa
      </Button>
    </div>
  );
}
