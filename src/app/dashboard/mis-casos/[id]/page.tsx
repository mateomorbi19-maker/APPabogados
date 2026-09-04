// Detalle del caso. Server component:
//   - Valida UUID del path y ownership del caso → 404 si falla.
//   - Trae caso + eventos + partes + nodos del mapa en 4 queries paralelas.
//   - Deriva la etapa procesal del mapa (no es un campo de la ficha).
//   - Pasa los datos al client component DetalleCaso.

import { notFound } from "next/navigation";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { COLS_CASO, COLS_PARTE } from "@/lib/casos/columnas";
import { getNodosDelCaso } from "@/lib/mapa-procesal/queries";
import { etapaActual } from "@/lib/mapa-procesal/etapa-actual";
import { DetalleCaso } from "@/components/mis-casos/detalle-caso";
import { estrategiaSchema } from "@/lib/schemas";
import { listarEscritos } from "@/lib/escritos/queries";
import type { Caso, EventoCaso, ParteCaso } from "@/lib/types";

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

  // Las cuatro lecturas en paralelo. Los nodos del mapa se traen sólo para
  // derivar la etapa procesal del badge: es una tabla chica por caso y evita
  // que la ficha tenga que declarar una etapa propia que se contradiga con el
  // mapa. `getNodosDelCaso` no valida propiedad —la validó el SELECT de
  // `casos` de acá al lado, con el mismo `id`— y su query está scopeada por
  // caso_id, así que no puede devolver nodos de otra causa.
  const [casoRes, eventosRes, partesRes, nodos, escritos] = await Promise.all([
    supabase
      .from("casos")
      .select(COLS_CASO)
      .eq("id", id)
      .eq("usuario_id", auth.usuario_id)
      .maybeSingle(),
    supabase
      .from("eventos_caso")
      .select(
        "id, tipo, categoria, descripcion, ocurrido_en, estado, creado_en, adjuntos",
      )
      .eq("caso_id", id)
      .order("ocurrido_en", { ascending: true }),
    supabase
      .from("partes_caso")
      .select(COLS_PARTE)
      .eq("caso_id", id)
      .order("creado_en", { ascending: true }),
    // El mapa puede no existir todavía; un fallo acá degrada a "sin etapa",
    // que es lo mismo que ve una causa sin mapa. No puede tirar la pantalla.
    getNodosDelCaso(id).catch((e) => {
      console.error("[caso detalle] error nodos del mapa:", e);
      return [];
    }),
    // Los escritos redactados para la causa. Mismo criterio que el mapa: si
    // la tabla todavía no existe (migración 20260904120000 sin aplicar), la
    // ficha se muestra igual con la lista vacía y el error queda en logs.
    listarEscritos(id, auth.usuario_id).catch((e) => {
      console.error("[caso detalle] error escritos:", e);
      return [];
    }),
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

  // Re-parseamos `estrategia_snapshot` con el schema Zod para que casos
  // viejos (creados antes del rediseño de tarjetas) tengan los campos
  // `tipo` y `resumen_ejecutivo` derivados automáticamente vía el
  // preprocess de `estrategiaSchema`. Si por alguna razón el snapshot
  // está corrompido (caso muy edge), caemos al raw casteado — el render
  // de seccion-estrategia-elegida.tsx tolera campos faltantes con
  // optional chaining sobre `e.tipo`.
  const rawCaso = casoRes.data as Caso;
  const snapshotParsed = estrategiaSchema.safeParse(rawCaso.estrategia_snapshot);
  const caso: Caso = snapshotParsed.success
    ? { ...rawCaso, estrategia_snapshot: snapshotParsed.data }
    : rawCaso;

  const eventos = (eventosRes.data ?? []) as EventoCaso[];

  if (partesRes.error) {
    console.error("[caso detalle] error partes:", partesRes.error);
  }
  const partes = (partesRes.data ?? []) as ParteCaso[];

  // Se pasa serializada (label + nodo) y no el objeto entero: el componente es
  // client y no tiene por qué recibir el árbol del mapa para pintar un badge.
  const etapaDerivada = etapaActual(nodos);
  const etapa = etapaDerivada
    ? { label: etapaDerivada.label, nodoTitulo: etapaDerivada.nodoTitulo }
    : null;

  return (
    <DetalleCaso
      caso={caso}
      eventosIniciales={eventos}
      partesIniciales={partes}
      escritosIniciales={escritos}
      etapa={etapa}
      mapaInicializado={nodos.length > 0}
    />
  );
}
