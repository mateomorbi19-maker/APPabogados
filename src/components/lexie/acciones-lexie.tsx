"use client";
// Las tarjetas de ACCIONES de un mensaje de LEXIE: lo que hizo, lo que intentó
// y lo que dejó esperando la confirmación del abogado.
//
// Molde: `acciones-mapa.tsx` del chat del caso. La diferencia de fondo es el
// ciclo de vida: acá una acción puede estar `pendiente`, y la tarjeta es el
// lugar donde el abogado la confirma o la cancela. Los dos botones son INLINE
// y no un Dialog a propósito: la ventana de LEXIE vive en z-40 y cualquier
// Dialog del repo sale en z-50 — se dibujaría encima de la propia ventana, y
// además rompería la promesa de "no modal" que sostiene todo el dock.
//
// Lo que se pinta lo armó el SERVIDOR: `vista_previa` ya viene con las
// direcciones completas, la fecha con día de semana, el cuerpo entero del
// correo. Acá no se formatea nada de dominio, sólo se ordena y se muestra —
// por eso mismo se muestra COMPLETA cuando está pendiente: confirmar es
// ejecutar exactamente lo que se leyó, así que tiene que poder leerse todo.

import Link from "next/link";
import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import {
  ArrowRight,
  Ban,
  BookMarked,
  CalendarDays,
  Check,
  CircleAlert,
  FileText,
  FolderOpen,
  Hourglass,
  Loader2,
  Mail,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ETIQUETA_ESTADO,
  ETIQUETA_SECCION,
  HREF_SECCION,
  type AccionLexie,
  type EstadoAccion,
  type SeccionAccion,
} from "@/lib/lexie/acciones";

// === El evento con el que el resto de la app se entera ===
//
// La ventana de LEXIE es NO modal y flota sobre la Agenda o la Bandeja: si
// LEXIE crea una audiencia, la lista que está detrás tiene que mostrarla sin
// que el abogado recargue. No hay estado compartido entre el dock (layout
// raíz) y cada sección, y un contexto de React para esto sería
// desproporcionado; el precedente es `caso-actualizado` en mis-casos-shell.

export const EVENTO_LEXIE_MUTACION = "lexie-mutacion";

export type DetalleMutacionLexie = {
  tool: string;
  seccion?: SeccionAccion;
  datos?: Record<string, unknown>;
};

/** Avisa que una acción quedó APLICADA. Sólo para `estado === "ok"`. */
export function emitirMutacionLexie(accion: AccionLexie): void {
  if (accion.estado !== "ok" || typeof window === "undefined") return;
  const detail: DetalleMutacionLexie = {
    tool: accion.tool,
    seccion: accion.seccion,
    datos: accion.datos,
  };
  window.dispatchEvent(new CustomEvent(EVENTO_LEXIE_MUTACION, { detail }));
}

/**
 * ¿Esta mutación toca alguna de estas secciones? Una acción SIN sección se
 * considera que toca todas: ante la duda, refrescar de más es barato y
 * mostrar datos viejos no.
 */
export function mutacionToca(
  detalle: DetalleMutacionLexie,
  ...secciones: SeccionAccion[]
): boolean {
  return !detalle.seccion || secciones.includes(detalle.seccion);
}

/**
 * Suscribe una vista a las mutaciones de LEXIE. El handler va por ref, así el
 * caller puede pasar un closure nuevo en cada render sin re-suscribir.
 */
export function useAlMutarLexie(
  handler: (detalle: DetalleMutacionLexie) => void,
): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);
  useEffect(() => {
    const onMutacion = (e: Event) => {
      const detail = (e as CustomEvent<DetalleMutacionLexie>).detail;
      if (detail && typeof detail.tool === "string") ref.current(detail);
    };
    window.addEventListener(EVENTO_LEXIE_MUTACION, onMutacion);
    return () => window.removeEventListener(EVENTO_LEXIE_MUTACION, onMutacion);
  }, []);
}

// === La tarjeta ===

