"use client";
// El panel de LEXIE. Vive en el shell de navegación, así que se abre desde
// cualquier sección con el mismo estado.
//
// Decisiones de forma:
// - Panel lateral y no página propia: LEXIE se consulta MIENTRAS se trabaja en
//   otra cosa ("¿qué tengo mañana?" mientras se lee un expediente). Sacar al
//   abogado de donde está para responderle eso sería absurdo.
// - Ancho completo en teléfono, ~26rem en escritorio. La app se va a usar
//   instalada en el celular, así que el layout angosto es el caso principal,
//   no el degradado.
// - Los datos se piden al ABRIR, no al cargar cada página: nadie paga dos
//   queries por entrar a la Bandeja.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DictadoVoz } from "@/components/mis-casos/chat/dictado-voz";
import { TextoLexie } from "./texto-lexie";
import { cn } from "@/lib/utils";

type Saludo = {
  encabezado: string;
  rapport: string;
  cierre: string;
  urgente: boolean;
};

type Mensaje = {
  id: string;
  tipo: "usuario" | "agente";
  contenido: string;
  creado_en: string;
};

// El panel se MONTA al abrirse (el launcher lo renderiza condicionalmente) y se
// desmonta al cerrarse. Por eso no recibe `abierto`: su sola existencia es
// estar abierto.
//
// Esa decisión no es cosmética. Con un panel siempre montado había que resetear
// el estado dentro de un efecto al pasar a abierto —`setCargando(true)` en el
// cuerpo del efecto—, que es exactamente el patrón de cascading renders que el
// lint del proyecto marca. Montando fresco, el estado inicial YA es el correcto
// y el efecto solo dispara el fetch. Además cada apertura arranca limpia, sin
// arrastrar el error o el borrador de la sesión anterior.
type Props = { onCerrar: () => void };

