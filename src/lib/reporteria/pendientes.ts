import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import { nombreCaso } from "@/lib/casos/nombre";
import { COLS_PARTE_BASE } from "@/lib/casos/columnas";
import { ultimoEnvioPorCaso } from "./queries";
import { DIAS_SIN_REPORTE_AVISO } from "./types";

// «Clientes sin novedades»: la memoria que reemplaza al envío automático
// (docs/PLAN_REPORTERIA.md §6). Causas ACTIVAS del abogado que tienen al
// menos una persona marcada como cliente y a las que hace más de N días que
// no se les manda un reporte, o nunca. La decisión de escribir sigue siendo
// del abogado; esto sólo se lo recuerda.

export type ClienteSinNovedades = {
  caso_id: string;
  nombre_caso: string;
  /** Nombres de las partes marcadas como cliente, para que la tarjeta diga a quién. */
  clientes: string[];
  /** Null = nunca se le mandó un reporte. */
  ultimo_envio: string | null;
  dias_sin_reporte: number | null;
};

const MS_DIA = 86_400_000;

export async function clientesSinNovedades(
  usuarioId: string,
  opts: { dias?: number; ahora?: Date } = {},
): Promise<ClienteSinNovedades[]> {
  const dias = opts.dias ?? DIAS_SIN_REPORTE_AVISO;
  const ahora = opts.ahora ?? new Date();
  const supabase = createServerClient();

  const { data: casos, error } = await supabase
    .from("casos")
    .select("id, titulo, caratula")
    .eq("usuario_id", usuarioId)
    .eq("estado_seguimiento", "activa");
  if (error) throw new Error(`clientesSinNovedades: ${error.message}`);
  const lista = (casos ?? []) as { id: string; titulo: string; caratula: string | null }[];
  if (lista.length === 0) return [];

  // Sólo las columnas base: esta consulta no necesita el contacto y así no
  // depende de la migración de reportería para dibujar el Inicio.
  const { data: partes, error: pErr } = await supabase
    .from("partes_caso")
    .select(COLS_PARTE_BASE)
    .in(
      "caso_id",
      lista.map((c) => c.id),
    )
    .eq("es_cliente", true);
  if (pErr) throw new Error(`clientesSinNovedades partes: ${pErr.message}`);
  const clientesPorCaso = new Map<string, string[]>();
  for (const p of (partes ?? []) as { caso_id: string; nombre: string }[]) {
    const arr = clientesPorCaso.get(p.caso_id) ?? [];
    arr.push(p.nombre);
    clientesPorCaso.set(p.caso_id, arr);
  }

  // Sin la migración no hay tabla de reportes: se toma "nunca" para todas.
  let ultimos = new Map<string, string>();
  try {
    ultimos = await ultimoEnvioPorCaso(usuarioId);
  } catch (e) {
    console.warn("[reporteria] no se pudo leer reportes_cliente (¿migración sin aplicar?):", e);
  }

  const out: ClienteSinNovedades[] = [];
  for (const c of lista) {
    const clientes = clientesPorCaso.get(c.id);
    if (!clientes || clientes.length === 0) continue;
    const ultimo = ultimos.get(c.id) ?? null;
    const diasSin = ultimo
      ? Math.floor((ahora.getTime() - new Date(ultimo).getTime()) / MS_DIA)
      : null;
    if (diasSin !== null && diasSin < dias) continue;
    out.push({
      caso_id: c.id,
      nombre_caso: nombreCaso(c),
      clientes,
      ultimo_envio: ultimo,
      dias_sin_reporte: diasSin,
    });
  }
  // Primero los que nunca recibieron nada, después los más atrasados.
  out.sort((a, b) => {
    if (a.dias_sin_reporte === null && b.dias_sin_reporte === null) return 0;
    if (a.dias_sin_reporte === null) return -1;
    if (b.dias_sin_reporte === null) return 1;
    return b.dias_sin_reporte - a.dias_sin_reporte;
  });
  return out;
}
