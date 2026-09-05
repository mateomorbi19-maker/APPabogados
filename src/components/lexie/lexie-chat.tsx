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
//
// Desde la Fase 11 cada mensaje del agente puede traer ACCIONES (lo que hizo,
// lo que dejó pendiente). Las pinta `acciones-lexie.tsx`, y los botones de la
// tarjeta vuelven acá: Confirmar y Cancelar son un POST sin modelo, y lo que
// devuelve el servidor —el par «Confirmé…/Hecho…»— se suma al hilo tal cual.
// Nada de esto autoenvía nada: la regla del dictado por voz sigue en pie.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DictadoVoz } from "@/components/mis-casos/chat/dictado-voz";
import { usePunteroFino } from "@/lib/hooks/use-cliente";
import type { AccionLexie } from "@/lib/lexie/acciones";
import { TextoLexie } from "./texto-lexie";
import { AccionesLexie, emitirMutacionLexie } from "./acciones-lexie";
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
  /** Sólo en mensajes del agente. Las arma el servidor, nunca el modelo. */
  acciones?: AccionLexie[];
  /** El par que inserta el botón Confirmar/Cancelar, no el abogado ni el modelo. */
  origen?: "boton";
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

/** Lo que el servidor devuelve como mensaje, ya con sus acciones validadas. */
function esMensaje(x: unknown): x is Mensaje {
  return (
    !!x &&
    typeof x === "object" &&
    typeof (x as Mensaje).id === "string" &&
    ((x as Mensaje).tipo === "usuario" || (x as Mensaje).tipo === "agente") &&
    typeof (x as Mensaje).contenido === "string"
  );
}

function ultimoMensajeAgenteId(mensajes: Mensaje[]): string | null {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    if (mensajes[i].tipo === "agente") return mensajes[i].id;
  }
  return null;
}

/** Avisa al resto de la app de cada acción que quedó aplicada. */
function emitirAplicadas(acciones: AccionLexie[] | undefined) {
  for (const a of acciones ?? []) emitirMutacionLexie(a);
}

