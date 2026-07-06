import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import { fueroSchema, type Fuero } from "@/lib/mapa-procesal/types";
import {
  getNodosByCaso,
  inicializarMapa,
  reiniciarMapa,
} from "@/lib/mapa-procesal/queries";

const uuidSchema = z.string().uuid();

// El fuero define qué plantilla procesal se instancia (Fase A fuero-aware).
const initBodySchema = z.object({ fuero: fueroSchema });
const reiniciarBodySchema = z.object({ fuero: fueroSchema.optional() });

// === GET /api/casos/[id]/mapa ===
// Devuelve los nodos del mapa del caso + flag `inicializado` + `fuero`.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let mapa;
  try {
    mapa = await getNodosByCaso(id, wl.usuario_id);
  } catch (e) {
    console.error("[GET /api/casos/[id]/mapa] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando el mapa",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
  if (mapa === null) {
    return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
  }
  return jsonResponse(
    {
      ok: true,
      inicializado: mapa.nodos.length > 0,
      nodos: mapa.nodos,
      fuero: mapa.fuero,
    },
    200,
  );
}

// === POST /api/casos/[id]/mapa ===
// Inicializa el mapa con la plantilla del fuero elegido (body requerido).
// 409 si ya estaba inicializado.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = initBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let result;
  try {
    result = await inicializarMapa(id, wl.usuario_id, parsed.data.fuero);
  } catch (e) {
    console.error("[POST /api/casos/[id]/mapa] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error inicializando el mapa",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
  if (result.status === "not_owned") {
    return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
  }
  if (result.status === "already") {
    return jsonResponse({ ok: false, error: "El mapa ya está inicializado" }, 409);
  }
  return jsonResponse(
    { ok: true, inicializado: true, nodos: result.nodos, fuero: parsed.data.fuero },
    201,
  );
}

// === PUT /api/casos/[id]/mapa ===
// Reinicia el mapa: borra los nodos del caso y reinstancia la plantilla del
// fuero. Body opcional { fuero } permite cambiar de fuero al reiniciar; sin
// body usa el fuero ya guardado en el caso. Destructivo (pierde el progreso).
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

  // Body opcional: tolera PUT sin body (usa el fuero guardado del caso).
  let fuero: Fuero | undefined;
  const raw = await req.text();
  if (raw.trim().length > 0) {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
    }
    const parsed = reiniciarBodySchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse(
        { ok: false, error: "Body inválido", issues: parsed.error.issues },
        400,
      );
    }
    fuero = parsed.data.fuero;
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let result;
  try {
    result = await reiniciarMapa(id, wl.usuario_id, fuero);
  } catch (e) {
    console.error("[PUT /api/casos/[id]/mapa] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error reiniciando el mapa",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
  if (result.status === "not_owned") {
    return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
  }
  if (result.status === "sin_fuero") {
    return jsonResponse(
      {
        ok: false,
        error: "El caso no tiene fuero asignado; indicá el fuero para reiniciar",
      },
      400,
    );
  }
  return jsonResponse(
    { ok: true, inicializado: true, nodos: result.nodos, fuero: result.fuero },
    200,
  );
}
