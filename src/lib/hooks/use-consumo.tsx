"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ConsumoSummary = {
  nombre: string;
  tokens_usados_mes: number;
  gasto_usd_mes: number;
  ejecuciones_mes: number;
  tokens_restantes: number;
  limite_tokens_mensual: number;
};

export type EjecucionRow = {
  id: string;
  tipo: string;
  modelo: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  costo_usd: number;
  ejecutado_en: string;
};

export type ConsumoData = {
  consumo: ConsumoSummary;
  historial: EjecucionRow[];
};

export type ConsumoState =
  | { status: "loading" }
  | { status: "ready"; data: ConsumoData }
  | { status: "error"; message: string };

type ConsumoCtxValue = {
  state: ConsumoState;
  revalidate: () => Promise<void>;
};

const ConsumoCtx = createContext<ConsumoCtxValue | null>(null);

export function ConsumoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConsumoState>({ status: "loading" });
  // Refs persistentes para cubrir dos casos de borde:
  //   (a) race entre fetch inicial y revalidate(): si revalidate dispara
  //       mientras hay un fetch en vuelo, abortamos el anterior antes de
  //       arrancar el nuevo, así los responses no se pisan en orden no
  //       determinístico.
  //   (b) unmount: el cleanup del useEffect aborta cualquier fetch vivo
  //       para no setState sobre un componente desmontado.
  const controllerRef = useRef<AbortController | null>(null);

  const revalidate = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setState({ status: "loading" });
    try {
      const res = await fetch("/api/consumo", { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!res.ok) {
        // 403 acá indica inconsistencia (page.tsx server-side ya pasó la
        // whitelist). NO redirigimos a /forbidden desde el provider —
        // preferimos error visible para detectar el bug de raíz.
        setState({
          status: "error",
          message:
            res.status === 403
              ? "El servidor rechazó la consulta de consumo (403)"
              : `No se pudo cargar el consumo (HTTP ${res.status})`,
        });
        return;
      }
      const data = (await res.json()) as ConsumoData;
      if (controller.signal.aborted) return;
      setState({ status: "ready", data });
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setState({
        status: "error",
        message: e instanceof Error ? e.message : "Error desconocido",
      });
    }
  }, []);

  useEffect(() => {
    void revalidate();
    return () => {
      controllerRef.current?.abort();
    };
  }, [revalidate]);

  return (
    <ConsumoCtx.Provider value={{ state, revalidate }}>
      {children}
    </ConsumoCtx.Provider>
  );
}

export function useConsumo(): ConsumoCtxValue {
  const ctx = useContext(ConsumoCtx);
  if (!ctx) {
    throw new Error("useConsumo debe usarse dentro de <ConsumoProvider>");
  }
  return ctx;
}
