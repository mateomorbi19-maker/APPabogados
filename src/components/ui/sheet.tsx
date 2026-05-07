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
        className="fixed right-0 top-0 z-50 h-screen w-full max-w-[60vw] overflow-y-auto border-l border-border bg-card shadow-2xl"
      >
        {children}
      </aside>
    </>
  );
}
