import { redirect } from "next/navigation";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { ConsumoProvider } from "@/lib/hooks/use-consumo";
import { NavShell } from "@/components/nav/nav-shell";
import { MisCasosShell } from "@/components/mis-casos/mis-casos-shell";

// Layout server-side de /dashboard/mis-casos y /dashboard/mis-casos/[id].
// Valida auth, monta ConsumoProvider para que ConsumoBar siga funcionando,
// envuelve en el shell de navegación (header + sidebar) y delega el layout
// interno (sidebar de casos + children) al shell client. La lista vive en el
// shell (un solo fetch al mount/path change), persistente entre la página
// default y el detalle del caso.
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
      {/* `ancho="completo"` y no el default: con el centrado en max-w-6xl, en un
          monitor ancho la lista de causas quedaba flotando en el medio de la
          pantalla, con ~250px muertos entre la sidebar de navegación y la
          primera causa. Esta sección es master-detail y quiere el ancho entero;
          el límite de lectura lo pone el propio detalle. */}
      <NavShell
        nombreUsuario={result.nombre}
        isAdmin={result.role === "admin"}
        ancho="completo"
      >
        <MisCasosShell>{children}</MisCasosShell>
      </NavShell>
    </ConsumoProvider>
  );
}
