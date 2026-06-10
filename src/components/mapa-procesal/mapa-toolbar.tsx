"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Crosshair, Maximize2, Minimize2, Plus } from "lucide-react";
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
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  };

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
        onClick={() => void fitView({ padding: 0.2, duration: 400 })}
      >
        <Crosshair className="size-4" />
        Centrar vista
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleFullscreen}
        aria-label={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
      >
        {fullscreen ? (
          <Minimize2 className="size-4" />
        ) : (
          <Maximize2 className="size-4" />
        )}
        <span className="hidden md:inline">
          {fullscreen ? "Salir" : "Pantalla completa"}
        </span>
      </Button>
      <Button size="sm" onClick={onAgregarEvento} disabled={!puedeAgregar}>
        <Plus className="size-4" />
        Agregar evento
      </Button>
    </header>
  );
}
