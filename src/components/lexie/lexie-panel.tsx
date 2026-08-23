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

/** Devuelve el foco al campo, pero solo en escritorio.
 *
 *  En el teléfono cada `focus()` programático abre el teclado y le come media
 *  pantalla al panel: al abrir taparía el saludo (que es lo primero que hay que
 *  leer, las urgencias a 48h van ahí) y después de cada respuesta taparía la
 *  respuesta recién llegada. En táctil el campo se enfoca tocándolo, que es lo
 *  que se espera; el atajo de teclado no existe. */
function enfocarSiEsEscritorio(campo: HTMLTextAreaElement | null) {
  if (window.matchMedia("(min-width: 768px)").matches) campo?.focus();
}

export function LexiePanel({ onCerrar }: Props) {
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
  const panelRef = useRef<HTMLElement>(null);

  // Esc cierra, y la página no scrollea detrás del panel.
  //
  // El bloqueo va también en <html>: Safari en iOS ignora el `overflow:hidden`
  // del <body> y sigue paneando la página de atrás mientras el panel está
  // abierto (el panel "se despega" y queda flotando sobre contenido que se
  // mueve). Sobre el elemento raíz sí lo respeta, y a diferencia del truco de
  // `position:fixed` no pierde la posición de scroll al cerrar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    const raiz = document.documentElement;
    const prevBody = document.body.style.overflow;
    const prevRaiz = raiz.style.overflow;
    document.body.style.overflow = "hidden";
    raiz.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevBody;
      raiz.style.overflow = prevRaiz;
    };
  }, [onCerrar]);

  // El panel se pega al viewport VISUAL en móvil.
  //
  // `inset-y-0` mide el viewport de LAYOUT. En Android eso alcanza (el
  // `interactiveWidget: "resizes-content"` del layout lo achica cuando sube el
  // teclado), pero iOS no lo implementa: ahí el layout sigue midiendo la
  // pantalla entera y la fila de escritura del panel queda ~300px por debajo
  // del teclado. Escribir a LEXIE desde un iPhone era escribir a ciegas.
  // `visualViewport` es el único que sabe cuánto quedó realmente a la vista.
  //
  // Se escribe el estilo a mano sobre el nodo y no por estado: el evento
  // `scroll` del visual viewport se dispara en cada cuadro del scroll inercial
  // de iOS, y un re-render del hilo por cuadro lo haría saltar.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const esMovil = window.matchMedia("(max-width: 767px)");

    const ajustar = () => {
      const nodo = panelRef.current;
      if (!nodo) return;
      if (!esMovil.matches) {
        // De 768px para arriba manda el CSS: el panel es una columna lateral y
        // no hay teclado virtual que compensar.
        nodo.style.removeProperty("height");
        nodo.style.removeProperty("transform");
        return;
      }
      nodo.style.height = `${vv.height}px`;
      nodo.style.transform = `translateY(${vv.offsetTop}px)`;
    };

    ajustar();
    vv.addEventListener("resize", ajustar);
    vv.addEventListener("scroll", ajustar);
    esMovil.addEventListener("change", ajustar);
    return () => {
      vv.removeEventListener("resize", ajustar);
      vv.removeEventListener("scroll", ajustar);
      esMovil.removeEventListener("change", ajustar);
    };
  }, []);

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
      enfocarSiEsEscritorio(inputRef.current);
    }
  }, [texto, enviando]);

  const vacio = mensajes.length === 0;

  return (
    <>
      {/* `touch-none` sobre el velo: sin eso, arrastrar el dedo sobre la parte
          descubierta scrollea la página de atrás y el panel parece despegarse.
          El tap sigue funcionando (touch-action solo corta el paneo). */}
      <div
        className="fixed inset-0 z-40 touch-none bg-black/50 backdrop-blur-sm"
        onClick={onCerrar}
        aria-hidden
      />
      <aside
        ref={panelRef}
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

        {/* — Conversación —
            `overscroll-contain`: al llegar al final del hilo el gesto se
            encadenaba a la página de atrás y arrastraba el fondo debajo del
            panel. */}
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
        <div className="shrink-0 border-t border-[var(--el-border-soft)] p-3">
          <Textarea
            ref={inputRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter envía SOLO con puntero fino (mouse/trackpad). El
              // comentario anterior decía que en táctil "no se pierde nada
              // porque el teclado trae su propio Enter de enviar": es al revés
              // — el teclado virtual NO tiene Shift+Enter, así que con el atajo
              // prendido no hay forma de escribirle a LEXIE una pregunta de dos
              // párrafos, y cualquier Enter reflejo manda el mensaje a medias y
              // paga la llamada al modelo. Mismo criterio que el simulador.
              if (atajoEnter && e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            placeholder="Preguntale algo…"
            rows={2}
            disabled={enviando || dictando}
            // Sin `text-sm`: el primitivo trae `text-base md:text-sm` y
            // tailwind-merge borraba el `text-base` (mismo grupo, sin
            // modificador) dejando la defensa contra el zoom de iOS apagada en
            // silencio. Hoy el piso de 16px lo garantiza globals.css, así que
            // esto es sacar la mina, no el arreglo: el render no cambia en
            // ningún ancho (16px abajo de 768, 14px de ahí para arriba).
            className="min-h-[3.25rem] resize-none"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <DictadoVoz
              disabled={enviando}
              onTexto={(t) => setTexto((prev) => (prev ? `${prev} ${t}` : t))}
              onOcupadoChange={setDictando}
            />
            {/* `size="sm"` deja 36px de alto en móvil y este es el botón
                principal del panel: se lo lleva al piso táctil de 40px sin
                tocar la densidad de escritorio (h-7). */}
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
      </aside>
    </>
  );
}
