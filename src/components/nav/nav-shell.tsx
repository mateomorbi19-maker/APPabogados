import type { ReactNode } from "react";
import { BuscadorProvider } from "@/components/buscador/buscador-global";
import { LexieLauncher } from "@/components/lexie/lexie-launcher";
import { AppSidebar } from "./app-sidebar";
import { TopBar } from "./top-bar";

// Shell de navegación de las secciones con header + sidebar (todas menos las
// vistas inmersivas como el Mapa Procesal). El caller monta <ConsumoProvider>
// aguas arriba para que el medidor del header funcione, y pasa el nombre del
// usuario + si es admin (para condicionar el item Admin de la sidebar).
//
// No lleva "use client": compone dos client components (TopBar, AppSidebar)
// pero `children` puede ser un server component sin convertirse en client.
// `ancho`:
// - "contenido" (default) centra los children en una columna de max-w-6xl con
//   padding. Es lo que quiere una vista de lectura (casos, consumo, agenda).
// - "completo" entrega el <main> pelado, sin centrado ni padding. Es lo que
//   necesita una vista de trabajo tipo escritorio —la Bandeja— donde la lista
//   tiene que quedar pegada a la sidebar y aprovechar todo el ancho. Sin esto,
//   en pantallas anchas el max-w-6xl deja una franja muerta a cada lado y la
//   bandeja parece flotar en el medio.
export function NavShell({
  nombreUsuario,
  isAdmin,
  ancho = "contenido",
  children,
}: {
  nombreUsuario: string;
  isAdmin: boolean;
  ancho?: "contenido" | "completo";
  children: ReactNode;
}) {
  // BuscadorProvider envuelve todo el shell: monta el diálogo del buscador
  // global una sola vez y registra el atajo ⌘K / Ctrl+K, así el buscador se
  // abre desde cualquier sección y no solo desde el Inicio.
  return (
    <BuscadorProvider>
      <div className="flex min-h-screen flex-col bg-[var(--el-canvas)] text-[var(--el-text)]">
        <TopBar />
        <div className="flex flex-1">
          <AppSidebar nombreUsuario={nombreUsuario} isAdmin={isAdmin} />
          <main className="min-w-0 flex-1 bg-[var(--el-canvas)]">
            {ancho === "completo" ? (
              children
            ) : (
              <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
                {children}
              </div>
            )}
          </main>
        </div>
        {/* LEXIE va acá y no dentro de <main>: es global a la app, tiene que
            poder abrirse desde cualquier sección y quedar por encima del
            contenido sin que el ancho del main la recorte. */}
        <LexieLauncher />
      </div>
    </BuscadorProvider>
  );
}