type Props = {
  acciones: AccionLexie[];
  /**
   * Si las pendientes de este mensaje siguen siendo accionables. Sólo el
   * ÚLTIMO mensaje del agente las tiene activas: el servidor valida las claves
   * contra ese mensaje y nada más (ver manejarBoton en la ruta).
   */
  activas: boolean;
  onConfirmar: (clave: string) => void;
  onDescartar: (clave: string) => void;
  /** Clave de la acción que se está ejecutando ahora, si hay una. */
  ocupada?: string | null;
  /** Aviso por clave (por ejemplo, el 409 de "ya no está pendiente"). */
  avisos?: Record<string, string>;
};

export function AccionesLexie({
  acciones,
  activas,
  onConfirmar,
  onDescartar,
  ocupada,
  avisos,
}: Props) {
  if (acciones.length === 0) return null;
  return (
    <ul className="mt-2.5 space-y-2" aria-label="Acciones de LEXIE">
      {acciones.map((a, i) => (
        <TarjetaAccion
          key={a.clave ? `${a.clave}-${a.estado}` : `${a.tool}-${i}`}
          accion={a}
          activas={activas}
          ocupada={ocupada === a.clave && !!a.clave}
          // El aviso ("ya no está pendiente") sólo tiene sentido sobre la
          // tarjeta que todavía dice pendiente; la resuelta ya cuenta qué pasó.
          aviso={a.clave && a.estado === "pendiente" ? avisos?.[a.clave] : undefined}
          onConfirmar={onConfirmar}
          onDescartar={onDescartar}
        />
      ))}
    </ul>
  );
}

// Records con clases COMPLETAS: Tailwind v4 escanea strings literales. Cada
// color va por token o con su contraparte clara, porque la ventana se ve en
// los dos temas.
const ESTILO: Record<
  EstadoAccion,
  { caja: string; etiqueta: string; icono: string }
> = {
  ok: {
    caja: "border-emerald-500/30 bg-emerald-500/10",
    etiqueta: "text-emerald-800 dark:text-emerald-300",
    icono: "text-emerald-700 dark:text-emerald-400",
  },
  pendiente: {
    caja: "border-amber-500/35 bg-amber-500/10",
    etiqueta: "text-amber-800 dark:text-amber-300",
    icono: "text-amber-700 dark:text-amber-400",
  },
  en_curso: {
    caja: "border-primary/30 bg-primary/5",
    etiqueta: "text-primary",
    icono: "text-primary",
  },
  rechazada: {
    caja: "border-amber-500/20 bg-amber-500/[0.06]",
    etiqueta: "text-amber-800 dark:text-amber-300",
    icono: "text-amber-700 dark:text-amber-400",
  },
  descartada: {
    caja: "border-[var(--el-border)] bg-[var(--el-glass)]",
    etiqueta: "text-[var(--el-text-muted)]",
    icono: "text-[var(--el-text-muted)]",
  },
  error: {
    caja: "border-rose-500/30 bg-rose-500/10",
    etiqueta: "text-rose-800 dark:text-rose-300",
    icono: "text-rose-700 dark:text-rose-400",
  },
};

type Icono = ComponentType<{ className?: string }>;

const ICONO_ESTADO: Record<EstadoAccion, Icono> = {
  ok: Check,
  pendiente: Hourglass,
  en_curso: Loader2,
  rechazada: TriangleAlert,
  descartada: Ban,
  error: CircleAlert,
};

const ICONO_SECCION: Record<SeccionAccion, Icono> = {
  agenda: CalendarDays,
  bandeja: Mail,
  causa: FolderOpen,
  escritos: FileText,
  modelos: BookMarked,
};

