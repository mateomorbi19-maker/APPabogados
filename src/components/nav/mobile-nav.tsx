"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton, useUser } from "@clerk/nextjs";
import { LogOut, Menu, X } from "lucide-react";
import { ConsumoBar } from "@/components/header/consumo-bar";
import { useMediaQuery } from "@/lib/hooks/use-cliente";
import { itemsVisibles } from "./nav-items";
import { cn } from "@/lib/utils";

// Navegación de móvil: botón hamburguesa en la top bar + panel lateral.
//
// La sidebar de escritorio es `hidden md:flex`, así que abajo de 768px la app
// se quedaba literalmente sin menú: Agenda, Bandeja, Repositorio, Consumo y
// Admin no tenían NINGÚN punto de entrada desde el teléfono. Este componente
// es ese punto de entrada.
//
// Comparte los items con la sidebar vía nav-items.ts, así que agregar una
// sección la publica en las dos a la vez.
export function MobileNav({
  nombreUsuario,
  isAdmin,
}: {
  nombreUsuario: string;
  isAdmin: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const pathname = usePathname();
  const { user } = useUser();
  const items = itemsVisibles(isAdmin);
  const panelRef = useRef<HTMLDivElement>(null);
  const botonRef = useRef<HTMLButtonElement>(null);

  // El panel se ocultaba con `md:hidden`, o sea por CSS, mientras `abierto`
  // seguía en true. Al rotar el teléfono o ensanchar la ventana pasando los
  // 768px, el drawer desaparecía de la vista pero el efecto NO se limpiaba: el
  // `overflow: hidden` del body quedaba puesto y la página de escritorio se
  // quedaba sin scroll, sin ningún control visible para destrabarla (el
  // backdrop y la X también son md:hidden). Derivando la visibilidad del
  // breakpoint, cruzarlo re-corre el efecto y el cleanup devuelve el scroll.
  const esEscritorio = useMediaQuery("(min-width: 768px)");
  const visible = abierto && !esEscritorio;

  useEffect(() => {
    if (!visible) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    // Scroll lock del fondo mientras el panel está abierto.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    // El foco entra al panel al abrir y vuelve al botón al cerrar: si se
    // quedara en el botón, un lector de pantalla seguiría leyendo el contenido
    // de atrás como si el panel no existiera.
    const boton = botonRef.current;
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // `offsetParent === null` = el botón quedó display:none, que es lo que
      // pasa cuando el cierre lo causó el cruce a escritorio y no el usuario.
      // Devolverle el foco a un elemento oculto lo manda al body y pierde la
      // posición de lectura.
      if (boton && boton.offsetParent !== null) boton.focus();
    };
  }, [visible]);

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        onClick={() => setAbierto(true)}
        aria-label="Abrir menú"
        aria-expanded={abierto}
        // size-10 y no size-8: 40px es el piso razonable para un tap target.
        className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-lg text-[var(--el-text-soft)] transition-colors hover:bg-black/5 hover:text-[var(--el-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--el-violet)]/50 dark:hover:bg-white/5 md:hidden"
      >
        <Menu className="size-5" />
      </button>

      {/* createPortal a <body> y no inline: MobileNav se monta DENTRO del
          <header>, que lleva `backdrop-blur`. Un backdrop-filter distinto de
          none convierte al elemento en bloque contenedor de sus descendientes
          `fixed` Y le abre un contexto de apilado propio. Sin el portal, este
          `fixed inset-0` se resolvia contra el header (56px de alto) en vez de
          contra el viewport, y su z-50 quedaba encerrado en el z-20 del
          header. El portal lo saca del arbol del header y arregla las dos.
          Sin `md:hidden`: la visibilidad la decide `visible`, asi el DOM y el
          efecto del scroll lock no pueden divergir. */}
      {visible &&
        createPortal(
          <div className="fixed inset-0 z-50">
            <div
              className="absolute inset-0 animate-in bg-black/60 fade-in backdrop-blur-sm"
              onClick={() => setAbierto(false)}
              aria-hidden
            />
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Menú de navegación"
              // 100dvh y no 100vh: con la barra de URL del navegador móvil
              // visible, 100vh se pasa de largo y el bloque de perfil queda
              // abajo del borde inferior de la pantalla.
              className={cn(
                "absolute inset-y-0 left-0 flex h-[100dvh] w-[17rem] max-w-[85vw] flex-col",
                "border-r border-[var(--el-border)] bg-[var(--el-surface-side)] shadow-2xl",
                "animate-in slide-in-from-left duration-200",
              )}
              style={{
                paddingTop: "env(safe-area-inset-top)",
                paddingBottom: "env(safe-area-inset-bottom)",
              }}
            >
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--el-border-soft)] px-4">
                <span className="font-display text-lg font-semibold">
                  <span className="text-[var(--el-text)]">Estrategia</span>
                  <span className="text-[var(--el-violet-light)]">Legal</span>
                </span>
                <button
                  type="button"
                  onClick={() => setAbierto(false)}
                  aria-label="Cerrar menú"
                  className="-mr-2 flex size-10 items-center justify-center rounded-lg text-[var(--el-text-soft)] transition-colors hover:bg-black/5 hover:text-[var(--el-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--el-violet)]/50 dark:hover:bg-white/5"
                >
                  <X className="size-5" />
                </button>
              </div>

              <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
                {items.map((item) => {
                  const activo = item.match(pathname);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      // Cerrar acá y no en un efecto sobre `pathname`: navegar
                      // ES el evento, y derivarlo de un cambio de ruta obliga a
                      // un setState dentro de un useEffect (render en cascada).
                      onClick={() => setAbierto(false)}
                      aria-current={activo ? "page" : undefined}
                      // py-3 (≈44px de alto total) contra el py-2 de escritorio:
                      // con el dedo no hay puntería de mouse.
                      className={cn(
                        "flex items-center gap-3 rounded-[9px] px-3 py-3 text-[15px] transition-colors",
                        activo
                          ? "bg-[rgba(139,92,246,0.22)] font-medium text-violet-800 dark:text-[#CDBEFF]"
                          : "text-[var(--el-text-soft)] hover:bg-black/5 hover:text-[var(--el-text)] dark:hover:bg-white/5",
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-[18px] shrink-0",
                          !activo && "text-[var(--el-text-muted)]",
                        )}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </nav>

              {/* El medidor de cupo vive en la top bar, que en móvil no tiene
                  lugar para él. Acá entra completo, y con los números a la vista:
                  en la top bar están detrás de un tooltip, que en una pantalla
                  táctil no se puede abrir. */}
              <div className="shrink-0 border-t border-[var(--el-border-soft)] px-4 py-3">
                <ConsumoBar variante="drawer" />
              </div>

              <div className="shrink-0 border-t border-[var(--el-border-soft)] px-3 py-3">
                <div className="flex items-center gap-3 px-1">
                  {user?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={user.imageUrl}
                      alt=""
                      className="size-8 shrink-0 rounded-full"
                    />
                  ) : (
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-sm font-medium text-primary">
                      {nombreUsuario.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {nombreUsuario}
                  </span>
                </div>
                <SignOutButton>
                  <button
                    type="button"
                    className="mt-2 flex w-full items-center gap-3 rounded-md px-3 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <LogOut className="size-[18px] shrink-0" />
                    Salir
                  </button>
                </SignOutButton>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
