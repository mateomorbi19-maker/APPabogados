"use client";
// Orquestador del chat. Cliente. Mantiene state de mensajes para
// optimistic insert (mensaje del usuario inmediato + respuesta del
// agente cuando llega) y maneja el flujo de "nueva conversación" /
// "renombrar".

import { useState } from "react";
import type { Conversacion, MensajeConversacion } from "@/lib/types";
import { ChatHeader } from "./chat-header";
import { ListaMensajes } from "./lista-mensajes";
import { InputMensaje } from "./input-mensaje";

type Props = {
  casoId: string;
  conversacionInicial: Conversacion;
  mensajesIniciales: MensajeConversacion[];
  conversaciones: Conversacion[];
};

export function ChatShell({
  casoId,
  conversacionInicial,
  mensajesIniciales,
  conversaciones,
}: Props) {
  // El state local solo cubre los mensajes de la conversación actual
  // y su título (renombrable). Cambiar de conversación o crear una
  // nueva navega a otra URL → server-side reload → state nuevo.
  const [conversacion, setConversacion] = useState(conversacionInicial);
  const [mensajes, setMensajes] = useState(mensajesIniciales);

  const onMensajesNuevos = (nuevos: MensajeConversacion[]) => {
    setMensajes((prev) => [...prev, ...nuevos]);
  };

  const onTituloRenombrado = (nuevoTitulo: string) => {
    setConversacion((prev) => ({ ...prev, titulo: nuevoTitulo }));
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-3">
      <ChatHeader
        casoId={casoId}
        conversacion={conversacion}
        conversaciones={conversaciones}
        onTituloRenombrado={onTituloRenombrado}
      />
      <ListaMensajes
        casoId={casoId}
        mensajes={mensajes}
      />
      <InputMensaje
        casoId={casoId}
        conversacionId={conversacion.id}
        archivada={conversacion.estado === "archivada"}
        onMensajesNuevos={onMensajesNuevos}
      />
    </div>
  );
}
