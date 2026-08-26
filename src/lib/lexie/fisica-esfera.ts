// La física de la esfera de LEXIE.
//
// Módulo PURO: no toca el DOM, no usa `window`, no importa React. Toda la
// integración pasa por `avanzar()`, así que el comportamiento se puede razonar
// y probar sin un browser — que es la única forma sensata de trabajar sobre algo
// que corre 60 veces por segundo.
//
// === Por qué a mano y no con una librería ===
//
// El repo no tiene framer-motion, react-spring, dnd-kit ni nada parecido, y esa
// ausencia es deliberada: es una PWA que tres abogados instalan en el celular.
// Todo lo que hace falta acá son dos resortes y un rebote, unas 120 líneas.
//
// === Los dos resortes ===
//
// 1. POSICIÓN. La esfera no se pega al dedo: lo PERSIGUE, con retraso. Ese lag
//    es todo el efecto — un elemento clavado al cursor se siente rígido, uno que
//    llega tarde y se pasa un poco se siente elástico. Al soltar conserva el
//    envión, roza hasta frenar y rebota contra los bordes.
//
// 2. DEFORMACIÓN. El squash & stretch no se calcula directo de la velocidad,
//    sino que persigue a la velocidad con su propio resorte, y ese resorte está
//    SUBAMORTIGUADO a propósito: cuando la esfera frena de golpe, la deformación
//    sigue oscilando un rato. Eso es lo que se lee como gelatina en vez de como
//    goma.

export type EstadoEsfera = {
  /** Posición del borde superior izquierdo, en px de viewport. */
  x: number;
  y: number;
  /** Velocidad, en px por segundo. */
  vx: number;
  vy: number;
  /** Adónde tira el dedo. Solo se usa mientras `arrastrando`. */
  objetivoX: number;
  objetivoY: number;
  arrastrando: boolean;
  /** Magnitud actual de la deformación, 0 = esfera perfecta. */
  deform: number;
  /** Velocidad de la deformación (el segundo resorte). */
  deformV: number;
  /** Hacia dónde apunta el estiramiento, en radianes. */
  angulo: number;
};

/** Caja donde la esfera puede moverse. `maxX/maxY` ya descuentan su tamaño. */
export type Limites = { maxX: number; maxY: number };

// Resorte de posición mientras se arrastra. C por debajo del amortiguamiento
// crítico (2·√K ≈ 32) para que se pase un poco y vuelva.
const K_ARRASTRE = 260;
const C_ARRASTRE = 22;

// Rozamiento al soltar: la velocidad decae e^(-F·t), así que a los 0,5 s queda
// un 6%. Suficiente para que se sienta el envión sin que la esfera se escape
// media pantalla.
const FRICCION = 5.5;

// Cuánta energía conserva un rebote contra el borde.
const RESTITUCION = 0.55;

// Resorte de deformación. K alto y C bajo = oscila varias veces antes de
// aquietarse: el "jiggle".
const K_DEFORM = 190;
const C_DEFORM = 13;

/** Velocidad a la que la deformación llega a su tope. */
const V_REFERENCIA = 1400;
/** Estiramiento máximo: 20% para un lado, 20% para el otro. */
const DEFORM_MAX = 0.2;

/**
 * Techo del paso de integración. Sin esto, volver a una pestaña que estuvo en
 * segundo plano entrega un `dt` de varios segundos y el integrador explota: la
 * esfera aparecería disparada fuera de la pantalla.
 */
const DT_MAX = 1 / 30;

/** Debajo de esto se considera quieta y el loop de animación se puede apagar. */
const EPS_VELOCIDAD = 1.2;
const EPS_DEFORM = 0.001;

export function crearEstado(x: number, y: number): EstadoEsfera {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    objetivoX: x,
    objetivoY: y,
    arrastrando: false,
    deform: 0,
    deformV: 0,
    angulo: 0,
  };
}

