"use client";
// Panel derecho: el hilo abierto. Se trae su propio detalle (la lista sólo
// tiene el resumen) y aborta el fetch al cambiar de hilo o desmontarse.

import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  ArrowLeft,
  Inbox,
  Mail,
  RefreshCw,
  RotateCcw,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Buzon, HiloCompleto, HiloResumen, MensajeCompleto } from "@/lib/gmail/types";
import { errorDe, esRespuestaHilo, pedirJson } from "./api";
import { MensajeBloque } from "./mensaje-bloque";

type Props = {
  hiloId: string;
  resumen: HiloResumen | null;
  buzon: Buzon;
  demo: boolean;
  puedeEnviar: boolean;
  puedeModificar: boolean;
  onCerrar: () => void;
  onToggleDestacado: () => void;
  onArchivar: () => void;
  onPapelera: () => void;
  onRestaurar: () => void;
  onMarcarNoLeido: () => void;
  onResponder: (m: MensajeCompleto, aTodos: boolean) => void;
  onReenviar: (m: MensajeCompleto) => void;
};

type Estado =
  | { status: "loading" }
  | { status: "ready"; hilo: HiloCompleto }
  | { status: "error"; message: string };

// Identidad estable: el "cargando" se DERIVA de que el resultado guardado no
// corresponda al hilo/intento vigente, en vez de setearse desde el efecto.
const CARGANDO: Estado = { status: "loading" };
const NINGUNO: ReadonlySet<string> = new Set<string>();

type Resultado = { clave: string; estado: Estado; abiertos: ReadonlySet<string> };

/** Placeholder tipográfico cuando todavía no se eligió ningún hilo. */
export function HiloVacio() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <Inbox
        aria-hidden
        className="size-10 text-[var(--el-text-muted)] opacity-50"
      />
      <p className="font-display text-3xl font-semibold tracking-tight text-[var(--el-text)]/25">
        Bandeja de entrada
      </p>
      <p className="max-w-xs text-sm leading-relaxed text-[var(--el-text-muted)]">
        Elegí un mensaje de la lista para leerlo, responderlo o archivarlo.
      </p>
    </div>
  );
}

export function VistaHilo({
  hiloId,
  resumen,
  buzon,
  demo,
  puedeEnviar,
  puedeModificar,
  onCerrar,
  onToggleDestacado,
  onArchivar,
  onPapelera,
  onRestaurar,
  onMarcarNoLeido,
  onResponder,
  onReenviar,
}: Props) {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [intento, setIntento] = useState(0);

  const clave = `${hiloId} ${intento}`;
  const vigente = resultado !== null && resultado.clave === clave;
  const estado: Estado = vigente ? resultado.estado : CARGANDO;
  const abiertos: ReadonlySet<string> = vigente ? resultado.abiertos : NINGUNO;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { res, json } = await pedirJson(
          `/api/bandeja/hilos/${encodeURIComponent(hiloId)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (!res.ok || !esRespuestaHilo(json)) {
          setResultado({
            clave,
            estado: {
              status: "error",
              message: errorDe(json, res.status, "No se pudo abrir el hilo"),
            },
            abiertos: NINGUNO,
          });
          return;
        }
        const { hilo } = json;
        // El último mensaje es el que se quiere leer; el resto arranca colapsado.
        const ultimo = hilo.mensajes[hilo.mensajes.length - 1];
        setResultado({
          clave,
          estado: { status: "ready", hilo },
          abiertos: new Set(ultimo ? [ultimo.id] : []),
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setResultado({
          clave,
          estado: {
            status: "error",
            message: e instanceof Error ? e.message : "Error de red",
          },
          abiertos: NINGUNO,
        });
      }
    })();
    return () => controller.abort();
  }, [clave, hiloId]);

  const toggleMensaje = useCallback((id: string) => {
    setResultado((prev) => {
      if (prev === null) return prev;
      const next = new Set(prev.abiertos);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, abiertos: next };
    });
  }, []);

  const enPapelera = buzon === "TRASH";
  const destacado = resumen?.destacado ?? false;
  const asunto =
    estado.status === "ready"
      ? estado.hilo.asunto
      : (resumen?.asunto ?? "Cargando…");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Barra de acciones del hilo */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--el-border-soft)] px-2 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Volver a la lista"
          className="md:hidden"
          onClick={onCerrar}
        >
          <ArrowLeft className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={destacado ? "Quitar de destacados" : "Destacar el hilo"}
          aria-pressed={destacado}
          disabled={!puedeModificar}
          onClick={onToggleDestacado}
        >
          <Star
            className={cn(
              "size-4",
              destacado
                ? "fill-[#fcd34d] text-[#fcd34d]"
                : "text-[var(--el-text-muted)]",
            )}
          />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Marcar como no leído"
          disabled={!puedeModificar}
          onClick={onMarcarNoLeido}
        >
          <Mail className="size-4 text-[var(--el-text-muted)]" />
        </Button>

        {enPapelera ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Restaurar de la papelera"
            disabled={!puedeModificar}
            onClick={onRestaurar}
          >
            <RotateCcw className="size-3.5" /> Restaurar
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Archivar el hilo"
            disabled={!puedeModificar}
            onClick={onArchivar}
          >
            <Archive className="size-4 text-[var(--el-text-muted)]" />
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Mover el hilo a la papelera"
          disabled={!puedeModificar}
          onClick={onPapelera}
        >
          <Trash2 className="size-4 text-[var(--el-text-muted)]" />
        </Button>

        <div className="flex-1" />

        {demo ? (
          <span className="rounded-4xl border border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.12)] px-2 py-0.5 text-[10px] font-medium text-[#fcd34d]">
            Mensaje de ejemplo
          </span>
        ) : null}
      </div>

      {/* Contenido */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <h1 className="font-display text-xl leading-snug font-semibold text-[var(--el-text)] md:text-2xl">
          {asunto}
        </h1>

        {estado.status === "loading" ? (
          <div className="mt-4 space-y-3" aria-busy="true">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ) : estado.status === "error" ? (
          <div className="mt-4 rounded-xl border border-[rgba(248,113,113,0.35)] bg-[rgba(248,113,113,0.08)] p-4">
            <p className="text-sm font-medium text-[#fca5a5]">
              No se pudo abrir el hilo
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--el-text-soft)]">
              {estado.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setIntento((i) => i + 1)}
            >
              <RefreshCw className="size-3.5" /> Reintentar
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-2 pb-6">
            {estado.hilo.mensajes.map((m) => (
              <MensajeBloque
                key={m.id}
                mensaje={m}
                abierto={abiertos.has(m.id)}
                demo={demo}
                puedeEnviar={puedeEnviar}
                onToggle={toggleMensaje}
                onResponder={onResponder}
                onReenviar={onReenviar}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
