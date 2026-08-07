"use client";
// Un mensaje dentro del hilo abierto. Colapsable: en un hilo de cinco idas y
// vueltas sólo interesa el último, los anteriores quedan como una línea.

import { ChevronDown, Download, Paperclip, Reply, ReplyAll, Forward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MensajeCompleto } from "@/lib/gmail/types";
import { fechaCompleta, fechaCorta, fmtTamano } from "./fechas";
import { colorAvatar, inicialDe, nombreDe } from "./presentacion";
import { CuerpoMensaje } from "./cuerpo-mensaje";

type Props = {
  mensaje: MensajeCompleto;
  abierto: boolean;
  demo: boolean;
  puedeEnviar: boolean;
  onToggle: (id: string) => void;
  onResponder: (m: MensajeCompleto, aTodos: boolean) => void;
  onReenviar: (m: MensajeCompleto) => void;
};

export function MensajeBloque({
  mensaje,
  abierto,
  demo,
  puedeEnviar,
  onToggle,
  onResponder,
  onReenviar,
}: Props) {
  const destinatarios = [...mensaje.para, ...mensaje.cc];

  return (
    <article
      className={cn(
        "rounded-xl border transition-colors",
        abierto
          ? "border-[var(--el-border)] bg-[var(--el-surface-card)]"
          : "border-[var(--el-border-soft)] bg-[var(--el-surface-card)]/50",
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(mensaje.id)}
        aria-expanded={abierto}
        className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left outline-none transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-[var(--el-violet)]/60"
      >
        <span
          aria-hidden
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            colorAvatar(mensaje.de.email),
          )}
        >
          {inicialDe(mensaje.de)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--el-text)]">
              {nombreDe(mensaje.de)}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-[var(--el-text-muted)]">
              {abierto ? fechaCompleta(mensaje.fecha) : fechaCorta(mensaje.fecha)}
            </span>
          </span>

          {abierto ? (
            <>
              <span className="mt-0.5 block truncate text-xs text-[var(--el-text-muted)]">
                {mensaje.de.email}
              </span>
              {destinatarios.length > 0 ? (
                <span className="mt-0.5 block truncate text-xs text-[var(--el-text-muted)]">
                  Para: {destinatarios.map((d) => d.email).join(", ")}
                </span>
              ) : null}
            </>
          ) : (
            <span className="mt-0.5 block truncate text-xs text-[var(--el-text-muted)]">
              {mensaje.cuerpo_texto?.trim().slice(0, 140) || mensaje.asunto}
            </span>
          )}
        </span>

        <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
          {mensaje.adjuntos.length > 0 ? (
            <Paperclip className="size-3.5 text-[var(--el-text-muted)]" />
          ) : null}
          <ChevronDown
            className={cn(
              "size-4 text-[var(--el-text-muted)] transition-transform",
              abierto && "rotate-180",
            )}
          />
        </span>
      </button>

      {abierto ? (
        <div className="space-y-3 border-t border-[var(--el-border-soft)] px-3 py-3">
          <CuerpoMensaje mensaje={mensaje} />

          {mensaje.adjuntos.length > 0 ? (
            <div className="flex flex-wrap gap-2 border-t border-[var(--el-border-soft)] pt-3">
              {mensaje.adjuntos.map((a) => {
                const etiqueta = `${a.filename}${
                  a.size_bytes > 0 ? ` · ${fmtTamano(a.size_bytes)}` : ""
                }`;
                // Los adjuntos demo no existen del lado de Google: la ruta
                // devuelve 404, así que ni los ofrecemos como descargables.
                if (demo) {
                  return (
                    <span
                      key={a.id}
                      title="Los adjuntos de ejemplo no se pueden descargar"
                      className="inline-flex max-w-full cursor-not-allowed items-center gap-1.5 rounded-lg border border-[var(--el-border-soft)] bg-black/[0.02] dark:bg-white/[0.02] px-2.5 py-1.5 text-xs text-[var(--el-text-muted)] opacity-60"
                    >
                      <Paperclip className="size-3.5 shrink-0" />
                      <span className="truncate">{etiqueta}</span>
                    </span>
                  );
                }
                return (
                  <a
                    key={a.id}
                    href={`/api/bandeja/adjuntos/${encodeURIComponent(mensaje.id)}/${encodeURIComponent(a.id)}`}
                    download={a.filename}
                    aria-label={`Descargar ${a.filename}`}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[var(--el-border-soft)] bg-black/[0.02] dark:bg-white/[0.02] px-2.5 py-1.5 text-xs text-[var(--el-text-soft)] transition-colors hover:border-[var(--el-violet)]/50 hover:text-[var(--el-text)]"
                  >
                    <Download className="size-3.5 shrink-0" />
                    <span className="truncate">{etiqueta}</span>
                  </a>
                );
              })}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-[var(--el-border-soft)] pt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={!puedeEnviar}
              onClick={() => onResponder(mensaje, false)}
            >
              <Reply className="size-3.5" /> Responder
            </Button>
            {destinatarios.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={!puedeEnviar}
                onClick={() => onResponder(mensaje, true)}
              >
                <ReplyAll className="size-3.5" /> Responder a todos
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              disabled={!puedeEnviar}
              onClick={() => onReenviar(mensaje)}
            >
              <Forward className="size-3.5" /> Reenviar
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
