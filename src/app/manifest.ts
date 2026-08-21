import type { MetadataRoute } from "next";

// Web App Manifest — lo que convierte al dominio en algo instalable.
//
// Next lo sirve en /manifest.webmanifest y lo linkea solo desde el <head>; no
// hace falta agregar el <link> a mano.
//
// Android (Chrome) pide, para ofrecer "Instalar": name, icons de 192 y 512,
// start_url, display standalone y un service worker con handler de fetch (ver
// public/sw.js). iOS (Safari) ignora casi todo esto y se guía por las meta
// `apple-mobile-web-app-*` y el apple-touch-icon, que van en layout.tsx.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EstrategiaLegal",
    short_name: "EstrategiaLegal",
    description: "Análisis estratégico de casos penales asistido por IA",
    // La app arranca en el Inicio. Si el usuario no tiene sesión, Clerk lo
    // manda a /sign-in igual que en el navegador.
    start_url: "/",
    // `standalone` es lo que saca la barra de direcciones y hace que se sienta
    // una app y no una pestaña. Es literalmente el pedido.
    display: "standalone",
    orientation: "portrait",
    // Coincide con --el-canvas del tema oscuro: el splash de Android y la
    // barra de estado quedan del color de la app, sin flash blanco al abrir.
    background_color: "#08080c",
    theme_color: "#08080c",
    lang: "es-AR",
    dir: "ltr",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // `maskable` va en su propio archivo, con padding, porque Android recorta
      // hasta un 20% de cada borde para adaptarlo a la forma de íconos del
      // launcher. Usar el mismo arte que "any" le comería las letras.
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
