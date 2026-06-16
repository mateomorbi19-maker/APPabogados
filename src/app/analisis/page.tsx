import { redirect } from "next/navigation";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { ConsumoProvider } from "@/lib/hooks/use-consumo";
import { NavShell } from "@/components/nav/nav-shell";
import { NuevoAnalisisPanel } from "@/components/nuevo-analisis/nuevo-analisis-panel";

// Flujo de "Nuevo análisis" — antes vivía en la raíz (/). Ahora la raíz es el
// Inicio (dashboard) y este flujo tiene su propia ruta. La lógica del panel no
// cambió: solo se reubicó dentro del shell con sidebar.
export default async function AnalisisPage() {
  const result = await requireUsuarioOr403();
  if (!result.ok) {
    if (result.status === 401) redirect("/sign-in");
    redirect("/forbidden");
  }
  return (
    <ConsumoProvider>
      <NavShell nombreUsuario={result.nombre} isAdmin={result.role === "admin"}>
        <NuevoAnalisisPanel />
      </NavShell>
    </ConsumoProvider>
  );
}
