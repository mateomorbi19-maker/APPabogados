import type { ReactNode } from "react";

// El Mapa procesal se ve SIEMPRE en oscuro, sin importar el tema elegido en
// Ajustes. No es una omisión: su tratamiento visual ("dossier holográfico") son
// orbes con glow, carriles luminosos y chrome de vidrio sobre un canvas casi
// negro. En claro no se degrada a algo aceptable — se vuelve ilegible.
//
// `contents` hace que el wrapper no genere caja, así que no toca el layout
// full-screen de la vista. Las custom properties y `color-scheme` igual
// heredan a través de él, que es todo lo que hace falta para fijar la paleta.
export default function MapaProcesalLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="dark contents [color-scheme:dark]">{children}</div>;
}
