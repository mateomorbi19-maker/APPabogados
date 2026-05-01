// Detalle del caso. Server component:
//   - Valida UUID del path y ownership del caso → 404 si falla.
//   - Trae caso + eventos en 2 queries (paralelas con Promise.all).
//   - Pasa los datos al client component DetalleCaso.

import { notFound } from "next/navigation";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { DetalleCaso } from "@/components/mis-casos/detalle-caso";
import type { Caso, EventoCaso } from "@/lib/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CasoDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const auth = await requireUsuarioOr403();
  if (!auth.ok) notFound();

  const supabase = createServerClient();

  const [casoRes, eventosRes] = await Promise.all([
    supabase
      .from("casos")
      .select(
        "id, usuario_id, titulo, caso_descripcion, contexto, rol, ejecucion_origen_id, estrategia_seleccionada_rol, estrategia_seleccionada_idx, estrategia_snapshot, creado_en, actualizado_en",
      )
      .eq("id", id)
      .eq("usuario_id", auth.usuario_id)
      .maybeSingle(),
    supabase
      .from("eventos_caso")
      .select("id, tipo, descripcion, ocurrido_en, estado, creado_en")
      .eq("caso_id", id)
      .order("ocurrido_en", { ascending: true }),
  ]);

  if (casoRes.error) {
    console.error("[caso detalle] error caso:", casoRes.error);
    notFound();
  }
  if (!casoRes.data) notFound();

  if (eventosRes.error) {
    console.error("[caso detalle] error eventos:", eventosRes.error);
    // Aunque fallen los eventos, mostramos el caso con array vacío en vez
    // de tirar 404. Caso edge: tabla con permisos raros, etc.
  }

  const caso = casoRes.data as Caso;
  const eventos = (eventosRes.data ?? []) as EventoCaso[];

  return <DetalleCaso caso={caso} eventosIniciales={eventos} />;
}
