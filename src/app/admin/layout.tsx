import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { requireAdminOr404 } from "@/lib/admin/auth";
import { Badge } from "@/components/admin/Badge";

// Layout protegido del panel admin. Si la sesión no es admin, llamamos
// notFound() — el usuario ve la página 404 estándar de Next, sin pista de
// que la ruta existe. Mismo principio que `/api/admin/*` (404 plano).
//
// El header lleva un badge "ADMIN" naranja para que cuando estés en este
// panel sepas de un vistazo que no estás en el modo usuario común.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await requireAdminOr404();
  if (!result.ok) notFound();

  return (
    <div className="min-h-dvh flex flex-col">
      {/* env(safe-area-inset-top) igual que nav/top-bar.tsx: con viewportFit
          cover + statusBarStyle black-translucent, en la PWA instalada este
          header sticky quedaba debajo del reloj y la batería. */}
      <header
        className="border-b border-orange-500/30 bg-orange-50 dark:bg-orange-950/10 sticky top-0 z-30 backdrop-blur"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        {/* El min-content de esta fila daba ~452px (logo Space Grotesk 20px +
            badge ADMIN + "← Volver a la app" + UserButton + gaps): a 360px
            desbordaba ~92px y, sin overflow-x hidden en body, TODA la página
            de admin agarraba scroll horizontal. Abajo de sm el logo baja a
            16px y puede truncar, y el link de volver es solo la flecha. */}
        <div className="container max-w-7xl mx-auto px-4 py-2 flex items-center gap-2 sm:gap-3">
          <Link
            href="/admin"
            className="font-serif text-base sm:text-xl tracking-tight hover:opacity-80 transition-opacity min-w-0 truncate"
          >
            EstrategiaLegal
          </Link>
          <Badge variant="admin" className="font-bold tracking-wider shrink-0">
            ADMIN
          </Badge>
          <span className="hidden sm:inline text-sm text-muted-foreground truncate">
            — {result.nombre}
          </span>
          <div className="flex-1" />
          <Link
            href="/"
            aria-label="Volver a la app"
            className="shrink-0 inline-flex items-center gap-1 rounded-md text-sm text-muted-foreground hover:text-foreground transition-colors max-sm:size-10 max-sm:justify-center"
          >
            <ArrowLeft className="size-4 shrink-0" />
            <span className="hidden sm:inline">Volver a la app</span>
          </Link>
          <UserButton />
        </div>
      </header>
      <main className="flex-1">
        <div className="container max-w-7xl mx-auto px-4 py-4">{children}</div>
      </main>
    </div>
  );
}
