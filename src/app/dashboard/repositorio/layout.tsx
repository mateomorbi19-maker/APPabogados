import { redirect } from "next/navigation";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { ConsumoProvider } from "@/lib/hooks/use-consumo";
import { NavShell } from "@/components/nav/nav-shell";

// Layout server-side de /dashboard/repositorio y /dashboard/repositorio/[id].
// La auth y el shell (header + sidebar + ConsumoProvider para la ConsumoBar)
// se resuelven una sola vez acá, igual que en /dashboard/mis-casos: las pages
// quedan puras porque el repositorio no está scopeado por usuario — el catálogo
// es el mismo para los tres.
export default async function RepositorioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await requireUsuarioOr403();
  if (!result.ok) {
    if (result.status === 401) redirect("/sign-in");
    redirect("/forbidden");
  }

  return (
    <ConsumoProvider>
      <NavShell nombreUsuario={result.nombre} isAdmin={result.role === "admin"}>
        {children}
      </NavShell>
    </ConsumoProvider>
  );
}
