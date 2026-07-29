import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import { MAX_NODOS_POR_CASO } from "./coherencia";
import { NODE_SEP, RANK_SEP } from "./layout";
import { generarPlantillaBase } from "./plantilla-base";
import { sugerirFuero } from "./sugerir-fuero";
import type { EstadoNodo, Fuero, NodoProcesalDB } from "./types";

const COLS =
  "id, caso_id, titulo, descripcion, tipo, estado, padre_id, posicion_x, posicion_y, riesgo_alto, metadata, created_at, updated_at";

// Cuántos nodos tiene HOY el caso. Lo usan los dos caminos de creación para
// aplicar el tope: antes vivía solo dentro de validarAccion (chat), así que la
// UI podía dejar el mapa por encima del máximo y con eso incapacitar al chat
// para crear cualquier nodo.
async function contarNodos(casoId: string): Promise<number> {
  const supabase = createServerClient();
  const { count, error } = await supabase
    .from("mapa_procesal_nodos")
    .select("id", { count: "exact", head: true })
    .eq("caso_id", casoId);
  if (error) throw new Error(`contarNodos: ${error.message}`);
  return count ?? 0;
}

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

// Trae id + fuero del caso si es del usuario; null si no existe / no es suyo.
export async function getCasoConFuero(
  casoId: string,
  usuarioId: string,
): Promise<{ id: string; fuero: Fuero | null } | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("casos")
    .select("id, fuero")
    .eq("id", casoId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  if (error) throw new Error(`getCasoConFuero: ${error.message}`);
  return data ? (data as { id: string; fuero: Fuero | null }) : null;
}

// Sugiere un fuero para el caso a partir de contexto.jurisdiccion (respuesta
// del formulario dinámico) o del relato. Solo tiene sentido cuando el caso aún
// no tiene fuero persistido. El caller ya verificó ownership.
export async function sugerirFueroDelCaso(casoId: string): Promise<Fuero | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("casos")
    .select("contexto, caso_descripcion")
    .eq("id", casoId)
    .maybeSingle();
  if (error) throw new Error(`sugerirFueroDelCaso: ${error.message}`);
  if (!data) return null;
  return sugerirFuero({
    contexto: data.contexto as Record<string, unknown> | null,
    descripcion: (data.caso_descripcion as string | null) ?? null,
  });
}

// Devuelve los nodos + fuero del caso, o null si no existe / no es del usuario.
export async function getNodosByCaso(
  casoId: string,
  usuarioId: string,
): Promise<{ nodos: NodoProcesalDB[]; fuero: Fuero | null } | null> {
  const caso = await getCasoConFuero(casoId, usuarioId);
  if (!caso) return null;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("mapa_procesal_nodos")
    .select(COLS)
    .eq("caso_id", casoId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getNodosByCaso: ${error.message}`);
  return { nodos: (data ?? []) as NodoProcesalDB[], fuero: caso.fuero };
}

// Lectura de nodos SIN verificar ownership: para callers que YA lo validaron
// (buildContextoCaso, invocado desde rutas que autenticaron el caso). Mismo
// patrón que sugerirFueroDelCaso. La query sigue scopeada por caso_id, así que
// no hay forma de que devuelva nodos de otro caso.
export async function getNodosDelCaso(
  casoId: string,
): Promise<NodoProcesalDB[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("mapa_procesal_nodos")
    .select(COLS)
    .eq("caso_id", casoId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getNodosDelCaso: ${error.message}`);
  return (data ?? []) as NodoProcesalDB[];
}

export type InicializarResult =
  | { status: "ok"; nodos: NodoProcesalDB[] }
  | { status: "not_owned" }
  | { status: "already" };

export async function inicializarMapa(
  casoId: string,
  usuarioId: string,
  fuero: Fuero,
): Promise<InicializarResult> {
  if (!(await casoEsDelUsuario(casoId, usuarioId))) return { status: "not_owned" };
  const supabase = createServerClient();

  const { count, error: cErr } = await supabase
    .from("mapa_procesal_nodos")
    .select("id", { count: "exact", head: true })
    .eq("caso_id", casoId);
  if (cErr) throw new Error(`inicializarMapa count: ${cErr.message}`);
  if ((count ?? 0) > 0) return { status: "already" };

  // Persistimos el fuero confirmado por el abogado ANTES de insertar: si el
  // insert falla, el mapa sigue "sin inicializar" y el fuero queda como
  // default del próximo intento.
  const { error: fErr } = await supabase
    .from("casos")
    .update({ fuero })
    .eq("id", casoId);
  if (fErr) throw new Error(`inicializarMapa fuero: ${fErr.message}`);

  const plantilla = generarPlantillaBase(casoId, fuero);
  const { data, error } = await supabase
    .from("mapa_procesal_nodos")
    .insert(plantilla)
    .select(COLS);
  if (error) throw new Error(`inicializarMapa insert: ${error.message}`);
  return { status: "ok", nodos: (data ?? []) as NodoProcesalDB[] };
}

