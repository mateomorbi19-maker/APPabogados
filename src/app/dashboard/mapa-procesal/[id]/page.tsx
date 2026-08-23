// Página del mapa procesal de un caso. Vive FUERA de /dashboard/mis-casos para
// no heredar su layout (SiteHeader global + sidebar del caso): el mapa es una
// vista inmersiva full-screen. Server component: valida UUID + ownership y
// delega en el client component (que trae su propia toolbar).
import { notFound } from "next/navigation";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import type { CasoNombrable } from "@/lib/types";
import { nombreCaso } from "@/lib/casos/nombre";
import { COLS_CASO_NOMBRE } from "@/lib/casos/columnas";
import { MapaProcesalView } from "@/components/mapa-procesal/mapa-procesal-view";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MapaProcesalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const auth = await requireUsuarioOr403();
  if (!auth.ok) notFound();

  const supabase = createServerClient();
  const { data: caso } = await supabase
    .from("casos")
    .select(COLS_CASO_NOMBRE)
    .eq("id", id)
    .eq("usuario_id", auth.usuario_id)
    .maybeSingle();
  if (!caso) notFound();

  const nombrable = caso as CasoNombrable;
  return (
    <MapaProcesalView casoId={nombrable.id} casoTitulo={nombreCaso(nombrable)} />
  );
}
