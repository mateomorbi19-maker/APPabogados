"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Crosshair,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  RotateCcw,
  Undo2,
  Wand2,
} from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  casoId: string;
  casoTitulo: string;
  // Label del fuero activo (FUERO_LABEL). undefined = mapa sin fuero asignado.
  fueroLabel?: string;
  puedeAgregar: boolean; // hay un nodo seleccionado no bloqueado
  onAgregarEvento: () => void;
  // Reinicia el mapa al flujo nuevo. undefined = ocultar (mapa sin inicializar).
  onReiniciar?: () => void;
  // Re-corre dagre y persiste el layout. undefined = ocultar.
  onReordenar?: () => void;
  reordenando?: boolean;
  // Deshacer el último borrado de nodos. undefined = nada para deshacer.
  onDeshacer?: () => void;
};

export function MapaToolbar({
  casoId,
  casoTitulo,
  fueroLabel,
  puedeAgregar,
  onAgregarEvento,
  onReiniciar,
  onReordenar,
  reordenando,
  onDeshacer,
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
    <header className="flex items-center gap-3 border-b border-[var(--el-glass-border)] bg-[var(--el-glass)] px-4 py-2 backdrop-blur-xl">
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
        {fueroLabel ? (
          <p className="truncate text-[11px] leading-tight text-muted-foreground">
            {fueroLabel}
          </p>
        ) : null}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => void fitView({ padding: 0.2, duration: 400 })}
      >
        <Crosshair className="size-4" />
        Centrar vista
      </Button>
      {onDeshacer ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onDeshacer}
          title="Restaura los últimos nodos eliminados"
        >
          <Undo2 className="size-4" />
          <span className="hidden md:inline">Deshacer</span>
        </Button>
      ) : null}
      {onReordenar ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onReordenar}
          disabled={reordenando}
          title="Re-acomoda todos los nodos con el layout automático (se guarda)"
        >
          {reordenando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Wand2 className="size-4" />
          )}
          <span className="hidden md:inline">
            {reordenando ? "Reordenando..." : "Reordenar"}
          </span>
        </Button>
      ) : null}
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
      {onReiniciar ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onReiniciar}
          className="text-muted-foreground hover:text-foreground"
          title="Borra el progreso y reinstancia el flujo nuevo"
        >
          <RotateCcw className="size-4" />
          <span className="hidden md:inline">Reiniciar</span>
        </Button>
      ) : null}
      <Button size="sm" onClick={onAgregarEvento} disabled={!puedeAgregar}>
        <Plus className="size-4" />
        Agregar evento
      </Button>
    </header>
  );
}
