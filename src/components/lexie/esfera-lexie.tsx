"use client";

import { useCallback, useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import { useMediaQuery } from "@/lib/hooks/use-cliente";
import {
  acotarEstado,
  avanzar,
  crearEstado,
  enReposo,
  transformDe,
  type EstadoEsfera,
  type Limites,
} from "@/lib/lexie/fisica-esfera";

// La esfera de LEXIE: el ancla flotante de la asistente.
//
// Reemplaza al FAB `fixed bottom-5 right-5` que había antes. Dos cambios de
// fondo: se puede arrastrar a cualquier punto de la pantalla y se queda donde la
// dejen, y su movimiento pasa por un modelo físico en vez de por transiciones
// CSS (ver fisica-esfera.ts).
//
// === Regla de rendimiento ===
//
// Nada de lo que cambia por frame vive en el estado de React. La posición se
// escribe directo sobre el nodo (`nodo.style.transform`), igual que hace el
// panel viejo con el visualViewport de iOS, y por el mismo motivo: sesenta
// `setState` por segundo re-renderizarían el árbol entero mientras el abogado
// arrastra. Es además lo que exige la regla `react-hooks/set-state-in-effect`
// que el lint del repo tiene prendida.

const TAMANO = 60;
/** Aire mínimo contra los bordes en la posición por defecto. */
const MARGEN = 20;
/**
 * Cuánto se puede mover el dedo sin que deje de ser un tap. Por debajo de esto
 * el gesto abre el chat; por encima, solo arrastró. 6 px es el temblor normal de
 * un click con mouse y del apoyo de un pulgar.
 */
const UMBRAL_TAP = 6;

const CLAVE_POSICION = "el-lexie-pos";

/**
 * La posición se guarda como FRACCIÓN del área disponible, no en píxeles.
 * Guardar píxeles significaba que la esfera dejada en el borde derecho de un
 * monitor de 2560 aparecía fuera de pantalla en el celular, y que rotar el
 * teléfono la mandaba a cualquier lado.
 */
type PosicionGuardada = { fx: number; fy: number };

function limitesActuales(): Limites {
  return {
    maxX: Math.max(0, window.innerWidth - TAMANO),
    maxY: Math.max(0, window.innerHeight - TAMANO),
  };
}

function leerPosicion(): PosicionGuardada | null {
  try {
    const crudo = localStorage.getItem(CLAVE_POSICION);
    if (!crudo) return null;
    const p = JSON.parse(crudo) as Partial<PosicionGuardada>;
    if (typeof p.fx !== "number" || typeof p.fy !== "number") return null;
    if (!Number.isFinite(p.fx) || !Number.isFinite(p.fy)) return null;
    return { fx: Math.min(1, Math.max(0, p.fx)), fy: Math.min(1, Math.max(0, p.fy)) };
  } catch {
    // localStorage puede estar bloqueado (modo privado, permisos). Que la
    // esfera no recuerde dónde estaba es molesto; que la app no cargue, no.
    return null;
  }
}

function guardarPosicion(e: EstadoEsfera): void {
  try {
    const lim = limitesActuales();
    localStorage.setItem(
      CLAVE_POSICION,
      JSON.stringify({
        fx: lim.maxX > 0 ? e.x / lim.maxX : 1,
        fy: lim.maxY > 0 ? e.y / lim.maxY : 1,
      }),
    );
  } catch {
    /* ver leerPosicion */
  }
}

function posicionInicial(): { x: number; y: number } {
  const lim = limitesActuales();
  const guardada = leerPosicion();
  if (guardada) {
    return { x: guardada.fx * lim.maxX, y: guardada.fy * lim.maxY };
  }
  // Por defecto, abajo a la derecha: donde estaba el FAB de siempre, para que
  // nadie tenga que salir a buscarla la primera vez.
  return {
    x: Math.max(0, lim.maxX - MARGEN),
    y: Math.max(0, lim.maxY - MARGEN),
  };
}

export function EsferaLexie({
  onAbrir,
  ocupada = false,
}: {
  onAbrir: () => void;
  /**
   * LEXIE está pensando. Hoy no llega a verse —la esfera se desmonta mientras
   * el chat está abierto— pero se conserva para cuando el turno siga corriendo
   * con el chat cerrado.
   */
  ocupada?: boolean;
}) {
  const nodoRef = useRef<HTMLButtonElement>(null);
  const estadoRef = useRef<EstadoEsfera | null>(null);
  const rafRef = useRef<number | null>(null);
  const ultimoTRef = useRef(0);
  // Offset del dedo DENTRO de la esfera. Sin esto, agarrarla del borde la
  // centraría de un salto bajo el cursor en el primer frame.
  const agarreRef = useRef({ dx: 0, dy: 0 });
  // Dónde empezó el gesto y cuánto se alejó de ahí: es lo que separa un tap
  // (abre el chat) de un arrastre (solo mueve).
  const inicioRef = useRef({ x: 0, y: 0 });
  const desplazamientoRef = useRef(0);

  // El loop de rAF corre fuera de React y necesita leer esta preferencia en
  // cada frame, así que se espeja en un ref. La escritura va en un efecto y no
  // en el cuerpo del render: tocar un ref durante el render es justamente lo
  // que prohíbe `react-hooks/refs`.
  const sinMovimiento = useMediaQuery("(prefers-reduced-motion: reduce)");
  const sinMovimientoRef = useRef(sinMovimiento);
  useEffect(() => {
    sinMovimientoRef.current = sinMovimiento;
  }, [sinMovimiento]);

  const pintar = useCallback(() => {
    const nodo = nodoRef.current;
    const est = estadoRef.current;
    if (!nodo || !est) return;
    nodo.style.transform = sinMovimientoRef.current
      ? `translate3d(${est.x.toFixed(2)}px, ${est.y.toFixed(2)}px, 0)`
      : transformDe(est);
    // El morphing de reposo se apaga mientras se arrastra (ver globals.css): la
    // deformación real ya la maneja la física, y las dos a la vez se leen como
    // temblor. Va por atributo del DOM y no por estado de React, como todo lo
    // que cambia dentro del loop.
    nodo.dataset.arrastrando = est.arrastrando ? "true" : "false";
  }, []);

  // Arranca el loop si no está corriendo. Se apaga solo cuando la física entra
  // en reposo: una esfera quieta no tiene por qué despertar la GPU mientras el
  // abogado lee un expediente.
  const asegurarLoop = useCallback(() => {
    if (rafRef.current !== null) return;
    ultimoTRef.current = performance.now();
    const tick = (t: number) => {
      const est = estadoRef.current;
      if (!est) {
        rafRef.current = null;
        return;
      }
      const dt = (t - ultimoTRef.current) / 1000;
      ultimoTRef.current = t;

      if (sinMovimientoRef.current) {
        // Sin animación: la esfera va derecho adonde la llevan.
        est.x = est.objetivoX;
        est.y = est.objetivoY;
        acotarEstado(est, limitesActuales());
        est.vx = est.vy = est.deform = est.deformV = 0;
      } else {
        avanzar(est, dt, limitesActuales());
      }
      pintar();

      if (enReposo(est)) {
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [pintar]);

  // Montaje: posición inicial y primer pintado. Corre una sola vez.
  useEffect(() => {
    const inicial = posicionInicial();
    estadoRef.current = crearEstado(inicial.x, inicial.y);
    pintar();

    // Al cambiar el tamaño de la ventana (o rotar el teléfono) la esfera podría
    // quedar fuera de la pantalla: se la trae de vuelta adentro.
    const onResize = () => {
      const est = estadoRef.current;
      if (!est) return;
      acotarEstado(est, limitesActuales());
      est.objetivoX = est.x;
      est.objetivoY = est.y;
      pintar();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [pintar]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const est = estadoRef.current;
      if (!est || e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      agarreRef.current = { dx: e.clientX - est.x, dy: e.clientY - est.y };
      inicioRef.current = { x: e.clientX, y: e.clientY };
      desplazamientoRef.current = 0;
      est.arrastrando = true;
      est.objetivoX = est.x;
      est.objetivoY = est.y;
      asegurarLoop();
    },
    [asegurarLoop],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const est = estadoRef.current;
      if (!est || !est.arrastrando) return;
      // Distancia al punto donde empezó el gesto, y se queda con el máximo: un
      // arrastre que va y vuelve al origen sigue siendo un arrastre.
      desplazamientoRef.current = Math.max(
        desplazamientoRef.current,
        Math.hypot(e.clientX - inicioRef.current.x, e.clientY - inicioRef.current.y),
      );
      est.objetivoX = e.clientX - agarreRef.current.dx;
      est.objetivoY = e.clientY - agarreRef.current.dy;
      asegurarLoop();
    },
    [asegurarLoop],
  );

  const soltar = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const est = estadoRef.current;
      if (!est) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      if (!est.arrastrando) return;
      est.arrastrando = false;
      guardarPosicion(est);
      asegurarLoop();
    },
    [asegurarLoop],
  );

  // El click nativo se deja pasar (no hay preventDefault en pointerdown) para
  // que Enter y Espacio sigan funcionando sobre un <button> de verdad. Lo que se
  // filtra acá es el click que cierra un ARRASTRE: sin esto, mover la esfera
  // abriría el chat cada vez.
  const onClick = useCallback(() => {
    if (desplazamientoRef.current > UMBRAL_TAP) return;
    onAbrir();
  }, [onAbrir]);

  return (
    <button
      ref={nodoRef}
      type="button"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={soltar}
      onPointerCancel={soltar}
      onClick={onClick}
      aria-label="Abrir LEXIE, la asistente del estudio"
      title="LEXIE — arrastrame donde quieras (Ctrl+J)"
      // `fixed` a 0,0 y todo el movimiento por transform: cambiar `left`/`top`
      // dispararía layout en cada frame, mientras que un transform se resuelve
      // en el compositor.
      // `touch-action: none` es lo que evita que arrastrarla con el dedo
      // scrollee la página de atrás.
      className="pointer-events-auto fixed left-0 top-0 z-[41] size-[60px] cursor-grab touch-none select-none rounded-full outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-[var(--el-violet-light)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--el-canvas)]"
      style={{ willChange: "transform" }}
    >
      {/* Sombra difusa apoyada debajo: la misma `.el-platform` del mapa, que es
          lo que despega la esfera del fondo en vez de dejarla pegada. */}
      <span
        aria-hidden
        className="el-platform pointer-events-none absolute left-1/2 top-[calc(50%+26px)] -z-10 h-[22px] w-[68px] -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(139,92,246,0.45), transparent 70%)",
        }}
      />

      {/* La cáscara. Es la que se deforma y la que lleva el gradiente. */}
      <span aria-hidden className="el-lexie-orb absolute inset-0 overflow-hidden">
        <span className="el-lexie-flujo absolute inset-[-25%]" />
        {/* Specular: el brillo alto que convierte un círculo con degradé en algo
            con volumen. Mismas proporciones que el orbe del mapa. */}
        <span
          className="el-specular absolute rounded-full"
          style={{ top: "12%", left: "20%", width: "42%", height: "32%" }}
        />
      </span>

      {/* Anillo de "estoy pensando". Reusa el spin del mapa. */}
      {ocupada && (
        <span
          aria-hidden
          className="el-reticle pointer-events-none absolute -inset-[6px] rounded-full"
          style={{ borderColor: "rgba(196,181,253,0.65)" }}
        />
      )}

      <Sparkles
        className="relative z-[1] mx-auto size-6 text-white drop-shadow-[0_1px_3px_rgba(24,10,60,0.75)]"
        strokeWidth={1.9}
      />
    </button>
  );
}
