"use client";

// La ventana flotante de LEXIE.
//
// === Lo que la diferencia de todo lo demás en el repo ===
//
// Es el primer overlay NO MODAL de la app. Todos los otros (el buscador ⌘K, los
// diálogos de Base UI, el `ui/sheet.tsx` manual, el panel de LEXIE anterior)
// ponen un velo, bloquean el scroll del body y capturan el foco. Este no hace
// nada de eso: se puede navegar, hacer scroll y clickear detrás mientras está
// abierto, que era justamente el pedido — preguntarle algo a LEXIE sin dejar de
// trabajar.
//
// La mecánica que lo permite es una sola: el contenedor de arriba es
// `pointer-events-none` y solo la ventana y la esfera vuelven a
// `pointer-events-auto`. Todo lo que no sea ellas deja pasar el click al fondo.
//
// === z-index ===
//
// Ventana 40, esfera 41. Por encima de la TopBar (20) y del panel de nodo del
// mapa (10), y por DEBAJO de los 50 que usan los modales de Base UI: así el ⌘K y
// los diálogos le siguen ganando, que es lo correcto — si el abogado abre el
// buscador, el buscador manda.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2, Sparkles, SquarePen, X } from "lucide-react";
import { useMediaQuery } from "@/lib/hooks/use-cliente";
import { cn } from "@/lib/utils";

const CLAVE_GEOMETRIA = "el-lexie-ventana";

const ANCHO_DEFECTO = 384;
const ALTO_DEFECTO = 560;
const ANCHO_MIN = 320;
const ALTO_MIN = 380;
const MARGEN = 20;

type Geometria = { x: number; y: number; w: number; h: number };

