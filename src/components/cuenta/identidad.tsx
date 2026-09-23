"use client";
import { useUser } from "@clerk/nextjs";
import { cn } from "@/lib/utils";

// La identidad que se MUESTRA (nombre y foto) sale de Clerk, que es donde el
// abogado la edita desde «Datos personales». `usuarios.nombre` no se toca: es
// el identificador interno (consumo, colores, contexto de LEXIE) y queda como
// respaldo mientras Clerk no cargó o si la cuenta no tiene nombre.

export type SeccionCuenta = "apariencia" | "datos" | "plan";

const EVENTO_ABRIR_CUENTA = "cuenta-abrir";

/**
 * Abre el diálogo «Tu cuenta» en una sección. Es un evento de window (mismo
 * patrón que `lexie-abrir`) porque el diálogo vive montado en el shell y el
 * menú del drawer móvil se desmonta al cerrarse.
 */
export function abrirCuenta(seccion: SeccionCuenta) {
  window.dispatchEvent(new CustomEvent<SeccionCuenta>(EVENTO_ABRIR_CUENTA, { detail: seccion }));
}

export function escucharAbrirCuenta(cb: (seccion: SeccionCuenta) => void) {
  const handler = (e: Event) => cb((e as CustomEvent<SeccionCuenta>).detail);
  window.addEventListener(EVENTO_ABRIR_CUENTA, handler);
  return () => window.removeEventListener(EVENTO_ABRIR_CUENTA, handler);
}

export function useIdentidad(nombreUsuario: string) {
  const { user } = useUser();
  return {
    user,
    nombre: user?.fullName?.trim() || nombreUsuario,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
    // Sin foto propia Clerk devuelve un avatar genérico; se prefiere la inicial.
    imagen: user?.hasImage ? user.imageUrl : null,
  };
}

export function AvatarUsuario({
  nombre,
  imagen,
  className,
}: {
  nombre: string;
  imagen: string | null;
  className?: string;
}) {
  if (imagen) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imagen}
        alt=""
        className={cn("size-8 shrink-0 rounded-full object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-sm font-medium text-primary",
        className,
      )}
    >
      {nombre.charAt(0).toUpperCase()}
    </span>
  );
}
