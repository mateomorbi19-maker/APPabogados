"use client";
// Registra el service worker de public/sw.js.
//
// Sin este registro Chrome no ofrece "Instalar" en Android, por más completo
// que esté el manifest. (iOS no lo necesita: "Agregar a inicio" del menú
// Compartir funciona igual, pero tener el SW le da el cartel de sin conexión.)
//
// Solo en producción: en desarrollo un service worker activo se mete con el
// hot reload y sirve navegaciones viejas mientras se edita.

import { useEffect } from "react";

export function RegistrarSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // Después del load: registrar durante la carga inicial compite por ancho de
    // banda con el JS que la página necesita para ser interactiva.
    const registrar = () => {
      navigator.serviceWorker.register("/sw.js").catch((e) => {
        // Que falle el registro no rompe nada: la app funciona igual, solo no
        // se puede instalar.
        console.warn("[pwa] no se pudo registrar el service worker:", e);
      });
    };

    if (document.readyState === "complete") {
      registrar();
      return;
    }
    window.addEventListener("load", registrar);
    return () => window.removeEventListener("load", registrar);
  }, []);

  return null;
}
