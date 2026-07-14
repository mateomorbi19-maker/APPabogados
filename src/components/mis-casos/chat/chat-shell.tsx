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

import { useState } from "react";
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
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <ChatHeader
        casoId={casoId}
        casoTitulo={casoTitulo}
        conversacion={conversacion}
        conversaciones={conversaciones}
        onTituloRenombrado={onTituloRenombrado}
      />

      <ListaMensajes casoId={casoId} mensajes={mensajes} pensando={pensando} />

      <div className="shrink-0 border-t border-border bg-card/40">
        <div className="mx-auto w-full max-w-4xl px-4 py-3 md:px-6">
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
