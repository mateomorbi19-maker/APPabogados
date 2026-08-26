import type { ReactNode } from "react";
import { BuscadorProvider } from "@/components/buscador/buscador-global";
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
      <div className="flex min-h-dvh flex-col bg-[var(--el-canvas)] text-[var(--el-text)]">
        <TopBar nombreUsuario={nombreUsuario} isAdmin={isAdmin} />
        <div className="flex flex-1">
          <AppSidebar nombreUsuario={nombreUsuario} isAdmin={isAdmin} />
          <main className="min-w-0 flex-1 bg-[var(--el-canvas)]">
            {ancho === "completo" ? (
              children
            ) : (
              // pb-24 en móvil: la esfera de LEXIE flota sobre TODAS las
              // secciones y arranca abajo a la derecha. Con el py-6 original se
              // superponía al último elemento del documento — que en el flujo
              // de análisis es justo el CTA ("Continuar", "Analizar caso"),
              // alineado a la derecha: tocarlo abría LEXIE en vez de disparar
              // el análisis. El hueco lo reserva el shell y no cada sección.
              //
              // Se conserva aunque la esfera ahora sea arrastrable: el hueco
              // protege la POSICIÓN POR DEFECTO, que es donde la va a encontrar
              // quien nunca la movió.
              <div className="mx-auto max-w-6xl px-4 pt-6 pb-24 md:px-6 md:pb-6">
                {children}
              </div>
            )}
          </main>
        </div>
      </div>
    </BuscadorProvider>
  );
}
