"use client";
// Avatar de un rol de la sala. SVG inline, sin dependencias ni assets externos.
//
// ESTE ARCHIVO ES REEMPLAZABLE POR DISEÑO. Es el único lugar que sabe cómo se
// DIBUJA un personaje; el resto de la escena (posiciones, iluminación del
// hablante, fases, transcripción) solo conoce el `rol` y su color. Para pasar a
// pixel-art alcanza con cambiar el cuerpo de este componente por sprites o un
// <img> con `image-rendering: pixelated`, manteniendo la firma.
//
// Los trazos vienen del mockup lexstrategy_sala.html (viewBox 0 0 100 104).

import type { RolSala } from "@/lib/simulador/sala";

type Rasgos = {
  piel: string;
  pelo: string;
  // Melena a los costados.
  melena?: boolean;
  // Puñetas/jabot blanco del magistrado. Excluyente con `corbata`.
  jabot?: boolean;
  corbata?: string;
};

// Solo apariencia. El color IDENTIFICATORIO del rol no está acá: va en el
// anillo del marco y en la placa de nombre (ver sala.ts). Por eso el esquema
// sigue funcionando aunque después cambie el estilo de dibujo.
const RASGOS: Record<RolSala, Rasgos> = {
  juez: { piel: "#e6b58f", pelo: "#a7b0bd", jabot: true },
  secretario: { piel: "#e7bd97", pelo: "#4a3728", corbata: "#8aa0b6" },
  fiscal: { piel: "#f0c6a0", pelo: "#7a4636", melena: true, corbata: "#f2555f" },
  querellante: { piel: "#e0b088", pelo: "#5a3a2a", melena: true, corbata: "#e8739f" },
  defensa: { piel: "#d9a57e", pelo: "#20242e", corbata: "#8b7cf6" },
  imputado: { piel: "#c98d63", pelo: "#31241c" },
  testigo: { piel: "#d8a882", pelo: "#3a3028" },
  perito: { piel: "#e3bb96", pelo: "#55524d", corbata: "#56b8c9" },
};

export function AvatarRol({
  rol,
  className,
}: {
  rol: RolSala;
  className?: string;
}) {
  const r = RASGOS[rol];
  // El magistrado viste toga: más oscura que el traje del resto.
  const traje = rol === "juez" ? "#1c2330" : "#28303f";

  return (
    <svg
      viewBox="0 0 100 104"
      className={className}
      role="presentation"
      aria-hidden="true"
    >
      {/* torso */}
      <path d="M12,104 Q12,72 50,72 Q88,72 88,104 Z" fill={traje} />

      {/* cuello de la vestimenta */}
      {r.jabot ? (
        <>
          <path d="M43,71 L43,92 L50,98 L57,92 L57,71 Z" fill="#f2f5fb" />
          <rect x="46.5" y="73" width="7" height="20" fill="#dbe1ec" />
        </>
      ) : r.corbata ? (
        <path d="M50,73 L44.5,87 L50,100 L55.5,87 Z" fill={r.corbata} />
      ) : (
        <path d="M42,74 Q50,80 58,74 L58,78 Q50,85 42,78 Z" fill="#1c222e" />
      )}

      {/* cuello y cabeza */}
      <rect x="44" y="60" width="12" height="14" rx="3" fill={r.piel} />
      <circle cx="50" cy="44" r="21" fill={r.piel} />

      {/* pelo */}
      <path
        d="M28,44 Q28,17 50,17 Q72,17 72,44 Q66,30 50,30 Q34,30 28,44Z"
        fill={r.pelo}
      />
      {r.melena ? (
        <>
          <path d="M27,42 Q24,62 33,70 L34,40 Z" fill={r.pelo} />
          <path d="M73,42 Q76,62 67,70 L66,40 Z" fill={r.pelo} />
        </>
      ) : null}

      {/* rostro */}
      <circle cx="42" cy="45" r="2.4" fill="#191c24" />
      <circle cx="58" cy="45" r="2.4" fill="#191c24" />
      <path
        d="M44.5,53 Q50,57 55.5,53"
        stroke="#a9695a"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
