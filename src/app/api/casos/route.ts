import { NextRequest } from "next/server";
import { crearCasoInputSchema } from "@/lib/schemas";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";

// === POST /api/casos ===
// Crea un caso a partir de una ejecución de "analizar_caso", tomando una
// estrategia específica del resultado. Snapshot la estrategia para que
// sobreviva si la ejecución se borra.
export async function POST(req: NextRequest): Promise<Response> {
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsedBody = crearCasoInputSchema.safeParse(bodyJson);
  if (!parsedBody.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsedBody.error.issues },
      400,
    );
  }
  const { titulo, ejecucion_origen_id, rol_estrategia, idx_estrategia } =
    parsedBody.data;

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  const supabase = createServerClient();

  const { data: ejecucion, error: ejErr } = await supabase
    .from("ejecuciones")
    .select("id, tipo, metadata, usuario_id")
    .eq("id", ejecucion_origen_id)
    .eq("usuario_id", wl.usuario_id)
    .maybeSingle();

  if (ejErr) {
    console.error("[POST /api/casos] error cargando ejecución:", ejErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando ejecución",
        ...(isDev() ? { detail: ejErr.message } : {}),
      },
      500,
    );
  }
  if (!ejecucion) {
    return jsonResponse({ ok: false, error: "Ejecución no encontrada" }, 404);
  }
  if (ejecucion.tipo !== "analizar_caso") {
    return jsonResponse(
      { ok: false, error: "La ejecución no es de tipo analizar_caso" },
      400,
    );
  }

  // El metadata de "analizar_caso" trae { caso, contexto, rol, resultado, ... }.
  // Validamos defensivamente cada nivel: si la ejecución es vieja o falló el
  // parseo, resultado puede ser null o no tener la rama del rol pedido.
  const metadata = ejecucion.metadata as Record<string, unknown> | null;
  if (!metadata || typeof metadata !== "object") {
    return jsonResponse(
      { ok: false, error: "Esta ejecución no tiene estrategias para guardar" },
      400,
    );
  }
  const resultado = metadata.resultado as Record<string, unknown> | null | undefined;
  if (!resultado || typeof resultado !== "object") {
    return jsonResponse(
      { ok: false, error: "Esta ejecución no tiene estrategias para guardar" },
      400,
    );
  }
  const seccion = resultado[rol_estrategia] as
    | { estrategias?: unknown }
    | undefined;
  if (
    !seccion ||
    typeof seccion !== "object" ||
    !Array.isArray(seccion.estrategias)
  ) {
    return jsonResponse(
      { ok: false, error: "Esta ejecución no tiene estrategias para guardar" },
      400,
    );
  }
  const estrategias = seccion.estrategias as unknown[];
  if (idx_estrategia < 0 || idx_estrategia >= estrategias.length) {
    return jsonResponse(
      { ok: false, error: "Índice de estrategia fuera de rango" },
      400,
    );
  }
  const estrategiaSnapshot = estrategias[idx_estrategia];

  const casoDescripcion =
    typeof metadata.caso === "string" ? metadata.caso : "";
  const contexto =
    metadata.contexto && typeof metadata.contexto === "object"
      ? metadata.contexto
      : null;
  const rol = typeof metadata.rol === "string" ? metadata.rol : null;
  if (!casoDescripcion || !rol) {
    return jsonResponse(
      { ok: false, error: "Esta ejecución no tiene estrategias para guardar" },
      400,
    );
  }

  const { data: casoInsertado, error: casoErr } = await supabase
    .from("casos")
    .insert({
      usuario_id: wl.usuario_id,
      titulo,
      caso_descripcion: casoDescripcion,
      contexto,
      rol,
      ejecucion_origen_id,
      estrategia_seleccionada_rol: rol_estrategia,
      estrategia_seleccionada_idx: idx_estrategia,
      estrategia_snapshot: estrategiaSnapshot,
    })
    .select("id")
    .single();

  if (casoErr || !casoInsertado) {
    console.error("[POST /api/casos] error insertando caso:", casoErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error creando caso",
        ...(isDev() && casoErr ? { detail: casoErr.message } : {}),
      },
      500,
    );
  }

  // Evento inicial — tipo 'sistema' porque lo crea el server, no el abogado.
  const { error: evErr } = await supabase.from("eventos_caso").insert({
    caso_id: casoInsertado.id,
    tipo: "sistema",
    descripcion: "Caso creado y estrategia elegida",
    ocurrido_en: new Date().toISOString(),
    estado: "sucedido",
  });
  if (evErr) {
    // No bloqueamos la creación del caso por un fallo en el evento inicial.
    console.error("[POST /api/casos] evento inicial falló:", evErr);
  }

  return jsonResponse({ ok: true, caso_id: casoInsertado.id }, 201);
}

// === GET /api/casos ===
// Lista casos del usuario con resumen: rol, jurisdicción, fecha de creación,
// último evento (descripcion + ocurrido_en) y cantidad de eventos.
export async function GET(): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  const supabase = createServerClient();

  const { data: casos, error: casosErr } = await supabase
    .from("casos")
    .select("id, titulo, rol, contexto, creado_en")
    .eq("usuario_id", wl.usuario_id)
    .order("creado_en", { ascending: false });

  if (casosErr) {
    console.error("[GET /api/casos] error cargando casos:", casosErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando casos",
        ...(isDev() ? { detail: casosErr.message } : {}),
      },
      500,
    );
  }

  if (!casos || casos.length === 0) {
    return jsonResponse({ casos: [] }, 200);
  }

  const casoIds = casos.map((c) => c.id);

  // Cargamos los eventos de TODOS los casos del usuario en una sola query.
  // Para 3 usuarios con pocos casos cada uno es infinitamente más barato que
  // N+1 queries, y simplifica que no haya RPC custom.
  const { data: eventos, error: evErr } = await supabase
    .from("eventos_caso")
    .select("caso_id, descripcion, ocurrido_en")
    .in("caso_id", casoIds);

  if (evErr) {
    console.error("[GET /api/casos] error cargando eventos:", evErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando eventos",
        ...(isDev() ? { detail: evErr.message } : {}),
      },
      500,
    );
  }

  type EventoLite = { caso_id: string; descripcion: string; ocurrido_en: string };
  const eventosPorCaso = new Map<string, EventoLite[]>();
  for (const e of (eventos ?? []) as EventoLite[]) {
    const list = eventosPorCaso.get(e.caso_id);
    if (list) list.push(e);
    else eventosPorCaso.set(e.caso_id, [e]);
  }

  type CasoLite = {
    id: string;
    titulo: string;
    rol: string;
    contexto: Record<string, unknown> | null;
    creado_en: string;
  };

  const result = (casos as CasoLite[]).map((c) => {
    const evs = eventosPorCaso.get(c.id) ?? [];
    const ultimo =
      evs.length > 0
        ? evs.reduce((acc, e) =>
            new Date(e.ocurrido_en) > new Date(acc.ocurrido_en) ? e : acc,
          )
        : null;
    const jurisdiccion =
      c.contexto && typeof c.contexto === "object" && "jurisdiccion" in c.contexto
        ? (c.contexto.jurisdiccion as string | null)
        : null;
    return {
      id: c.id,
      titulo: c.titulo,
      rol: c.rol,
      jurisdiccion,
      creado_en: c.creado_en,
      ultimo_evento: ultimo
        ? { descripcion: ultimo.descripcion, ocurrido_en: ultimo.ocurrido_en }
        : null,
      cantidad_eventos: evs.length,
    };
  });

  return jsonResponse({ casos: result }, 200);
}