export function LexieChat({
  onOcupadaChange,
  precarga,
}: {
  /** Para que la esfera pueda mostrar que LEXIE está pensando aunque la ventana esté tapada. */
  onOcupadaChange?: (ocupada: boolean) => void;
  /**
   * Texto que otra pantalla dejó escrito para el abogado (ver lexie-dock).
   * Se siembra en el campo, no se envía: el `n` distingue dos pedidos con el
   * mismo texto.
   */
  precarga?: { texto: string; n: number } | null;
}) {
  const [cargando, setCargando] = useState(true);
  const [saludo, setSaludo] = useState<Saludo | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  // Con el dedo no hay Shift+Enter: el atajo solo existe con mouse.
  const atajoEnter = usePunteroFino();
  const [texto, setTexto] = useState(precarga?.texto ?? "");
  const [enviando, setEnviando] = useState(false);
  // La clave de la acción que el botón está ejecutando ahora. Una sola por
  // vez: el servidor reserva la clave con un UPDATE condicional, pero no hace
  // falta llegar hasta ahí para frenar el doble click.
  const [ocupada, setOcupada] = useState<string | null>(null);
  // Avisos por clave, para pintar ADENTRO de la tarjeta (el 409 de "ya no está
  // pendiente") en vez de en el cartel rojo del pie, que es para fallos.
  const [avisos, setAvisos] = useState<Record<string, string>>({});
  // Precarga durante el render, sin efecto (ver la nota de ficha-form.tsx):
  // si el pedido llega con el chat ya montado, se pisa el campo en el acto.
  const [precargaVista, setPrecargaVista] = useState(precarga?.n ?? 0);
  if (precarga && precarga.n !== precargaVista) {
    setPrecargaVista(precarga.n);
    setTexto(precarga.texto);
  }
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

  // Trae el hilo entero de nuevo. Es la re-sincronización después de cualquier
  // camino en el que el servidor pudo haber escrito algo que este cliente no
  // vio: un 409 (la acción ya se ejecutó desde otra pestaña), un turno que se
  // cortó con acciones aplicadas (la ruta insertó un mensaje de corte), o una
  // confirmación cuya respuesta nunca llegó (el par «Confirmé…/Ejecutando…»
  // se inserta ANTES de ejecutar, justamente para que quede rastro).
  //
  // `emitirOk` avisa al resto de la app por las acciones aplicadas del último
  // mensaje del agente: en esos tres caminos algo puede haber cambiado sin que
  // este cliente haya tenido la respuesta para avisar. NO se usa en la carga
  // inicial, que traería acciones viejas y refrescaría todo sin motivo.
  const recargar = useCallback(async (emitirOk = false) => {
    const r = await fetch("/api/lexie");
    const d = await r.json();
    if (!d.ok) throw new Error(d.error ?? "No pude abrir LEXIE.");
    const lista: Mensaje[] = Array.isArray(d.mensajes)
      ? d.mensajes.filter(esMensaje)
      : [];
    setSaludo(d.saludo ?? null);
    setMensajes(lista);
    if (emitirOk) {
      const ultimoId = ultimoMensajeAgenteId(lista);
      const ultimo = lista.find((m) => m.id === ultimoId);
      emitirAplicadas(ultimo?.acciones);
    }
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
        setMensajes(
          Array.isArray(d.mensajes) ? d.mensajes.filter(esMensaje) : [],
        );
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

  // La esfera muestra actividad tanto por un turno del modelo como por una
  // acción confirmada en ejecución: generar un escrito tarda casi lo mismo.
  const activa = enviando || ocupada !== null;
  useEffect(() => {
    onOcupadaChange?.(activa);
  }, [activa, onOcupadaChange]);

  const enviar = useCallback(async () => {
    const contenido = texto.trim();
    if (contenido.length === 0 || enviando || ocupada) return;

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
    setAvisos({});

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
        // Turno cortado con acciones ya APLICADAS (un correo enviado y después
        // la API murió): el servidor insertó el par de corte con las tarjetas,
        // así que el hilo se vuelve a leer en vez de esconder lo que pasó. El
        // texto no vuelve al campo: ya quedó persistido en la conversación, y
        // re-mandarlo repetiría la acción.
        if (Array.isArray(d.acciones) && d.acciones.length > 0) {
          try {
            await recargar(true);
          } catch {
            setMensajes((m) => m.filter((x) => x.id !== temporal.id));
          }
          setError(d.error ?? "No pude responder.");
          return;
        }
        // El servidor no persistió nada si falló, así que se saca el optimista
        // y se devuelve el texto al input para que no se pierda lo escrito.
        setMensajes((m) => m.filter((x) => x.id !== temporal.id));
        setTexto(contenido);
        setError(d.error ?? "No pude responder.");
        return;
      }
      const acciones: AccionLexie[] = Array.isArray(d.acciones) ? d.acciones : [];
      setMensajes((m) => [
        ...m.filter((x) => x.id !== temporal.id),
        {
          ...temporal,
          id:
            typeof d.mensaje_usuario_id === "string"
              ? d.mensaje_usuario_id
              : `u-${Date.now()}`,
        },
        {
          // El id REAL del mensaje: es contra ese mensaje que el servidor
          // valida las claves de las pendientes, y es lo que decide qué
          // tarjetas siguen activas.
          id:
            typeof d.mensaje_agente_id === "string"
              ? d.mensaje_agente_id
              : `a-${Date.now()}`,
          tipo: "agente",
          contenido: d.respuesta,
          creado_en: new Date().toISOString(),
          acciones,
        },
      ]);
      emitirAplicadas(acciones);
    } catch {
      setMensajes((m) => m.filter((x) => x.id !== temporal.id));
      setTexto(contenido);
      setError("Se cortó la conexión. Probá de nuevo.");
    } finally {
      setEnviando(false);
      enfocarSiEsEscritorio(inputRef.current);
    }
  }, [texto, enviando, ocupada, recargar]);

  // El camino del BOTÓN: confirmar o cancelar una pendiente. Cero tokens; el
  // servidor ejecuta el payload que persistió, y devuelve el par de mensajes
  // que dejó en el hilo. La tarjeta pasa a "Ejecutando…" mientras tanto.
  const accionar = useCallback(
    async (clave: string, modo: "confirmar" | "descartar") => {
      if (ocupada || enviando) return;
      setOcupada(clave);
      setError(null);
      setAvisos((a) => {
        if (!(clave in a)) return a;
        const resto = { ...a };
        delete resto[clave];
        return resto;
      });
      try {
        const r = await fetch("/api/lexie", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            modo === "confirmar"
              ? { confirmar_accion: clave }
              : { descartar_accion: clave },
          ),
        });
        const d = await r.json();
        if (r.status === 409) {
          // No es un fallo: la acción ya se ejecutó o se descartó por otra vía
          // (otra pestaña, o por texto en un turno posterior). Se avisa en la
          // tarjeta y se vuelve a leer el hilo, que es donde está la verdad.
          setAvisos((a) => ({
            ...a,
            [clave]:
              typeof d.error === "string"
                ? d.error
                : "Esa acción ya no está pendiente.",
          }));
          await recargar(true);
          return;
        }
        if (!d.ok) {
          setError(d.error ?? "No pude procesar la confirmación.");
          return;
        }
        const nuevos: Mensaje[] = Array.isArray(d.mensajes)
          ? d.mensajes.filter(esMensaje)
          : [];
        setMensajes((m) => [...m, ...nuevos]);
        if (d.accion) emitirMutacionLexie(d.accion as AccionLexie);
      } catch {
        // La conexión murió sin respuesta, pero el servidor pudo haber
        // ejecutado igual (el par se inserta antes de ejecutar). Se relee el
        // hilo para que la tarjeta diga lo que realmente pasó.
        try {
          await recargar(true);
        } catch {
          /* el cartel de abajo ya lo dice */
        }
        setError(
          "Se cortó la conexión. Si la acción se alcanzó a ejecutar, la tarjeta lo dice.",
        );
      } finally {
        setOcupada(null);
      }
    },
    [ocupada, enviando, recargar],
  );

  const confirmar = useCallback(
    (clave: string) => void accionar(clave, "confirmar"),
    [accionar],
  );
  const descartar = useCallback(
    (clave: string) => void accionar(clave, "descartar"),
    [accionar],
  );

  const vacio = mensajes.length === 0;
  // Sólo el último mensaje del agente tiene pendientes ACCIONABLES: el
  // servidor valida la clave contra ese mensaje, y contra ningún otro.
  const ultimoAgenteId = ultimoMensajeAgenteId(mensajes);

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
                    {m.origen === "boton" ? (
                      // «Confirmé: …» / «Descarté: …» lo escribió el botón, no
                      // el abogado: va como una nota discreta, sin la burbuja
                      // violeta que identifica lo que él tipeó.
                      <p className="max-w-[85%] whitespace-pre-wrap px-1 py-0.5 text-right text-xs italic text-[var(--el-text-muted)]">
                        {m.contenido}
                      </p>
                    ) : (
                      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[var(--el-violet)]/15 px-3.5 py-2 text-sm text-[var(--el-text)]">
                        {m.contenido}
                      </p>
                    )}
                  </div>
                ) : (
                  <div key={m.id} className="max-w-[92%]">
                    <TextoLexie texto={m.contenido} />
                    {m.acciones && m.acciones.length > 0 ? (
                      <AccionesLexie
                        acciones={m.acciones}
                        activas={m.id === ultimoAgenteId}
                        ocupada={ocupada}
                        avisos={avisos}
                        onConfirmar={confirmar}
                        onDescartar={descartar}
                      />
                    ) : null}
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
            className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-3 py-2 text-sm text-rose-700 dark:text-rose-300"
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
            disabled={
              enviando || dictando || ocupada !== null || texto.trim().length === 0
            }
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