function TarjetaAccion({
  accion,
  activas,
  ocupada,
  aviso,
  onConfirmar,
  onDescartar,
}: {
  accion: AccionLexie;
  activas: boolean;
  ocupada: boolean;
  aviso?: string;
  onConfirmar: (clave: string) => void;
  onDescartar: (clave: string) => void;
}) {
  // Una pendiente cuya clave está en vuelo se pinta como "en curso": es el
  // mismo estado intermedio que el servidor reserva con el UPDATE condicional,
  // sólo que visto desde el cliente antes de que vuelva la respuesta.
  const estado: EstadoAccion =
    accion.estado === "pendiente" && ocupada ? "en_curso" : accion.estado;
  const estilo = ESTILO[estado];
  const IconoEstado = ICONO_ESTADO[estado];
  const IconoSeccion = accion.seccion ? ICONO_SECCION[accion.seccion] : Sparkles;

  const pendiente = accion.estado === "pendiente" && !!accion.clave;
  const href =
    accion.estado === "ok"
      ? (typeof accion.datos?.href === "string" ? accion.datos.href : null) ??
        (accion.seccion ? HREF_SECCION[accion.seccion] : null)
      : null;
  const vista = registroNoVacio(accion.vista_previa);
  const antes = registroNoVacio(accion.antes);

  return (
    <li className={cn("rounded-lg border px-3 py-2.5", estilo.caja)}>
      <div className="flex items-start gap-2">
        <IconoEstado
          aria-hidden
          className={cn(
            "mt-0.5 size-3.5 shrink-0",
            estilo.icono,
            estado === "en_curso" && "animate-spin",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span
              className={cn(
                "text-[10px] font-medium uppercase tracking-wider",
                estilo.etiqueta,
              )}
            >
              {estado === "en_curso" && accion.estado === "pendiente"
                ? "Ejecutando…"
                : ETIQUETA_ESTADO[estado]}
            </span>
            {accion.seccion ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-[var(--el-text-muted)]">
                <IconoSeccion aria-hidden className="size-3" />
                {ETIQUETA_SECCION[accion.seccion]}
              </span>
            ) : null}
          </p>
          <p
            className={cn(
              "mt-0.5 break-words text-sm",
              estado === "descartada"
                ? "text-[var(--el-text-muted)] line-through decoration-[var(--el-text-muted)]/50"
                : "text-[var(--el-text)]",
            )}
          >
            {accion.resumen}
          </p>
        </div>
      </div>

      {/* La vista previa COMPLETA mientras espera: es lo que se va a ejecutar
          tal cual. Una vez superada por otro mensaje, o ya hecha, queda
          plegada para no repetir medio correo en cada tarjeta del hilo. */}
      {vista && pendiente && activas ? (
        <Pares registro={vista} className="mt-2.5" />
      ) : vista && (pendiente || accion.estado === "ok" || accion.estado === "en_curso") ? (
        <Plegable titulo="Detalle">
          <Pares registro={vista} />
        </Plegable>
      ) : null}

      {antes && accion.estado === "ok" ? (
        <Plegable titulo="Antes">
          <Pares registro={antes} />
        </Plegable>
      ) : null}

      {accion.estado === "rechazada" && accion.motivo ? (
        <p className="mt-1.5 break-words pl-5 text-xs text-[var(--el-text-soft)]">
          {accion.motivo}
        </p>
      ) : null}
      {accion.estado === "rechazada" && accion.sugerencia ? (
        <p className="mt-1 break-words pl-5 text-xs italic text-amber-800/90 dark:text-amber-200/80">
          {accion.sugerencia}
        </p>
      ) : null}

      {accion.estado === "error" && accion.error ? (
        <p className="mt-1.5 break-words pl-5 text-xs text-rose-700 dark:text-rose-300">
          {accion.error}
        </p>
      ) : null}

      {aviso ? (
        <p
          role="status"
          className="mt-2 rounded-md border border-[var(--el-border)] bg-[var(--el-canvas)]/60 px-2.5 py-1.5 text-xs text-[var(--el-text-soft)]"
        >
          {aviso}
        </p>
      ) : null}

      {pendiente ? (
        activas ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-5">
            <Button
              size="sm"
              className="max-md:h-10"
              disabled={ocupada}
              onClick={() => onConfirmar(accion.clave as string)}
            >
              {ocupada ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Check />
              )}
              {ocupada ? "Ejecutando…" : "Confirmar"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="max-md:h-10"
              disabled={ocupada}
              onClick={() => onDescartar(accion.clave as string)}
            >
              <X />
              Cancelar
            </Button>
          </div>
        ) : (
          <p className="mt-2 pl-5 text-xs text-[var(--el-text-muted)]">
            Superada por un mensaje posterior
          </p>
        )
      ) : null}

      {href ? (
        <Link
          href={href}
          // Es la única salida a la sección desde la tarjeta: como renglón de
          // 11px sería un target de ~15px. Abajo de 768px va con 40px.
          className="mt-1.5 inline-flex min-h-10 items-center gap-1 pl-5 text-xs text-primary underline underline-offset-2 hover:text-foreground md:min-h-0 md:text-[11px]"
        >
          Ver
          <ArrowRight className="size-3" />
        </Link>
      ) : null}
    </li>
  );
}

