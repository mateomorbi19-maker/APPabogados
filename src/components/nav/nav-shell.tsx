import type { ReactNode } from "react";
import { AppSidebar } from "./app-sidebar";
import { TopBar } from "./top-bar";

// Shell de navegación de las secciones con header + sidebar (todas menos las
// vistas inmersivas como el Mapa Procesal). El caller monta <ConsumoProvider>
// aguas arriba para que el medidor del header funcione, y pasa el nombre del
// usuario + si es admin (para condicionar el item Admin de la sidebar).
//
// No lleva "use client": compone dos client components (TopBar, AppSidebar)
// pero `children` puede ser un server component sin convertirse en client.
export function NavShell({
  nombreUsuario,
  isAdmin,
  children,
}: {
  nombreUsuario: string;
  isAdmin: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--el-canvas)] text-[var(--el-text)]">
      <TopBar />
      <div className="flex flex-1">
        <AppSidebar nombreUsuario={nombreUsuario} isAdmin={isAdmin} />
        <main className="min-w-0 flex-1 bg-[var(--el-canvas)]">
          <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
