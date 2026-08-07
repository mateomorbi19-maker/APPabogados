"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  esTema,
  TEMA_DEFAULT,
  TEMA_STORAGE_KEY,
  type Tema,
} from "./tema";

// Estado del tema. Deliberadamente sin librería: son dos opciones, una clase en
// `<html>` y una clave de localStorage. `next-themes` resolvería lo mismo con
// una dependencia más y un provider que no controlamos.
//
// El primer paint YA sale con el tema correcto gracias a SCRIPT_ANTI_FLASH
// (ver tema.ts). Este provider se encarga de lo que pasa después: leer la
// preferencia guardada, aplicarla cuando el usuario la cambia, y —si eligió
// "Sistema"— reaccionar a que el sistema operativo cambie de modo mientras la
// app está abierta.

type Ctx = {
  tema: Tema;
  setTema: (t: Tema) => void;
  /** Qué se está viendo AHORA. Con tema="sistema" depende del SO. */
  oscuro: boolean;
};

const TemaContext = createContext<Ctx | null>(null);

const QUERY_OSCURO = "(prefers-color-scheme: dark)";

function sistemaEnOscuro(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia(QUERY_OSCURO).matches;
}

function aplicar(oscuro: boolean): void {
  const el = document.documentElement;
  el.classList.toggle("dark", oscuro);
  // `color-scheme` es lo que hace que los controles nativos (popup del select,
  // calendario del date, scrollbars) sigan al tema. Sin esto quedan blancos
  // sobre la app oscura.
  el.style.colorScheme = oscuro ? "dark" : "light";
}

/** Preferencia guardada, o el default. Segura de llamar en el servidor. */
function leerPreferencia(): Tema {
  if (typeof window === "undefined") return TEMA_DEFAULT;
  try {
    const guardado = window.localStorage.getItem(TEMA_STORAGE_KEY);
    return esTema(guardado) ? guardado : TEMA_DEFAULT;
  } catch {
    // Almacenamiento bloqueado: se usa el default por esta sesión.
    return TEMA_DEFAULT;
  }
}

export function TemaProvider({ children }: { children: ReactNode }) {
  // Inicialización perezosa en vez de leer localStorage en un efecto: el DOM ya
  // tiene el tema aplicado por SCRIPT_ANTI_FLASH, así que este estado sólo
  // necesita reflejarlo, no producirlo.
  //
  // El servidor renderiza con el default, el cliente con lo guardado — y eso no
  // genera desajuste de hidratación porque lo único que depende de `tema` es el
  // contenido del diálogo de Ajustes, que arranca cerrado y no se monta.
  const [tema, setTemaState] = useState<Tema>(leerPreferencia);
  const [oscuro, setOscuro] = useState(() =>
    leerPreferencia() === "sistema" ? sistemaEnOscuro() : true,
  );

  // Con "Sistema" hay que seguir escuchando: el usuario puede tener el SO en
  // modo automático por horario y la app queda abierta cuando cambia.
  useEffect(() => {
    if (tema !== "sistema") return;
    const mq = window.matchMedia(QUERY_OSCURO);
    const onChange = (e: MediaQueryListEvent) => {
      setOscuro(e.matches);
      aplicar(e.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [tema]);

  const setTema = useCallback((t: Tema) => {
    setTemaState(t);
    const nuevoOscuro = t === "sistema" ? sistemaEnOscuro() : true;
    setOscuro(nuevoOscuro);
    // Se aplica al DOM acá y no en un efecto: el cambio de tema es una acción
    // del usuario, y el DOM es un sistema externo que hay que sincronizar en el
    // mismo gesto (además, la regla de lint del proyecto prohíbe setState
    // sincrónico dentro de un efecto).
    aplicar(nuevoOscuro);
    try {
      window.localStorage.setItem(TEMA_STORAGE_KEY, t);
    } catch {
      // Sin almacenamiento la elección vale para esta sesión y nada más.
    }
  }, []);

  const value = useMemo<Ctx>(
    () => ({ tema, setTema, oscuro }),
    [tema, setTema, oscuro],
  );

  return <TemaContext.Provider value={value}>{children}</TemaContext.Provider>;
}

export function useTema(): Ctx {
  const ctx = useContext(TemaContext);
  if (!ctx) {
    throw new Error("useTema debe usarse dentro de <TemaProvider>");
  }
  return ctx;
}