// === Pares clave/valor ===

function registroNoVacio(
  r: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!r) return null;
  const entradas = Object.entries(r).filter(([, v]) => !esVacio(v));
  return entradas.length > 0 ? Object.fromEntries(entradas) : null;
}

function esVacio(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    v === "" ||
    (Array.isArray(v) && v.length === 0)
  );
}

/** `fecha_inicio` → `Fecha inicio`. Las claves ya legibles quedan como están. */
function etiquetaDe(clave: string): string {
  const s = clave.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function esTextoLargo(v: unknown): v is string {
  return typeof v === "string" && (v.length > 140 || v.includes("\n"));
}

function Pares({
  registro,
  className,
  nivel = 0,
}: {
  registro: Record<string, unknown>;
  className?: string;
  nivel?: number;
}) {
  return (
    <dl className={cn("space-y-1.5 pl-5", nivel > 0 && "pl-3", className)}>
      {Object.entries(registro)
        .filter(([, v]) => !esVacio(v))
        .map(([k, v]) => (
          <div key={k} className="text-xs">
            <dt className="text-[var(--el-text-muted)]">{etiquetaDe(k)}</dt>
            <dd className="min-w-0 break-words text-[var(--el-text-soft)]">
              <Valor v={v} nivel={nivel} />
            </dd>
          </div>
        ))}
    </dl>
  );
}

function Valor({ v, nivel }: { v: unknown; nivel: number }): ReactNode {
  if (esTextoLargo(v)) {
    // El cuerpo de un correo o el texto de un escrito: se lee entero, con
    // scroll propio para que una tarjeta no ocupe la ventana completa.
    return (
      <div className="mt-0.5 max-h-48 overflow-y-auto overscroll-contain whitespace-pre-wrap rounded-md border border-[var(--el-border)] bg-[var(--el-canvas)]/60 px-2.5 py-2 text-[var(--el-text)]">
        {v}
      </div>
    );
  }
  if (typeof v === "string") return v;
  if (typeof v === "number") return v.toLocaleString("es-AR");
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (Array.isArray(v)) {
    return (
      <ul className="list-disc space-y-0.5 pl-4">
        {v.map((item, i) => (
          <li key={i}>
            <Valor v={item} nivel={nivel + 1} />
          </li>
        ))}
      </ul>
    );
  }
  if (v && typeof v === "object") {
    // Dos niveles alcanzan para lo que arma el servidor (un adjunto con nombre
    // y tamaño, un diff campo a campo). Más hondo, se muestra crudo.
    if (nivel >= 2) return JSON.stringify(v);
    return (
      <Pares registro={v as Record<string, unknown>} nivel={nivel + 1} className="mt-0.5" />
    );
  }
  return String(v);
}

function Plegable({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <details className="group mt-1.5">
      <summary className="ml-5 inline-flex min-h-10 cursor-pointer list-none items-center gap-1 text-xs text-[var(--el-text-muted)] hover:text-[var(--el-text)] md:min-h-0 [&::-webkit-details-marker]:hidden">
        <ArrowRight className="size-3 transition-transform group-open:rotate-90" />
        {titulo}
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  );
}