export type CrearNodoResult =
  | { status: "ok"; nodo: NodoProcesalDB }
  // El caso no es del usuario, o el padre no existe en ese caso.
  | { status: "not_found" }
  | { status: "tope"; total: number; maximo: number };

// Crea un nodo hijo (tipo prediccion, estado desbloqueado). La posición se
// siembra debajo del padre, corrida según cuántos hermanos ya tiene (heurística
// simple; el abogado lo arrastra o usa "Reordenar" si no le gusta).
export async function crearNodoHijo(
  casoId: string,
  padreId: string,
  usuarioId: string,
  // `riesgo_alto` lo usa el agente del chat: cuando crea un desenlace adverso
  // al imputado (prisión preventiva, revocación de libertad) tiene que poder
  // marcarlo en el mismo insert. La UI del mapa nunca lo manda (crea neutro y
  // el abogado togglea después), por eso es opcional con default false.
  data: { titulo: string; descripcion?: string | null; riesgo_alto?: boolean },
): Promise<CrearNodoResult> {
  if (!(await casoEsDelUsuario(casoId, usuarioId))) return { status: "not_found" };
  const supabase = createServerClient();

  const total = await contarNodos(casoId);
  if (total >= MAX_NODOS_POR_CASO) {
    return { status: "tope", total, maximo: MAX_NODOS_POR_CASO };
  }

  const { data: padre, error: pErr } = await supabase
    .from("mapa_procesal_nodos")
    .select("id, posicion_x, posicion_y")
    .eq("id", padreId)
    .eq("caso_id", casoId)
    .maybeSingle();
  if (pErr) throw new Error(`crearNodoHijo padre: ${pErr.message}`);
  if (!padre) return { status: "not_found" };
  const p = padre as { id: string; posicion_x: number; posicion_y: number };

  const { count: nHermanos, error: hErr } = await supabase
    .from("mapa_procesal_nodos")
    .select("id", { count: "exact", head: true })
    .eq("caso_id", casoId)
    .eq("padre_id", padreId);
  if (hErr) throw new Error(`crearNodoHijo hermanos: ${hErr.message}`);

  const { data: nodo, error } = await supabase
    .from("mapa_procesal_nodos")
    .insert({
      caso_id: casoId,
      titulo: data.titulo,
      descripcion: data.descripcion ?? null,
      tipo: "prediccion",
      estado: "desbloqueado",
      padre_id: padreId,
      riesgo_alto: data.riesgo_alto ?? false,
      posicion_x: p.posicion_x + (nHermanos ?? 0) * NODE_SEP,
      posicion_y: p.posicion_y + RANK_SEP,
    })
    .select(COLS)
    .single();
  if (error || !nodo) {
    throw new Error(`crearNodoHijo: ${error?.message ?? "sin fila"}`);
  }
  return { status: "ok", nodo: nodo as NodoProcesalDB };
}

export type CrearRamasResult =
  // `descartadas` > 0 cuando no entraban todas por el tope: se guardan las
  // primeras en vez de fallar entera (media simulación es mejor que ninguna).
  | { status: "ok"; nodos: NodoProcesalDB[]; descartadas: number }
  | { status: "not_found" }
  | { status: "tope"; total: number; maximo: number };

