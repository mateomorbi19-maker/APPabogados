import { redirect } from "next/navigation";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { ConsumoProvider } from "@/lib/hooks/use-consumo";
import { AppShell } from "@/components/app-shell";

export default async function HomePage() {
  const result = await requireUsuarioOr403();
  if (!result.ok) {
    if (result.status === 401) redirect("/sign-in");
    redirect("/forbidden");
  }
  return (
    <ConsumoProvider>
      <AppShell nombreUsuario={result.nombre} />
    </ConsumoProvider>
  );
}
