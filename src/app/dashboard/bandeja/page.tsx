import { redirect } from "next/navigation";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { ConsumoProvider } from "@/lib/hooks/use-consumo";
import { NavShell } from "@/components/nav/nav-shell";
import { BandejaView } from "@/components/bandeja/bandeja-view";

// Página de la Bandeja de entrada. Mismo shell que /dashboard/agenda (auth +
// ConsumoProvider para el medidor del header + NavShell).
//
// A diferencia de la agenda, acá no se precarga nada en el server: todo el
// correo sale de /api/bandeja/*, que resuelve por sí solo el modo demo cuando
// los scopes de Gmail todavía no están concedidos.
export default async function BandejaPage() {
  const result = await requireUsuarioOr403();
  if (!result.ok) {
    if (result.status === 401) redirect("/sign-in");
    redirect("/forbidden");
  }

  return (
    <ConsumoProvider>
      <NavShell nombreUsuario={result.nombre} isAdmin={result.role === "admin"}>
        <BandejaView />
      </NavShell>
    </ConsumoProvider>
  );
}
