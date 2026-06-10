import { redirect } from "next/navigation";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { ConsumoProvider } from "@/lib/hooks/use-consumo";
import { SiteHeader } from "@/components/header/site-header";
import { AgendaView } from "@/components/agenda/agenda-view";
import type { CasoOption } from "@/lib/agenda/types";

// Página de la Agenda. Mismo shell que /dashboard/mis-casos (auth + ConsumoProvider
// para la ConsumoBar del header + SiteHeader). No hay rutas anidadas, así que el
// shell vive en la propia page en vez de un layout dedicado.
export default async function AgendaPage() {
  const result = await requireUsuarioOr403();
  if (!result.ok) {
    if (result.status === 401) redirect("/sign-in");
    redirect("/forbidden");
  }

  // Casos del usuario para el filtro y el form (solo id + titulo).
  const supabase = createServerClient();
  const { data } = await supabase
    .from("casos")
    .select("id, titulo")
    .eq("usuario_id", result.usuario_id)
    .order("creado_en", { ascending: false });
  const casos: CasoOption[] = (data ?? []) as CasoOption[];

  return (
    <ConsumoProvider>
      <div className="min-h-screen flex flex-col">
        <SiteHeader nombreUsuario={result.nombre} />
        <main className="flex-1">
          <div className="container max-w-6xl mx-auto px-4 py-6">
            <AgendaView casos={casos} />
          </div>
        </main>
      </div>
    </ConsumoProvider>
  );
}
