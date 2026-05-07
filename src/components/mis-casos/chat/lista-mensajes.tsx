"use client";
// Lista scrolleable de mensajes del chat. Auto-scroll al final cuando
// llega un mensaje nuevo. El usuario puede scrollear hacia arriba a
// mensajes anteriores; el auto-scroll se activa solo al agregar.

import { useEffect, useRef } from "react";
import type { MensajeConversacion } from "@/lib/types";
import { MensajeUsuario } from "./mensaje-usuario";
import { MensajeAgente } from "./mensaje-agente";

type Props = {
  casoId: string;
  mensajes: MensajeConversacion[];
};

export function ListaMensajes({ casoId, mensajes }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll cuando cambia la cantidad de mensajes. NO al cambiar
  // el contenido de un mensaje existente (eso no debería pasar pero
  // por si acaso).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensajes.length]);

  if (mensajes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[40vh]">
        <p className="text-sm text-muted-foreground text-center max-w-md">
          Empezá la conversación con el agente. Tiene acceso al análisis
          original del caso, la estrategia que elegiste, y todo el
          historial del timeline.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto rounded-md border border-border bg-card/20 px-3 py-3 space-y-4">
      {mensajes.map((m) =>
        m.rol === "usuario" ? (
          <MensajeUsuario key={m.id} casoId={casoId} mensaje={m} />
        ) : (
          <MensajeAgente key={m.id} mensaje={m} />
        ),
      )}
      <div ref={bottomRef} />
    </div>
  );
}
