"use client";
import { fmtFecha } from "@/lib/format";
import type { MensajeConversacion } from "@/lib/types";
import { AdjuntosRender } from "@/components/mis-casos/adjuntos-render";

type Props = {
  casoId: string;
  mensaje: MensajeConversacion;
};

// Mensaje del abogado en el chat. Burbuja alineada a la DERECHA con
// tinte violeta (convención de chat: lo propio va a la derecha) + texto
// + adjuntos descargables (reusa AdjuntosRender existente).
export function MensajeUsuario({ casoId, mensaje }: Props) {
  return (
    // 92% abajo de 640px: a 360px el 85% dejaba ~270px de burbuja menos
    // 24px de padding, y un mensaje de tres renglones pasaba a cinco.
    <article className="ml-auto max-w-[92%] sm:max-w-[85%] rounded-md border border-primary/25 bg-primary/10 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        Tu mensaje · {fmtFecha(mensaje.creado_en)}
      </p>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">
        {mensaje.contenido}
      </p>
      {mensaje.adjuntos && mensaje.adjuntos.length > 0 ? (
        <AdjuntosRender casoId={casoId} adjuntos={mensaje.adjuntos} />
      ) : null}
    </article>
  );
}
