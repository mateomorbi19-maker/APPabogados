// Helpers de presentación de direcciones de correo (avatares, nombres cortos).

import type { DireccionEmail } from "@/lib/gmail/types";

// Tailwind v4 escanea STRINGS LITERALES: las clases van completas y el hash
// del email sólo elige el índice. Nada de `bg-${color}-500`.
const COLORES_AVATAR: readonly string[] = [
  "bg-[rgba(139,92,246,0.20)] text-[#c4b5fd]",
  "bg-[rgba(52,211,153,0.18)] text-[#6ee7b7]",
  "bg-[rgba(96,165,250,0.18)] text-[#93c5fd]",
  "bg-[rgba(251,191,36,0.18)] text-[#fcd34d]",
  "bg-[rgba(244,114,182,0.18)] text-[#f9a8d4]",
  "bg-[rgba(45,212,191,0.18)] text-[#5eead4]",
  "bg-[rgba(248,113,113,0.18)] text-[#fca5a5]",
  "bg-[rgba(129,140,248,0.20)] text-[#a5b4fc]",
];

/**
 * Color estable por remitente: el mismo email siempre cae en el mismo par
 * fondo/texto, así el ojo reconoce a la fiscalía o al cliente sin leer.
 */
export function colorAvatar(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) {
    h = (h * 31 + email.charCodeAt(i)) >>> 0;
  }
  return COLORES_AVATAR[h % COLORES_AVATAR.length];
}

export function inicialDe(d: DireccionEmail): string {
  const base = d.nombre.trim() || d.email.trim();
  const c = base.charAt(0);
  return c ? c.toUpperCase() : "?";
}

/**
 * Nombre para mostrar. El parser garantiza que `nombre` cae al email cuando el
 * header no traía display name; en ese caso mostramos sólo la parte local para
 * que la columna de remitentes no quede toda igual.
 */
export function nombreDe(d: DireccionEmail): string {
  if (d.nombre && d.nombre !== d.email) return d.nombre;
  const arroba = d.email.indexOf("@");
  return arroba > 0 ? d.email.slice(0, arroba) : d.email;
}
