"use client";

// El contenido de la conversación con LEXIE: el hilo y la fila de escritura.
//
// Es solo el CONTENIDO. El marco —posición, arrastre, tamaño, pantalla
// completa, cerrar— es responsabilidad de `ventana-lexie.tsx`, y quién lo monta
// es `lexie-dock.tsx`. La separación importa: este componente no sabe si está
// dentro de una ventana flotante, a pantalla completa o en una hoja de celular,
// y por eso las tres cosas funcionan con el mismo código.
//
// Viene del `lexie-panel.tsx` anterior, que además del contenido era un diálogo
// modal: velo negro, `aria-modal`, y `overflow:hidden` sobre <body> y <html>.
// Todo eso se fue. Preguntarle algo a LEXIE ya no obliga a abandonar lo que se
// estaba haciendo.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DictadoVoz } from "@/components/mis-casos/chat/dictado-voz";
import { usePunteroFino } from "@/lib/hooks/use-cliente";
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

/** Devuelve el foco al campo, pero solo en escritorio.
 *
 *  En el teléfono cada `focus()` programático abre el teclado y le come media
 *  pantalla: al abrir taparía el saludo (que es lo primero que hay que leer, las
 *  urgencias a 48h van ahí) y después de cada respuesta taparía la respuesta
 *  recién llegada. En táctil el campo se enfoca tocándolo, que es lo que se
 *  espera; el atajo de teclado no existe. */
function enfocarSiEsEscritorio(campo: HTMLTextAreaElement | null) {
  if (window.matchMedia("(min-width: 768px)").matches) campo?.focus();
}

export function LexieChat({
  onOcupadaChange,
}: {
  /** Para que la esfera pueda mostrar que LEXIE está pensando aunque la ventana esté tapada. */
  onOcupadaChange?: (ocupada: boolean) => void;
}) {
  const [cargando, setCargando] = useState(true);
  const [saludo, setSaludo] = useState<Saludo | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  // Con el dedo no hay Shift+Enter: el atajo solo existe con mouse.
  const atajoEnter = usePunteroFino();
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [dictando, setDictando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // La pantalla actual, leída EN EL MOMENTO DE ENVIAR y no al abrir. Es la
  // diferencia que hace que esto sirva: la ventana ya no se desmonta al
  // navegar, así que una ruta capturada al abrirla quedaría desactualizada
  // apenas el abogado cambie de sección con el chat abierto — que es
  // exactamente el caso de uso nuevo.
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

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
        enfocarSiEsEscritorio(inputRef.current);
      });
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes, enviando]);

  useEffect(() => {
    onOcupadaChange?.(enviando);
  }, [enviando, onOcupadaChange]);

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
        body: JSON.stringify({
          mensaje: contenido,
          // Solo el pathname. El nombre de lo que hay abierto lo resuelve el
          // servidor después de verificar que la causa sea de este abogado.
          pathname: pathnameRef.current,
        }),
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
      enfocarSiEsEscritorio(inputRef.current);
    }
  }, [texto, enviando]);

  const vacio = mensajes.length === 0;

  return (
    <>
      {/* — Conversación —
          `overscroll-contain`: al llegar al final del hilo el gesto se
          encadenaba a la página de atrás y arrastraba el fondo. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
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
      <div className="shrink-0 border-t border-[var(--el-glass-border)] p-3">
        <Textarea
          ref={inputRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Enter envía SOLO con puntero fino (mouse/trackpad): el teclado
            // virtual no tiene Shift+Enter, así que con el atajo prendido no
            // habría forma de escribir una pregunta de dos párrafos, y
            // cualquier Enter reflejo manda el mensaje a medias y paga la
            // llamada al modelo.
            if (atajoEnter && e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void enviar();
            }
          }}
          placeholder="Preguntale algo…"
          rows={2}
          disabled={enviando || dictando}
          // Sin `text-sm`: el primitivo trae `text-base md:text-sm` y
          // tailwind-merge borraría el `text-base` (mismo grupo, sin
          // modificador), apagando en silencio la defensa contra el zoom de iOS.
          className="min-h-[3.25rem] resize-none bg-[var(--el-canvas)]/50"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <DictadoVoz
            disabled={enviando}
            onTexto={(t) => setTexto((prev) => (prev ? `${prev} ${t}` : t))}
            onOcupadoChange={setDictando}
          />
          {/* `size="sm"` deja 36px de alto en móvil y este es el botón principal:
              se lo lleva al piso táctil de 40px sin tocar la densidad de
              escritorio. */}
          <Button
            size="sm"
            className="max-md:h-10 max-md:px-4"
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
    </>
  );
}
