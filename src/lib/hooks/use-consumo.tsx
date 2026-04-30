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
  // jsonb laxo del server. El componente que lo consume (modal de detalle
  // 5.1) lo valida con `ejecucionMetadataSchema` antes de leerlo.
  metadata: unknown;
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
  // Dos refs distintas con motivos distintos:
  //   (a) inFlightRef: in-flight guard. Si revalidate() entra mientras hay un
  //       fetch vivo, retornamos en seco. Sin esto, 5 clicks rápidos en
  //       "Actualizar" disparan 5 requests porque `disabled={isLoading}` no
  //       alcanza: React 18 batchea renders, así que múltiples clicks pueden
  //       procesarse antes de que el `disabled` se propague al DOM.
  //   (b) controllerRef: AbortController para cancelar el fetch vivo en el
  //       cleanup del useEffect cuando el provider se desmonta — así evitamos
  //       setState sobre un componente desmontado.
  const inFlightRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  const revalidate = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
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
    } finally {
      inFlightRef.current = false;
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
