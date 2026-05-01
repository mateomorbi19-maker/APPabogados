import { redirect } from "next/navigation";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { ConsumoProvider } from "@/lib/hooks/use-consumo";
import { SiteHeader } from "@/components/header/site-header";
import { MisCasosShell } from "@/components/mis-casos/mis-casos-shell";

// Layout server-side de /dashboard/mis-casos y /dashboard/mis-casos/[id].
// Valida auth, monta ConsumoProvider para que ConsumoBar siga funcionando,
// renderiza SiteHeader y delega el layout interno (sidebar + children) al
// shell client. La lista vive en el shell (un solo fetch al mount/path
// change), persistente entre la página default y el detalle del caso.
export default async function MisCasosLayout({
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
      <div className="min-h-screen flex flex-col">
        <SiteHeader nombreUsuario={result.nombre} />
        <main className="flex-1">
          <div className="container max-w-6xl mx-auto px-4 py-6">
            <MisCasosShell>{children}</MisCasosShell>
          </div>
        </main>
      </div>
    </ConsumoProvider>
  );
}
