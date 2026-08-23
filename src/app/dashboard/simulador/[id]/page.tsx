// Vista del Simulador de Audiencias sobre un caso. Vive FUERA de
// /dashboard/mis-casos para no heredar su layout (NavShell + sidebar +
// max-w-6xl): es una vista inmersiva full-height, mismo patrón que el Chat y
// el Mapa Procesal.
//
// Server component: valida ownership, verifica que el fuero del caso esté
// soportado, y carga la simulación más reciente con sus turnos. NO hace
// lazy-init como el chat: abrir una audiencia gasta tokens, así que arranca
// solo cuando el abogado la configura y la inicia explícitamente.

import { notFound } from "next/navigation";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import type { CasoNombrable } from "@/lib/types";
import { nombreCaso } from "@/lib/casos/nombre";
import { COLS_CASO_NOMBRE_FUERO } from "@/lib/casos/columnas";
import { SimuladorShell } from "@/components/simulador/simulador-shell";
import type { SimulacionAudiencia, TurnoSimulacion } from "@/lib/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Debe coincidir con FUERO_SOPORTADO de la ruta POST /simulacion. El guion v1
// es exclusivamente CPP PBA (Ley 11.922).
const FUERO_SOPORTADO = "pba";

export default async function SimuladorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vista?: string | string[] }>;
}) {
  const { id: casoId } = await params;
  if (!UUID_RE.test(casoId)) notFound();

  // Flag de la Vista de sala (escena + barra de fases). Mismo mecanismo que el
  // chat y el admin usan para su estado de vista: un searchParam, sin infra de
  // feature flags. El modo texto sigue siendo el default hasta validarla.
  const { vista } = await searchParams;
  const vistaSala = (Array.isArray(vista) ? vista[0] : vista) === "sala";

  const auth = await requireUsuarioOr403();
  if (!auth.ok) notFound();

  const supabase = createServerClient();

  const { data: caso, error: casoErr } = await supabase
    .from("casos")
    .select(COLS_CASO_NOMBRE_FUERO)
    .eq("id", casoId)
    .eq("usuario_id", auth.usuario_id)
    .maybeSingle();
  if (casoErr || !caso) notFound();

  const casoTipado = caso as CasoNombrable & { fuero: string | null };

  // Simulación más reciente del caso (en curso, finalizada o abandonada).
  // Si es la primera vez, no hay ninguna y el shell muestra la pantalla de
  // configuración.
  // OJO: los errores de estas dos lecturas se PROPAGAN a propósito. Mapear un
  // fallo de SELECT a "no hay simulación" mostraría la pantalla de arranque a
  // alguien que tiene una audiencia en curso, y el siguiente clic en "Iniciar
  // audiencia" la daría por abandonada y pagaría una llamada nueva al modelo.
  // Es preferible el error boundary de Next: el abogado recarga y la recupera.
  const { data: sims, error: simsErr } = await supabase
    .from("simulaciones_audiencia")
    .select(
      "id, caso_id, tipo_audiencia, rol_usuario, dificultad, magistrado_perfil, estado, debriefing, creada_en, actualizada_en, finalizada_en",
    )
    .eq("caso_id", casoId)
    .order("creada_en", { ascending: false })
    .limit(1);
  if (simsErr) {
    throw new Error(`simulador page: error leyendo simulaciones: ${simsErr.message}`);
  }
  const simulacion = ((sims ?? [])[0] ?? null) as SimulacionAudiencia | null;

  let turnos: TurnoSimulacion[] = [];
  if (simulacion) {
    const { data: ts, error: tsErr } = await supabase
      .from("turnos_simulacion")
      .select(
        "id, simulacion_id, emisor, emisor_nombre, contenido, metadata, ejecucion_id, creado_en",
      )
      .eq("simulacion_id", simulacion.id)
      .order("creado_en", { ascending: true });
    if (tsErr) {
      throw new Error(`simulador page: error leyendo turnos: ${tsErr.message}`);
    }
    turnos = (ts ?? []) as TurnoSimulacion[];
  }

  // key por simulación: fuerza remount del client component al cambiar de
  // audiencia, para que el state sembrado por props nunca quede stale (mismo
  // motivo que en la página del chat).
  return (
    <SimuladorShell
      key={simulacion?.id ?? "sin-simulacion"}
      casoId={casoId}
      casoTitulo={nombreCaso(casoTipado)}
      fueroSoportado={casoTipado.fuero === FUERO_SOPORTADO}
      fueroCaso={casoTipado.fuero}
      simulacionInicial={simulacion}
      turnosIniciales={turnos}
      vistaSala={vistaSala}
    />
  );
}
