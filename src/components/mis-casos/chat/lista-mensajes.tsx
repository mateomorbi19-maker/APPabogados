"use client";
// Zona central del chat inmersivo: la ÚNICA que scrollea. El contenedor
// externo es flex-1 min-h-0 overflow-y-auto (receta obligatoria para que
// el overflow enganche dentro de la columna acotada del ChatShell); el
// track interno centra los mensajes en max-w-4xl para legibilidad.
// Auto-scroll al final cuando llega un mensaje nuevo; el usuario puede
// scrollear hacia arriba libremente.

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
      <div className="flex-1 min-h-0 flex items-center justify-center px-4">
        <p className="text-sm text-muted-foreground text-center max-w-md">
          Empezá la conversación con el agente. Tiene acceso al análisis
          original del caso, la estrategia que elegiste, y todo el
          historial del timeline.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-4 md:px-6 space-y-4">
        {mensajes.map((m) =>
          m.rol === "usuario" ? (
            <MensajeUsuario key={m.id} casoId={casoId} mensaje={m} />
          ) : (
            <MensajeAgente key={m.id} mensaje={m} />
          ),
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
