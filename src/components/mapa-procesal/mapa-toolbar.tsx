"use client";
import { useEffect, useState } from "react";
import { useCapacidadDelBrowser } from "@/lib/hooks/use-cliente";

// Fuera del componente: `useSyncExternalStore` llama a getSnapshot en cada
// render y necesita que devuelva siempre lo mismo.
const SOPORTA_FULLSCREEN = () =>
  typeof document.documentElement.requestFullscreen === "function";
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

// Abajo de 768px estos botones se quedan SOLO con el ícono, así que el rótulo
// pasa a ser el aria-label y el blanco táctil hay que ponerlo a mano: `size=sm`
// da 36px de alto y ~38 de ancho, por debajo del piso de 40 de la app.
const ICONO_MOVIL = "max-md:size-10";

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
  // El iPhone no implementa la Fullscreen API sobre elementos: en iOS Safari
  // `document.documentElement.requestFullscreen` es `undefined`, así que la
  // llamada tiraba un TypeError SINCRÓNICO — antes de que existiera promesa
  // que catchear. El botón no hacía nada, ensuciaba la consola y ocupaba lugar
  // en la barra más apretada de la app justo donde no sirve.
  // Feature detection vía useSyncExternalStore: el server no sabe si el browser
  // soporta fullscreen, así que hidrata en false y el valor real llega en el
  // mismo commit. Con useState+useEffect era un render en cascada.
  const puedeFullscreen = useCapacidadDelBrowser(SOPORTA_FULLSCREEN);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      // `?.()` corta TODA la cadena (el `.catch` incluido) si el método no
      // existe, que es exactamente el caso del iPhone.
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };

  return (
    // En móvil la barra es de DOS filas: los 7 controles con rótulo pedían
    // ~600px de ancho mínimo (todos los botones traen `shrink-0`), así que en
    // 390px el contenido desbordaba ~210px y "Agregar evento" —la acción
    // principal— quedaba fuera de pantalla. `md:contents` disuelve las dos
    // filas arriba de 768px: en escritorio la barra queda EXACTAMENTE como
    // estaba (una fila, gap-3, px-4).
    <header
      className="flex flex-col gap-1.5 border-b border-[var(--el-glass-border)] bg-[var(--el-glass)] px-3 py-2 backdrop-blur-xl md:flex-row md:items-center md:gap-3 md:px-4"
      // viewportFit=cover: instalada como app, la status bar del iPhone se
      // dibuja ENCIMA de esta barra si no se compensa (mismo criterio que
      // nav/top-bar.tsx). En escritorio el env() vale 0 → queda el py-2.
      style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
    >
      {/* Fila 1 en móvil: volver + título de la causa. */}
      <div className="flex min-w-0 items-center gap-2 md:contents">
        <Link
          href={`/dashboard/mis-casos/${casoId}`}
          aria-label="Volver al caso"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            ICONO_MOVIL,
          )}
        >
          <ArrowLeft className="size-4" />
          <span className="hidden md:inline">Volver al caso</span>
        </Link>

        <div className="min-w-0 flex-1 text-left md:text-center">
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
      </div>

      {/* Fila 2 en móvil: las acciones, alineadas a la derecha. `flex-wrap` es
          el seguro de que nada se salga del ancho aunque estén las cuatro
          condicionales a la vez (Deshacer, Reordenar, Pantalla completa,
          Reiniciar) en un teléfono de 360px. */}
      <div className="flex flex-wrap items-center justify-end gap-1 md:contents">
        <Button
          variant="ghost"
          size="sm"
          className={ICONO_MOVIL}
          aria-label="Centrar vista"
          onClick={() => void fitView({ padding: 0.2, duration: 400 })}
        >
          <Crosshair className="size-4" />
          <span className="hidden md:inline">Centrar vista</span>
        </Button>
        {onDeshacer ? (
          <Button
            variant="ghost"
            size="sm"
            className={ICONO_MOVIL}
            onClick={onDeshacer}
            // El `title` no existe en touch: sin aria-label estos tres eran
            // íconos indistinguibles.
            aria-label="Deshacer"
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
            className={ICONO_MOVIL}
            onClick={onReordenar}
            disabled={reordenando}
            aria-label="Reordenar el mapa"
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
        {puedeFullscreen ? (
          <Button
            variant="ghost"
            size="sm"
            className={ICONO_MOVIL}
            onClick={toggleFullscreen}
            aria-label={
              fullscreen ? "Salir de pantalla completa" : "Pantalla completa"
            }
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
        ) : null}
        {onReiniciar ? (
          <>
            {/* Separador solo en móvil: Reiniciar borra todo el progreso y sin
                rótulo queda como un ícono más pegado a dos inofensivos. El
                golpe accidental igual es recuperable (abre un diálogo de
                confirmación), pero la separación visual es barata. */}
            <span
              aria-hidden
              className="mx-0.5 h-5 w-px bg-[var(--el-glass-border)] md:hidden"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={onReiniciar}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                ICONO_MOVIL,
              )}
              aria-label="Reiniciar mapa"
              title="Borra el progreso y reinstancia el flujo nuevo"
            >
              <RotateCcw className="size-4" />
              <span className="hidden md:inline">Reiniciar</span>
            </Button>
          </>
        ) : null}
        <Button
          size="sm"
          onClick={onAgregarEvento}
          disabled={!puedeAgregar}
          className="max-md:h-10"
        >
          <Plus className="size-4" />
          Agregar
          <span className="hidden md:inline">evento</span>
        </Button>
      </div>
    </header>
  );
}
