"use client";
import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ListaCasos, type CasoListItem } from "./lista-casos";
import { MisCasosEmptyState } from "./empty-state";

type Props = {
  children: React.ReactNode;
};

type Estado =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; casos: CasoListItem[] };

// Shell de la sección "Mis casos". Maneja:
//   - fetch inicial de la lista al mount
//   - re-fetch cuando cambia el pathname (ej: vengo de /dashboard/mis-casos/abc → /dashboard/mis-casos)
//   - layout de 2 columnas (sidebar 220px + slot a la derecha)
//   - id activo extraído de la URL: /dashboard/mis-casos/[id]
//   - empty state cuando no hay casos (ocupa el ancho completo, sin sidebar)
export function MisCasosShell({ children }: Props) {
  const pathname = usePathname();
  const [estado, setEstado] = useState<Estado>({ kind: "loading" });

  // ID activo según la URL. /dashboard/mis-casos → null (sin selección).
  // /dashboard/mis-casos/abc-123 → "abc-123".
  const idActivo = (() => {
    const match = pathname.match(/^\/dashboard\/mis-casos\/([^/]+)$/);
    return match ? match[1] : null;
  })();

  // Un `useCallback` y no una función suelta: la consumen dos efectos y sin
  // identidad estable el segundo se re-suscribiría en cada render.
  const cargar = useCallback(async (cancelado?: { current: boolean }) => {
    try {
      const res = await fetch("/api/casos", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as
        | { casos: CasoListItem[] }
        | { ok: false; error: string }
        | null;
      if (cancelado?.current) return;
      if (!res.ok || !json || ("ok" in json && json.ok === false)) {
        const msg =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : `Error consultando casos (HTTP ${res.status})`;
        setEstado({ kind: "error", message: msg });
        return;
      }
      if (!("casos" in json)) {
        setEstado({ kind: "error", message: "Respuesta inesperada" });
        return;
      }
      setEstado({ kind: "ready", casos: json.casos });
    } catch (e) {
      if (cancelado?.current) return;
      setEstado({
        kind: "error",
        message: e instanceof Error ? e.message : "Error de red",
      });
    }
  }, []);

  useEffect(() => {
    const cancelado = { current: false };
    // El IIFE async es la forma que ya tenía este efecto y se conserva: `cargar`
    // resuelve su setState recién después del await, pero llamada en seco el
    // linter la lee como un setState sincrónico dentro del efecto.
    void (async () => {
      await cargar(cancelado);
    })();
    return () => {
      cancelado.current = true;
    };
    // Re-fetch cuando cambia el pathname: cubre el caso "vine de / tras
    // crear un caso" sin necesidad de revalidatePath en el server.
  }, [pathname, cargar]);

  // La ficha se edita en el detalle, que es un componente hermano: sin esto la
  // sidebar seguía mostrando el nombre viejo (y el expediente viejo) hasta
  // navegar a otra causa y volver. No hay estado compartido entre los dos, y
  // montar un contexto o un router.refresh() para un rename es desproporcionado;
  // un evento de ventana cuesta ocho líneas y no arrastra re-renders de nada más.
  useEffect(() => {
    const onActualizado = () => void cargar();
    window.addEventListener("caso-actualizado", onActualizado);
    return () => window.removeEventListener("caso-actualizado", onActualizado);
  }, [cargar]);

  if (estado.kind === "loading") {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (estado.kind === "error") {
    return (
      <div className="rounded border border-destructive bg-destructive/10 p-6 text-sm text-destructive">
        <p className="font-medium mb-1">Error cargando casos</p>
        <p>{estado.message}</p>
      </div>
    );
  }

  // Empty state: ocupa el ancho completo (sin sidebar) porque no hay nada
  // que listar. Cuando aparezca el primer caso, este branch deja de
  // renderizarse.
  if (estado.casos.length === 0) {
    return <MisCasosEmptyState />;
  }

  // Master-detail: en móvil no hay dos columnas, así que con un caso abierto
  // la lista completa quedaba ARRIBA del detalle (~76px por card: con 8 casos
  // había que scrollear ~600px para ver el caso recién abierto). Abajo de
  // 768px pasa a navegación por pasos — lista O detalle, nunca los dos — y el
  // detalle trae su propio "Mis casos" para volver (header-caso.tsx). El
  // sticky de escritorio queda intacto.
  return (
    <div className="grid gap-6 grid-cols-1 md:grid-cols-[220px_1fr]">
      <aside
        className={cn(
          "md:sticky md:top-20 md:self-start",
          idActivo && "hidden md:block",
        )}
      >
        <ListaCasos casos={estado.casos} idActivo={idActivo} />
      </aside>
      <section className="min-w-0">{children}</section>
    </div>
  );
}