// Inserta en batch las ramas propuestas por la simulación IA como hijas del
// nodo objetivo (tipo prediccion, estado desbloqueado — mismas invariantes que
// crearNodoHijo). Posiciones: en fila debajo del padre, a continuación de los
// hermanos existentes ("Reordenar" acomoda la estética).
export async function crearRamasSimuladas(
  casoId: string,
  padreId: string,
  usuarioId: string,
  ramas: Array<{ titulo: string; descripcion: string; riesgo_alto: boolean }>,
): Promise<CrearRamasResult> {
  if (!(await casoEsDelUsuario(casoId, usuarioId))) return { status: "not_found" };
  const supabase = createServerClient();

  const total = await contarNodos(casoId);
  const cupo = MAX_NODOS_POR_CASO - total;
  if (cupo <= 0) return { status: "tope", total, maximo: MAX_NODOS_POR_CASO };
  const aInsertar = ramas.slice(0, cupo);

  const { data: padre, error: pErr } = await supabase
    .from("mapa_procesal_nodos")
    .select("id, posicion_x, posicion_y")
    .eq("id", padreId)
    .eq("caso_id", casoId)
    .maybeSingle();
  if (pErr) throw new Error(`crearRamasSimuladas padre: ${pErr.message}`);
  if (!padre) return { status: "not_found" };
  const p = padre as { id: string; posicion_x: number; posicion_y: number };

  const { count: nHermanos, error: hErr } = await supabase
    .from("mapa_procesal_nodos")
    .select("id", { count: "exact", head: true })
    .eq("caso_id", casoId)
    .eq("padre_id", padreId);
  if (hErr) throw new Error(`crearRamasSimuladas hermanos: ${hErr.message}`);

  const filas = aInsertar.map((r, i) => ({
    caso_id: casoId,
    titulo: r.titulo,
    descripcion: r.descripcion,
    tipo: "prediccion" as const,
    estado: "desbloqueado" as const,
    padre_id: padreId,
    riesgo_alto: r.riesgo_alto,
    posicion_x: p.posicion_x + ((nHermanos ?? 0) + i) * NODE_SEP,
    posicion_y: p.posicion_y + RANK_SEP,
  }));

  const { data, error } = await supabase
    .from("mapa_procesal_nodos")
    .insert(filas)
    .select(COLS);
  if (error) throw new Error(`crearRamasSimuladas: ${error.message}`);
  return {
    status: "ok",
    nodos: (data ?? []) as NodoProcesalDB[],
    descartadas: ramas.length - aInsertar.length,
  };
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

// Edita título/descripción/estado/posición. Si estado === 'ocurrido', delega
// en marcarComoOcurrido (que además desbloquea hijos; en ese caso NO aplica
// otros campos — la UI nunca los manda juntos). Devuelve null si no aplica.
export async function actualizarNodo(
  nodoId: string,
  casoId: string,
  usuarioId: string,
  data: {
    titulo?: string;
    descripcion?: string | null;
    estado?: EstadoNodo;
    riesgo_alto?: boolean;
    posicion_x?: number;
    posicion_y?: number;
  },
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
  if (data.riesgo_alto !== undefined) patch.riesgo_alto = data.riesgo_alto;
  if (data.posicion_x !== undefined) patch.posicion_x = data.posicion_x;
  if (data.posicion_y !== undefined) patch.posicion_y = data.posicion_y;

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

// Actualiza posiciones en batch (siembra de mapas pre-Fase E y "Reordenar").
// Devuelve false si el caso no es del usuario. Los ids se scopean por caso_id
// en cada update, así ids ajenos simplemente no matchean fila.
export async function actualizarPosiciones(
  casoId: string,
  usuarioId: string,
  posiciones: Array<{ id: string; posicion_x: number; posicion_y: number }>,
): Promise<boolean> {
  if (!(await casoEsDelUsuario(casoId, usuarioId))) return false;
  const supabase = createServerClient();
  const ahora = new Date().toISOString();

  const resultados = await Promise.all(
    posiciones.map((p) =>
      supabase
        .from("mapa_procesal_nodos")
        .update({
          posicion_x: p.posicion_x,
          posicion_y: p.posicion_y,
          updated_at: ahora,
        })
        .eq("id", p.id)
        .eq("caso_id", casoId),
    ),
  );
  const conError = resultados.find((r) => r.error);
  if (conError?.error) {
    throw new Error(`actualizarPosiciones: ${conError.error.message}`);
  }
  return true;
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

export type RestaurarResult =
  | { status: "ok"; nodos: NodoProcesalDB[] }
  | { status: "not_owned" }
  // Algún padre externo al batch ya no existe en el caso (p. ej. se borró
  // después): no se puede restaurar sin dejar huérfanos.
  | { status: "padre_faltante" };

// Re-inserta nodos borrados (deshacer): ids PRESERVADOS para que el subárbol
// vuelva idéntico (posiciones, estados, jerarquía). Un solo INSERT multi-fila:
// Postgres valida la self-FK al cierre del statement, así que el orden
// padre/hijo dentro del batch no importa (mismo patrón que la plantilla).
export async function restaurarNodos(
  casoId: string,
  usuarioId: string,
  nodos: Array<{
    id: string;
    titulo: string;
    descripcion: string | null;
    tipo: "real" | "prediccion";
    estado: EstadoNodo;
    padre_id: string;
    riesgo_alto: boolean;
    posicion_x: number;
    posicion_y: number;
  }>,
): Promise<RestaurarResult> {
  if (!(await casoEsDelUsuario(casoId, usuarioId))) return { status: "not_owned" };
  const supabase = createServerClient();

  // Verificar que los padres EXTERNOS al batch sigan existiendo en el caso.
  const idsBatch = new Set(nodos.map((n) => n.id));
  const padresExternos = [
    ...new Set(nodos.map((n) => n.padre_id).filter((p) => !idsBatch.has(p))),
  ];
  if (padresExternos.length > 0) {
    const { data: existentes, error: eErr } = await supabase
      .from("mapa_procesal_nodos")
      .select("id")
      .eq("caso_id", casoId)
      .in("id", padresExternos);
    if (eErr) throw new Error(`restaurarNodos padres: ${eErr.message}`);
    if ((existentes ?? []).length !== padresExternos.length) {
      return { status: "padre_faltante" };
    }
  }

  const { data, error } = await supabase
    .from("mapa_procesal_nodos")
    .insert(nodos.map((n) => ({ ...n, caso_id: casoId })))
    .select(COLS);
  if (error) throw new Error(`restaurarNodos insert: ${error.message}`);
  return { status: "ok", nodos: (data ?? []) as NodoProcesalDB[] };
}

export type ReiniciarResult =
  | { status: "ok"; nodos: NodoProcesalDB[]; fuero: Fuero }
  | { status: "not_owned" }
  // El caso no tiene fuero guardado (mapa anterior a Fase A) y el PUT no trajo
  // uno: el caller debe pedir el fuero explícito.
  | { status: "sin_fuero" };

// Borra TODOS los nodos del caso y reinstancia la plantilla base actual. Sirve
// para que un mapa viejo (template anterior) pase al flujo nuevo sin crear un
// caso nuevo. Destructivo POR DISEÑO: pierde el progreso del mapa (estados/nodos
// manuales) — el usuario lo confirma en un diálogo antes.
//
// LIMITACIÓN CONOCIDA (aceptada para esta versión provisional): el delete y el
// insert son dos round-trips sin transacción. Si el insert fallara (timeout/red)
// después de que el delete commitea, el mapa queda con 0 nodos. NO se puede
// invertir el orden (insertar antes de borrar) porque el índice único de raíz
// por caso (`WHERE tipo='raiz'`) rechazaría dos raíces simultáneas. El estado
// vacío es RECUPERABLE en un click: el mapa vuelve a mostrar "sin inicializar" y
// reinicializar (o re-"Reiniciar") reinstancia el template. Si esta utilidad
// deja de ser provisional, el fix correcto es una RPC plpgsql transaccional que
// reciba los nodos por jsonb (manteniendo plantilla-base.ts como fuente única).
export async function reiniciarMapa(
  casoId: string,
  usuarioId: string,
  // Override opcional: permite reiniciar con OTRO fuero (caso "me equivoqué de
  // fuero") y resuelve los mapas anteriores a Fase A con casos.fuero NULL.
  fueroOverride?: Fuero,
): Promise<ReiniciarResult> {
  const caso = await getCasoConFuero(casoId, usuarioId);
  if (!caso) return { status: "not_owned" };
  const fuero = fueroOverride ?? caso.fuero;
  if (!fuero) return { status: "sin_fuero" };
  const supabase = createServerClient();

  if (fuero !== caso.fuero) {
    const { error: fErr } = await supabase
      .from("casos")
      .update({ fuero })
      .eq("id", casoId);
    if (fErr) throw new Error(`reiniciarMapa fuero: ${fErr.message}`);
  }

  const { error: delErr } = await supabase
    .from("mapa_procesal_nodos")
    .delete()
    .eq("caso_id", casoId);
  if (delErr) throw new Error(`reiniciarMapa delete: ${delErr.message}`);

  const plantilla = generarPlantillaBase(casoId, fuero);
  const { data, error } = await supabase
    .from("mapa_procesal_nodos")
    .insert(plantilla)
    .select(COLS);
  if (error) throw new Error(`reiniciarMapa insert: ${error.message}`);
  return { status: "ok", nodos: (data ?? []) as NodoProcesalDB[], fuero };
}
