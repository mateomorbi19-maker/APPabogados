"use client";
// Orquestador del chat. Cliente. Vista inmersiva full-height (patrón
// Mapa Procesal): columna de 3 filas acotada al viewport —
//
//   1. ChatHeader   (shrink-0, barra superior fija)
//   2. ListaMensajes (flex-1 min-h-0, ÚNICA zona que scrollea)
//   3. barra de input (shrink-0, fija abajo)
//
// La página lo monta con key={conversacion.id}: cambiar de conversación
// remonta el shell entero y el state local nunca queda stale.

import { useEffect, useState } from "react";
import type { Conversacion, MensajeConversacion } from "@/lib/types";
import { ChatHeader } from "./chat-header";
import { ListaMensajes } from "./lista-mensajes";
import { InputMensaje } from "./input-mensaje";

type Props = {
  casoId: string;
  casoTitulo: string;
  conversacionInicial: Conversacion;
  mensajesIniciales: MensajeConversacion[];
  conversaciones: Conversacion[];
};

export function ChatShell({
  casoId,
  casoTitulo,
  conversacionInicial,
  mensajesIniciales,
  conversaciones,
}: Props) {
  const [conversacion, setConversacion] = useState(conversacionInicial);
  const [mensajes, setMensajes] = useState(mensajesIniciales);
  // true mientras el agente está generando la respuesta: la lista
  // muestra la burbuja "Pensando…" (UX de chat estándar).
  const [pensando, setPensando] = useState(false);

  // Alto real de la ventana cuando el teclado virtual está abierto, o null
  // cuando no hace falta forzarlo. Ver el efecto de abajo.
  const [altoConTeclado, setAltoConTeclado] = useState<number | null>(null);

  // El teclado virtual de iOS NO achica el viewport de layout: `h-dvh` sigue
  // midiendo la pantalla entera y el dock de input (textarea + Enviar) queda
  // abajo del teclado, o sea escribís a ciegas. En Android lo resuelve
  // `interactiveWidget: "resizes-content"` del layout, pero Safari no lo
  // soporta: ahí la única fuente de verdad es visualViewport. En un iPhone 13
  // (390x844) con el teclado abierto la altura útil baja a ~508px.
  //
  // Solo se activa abajo de 768px y solo cuando la diferencia supera los
  // 120px (el colapso de la barra de Safari son ~60px y no es un teclado):
  // en escritorio `h-dvh` alcanza y no tocamos nada.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const movil = window.matchMedia("(max-width: 767px)");
    const medir = () => {
      if (!movil.matches) {
        setAltoConTeclado(null);
        return;
      }
      const tapado = window.innerHeight - vv.height;
      if (tapado > 120) {
        setAltoConTeclado(Math.round(vv.height));
        // iOS desplaza el viewport visual para revelar el campo enfocado.
        // Como acá el alto ya lo compensamos nosotros, ese desplazamiento
        // deja el header cortado arriba: lo devolvemos a cero.
        window.scrollTo(0, 0);
      } else {
        setAltoConTeclado(null);
      }
    };
    medir();
    vv.addEventListener("resize", medir);
    movil.addEventListener("change", medir);
    return () => {
      vv.removeEventListener("resize", medir);
      movil.removeEventListener("change", medir);
    };
  }, []);

  // Protocolo optimista: al enviar, el mensaje del abogado se agrega a
  // la lista AL INSTANTE con un id temporal; cuando el server responde,
  // el temporal se reemplaza por los mensajes reales (o se quita, si el
  // envío falló antes de persistir).
  const onEnvioIniciado = (optimista: MensajeConversacion) => {
    setMensajes((prev) => [...prev, optimista]);
    setPensando(true);
  };

  const onEnvioTerminado = (
    tempId: string,
    nuevos: MensajeConversacion[],
  ) => {
    // Dedup por id además del reemplazo del temporal: el
    // recovery-polling post-502 puede devolver mensajes que ya están
    // en la lista (su ventana "desde" arranca 5s antes del POST).
    setMensajes((prev) => {
      const base = prev.filter((m) => m.id !== tempId);
      const ids = new Set(base.map((m) => m.id));
      return [...base, ...nuevos.filter((m) => !ids.has(m.id))];
    });
    setPensando(false);
  };

  const onTituloRenombrado = (nuevoTitulo: string) => {
    setConversacion((prev) => ({ ...prev, titulo: nuevoTitulo }));
  };

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-background"
      style={
        altoConTeclado !== null ? { height: `${altoConTeclado}px` } : undefined
      }
    >
      <ChatHeader
        casoId={casoId}
        casoTitulo={casoTitulo}
        conversacion={conversacion}
        conversaciones={conversaciones}
        onTituloRenombrado={onTituloRenombrado}
      />

      <ListaMensajes casoId={casoId} mensajes={mensajes} pensando={pensando} />

      {/* El layout declara viewportFit "cover", así que en la app instalada
          en un iPhone con notch los ~34px del home indicator se comen la fila
          de Nivel/Dictar/Enviar. env(safe-area-inset-bottom) es 0 en todo lo
          demás, así que el padding de escritorio queda igual. */}
      <div className="shrink-0 border-t border-border bg-card/40">
        <div className="mx-auto w-full max-w-4xl px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:px-6">
          <InputMensaje
            casoId={casoId}
            conversacionId={conversacion.id}
            archivada={conversacion.estado === "archivada"}
            onEnvioIniciado={onEnvioIniciado}
            onEnvioTerminado={onEnvioTerminado}
          />
        </div>
      </div>
    </div>
  );
}