function acotar(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Encaja la ventana dentro del viewport actual.
 *
 * Se aplica SIEMPRE al leer de localStorage, no solo al cambiar de tamaño: una
 * geometría guardada en un monitor de 2560 px dejaría la ventana enteramente
 * fuera de pantalla al abrir la app en el celular, sin ninguna forma de traerla
 * de vuelta.
 */
function encajar(g: Geometria): Geometria {
  const w = acotar(g.w, ANCHO_MIN, Math.max(ANCHO_MIN, window.innerWidth - 16));
  const h = acotar(g.h, ALTO_MIN, Math.max(ALTO_MIN, window.innerHeight - 16));
  return {
    w,
    h,
    x: acotar(g.x, 0, Math.max(0, window.innerWidth - w)),
    y: acotar(g.y, 0, Math.max(0, window.innerHeight - h)),
  };
}

function geometriaInicial(): Geometria {
  try {
    const crudo = localStorage.getItem(CLAVE_GEOMETRIA);
    if (crudo) {
      const g = JSON.parse(crudo) as Partial<Geometria>;
      if (
        typeof g.x === "number" &&
        typeof g.y === "number" &&
        typeof g.w === "number" &&
        typeof g.h === "number" &&
        [g.x, g.y, g.w, g.h].every(Number.isFinite)
      ) {
        return encajar(g as Geometria);
      }
    }
  } catch {
    // localStorage bloqueado (modo privado): se abre en la posición por defecto.
  }
  // Abajo a la derecha, pero DEJANDO LIBRE la franja del pie: ahí es donde
  // arranca la esfera, y una ventana que nace justo encima de su propio botón
  // se ve como un error. 96px es la esfera (60) más su aire.
  return encajar({
    w: ANCHO_DEFECTO,
    h: ALTO_DEFECTO,
    x: window.innerWidth - ANCHO_DEFECTO - MARGEN,
    y: window.innerHeight - ALTO_DEFECTO - 96,
  });
}

function guardarGeometria(g: Geometria): void {
  try {
    localStorage.setItem(CLAVE_GEOMETRIA, JSON.stringify(g));
  } catch {
    /* ver geometriaInicial */
  }
}

// `nodo` es quién tomó el pointer capture: el header al mover, la manija al
// redimensionar. Hay que guardarlo porque el pointermove/up se manejan en el
// <section> padre (los eventos capturados igual burbujean), y liberar la
// captura desde el padre sería un no-op silencioso.
type Gesto = { nodo: Element } & (
  | { tipo: "mover"; dx: number; dy: number }
  | { tipo: "redimensionar"; x0: number; y0: number; w0: number; h0: number }
);

export function VentanaLexie({
  onCerrar,
  onNuevaConversacion,
  children,
}: {
  onCerrar: () => void;
  onNuevaConversacion: () => void;
  children: ReactNode;
}) {
  // Abajo de 640px la ventana flotante no tiene sentido: se comporta como una
  // hoja anclada al pie, ancho completo. Sigue SIN velo, así que la app de
  // atrás se puede seguir usando.
  const esMovil = useMediaQuery("(max-width: 639px)");
  const [completa, setCompleta] = useState(false);

  const nodoRef = useRef<HTMLElement>(null);
  const cuerpoRef = useRef<HTMLDivElement>(null);
  const geoRef = useRef<Geometria | null>(null);
  const gestoRef = useRef<Gesto | null>(null);

  const flotante = !esMovil && !completa;

  // Aplica la geometría al nodo. Va por estilo directo y no por estado de
  // React: durante un arrastre esto corre en cada `pointermove`, y un
  // re-render por evento haría saltar la ventana.
  const aplicar = useCallback(() => {
    const nodo = nodoRef.current;
    const g = geoRef.current;
    if (!nodo || !g) return;
    nodo.style.transform = `translate3d(${g.x}px, ${g.y}px, 0)`;
    nodo.style.width = `${g.w}px`;
    nodo.style.height = `${g.h}px`;
  }, []);

  const limpiarGeometria = useCallback(() => {
    const nodo = nodoRef.current;
    if (!nodo) return;
    nodo.style.removeProperty("transform");
    nodo.style.removeProperty("width");
    nodo.style.removeProperty("height");
  }, []);

  useEffect(() => {
    if (!geoRef.current) geoRef.current = geometriaInicial();
    if (flotante) aplicar();
    else limpiarGeometria();

    const onResize = () => {
      if (!geoRef.current) return;
      geoRef.current = encajar(geoRef.current);
      if (flotante) aplicar();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [flotante, aplicar, limpiarGeometria]);

  // El teclado virtual en iOS.
  //
  // `100dvh` alcanza en Android (el `interactiveWidget: "resizes-content"` del
  // layout achica el viewport de layout), pero iOS no lo implementa: ahí la
  // fila de escritura queda debajo del teclado. `visualViewport` es el único que
  // sabe cuánto quedó realmente a la vista.
  //
  // OJO — se compensa sobre el CUERPO, no sobre el nodo de la ventana: ese ya
  // usa `transform` para su propia posición, y escribir ahí lo movería de lugar.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const ajustar = () => {
      const cuerpo = cuerpoRef.current;
      if (!cuerpo) return;
      if (flotante) {
        cuerpo.style.removeProperty("max-height");
        return;
      }
      // Modo hoja o pantalla completa: el alto útil es el del viewport visual.
      cuerpo.style.maxHeight = `${vv.height}px`;
    };

    ajustar();
    vv.addEventListener("resize", ajustar);
    vv.addEventListener("scroll", ajustar);
    return () => {
      vv.removeEventListener("resize", ajustar);
      vv.removeEventListener("scroll", ajustar);
    };
  }, [flotante]);

  const onPointerDownBarra = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!flotante || e.button !== 0) return;
      const g = geoRef.current;
      if (!g) return;
      // No secuestrar el gesto cuando el pointer bajó sobre un botón de la
      // barra: si no, cerrar o maximizar arrastraría la ventana.
      if ((e.target as HTMLElement).closest("button")) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      gestoRef.current = {
        tipo: "mover",
        nodo: e.currentTarget,
        dx: e.clientX - g.x,
        dy: e.clientY - g.y,
      };
    },
    [flotante],
  );

  const onPointerDownResize = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!flotante || e.button !== 0) return;
      const g = geoRef.current;
      if (!g) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.stopPropagation();
      gestoRef.current = {
        tipo: "redimensionar",
        nodo: e.currentTarget,
        x0: e.clientX,
        y0: e.clientY,
        w0: g.w,
        h0: g.h,
      };
    },
    [flotante],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const gesto = gestoRef.current;
      const g = geoRef.current;
      if (!gesto || !g) return;
      if (gesto.tipo === "mover") {
        g.x = acotar(e.clientX - gesto.dx, 0, window.innerWidth - g.w);
        g.y = acotar(e.clientY - gesto.dy, 0, window.innerHeight - g.h);
      } else {
        g.w = acotar(
          gesto.w0 + (e.clientX - gesto.x0),
          ANCHO_MIN,
          window.innerWidth - g.x,
        );
        g.h = acotar(
          gesto.h0 + (e.clientY - gesto.y0),
          ALTO_MIN,
          window.innerHeight - g.y,
        );
      }
      aplicar();
    },
    [aplicar],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const gesto = gestoRef.current;
    if (!gesto) return;
    gestoRef.current = null;
    if (gesto.nodo.hasPointerCapture(e.pointerId)) {
      gesto.nodo.releasePointerCapture(e.pointerId);
    }
    if (geoRef.current) guardarGeometria(geoRef.current);
  }, []);

  return (
    <section
      ref={nodoRef}
      // Sin `aria-modal` y sin `role="dialog"`: no es modal, y anunciarlo como
      // tal le mentiría a un lector de pantalla sobre si el resto de la página
      // sigue disponible. Sí sigue disponible.
      aria-label="LEXIE, asistente del estudio"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(e) => {
        // Escape cierra solo si el foco está adentro. Un listener global
        // robaría el Escape de los diálogos que se abran por encima.
        if (e.key === "Escape") {
          e.stopPropagation();
          onCerrar();
        }
      }}
      className={cn(
        "pointer-events-auto fixed z-40 flex flex-col overflow-hidden text-[var(--el-text)]",
        // El vidrio de la app: oscuro pero no opaco, como se pidió. Mismos
        // tokens que la toolbar del mapa y el minimapa.
        "border border-[var(--el-glass-border)] bg-[var(--el-glass)] shadow-[0_16px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl",
        flotante && "left-0 top-0 rounded-2xl",
        completa && "inset-0 rounded-none",
        esMovil &&
          !completa &&
          "inset-x-0 bottom-0 h-[68dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]",
      )}
    >
      {/* — Barra de título / manija de arrastre — */}
      <header
        onPointerDown={onPointerDownBarra}
        className={cn(
          "flex shrink-0 select-none items-center justify-between gap-2 border-b border-[var(--el-glass-border)] px-3 py-2.5",
          flotante && "cursor-grab active:cursor-grabbing",
          completa && "pt-[env(safe-area-inset-top)]",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--el-violet)]/15">
            <Sparkles className="size-4 text-[var(--el-violet-light)]" />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-[var(--el-text)]">
              LEXIE
            </p>
            <p className="truncate text-[11px] text-[var(--el-text-muted)]">
              Asistente del estudio
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <BotonBarra
            onClick={onNuevaConversacion}
            etiqueta="Nueva conversación"
          >
            <SquarePen className="size-4" />
          </BotonBarra>
          {!esMovil && (
            <BotonBarra
              onClick={() => setCompleta((v) => !v)}
              etiqueta={completa ? "Salir de pantalla completa" : "Pantalla completa"}
            >
              {completa ? (
                <Minimize2 className="size-4" />
              ) : (
                <Maximize2 className="size-4" />
              )}
            </BotonBarra>
          )}
          <BotonBarra onClick={onCerrar} etiqueta="Cerrar">
            <X className="size-4" />
          </BotonBarra>
        </div>
      </header>

      <div ref={cuerpoRef} className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>

      {/* — Manija de redimensionado —
          Solo en modo flotante: a pantalla completa y en la hoja de celular no
          hay nada que redimensionar. */}
      {flotante && (
        <span
          onPointerDown={onPointerDownResize}
          role="presentation"
          className="absolute bottom-0 right-0 size-4 cursor-nwse-resize touch-none"
          style={{
            background:
              "linear-gradient(135deg, transparent 50%, var(--el-glass-border) 50%, var(--el-glass-border) 62%, transparent 62%, transparent 74%, var(--el-glass-border) 74%, var(--el-glass-border) 86%, transparent 86%)",
          }}
        />
      )}
    </section>
  );
}

function BotonBarra({
  onClick,
  etiqueta,
  children,
}: {
  onClick: () => void;
  etiqueta: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      title={etiqueta}
      className="grid size-8 place-items-center rounded-md text-[var(--el-text-soft)] transition hover:bg-[var(--el-violet)]/15 hover:text-[var(--el-violet-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--el-violet-light)]"
    >
      {children}
    </button>
  );
}
