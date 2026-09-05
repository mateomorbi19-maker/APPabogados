import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import { casoEsDelUsuario } from "@/lib/casos/propiedad";
import {
  agregarParte,
  listarPartes,
  MAX_PARTES,
} from "@/lib/casos/escritura";
import { rolParteLabel } from "@/lib/casos/ficha";
import { crearParteInputSchema } from "@/lib/schemas";

const uuidSchema = z.string().uuid();

// El guard de propiedad de TODAS las rutas de partes es `casoEsDelUsuario`.
//
// `partes_caso` no tiene `usuario_id` (la propiedad se hereda del caso vía la
// FK), y el server entra con service_role, que bypassa RLS. O sea: si ese
// chequeo no corre, cualquier abogado lee y escribe las partes de la causa de
// otro con solo cambiar el UUID de la URL. Y acá los datos son nombres reales
// de clientes e imputados: una fuga cruzada no es un bug de UX, es secreto
// profesional roto.
//
// Desde la Fase 11 el GET lo llama acá (la lectura no valida propiedad por
// contrato) y las escrituras lo llevan adentro de `src/lib/casos/escritura.ts`,
// que es el mismo código que usan las tools de LEXIE.

// === GET /api/casos/[id]/partes ===
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  try {
    if (!(await casoEsDelUsuario(id, wl.usuario_id))) {
      return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
    }
    const partes = await listarPartes(id);
    // Las lecturas del repo no llevan `ok` (ver GET /api/casos y /eventos).
    return jsonResponse({ partes }, 200);
  } catch (e) {
    console.error("[GET partes] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando partes",
        ...(isDev() ? { detail: e instanceof Error ? e.message : String(e) } : {}),
      },
      500,
    );
  }
}

// === POST /api/casos/[id]/partes ===
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }

  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = crearParteInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }

  try {
    // `caso_id` sale del path, nunca del body; el servicio verifica que sea
    // del usuario ANTES de tocar nada.
    const r = await agregarParte(id, wl.usuario_id, parsed.data);

    if (r.ok) {
      return jsonResponse({ ok: true, parte: r.parte }, 201);
    }

    switch (r.motivo) {
      case "caso_ajeno":
        return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
      case "tope":
        return jsonResponse(
          { ok: false, error: `Una causa admite hasta ${MAX_PARTES} partes` },
          400,
        );
      // Nuevo en la Fase 11: la misma persona cargada dos veces ya no crea
      // una segunda fila. Se devuelve la existente para que el formulario
      // pueda decir cuál es y el abogado la edite en vez de repetirla.
      case "duplicada": {
        const p = r.parte_existente;
        const quien = p
          ? `«${p.nombre}» ya está cargada en esta causa como ${rolParteLabel(p.rol).toLowerCase()}`
          : "Esa persona ya está cargada en esta causa";
        return jsonResponse(
          {
            ok: false,
            error: `${quien}. Editala desde la lista en vez de agregarla de nuevo.`,
            ...(p ? { parte_existente: p } : {}),
          },
          409,
        );
      }
    }
  } catch (e) {
    console.error("[POST partes] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error creando la parte",
        ...(isDev() ? { detail: e instanceof Error ? e.message : String(e) } : {}),
      },
      500,
    );
  }
}
