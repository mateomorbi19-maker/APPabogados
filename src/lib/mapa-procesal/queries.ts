import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import { generarPlantillaBase } from "./plantilla-base";
import type { EstadoNodo, NodoProcesalDB } from "./types";

const COLS =
  "id, caso_id, titulo, descripcion, tipo, estado, padre_id, posicion_x, posicion_y, metadata, created_at, updated_at";

// Ownership: los nodos pertenecen a un caso; el caso pertenece a un usuario.
// Cada función verifica que el caso sea del usuario antes de operar, y todas
// las queries de nodos quedan scopeadas por caso_id.
export async function casoEsDelUsuario(
  casoId: string,
  usuarioId: string,
): Promise<boolean> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("casos")
    .select("id")
    .eq("id", casoId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  if (error) throw new Error(`casoEsDelUsuario: ${error.message}`);
  return data !== null;
}

// Devuelve los nodos del caso, o null si el caso no existe / no es del usuario.
export async function getNodosByCaso(
  casoId: string,
  usuarioId: string,
): Promise<NodoProcesalDB[] | null> {
  if (!(await casoEsDelUsuario(casoId, usuarioId))) return null;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("mapa_procesal_nodos")
    .select(COLS)
    .eq("caso_id", casoId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getNodosByCaso: ${error.message}`);
  return (data ?? []) as NodoProcesalDB[];
}

export type InicializarResult =
  | { status: "ok"; nodos: NodoProcesalDB[] }
  | { status: "not_owned" }
  | { status: "already" };

export async function inicializarMapa(
  casoId: string,
  usuarioId: string,
): Promise<InicializarResult> {
  if (!(await casoEsDelUsuario(casoId, usuarioId))) return { status: "not_owned" };
  const supabase = createServerClient();

  const { count, error: cErr } = await supabase
    .from("mapa_procesal_nodos")
    .select("id", { count: "exact", head: true })
    .eq("caso_id", casoId);
  if (cErr) throw new Error(`inicializarMapa count: ${cErr.message}`);
  if ((count ?? 0) > 0) return { status: "already" };

  const plantilla = generarPlantillaBase(casoId);
  const { data, error } = await supabase
    .from("mapa_procesal_nodos")
    .insert(plantilla)
    .select(COLS);
  if (error) throw new Error(`inicializarMapa insert: ${error.message}`);
  return { status: "ok", nodos: (data ?? []) as NodoProcesalDB[] };
}

// Crea un nodo hijo (tipo prediccion, estado desbloqueado). Devuelve null si el
// caso no es del usuario o el padre no existe en ese caso.
export async function crearNodoHijo(
  casoId: string,
  padreId: string,
  usuarioId: string,
  data: { titulo: string; descripcion?: string | null },
): Promise<NodoProcesalDB | null> {
  if (!(await casoEsDelUsuario(casoId, usuarioId))) return null;
  const supabase = createServerClient();

  const { data: padre, error: pErr } = await supabase
    .from("mapa_procesal_nodos")
    .select("id")
    .eq("id", padreId)
    .eq("caso_id", casoId)
    .maybeSingle();
  if (pErr) throw new Error(`crearNodoHijo padre: ${pErr.message}`);
  if (!padre) return null;

  const { data: nodo, error } = await supabase
    .from("mapa_procesal_nodos")
    .insert({
      caso_id: casoId,
      titulo: data.titulo,
      descripcion: data.descripcion ?? null,
      tipo: "prediccion",
      estado: "desbloqueado",
      padre_id: padreId,
    })
    .select(COLS)
    .single();
  if (error || !nodo) {
    throw new Error(`crearNodoHijo: ${error?.message ?? "sin fila"}`);
  }
  return nodo as NodoProcesalDB;
}

// Marca un nodo como ocurrido (tipo real) y desbloquea sus hijos directos
// bloqueados. No toca el nodo raíz (.neq tipo raiz). Devuelve null si no aplica.
export async function marcarComoOcurrido(
  nodoId: string,
  casoId: string,
  usuarioId: string,
): Promise<NodoProcesalDB | null> {
  if (!(await casoEsDelUsuario(casoId, usuarioId))) return null;
  const supabase = createServerClient();

  const { data: nodo, error } = await supabase
    .from("mapa_procesal_nodos")
    .update({ estado: "ocurrido", tipo: "real", updated_at: new Date().toISOString() })
    .eq("id", nodoId)
    .eq("caso_id", casoId)
    .neq("tipo", "raiz")
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(`marcarComoOcurrido: ${error.message}`);
  if (!nodo) return null;

  const { error: hErr } = await supabase
    .from("mapa_procesal_nodos")
    .update({ estado: "desbloqueado", updated_at: new Date().toISOString() })
    .eq("caso_id", casoId)
    .eq("padre_id", nodoId)
    .eq("estado", "bloqueado");
  if (hErr) throw new Error(`marcarComoOcurrido hijos: ${hErr.message}`);

  return nodo as NodoProcesalDB;
}

// Edita título/descripción/estado. Si estado === 'ocurrido', delega en
// marcarComoOcurrido (que además desbloquea hijos). Devuelve null si no aplica.
export async function actualizarNodo(
  nodoId: string,
  casoId: string,
  usuarioId: string,
  data: { titulo?: string; descripcion?: string | null; estado?: EstadoNodo },
): Promise<NodoProcesalDB | null> {
  if (data.estado === "ocurrido") {
    return marcarComoOcurrido(nodoId, casoId, usuarioId);
  }
  if (!(await casoEsDelUsuario(casoId, usuarioId))) return null;
  const supabase = createServerClient();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.titulo !== undefined) patch.titulo = data.titulo;
  if (data.descripcion !== undefined) patch.descripcion = data.descripcion ?? null;
  if (data.estado !== undefined) patch.estado = data.estado;

  const { data: nodo, error } = await supabase
    .from("mapa_procesal_nodos")
    .update(patch)
    .eq("id", nodoId)
    .eq("caso_id", casoId)
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(`actualizarNodo: ${error.message}`);
  return nodo ? (nodo as NodoProcesalDB) : null;
}

export type EliminarResult =
  | { status: "ok" }
  | { status: "not_owned" }
  | { status: "not_found" }
  | { status: "is_raiz" };

// Elimina un nodo y (por FK ON DELETE CASCADE) todos sus descendientes. No
// permite eliminar la raíz.
export async function eliminarNodo(
  nodoId: string,
  casoId: string,
  usuarioId: string,
): Promise<EliminarResult> {
  if (!(await casoEsDelUsuario(casoId, usuarioId))) return { status: "not_owned" };
  const supabase = createServerClient();

  const { data: nodo, error: gErr } = await supabase
    .from("mapa_procesal_nodos")
    .select("id, tipo")
    .eq("id", nodoId)
    .eq("caso_id", casoId)
    .maybeSingle();
  if (gErr) throw new Error(`eliminarNodo get: ${gErr.message}`);
  if (!nodo) return { status: "not_found" };
  if ((nodo as { tipo: string }).tipo === "raiz") return { status: "is_raiz" };

  const { error } = await supabase
    .from("mapa_procesal_nodos")
    .delete()
    .eq("id", nodoId)
    .eq("caso_id", casoId);
  if (error) throw new Error(`eliminarNodo: ${error.message}`);
  return { status: "ok" };
}
