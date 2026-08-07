// Modelo del tema de la app. Sin "use client": lo importa tanto el provider
// (cliente) como el layout (servidor, para inyectar el script anti-flash).
//
// Sólo DOS opciones, y es a propósito: "Oscuro" (el default y el modo para el
// que está diseñada la app) y "Sistema" (seguir al sistema operativo). No hay
// "Claro" suelto porque nadie pidió forzar claro; quien quiere claro lo tiene
// desde su sistema operativo, que es donde ya tomó esa decisión una vez.

export const TEMAS = ["oscuro", "sistema"] as const;
export type Tema = (typeof TEMAS)[number];

export const TEMA_DEFAULT: Tema = "oscuro";

/** Clave de localStorage. La comparte el provider con el script anti-flash. */
export const TEMA_STORAGE_KEY = "el-tema";

export function esTema(v: unknown): v is Tema {
  return v === "oscuro" || v === "sistema";
}

export const TEMA_META: Record<Tema, { label: string; descripcion: string }> = {
  oscuro: {
    label: "Oscuro",
    descripcion: "Siempre en oscuro, como está diseñada la app.",
  },
  sistema: {
    label: "Sistema",
    descripcion:
      "Sigue la preferencia de tu computadora: claro de día, oscuro de noche si lo tenés configurado así.",
  },
};

/**
 * Script que corre ANTES del primer paint para evitar el flash: sin esto, el
 * HTML llega con `.dark` (el default del servidor) y recién después de hidratar
 * React lo sacaría, así que quien eligió "Sistema" con el sistema en claro vería
 * un fogonazo oscuro en cada navegación.
 *
 * Se escribe como string y no como función serializada para que quede legible
 * en el HTML y para poder envolverlo en un try/catch: en un navegador con
 * cookies/almacenamiento bloqueado, `localStorage` tira y sin el catch se
 * rompería el resto del documento.
 *
 * Cualquier valor desconocido cae en oscuro, que es el default.
 */
export const SCRIPT_ANTI_FLASH = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  TEMA_STORAGE_KEY,
)});var oscuro=t==="sistema"?window.matchMedia("(prefers-color-scheme: dark)").matches:true;var e=document.documentElement;e.classList.toggle("dark",oscuro);e.style.colorScheme=oscuro?"dark":"light";}catch(_){}})();`;
