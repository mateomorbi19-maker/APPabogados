import { redirect } from "next/navigation";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { ConsumoProvider } from "@/lib/hooks/use-consumo";
import { NavShell } from "@/components/nav/nav-shell";
import { ConsumoPanel } from "@/components/consumo/consumo-panel";

// "Mi consumo" — antes era un tab dentro del flujo de análisis en la raíz.
// Ahora es su propia ruta, accesible desde la sidebar.
export default async function ConsumoPage() {
  const result = await requireUsuarioOr403();
  if (!result.ok) {
    if (result.status === 401) redirect("/sign-in");
    redirect("/forbidden");
  }
  return (
    <ConsumoProvider>
      <NavShell nombreUsuario={result.nombre} isAdmin={result.role === "admin"}>
        <ConsumoPanel />
      </NavShell>
    </ConsumoProvider>
  );
}
