"use client";
import { Menu } from "@base-ui/react/menu";
import { useClerk } from "@clerk/nextjs";
import { ChevronsUpDown, LogOut, Palette, Sparkles, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { abrirCuenta, AvatarUsuario, useIdentidad, type SeccionCuenta } from "./identidad";

// Menú de cuenta, al estilo de la app de escritorio de Claude: foto y nombre
// abajo a la izquierda; al tocarlo se despliega hacia arriba con Apariencia,
// Datos personales, Mi plan y Cerrar sesión. Las tres primeras abren el
// diálogo «Tu cuenta» (cuenta-dialog.tsx) en esa sección.

const OPCIONES: { id: SeccionCuenta; label: string; icono: typeof Palette }[] = [
  { id: "apariencia", label: "Apariencia", icono: Palette },
  { id: "datos", label: "Datos personales", icono: UserRound },
  { id: "plan", label: "Mi plan", icono: Sparkles },
];

const CLASE_ITEM =
  "flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none select-none data-[highlighted]:bg-muted [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

function useCerrarSesion() {
  const { signOut } = useClerk();
  return () => void signOut({ redirectUrl: "/sign-in" });
}

/** Sidebar de escritorio: botón con foto y nombre + menú desplegable. */
export function MenuCuenta({ nombreUsuario }: { nombreUsuario: string }) {
  const { nombre, email, imagen } = useIdentidad(nombreUsuario);
  const cerrarSesion = useCerrarSesion();

  return (
    <Menu.Root>
      <Menu.Trigger
        className="flex w-full items-center gap-3 rounded-[9px] px-2 py-2 text-left transition-colors outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:bg-black/5 dark:hover:bg-white/5 dark:data-[popup-open]:bg-white/5"
        aria-label="Menú de tu cuenta"
      >
        <AvatarUsuario nombre={nombre} imagen={imagen} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[var(--el-text)]">{nombre}</span>
          {email ? (
            <span className="block truncate text-xs text-[var(--el-text-muted)]">{email}</span>
          ) : null}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-[var(--el-text-muted)]" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={6} className="z-50 outline-none">
          <Menu.Popup className="w-[var(--anchor-width)] min-w-56 origin-[var(--transform-origin)] rounded-xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none transition-[transform,opacity] duration-100 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            {email ? (
              <div className="truncate px-2.5 pt-1.5 pb-1 text-xs text-muted-foreground">{email}</div>
            ) : null}
            {OPCIONES.map(({ id, label, icono: Icono }) => (
              <Menu.Item key={id} className={CLASE_ITEM} onClick={() => abrirCuenta(id)}>
                <Icono />
                {label}
              </Menu.Item>
            ))}
            <Menu.Separator className="mx-1 my-1 h-px bg-border" />
            <Menu.Item className={CLASE_ITEM} onClick={cerrarSesion}>
              <LogOut />
              Cerrar sesión
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * Drawer móvil: el drawer ya es un menú, así que las opciones van en lista
 * (más fácil de tocar que un desplegable dentro de otro panel). `onElegir`
 * cierra el drawer antes de abrir el diálogo.
 */
export function CuentaEnLista({
  nombreUsuario,
  onElegir,
}: {
  nombreUsuario: string;
  onElegir: () => void;
}) {
  const { nombre, email, imagen } = useIdentidad(nombreUsuario);
  const cerrarSesion = useCerrarSesion();
  const claseFila =
    "flex w-full items-center gap-3 rounded-md px-3 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-[18px] [&_svg]:shrink-0";

  return (
    <div>
      <div className="flex items-center gap-3 px-1 pb-2">
        <AvatarUsuario nombre={nombre} imagen={imagen} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{nombre}</span>
          {email ? (
            <span className="block truncate text-xs text-muted-foreground">{email}</span>
          ) : null}
        </span>
      </div>
      {OPCIONES.map(({ id, label, icono: Icono }) => (
        <button
          key={id}
          type="button"
          className={claseFila}
          onClick={() => {
            onElegir();
            // Un frame después: el cierre del drawer devuelve el foco a la
            // hamburguesa, y eso no tiene que pisarle el foco al diálogo.
            requestAnimationFrame(() => abrirCuenta(id));
          }}
        >
          <Icono />
          {label}
        </button>
      ))}
      <button type="button" className={cn(claseFila, "mt-1")} onClick={cerrarSesion}>
        <LogOut />
        Cerrar sesión
      </button>
    </div>
  );
}
