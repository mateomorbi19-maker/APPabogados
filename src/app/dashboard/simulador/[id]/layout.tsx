import type { ReactNode } from "react";

// El Simulador de audiencias se ve SIEMPRE en oscuro, por el mismo motivo que
// el Mapa procesal: la Vista de sala es un escenario iluminado (anillos de
// color, glows por rol, ecualizador del hablante) construido sobre fondo
// negro. Ver el comentario del layout del mapa.
export default function SimuladorLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="dark contents [color-scheme:dark]">{children}</div>;
}
