"use client";
// Drawer lateral derecho para drill-down de la ejecución. Implementación
// manual porque shadcn/ui sheet no está instalado y el dialog del proyecto
// (@base-ui/react) está pensado como modal centrado.
//
// Decisiones:
// - Backdrop bloquea scroll del body al estar abierto.
// - Esc cierra. Click fuera cierra.
// - Sin animación de entrada/salida — el panel es operativo, sin frills.
//   Si lo querés más smooth, ver `tw-animate-css` que ya está en deps.

import { useEffect, type ReactNode } from "react";

export function Sheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onOpenChange]);

  if (!open) return null;
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        // Anchos: en móvil el panel va a pantalla completa. `max-w-[60vw]` sin
        // variante base aplicaba DESDE 0px, así que en un teléfono de 360 el
        // drawer se dibujaba de 216px — con el px-5 de su consumidor quedaban
        // 176px útiles para un formulario con select, fecha/hora y textarea.
        // El `max-w-none` explícito es necesario para desactivarlo abajo de sm.
        //
        // Alto: h-dvh y no h-screen. 100vh en móvil es el viewport GRANDE (el
        // que existiría sin la barra de URL), así que el panel medía siempre
        // más que la pantalla y su último control caía abajo del borde.
        className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-none flex-col overflow-y-auto overscroll-contain border-l border-border bg-card shadow-2xl sm:max-w-[32rem] lg:max-w-[60vw]"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {children}
      </aside>
    </>
  );
}
