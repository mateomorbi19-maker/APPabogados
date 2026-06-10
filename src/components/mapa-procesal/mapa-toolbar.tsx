"use client";
import Link from "next/link";
import { ArrowLeft, Crosshair, Plus } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  casoId: string;
  casoTitulo: string;
  puedeAgregar: boolean; // hay un nodo seleccionado no bloqueado
  onAgregarEvento: () => void;
};

export function MapaToolbar({
  casoId,
  casoTitulo,
  puedeAgregar,
  onAgregarEvento,
}: Props) {
  const { fitView } = useReactFlow();

  return (
    <header className="flex items-center gap-3 border-b border-border bg-card/80 px-4 py-2 backdrop-blur">
      <Link
        href={`/dashboard/mis-casos/${casoId}`}
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
      >
        <ArrowLeft className="size-4" />
        Volver al caso
      </Link>

      <div className="min-w-0 flex-1 text-center">
        <p className="truncate text-sm">
          <span className="font-medium">Mapa procesal</span>
          <span className="text-muted-foreground"> · {casoTitulo}</span>
        </p>
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => void fitView({ duration: 400 })}
      >
        <Crosshair className="size-4" />
        Centrar vista
      </Button>
      <Button size="sm" onClick={onAgregarEvento} disabled={!puedeAgregar}>
        <Plus className="size-4" />
        Agregar evento
      </Button>
    </header>
  );
}
