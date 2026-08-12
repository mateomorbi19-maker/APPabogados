"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtRelativo } from "@/lib/format";
import { rolBadge, rolLabel } from "@/lib/casos/rol";

// Buscador global. El disparador vive en el Inicio (la fila de búsqueda de
// arriba de todo), pero el diálogo se monta en el shell de navegación: así el
// atajo ⌘K / Ctrl+K funciona desde cualquier sección, que es lo que hace que un
// buscador sea "global" y no un campo más de una pantalla.

export type ResultadoBusqueda = {
  id: string;
  titulo: string;
  rol: string;
  actualizado_en: string;
  campo: "titulo" | "relato" | "contexto";
  fragmento: string;
};

const CAMPO_LABEL: Record<ResultadoBusqueda["campo"], string> = {
  titulo: "Carátula",
  relato: "En el relato",
  contexto: "En el formulario",
};

const DEBOUNCE_MS = 220;
const MIN_CARACTERES = 2;

type BuscadorCtxValue = { abrir: () => void };
const BuscadorCtx = createContext<BuscadorCtxValue | null>(null);

export function BuscadorProvider({ children }: { children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const abrir = useCallback(() => setAbierto(true), []);

  // ⌘K en Mac, Ctrl+K en Windows. `e.key` puede venir en mayúscula si el
  // usuario tiene Shift o Caps activo, así que comparamos en minúscula.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "k") return;
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      // Abre, no alterna: cerrar tiene que pasar SIEMPRE por onOpenChange, que
      // es donde el diálogo limpia la búsqueda anterior. Con un toggle acá se
      // podría cerrar por afuera y reabrir con el estado sucio.
      setAbierto(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo(() => ({ abrir }), [abrir]);

  return (
    <BuscadorCtx.Provider value={value}>
      {children}
      <BuscadorDialog abierto={abierto} onAbiertoChange={setAbierto} />
    </BuscadorCtx.Provider>
  );
}

export function useBuscador(): BuscadorCtxValue {
  const ctx = useContext(BuscadorCtx);
  if (!ctx) {
    throw new Error("useBuscador debe usarse dentro de <BuscadorProvider>");
  }
  return ctx;
}

/** Etiqueta del atajo según plataforma. Va por useSyncExternalStore y no por
 *  useState + useEffect porque la plataforma no cambia nunca: es un valor que
 *  se LEE del entorno, con un snapshot distinto en el server (donde no sabemos
 *  cuál es) que en el cliente. Así React resuelve la hidratación sin mismatch
 *  y sin un render extra. */
const SIN_SUSCRIPCION = () => () => {};
const atajoCliente = () =>
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? "⌘K"
    : "Ctrl K";
const atajoServidor = () => "Ctrl K";

function useAtajoLabel(): string {
  return useSyncExternalStore(SIN_SUSCRIPCION, atajoCliente, atajoServidor);
}

/** La fila de búsqueda que se ve en el panel de inicio. Abre el diálogo. */
export function BuscadorTrigger({ className }: { className?: string }) {
  const { abrir } = useBuscador();
  const atajo = useAtajoLabel();

  return (
    <button
      type="button"
      onClick={abrir}
      className={cn(
        "flex w-full items-center gap-3 rounded-[11px] border border-[var(--el-border)] bg-[var(--el-surface-card)] px-4 py-3 text-left shadow-[var(--el-shadow-card)] transition-colors hover:border-[var(--el-violet)]/50",
        className,
      )}
    >
      <Search className="size-4 shrink-0 text-[var(--el-text-muted)]" />
      <span className="flex-1 truncate text-sm text-[var(--el-text-muted)]">
        Buscar causa o imputado…
      </span>
      <kbd className="hidden shrink-0 rounded border border-[var(--el-border)] bg-[var(--el-canvas)] px-1.5 py-0.5 font-display text-[11px] text-[var(--el-text-muted)] sm:block">
        {atajo}
      </kbd>
    </button>
  );
}

// Resultado de la última búsqueda que efectivamente terminó. Lleva el `termino`
// con el que se pidió: es lo que permite saber, al renderizar, si lo que hay en
// mano corresponde a lo que el usuario tiene escrito ahora o quedó viejo.
type Respuesta =
  | { kind: "inicial" }
  | { kind: "listo"; termino: string; resultados: ResultadoBusqueda[] }
  | { kind: "error"; termino: string; message: string };

// Lo que se muestra. Se DERIVA de la consulta actual + la última respuesta, en
// vez de mantenerse en su propio useState sincronizado por efectos: así no hay
// ninguna ventana en la que la pantalla muestre los resultados de la búsqueda
// anterior mientras se escribe la nueva.
type Vista =
  | { kind: "vacio" }
  | { kind: "buscando" }
  | { kind: "listo"; resultados: ResultadoBusqueda[] }
  | { kind: "error"; message: string };

function derivarVista(termino: string, respuesta: Respuesta): Vista {
  if (termino.length < MIN_CARACTERES) return { kind: "vacio" };
  if (respuesta.kind === "inicial" || respuesta.termino !== termino) {
    return { kind: "buscando" };
  }
  return respuesta.kind === "listo"
    ? { kind: "listo", resultados: respuesta.resultados }
    : { kind: "error", message: respuesta.message };
}

function BuscadorDialog({
  abierto,
  onAbiertoChange,
}: {
  abierto: boolean;
  onAbiertoChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [consulta, setConsulta] = useState("");
  const [respuesta, setRespuesta] = useState<Respuesta>({ kind: "inicial" });
  const [activo, setActivo] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const termino = consulta.trim();
  const vista = derivarVista(termino, respuesta);
  const resultados = vista.kind === "listo" ? vista.resultados : [];
  // El índice activo puede quedar fuera de rango cuando la búsqueda nueva
  // devuelve menos filas que la anterior; se acota al renderizar en vez de
  // resetearse desde un efecto.
  const activoSeguro = Math.min(activo, Math.max(0, resultados.length - 1));

  // Al cerrar limpiamos, para que la próxima vez que se abra arranque en
  // blanco. Va en el handler de cierre y no en un efecto sobre `abierto`
  // porque cerrar ES el evento — el efecto sería una reacción a su propio
  // resultado.
  const cambiarAbierto = useCallback(
    (v: boolean) => {
      if (!v) {
        setConsulta("");
        setRespuesta({ kind: "inicial" });
        setActivo(0);
      }
      onAbiertoChange(v);
    },
    [onAbiertoChange],
  );

  // Fetch con debounce. El AbortController corta la request anterior en cada
  // tecla: sin eso, una respuesta lenta de hace tres letras puede pisar a la
  // que corresponde a lo que el usuario tiene escrito ahora.
  useEffect(() => {
    if (termino.length < MIN_CARACTERES) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/buscar?q=${encodeURIComponent(termino)}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setRespuesta({
            kind: "error",
            termino,
            message: `No se pudo buscar (HTTP ${res.status})`,
          });
          return;
        }
        const json = (await res.json()) as { resultados?: ResultadoBusqueda[] };
        if (controller.signal.aborted) return;
        setRespuesta({
          kind: "listo",
          termino,
          resultados: json.resultados ?? [],
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setRespuesta({
          kind: "error",
          termino,
          message: e instanceof Error ? e.message : "Error de red",
        });
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [termino]);

  const abrirCaso = useCallback(
    (id: string) => {
      cambiarAbierto(false);
      router.push(`/dashboard/mis-casos/${id}`);
    },
    [cambiarAbierto, router],
  );

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (resultados.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActivo((activoSeguro + 1) % resultados.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActivo((activoSeguro - 1 + resultados.length) % resultados.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const elegido = resultados[activoSeguro];
      if (elegido) abrirCaso(elegido.id);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={cambiarAbierto}>
      <DialogContent
        showCloseButton={false}
        // Paleta anclada arriba, no centrada: el diálogo base viene con
        // `top-1/2 -translate-y-1/2` y tailwind-merge deja ganar a estas.
        className="top-[12vh] max-h-[70vh] w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl"
        // Base UI enfoca el primer elemento tabbable; lo forzamos al input para
        // que el usuario pueda escribir apenas se abre.
        initialFocus={inputRef}
      >
        <DialogTitle className="sr-only">Buscar en la app</DialogTitle>

        <div className="flex items-center gap-3 border-b border-[var(--el-border-soft)] px-4 py-3">
          <Search className="size-4 shrink-0 text-[var(--el-text-muted)]" />
          <input
            ref={inputRef}
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Buscar causa o imputado…"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--el-text)] outline-none placeholder:text-[var(--el-text-muted)]"
          />
          {vista.kind === "buscando" ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-[var(--el-text-muted)]" />
          ) : null}
        </div>

        <div className="max-h-[calc(70vh-3.5rem)] overflow-y-auto">
          <CuerpoResultados
            vista={vista}
            consulta={consulta}
            activo={activoSeguro}
            onHover={setActivo}
            onElegir={abrirCaso}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CuerpoResultados({
  vista,
  consulta,
  activo,
  onHover,
  onElegir,
}: {
  vista: Vista;
  consulta: string;
  activo: number;
  onHover: (i: number) => void;
  onElegir: (id: string) => void;
}) {
  if (vista.kind === "error") {
    return <Mensaje texto={vista.message} tono="error" />;
  }

  if (vista.kind === "vacio") {
    return (
      <Mensaje
        texto={
          consulta.trim().length === 0
            ? "Escribí el nombre de una causa o de un imputado."
            : "Escribí al menos dos letras."
        }
      />
    );
  }

  if (vista.kind === "buscando") {
    return <Mensaje texto="Buscando…" />;
  }

  if (vista.resultados.length === 0) {
    return <Mensaje texto={`Ningún caso coincide con “${consulta.trim()}”.`} />;
  }

  return (
    <ul className="p-2">
      {vista.resultados.map((r, i) => (
        <li key={r.id}>
          <button
            type="button"
            onMouseEnter={() => onHover(i)}
            onClick={() => onElegir(r.id)}
            className={cn(
              "flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-colors",
              i === activo ? "bg-black/5 dark:bg-white/8" : "bg-transparent",
            )}
          >
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--el-text)]">
                {r.titulo}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
                  rolBadge(r.rol),
                )}
              >
                {rolLabel(r.rol)}
              </span>
            </span>
            <span className="flex items-baseline gap-2 text-xs text-[var(--el-text-muted)]">
              <span className="shrink-0">{CAMPO_LABEL[r.campo]}</span>
              <span className="shrink-0">·</span>
              <span className="shrink-0">{fmtRelativo(r.actualizado_en)}</span>
            </span>
            {r.fragmento ? (
              <span className="line-clamp-2 text-xs leading-relaxed text-[var(--el-text-soft)]">
                {r.fragmento}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Mensaje({
  texto,
  tono = "neutro",
}: {
  texto: string;
  tono?: "neutro" | "error";
}) {
  return (
    <p
      className={cn(
        "px-4 py-8 text-center text-sm",
        tono === "error" ? "text-destructive" : "text-[var(--el-text-muted)]",
      )}
    >
      {texto}
    </p>
  );
}