export function LexiePanel({ onCerrar }: Props) {
  const [cargando, setCargando] = useState(true);
  const [saludo, setSaludo] = useState<Saludo | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [dictando, setDictando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Esc cierra, y el body no scrollea detrás del panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onCerrar]);

  // Carga inicial. Corre una sola vez, al montar.
  useEffect(() => {
    let vivo = true;
    fetch("/api/lexie")
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return;
        if (!d.ok) {
          setError(d.error ?? "No pude abrir LEXIE.");
          return;
        }
        setSaludo(d.saludo);
        setMensajes(d.mensajes ?? []);
      })
      .catch(() => {
        if (vivo) setError("No pude abrir LEXIE.");
      })
      .finally(() => {
        if (!vivo) return;
        setCargando(false);
        inputRef.current?.focus();
      });
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes, enviando]);

  const enviar = useCallback(async () => {
    const contenido = texto.trim();
    if (contenido.length === 0 || enviando) return;

    // Optimista: el mensaje del abogado aparece ya, con id temporal.
    const temporal: Mensaje = {
      id: `tmp-${Date.now()}`,
      tipo: "usuario",
      contenido,
      creado_en: new Date().toISOString(),
    };
    setMensajes((m) => [...m, temporal]);
    setTexto("");
    setEnviando(true);
    setError(null);

    try {
      const r = await fetch("/api/lexie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensaje: contenido }),
      });
      const d = await r.json();
      if (!d.ok) {
        // El servidor no persistió nada si falló, así que se saca el optimista
        // y se devuelve el texto al input para que no se pierda lo escrito.
        setMensajes((m) => m.filter((x) => x.id !== temporal.id));
        setTexto(contenido);
        setError(d.error ?? "No pude responder.");
        return;
      }
      setMensajes((m) => [
        ...m.filter((x) => x.id !== temporal.id),
        { ...temporal, id: `u-${Date.now()}` },
        {
          id: `a-${Date.now()}`,
          tipo: "agente",
          contenido: d.respuesta,
          creado_en: new Date().toISOString(),
        },
      ]);
    } catch {
      setMensajes((m) => m.filter((x) => x.id !== temporal.id));
      setTexto(contenido);
      setError("Se cortó la conexión. Probá de nuevo.");
    } finally {
      setEnviando(false);
      inputRef.current?.focus();
    }
  }, [texto, enviando]);

  const vacio = mensajes.length === 0;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onCerrar}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="LEXIE, asistente del estudio"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l sm:max-w-[26rem]",
          "border-[var(--el-border)] bg-[var(--el-surface-card)] shadow-2xl",
          // Respeta el notch y la barra de gestos cuando corre instalada.
          "pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]",
        )}
      >
        {/* — Encabezado — */}
        <header className="flex items-center justify-between border-b border-[var(--el-border-soft)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-full bg-[var(--el-violet)]/15">
              <Sparkles className="size-4 text-[var(--el-violet-light)]" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-[var(--el-text)]">LEXIE</p>
              <p className="text-[11px] text-[var(--el-text-muted)]">
                Asistente del estudio
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <X className="size-4" />
          </Button>
        </header>

        {/* — Conversación — */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {cargando ? (
            <div className="flex items-center gap-2 text-sm text-[var(--el-text-muted)]">
              <Loader2 className="size-4 animate-spin" />
              Un segundo…
            </div>
          ) : (
            <>
              {/* El saludo solo encabeza la conversación vacía: una vez que hay
                  hilo, repetirlo arriba de todo sería ruido. */}
              {saludo && vacio && (
                <div
                  className={cn(
                    "mb-4 rounded-xl border p-3.5",
                    saludo.urgente
                      ? "border-amber-500/25 bg-amber-500/[0.06]"
                      : "border-[var(--el-border-soft)] bg-[var(--el-canvas)]/40",
                  )}
                >
                  <p className="text-sm font-medium text-[var(--el-text)]">
                    {saludo.encabezado}
                  </p>
                  {saludo.rapport && (
                    <p className="mt-1 text-sm text-[var(--el-text-soft)]">
                      {saludo.rapport}
                    </p>
                  )}
                  <p className="mt-2 text-sm text-[var(--el-text-muted)]">
                    {saludo.cierre}
                  </p>
                </div>
              )}

              <div className="space-y-4">
                {mensajes.map((m) =>
                  m.tipo === "usuario" ? (
                    <div key={m.id} className="flex justify-end">
                      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[var(--el-violet)]/15 px-3.5 py-2 text-sm text-[var(--el-text)]">
                        {m.contenido}
                      </p>
                    </div>
                  ) : (
                    <div key={m.id} className="max-w-[92%]">
                      <TextoLexie texto={m.contenido} />
                    </div>
                  ),
                )}

                {enviando && (
                  <div className="flex items-center gap-2 text-sm text-[var(--el-text-muted)]">
                    <Loader2 className="size-3.5 animate-spin" />
                    Pensando…
                  </div>
                )}
              </div>
            </>
          )}

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-3 py-2 text-sm text-rose-300"
            >
              {error}
            </p>
          )}

          <div ref={finRef} />
        </div>

        {/* — Input — */}
        <div className="border-t border-[var(--el-border-soft)] p-3">
          <Textarea
            ref={inputRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter envía, Shift+Enter hace salto de línea. En pantalla táctil
              // el teclado trae su propio Enter de "enviar", así que no se
              // pierde nada.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            placeholder="Preguntale algo…"
            rows={2}
            disabled={enviando || dictando}
            className="min-h-[3.25rem] resize-none text-sm"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <DictadoVoz
              disabled={enviando}
              onTexto={(t) => setTexto((prev) => (prev ? `${prev} ${t}` : t))}
              onOcupadoChange={setDictando}
            />
            <Button
              size="sm"
              onClick={() => void enviar()}
              disabled={enviando || dictando || texto.trim().length === 0}
            >
              {enviando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Enviar
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}
