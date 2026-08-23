import { redirect } from "next/navigation";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { ConsumoProvider } from "@/lib/hooks/use-consumo";
import { NavShell } from "@/components/nav/nav-shell";
import { AgendaView } from "@/components/agenda/agenda-view";
import type { CasoOption } from "@/lib/agenda/types";
import type { CasoNombrable } from "@/lib/types";
import { nombreCaso } from "@/lib/casos/nombre";
import { COLS_CASO_NOMBRE } from "@/lib/casos/columnas";

// Página de la Agenda. Mismo shell que /dashboard/mis-casos (auth + ConsumoProvider
// para la ConsumoBar del header + NavShell). No hay rutas anidadas, así que el
// shell vive en la propia page en vez de un layout dedicado.
export default async function AgendaPage() {
  const result = await requireUsuarioOr403();
  if (!result.ok) {
    if (result.status === 401) redirect("/sign-in");
    redirect("/forbidden");
  }

  // Causas del usuario para el filtro y el form. Se traen `titulo` y
  // `caratula` y se resuelve el nombre acá: el selector es un <select>
  // nativo y una carátula sin resolver dejaría al abogado eligiendo entre
  // pedazos de relato.
  const supabase = createServerClient();
  const { data } = await supabase
    .from("casos")
    .select(COLS_CASO_NOMBRE)
    .eq("usuario_id", result.usuario_id)
    .order("creado_en", { ascending: false });
  const casos: CasoOption[] = ((data ?? []) as CasoNombrable[]).map((c) => ({
    id: c.id,
    titulo: nombreCaso(c),
  }));

  return (
    <ConsumoProvider>
      <NavShell nombreUsuario={result.nombre} isAdmin={result.role === "admin"}>
        <AgendaView casos={casos} />
      </NavShell>
    </ConsumoProvider>
  );
}
