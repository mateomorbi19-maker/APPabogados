import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import {
  getNodosByCaso,
  inicializarMapa,
  reiniciarMapa,
} from "@/lib/mapa-procesal/queries";

const uuidSchema = z.string().uuid();

// === GET /api/casos/[id]/mapa ===
// Devuelve los nodos del mapa del caso + flag `inicializado`.
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

  let nodos;
  try {
    nodos = await getNodosByCaso(id, wl.usuario_id);
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
  if (nodos === null) {
    return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
  }
  return jsonResponse({ ok: true, inicializado: nodos.length > 0, nodos }, 200);
}

// === POST /api/casos/[id]/mapa ===
// Inicializa el mapa con la plantilla base. 409 si ya estaba inicializado.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let result;
  try {
    result = await inicializarMapa(id, wl.usuario_id);
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
  return jsonResponse({ ok: true, inicializado: true, nodos: result.nodos }, 201);
}

// === PUT /api/casos/[id]/mapa ===
// Reinicia el mapa: borra los nodos del caso y reinstancia la plantilla base
// actual. Destructivo (pierde el progreso del mapa). Sirve para llevar un mapa
// viejo al flujo nuevo sin crear un caso nuevo.
export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let result;
  try {
    result = await reiniciarMapa(id, wl.usuario_id);
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
  return jsonResponse({ ok: true, inicializado: true, nodos: result.nodos }, 200);
}
