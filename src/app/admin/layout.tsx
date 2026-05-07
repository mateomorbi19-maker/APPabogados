import { notFound } from "next/navigation";
import Link from "next/link";
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
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-orange-500/30 bg-orange-950/10 sticky top-0 z-30 backdrop-blur">
        <div className="container max-w-7xl mx-auto px-4 py-2 flex items-center gap-3">
          <Link
            href="/admin"
            className="font-serif text-xl tracking-tight hover:opacity-80 transition-opacity"
          >
            EstrategiaLegal
          </Link>
          <Badge variant="admin" className="font-bold tracking-wider">
            ADMIN
          </Badge>
          <span className="hidden sm:inline text-sm text-muted-foreground">
            — {result.nombre}
          </span>
          <div className="flex-1" />
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Volver a la app
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
