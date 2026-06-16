import { redirect } from "next/navigation";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { getEventosByUser } from "@/lib/agenda/queries";
import { ConsumoProvider } from "@/lib/hooks/use-consumo";
import { NavShell } from "@/components/nav/nav-shell";
import {
  InicioDashboard,
  type CasoReciente,
  type EventoProximo,
} from "@/components/inicio/inicio-dashboard";

// Inicio (dashboard) — landing de la app. Trae data REAL server-side:
//   - Casos recientes: tabla `casos`, ordenados por última actualización.
//   - Próximos eventos: agenda local (`eventos_agenda`), solo futuros, asc.
// (La app no lee eventos DESDE Google Calendar; solo escribe hacia él. La
// agenda local es la fuente canónica de eventos del usuario.)
export default async function InicioPage() {
  const result = await requireUsuarioOr403();
  if (!result.ok) {
    if (result.status === 401) redirect("/sign-in");
    redirect("/forbidden");
  }

  const supabase = createServerClient();
  const { data: casosData } = await supabase
    .from("casos")
    .select("id, titulo, rol, actualizado_en")
    .eq("usuario_id", result.usuario_id)
    .order("actualizado_en", { ascending: false })
    .limit(4);
  const casos: CasoReciente[] = (casosData ?? []) as CasoReciente[];

  // Eventos futuros: desde ahora, asc por fecha_inicio (la query ordena así).
  // Tomamos los primeros 4.
  let eventos: EventoProximo[] = [];
  try {
    const futuros = await getEventosByUser(result.usuario_id, {
      desde: new Date().toISOString(),
    });
    eventos = futuros.slice(0, 4).map((e) => ({
      id: e.id,
      titulo: e.titulo,
      tipo: e.tipo,
      fecha_inicio: e.fecha_inicio,
      todo_el_dia: e.todo_el_dia,
    }));
  } catch (e) {
    // Un fallo cargando eventos no debe romper el Inicio: degradamos al empty
    // state. El error queda en logs server-side.
    console.error("[InicioPage] error cargando eventos:", e);
  }

  return (
    <ConsumoProvider>
      <NavShell nombreUsuario={result.nombre} isAdmin={result.role === "admin"}>
        <InicioDashboard nombre={result.nombre} casos={casos} eventos={eventos} />
      </NavShell>
    </ConsumoProvider>
  );
}
