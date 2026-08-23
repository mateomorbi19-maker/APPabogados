"use client";
import { useCallback, useSyncExternalStore } from "react";

// Lecturas que SOLO existen en el browser (media queries y feature detection),
// hechas sin `useEffect` + `setState`.
//
// El patrón obvio —arrancar en false y corregir en un efecto— tiene dos
// problemas: dispara un render en cascada (lo marca la regla
// react-hooks/set-state-in-effect) y deja el valor equivocado durante el primer
// frame. `useSyncExternalStore` es la API que React expone justamente para
// esto: el `getServerSnapshot` da el valor del server (false, porque el server
// no sabe nada del dispositivo), así que el markup hidrata sin desajuste, y el
// valor real entra en el mismo commit en vez de en un segundo pase.

const SIN_SUSCRIPCION = () => () => {};
const FALSO = () => false;

// Media query reactiva: si el usuario rota el teléfono o cambia el tamaño de la
// ventana, el componente se entera.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    FALSO,
  );
}

// Feature detection pura (¿existe esta API?). No cambia durante la vida de la
// página, así que no hay a qué suscribirse: `SIN_SUSCRIPCION` devuelve un
// unsubscribe vacío. `leer` tiene que devolver siempre lo mismo para la misma
// sesión, o React va a re-renderizar en loop.
export function useCapacidadDelBrowser(leer: () => boolean): boolean {
  return useSyncExternalStore(SIN_SUSCRIPCION, leer, FALSO);
}

// Azúcar del caso más usado: "¿esto es un dispositivo con puntero fino
// (mouse/trackpad)?". Es la pregunta correcta para decidir atajos de teclado y
// affordances de hover — no el ancho de pantalla, porque una tablet grande
// sigue siendo táctil y una laptop chica no lo es.
export function usePunteroFino(): boolean {
  return useMediaQuery("(pointer: fine)");
}