function acotar(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Avanza la simulación `dt` segundos. MUTA el estado a propósito: esto corre en
 * cada frame y no vale la pena asignar un objeto nuevo 60 veces por segundo.
 */
export function avanzar(e: EstadoEsfera, dt: number, lim: Limites): void {
  const h = Math.min(dt, DT_MAX);
  if (h <= 0) return;

  // — Resorte 1: posición —
  if (e.arrastrando) {
    e.vx += ((e.objetivoX - e.x) * K_ARRASTRE - e.vx * C_ARRASTRE) * h;
    e.vy += ((e.objetivoY - e.y) * K_ARRASTRE - e.vy * C_ARRASTRE) * h;
  } else {
    e.vx -= e.vx * FRICCION * h;
    e.vy -= e.vy * FRICCION * h;
  }
  e.x += e.vx * h;
  e.y += e.vy * h;

  // — Rebote contra los bordes —
  // Se aplica también mientras se arrastra: si el dedo sale de la pantalla, la
  // esfera queda pegada al borde en vez de irse a coordenadas negativas.
  if (e.x < 0) {
    e.x = 0;
    e.vx = Math.abs(e.vx) * RESTITUCION;
  } else if (e.x > lim.maxX) {
    e.x = lim.maxX;
    e.vx = -Math.abs(e.vx) * RESTITUCION;
  }
  if (e.y < 0) {
    e.y = 0;
    e.vy = Math.abs(e.vy) * RESTITUCION;
  } else if (e.y > lim.maxY) {
    e.y = lim.maxY;
    e.vy = -Math.abs(e.vy) * RESTITUCION;
  }

  // — Resorte 2: deformación —
  const velocidad = Math.hypot(e.vx, e.vy);
  const objetivo = acotar(velocidad / V_REFERENCIA, 0, 1) * DEFORM_MAX;
  e.deformV += ((objetivo - e.deform) * K_DEFORM - e.deformV * C_DEFORM) * h;
  e.deform += e.deformV * h;

  // El ángulo solo se actualiza cuando hay movimiento real. Si se recalculara
  // siempre, al frenar la dirección saltaría al azar con el ruido numérico y la
  // esfera giraría sola justo cuando debería estar aquietándose.
  if (velocidad > EPS_VELOCIDAD) {
    e.angulo = Math.atan2(e.vy, e.vx);
  }
}

/** Deja la esfera dentro de la caja tras un resize o al rotar el celular. */
export function acotarEstado(e: EstadoEsfera, lim: Limites): void {
  e.x = acotar(e.x, 0, Math.max(0, lim.maxX));
  e.y = acotar(e.y, 0, Math.max(0, lim.maxY));
}

/**
 * `true` cuando ya no queda nada que animar. El loop de rAF se apaga con esto:
 * una esfera quieta no tiene por qué despertar la GPU sesenta veces por segundo
 * mientras el abogado lee un expediente.
 */
export function enReposo(e: EstadoEsfera): boolean {
  return (
    !e.arrastrando &&
    Math.hypot(e.vx, e.vy) < EPS_VELOCIDAD &&
    Math.abs(e.deform) < EPS_DEFORM &&
    Math.abs(e.deformV) < EPS_DEFORM
  );
}

/**
 * El `transform` CSS del estado actual.
 *
 * El orden importa: primero se ubica, después se rota hacia la dirección del
 * movimiento, y recién ahí se estira sobre el eje X local. Así el estiramiento
 * siempre queda alineado con el desplazamiento, que es como se deforma algo
 * blando de verdad. La rotación se deshace al final para que el contenido
 * (el ícono) no gire con la cáscara.
 */
export function transformDe(e: EstadoEsfera): string {
  const g = (e.angulo * 180) / Math.PI;
  const sx = (1 + e.deform).toFixed(4);
  const sy = (1 - e.deform).toFixed(4);
  return `translate3d(${e.x.toFixed(2)}px, ${e.y.toFixed(2)}px, 0) rotate(${g.toFixed(2)}deg) scale(${sx}, ${sy}) rotate(${(-g).toFixed(2)}deg)`;
}
