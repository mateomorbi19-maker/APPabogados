import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";
import { COLS_CASO } from "@/lib/casos/columnas";
import {
  editarFicha,
  leerFicha,
  MENSAJE_FUERO_CONGELADO,
} from "@/lib/casos/escritura";
import { editarCasoInputSchema } from "@/lib/schemas";

const uuidSchema = z.string().uuid();

// === GET /api/casos/[id] ===
// Detalle de un caso del usuario + eventos ordenados por ocurrido_en ASC.
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

  const supabase = createServerClient();

  const { data: caso, error: casoErr } = await supabase
    .from("casos")
    .select(COLS_CASO)
    .eq("id", id)
    .eq("usuario_id", wl.usuario_id)
    .maybeSingle();

  if (casoErr) {
    console.error("[GET /api/casos/[id]] error:", casoErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando caso",
        ...(isDev() ? { detail: casoErr.message } : {}),
      },
      500,
    );
  }
  if (!caso) {
    return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
  }

  // `categoria` y `adjuntos` existen desde 20260507120000 y este SELECT nunca
  // los pidió, así que esta ruta devolvía eventos incompletos mientras el SSR
  // del detalle los traía. No se notaba porque la pantalla usa el SSR; el que
  // se comía la diferencia era el fallback client-side.
  const { data: eventos, error: evErr } = await supabase
    .from("eventos_caso")
    .select(
      "id, tipo, categoria, descripcion, ocurrido_en, estado, creado_en, adjuntos",
    )
    .eq("caso_id", id)
    .order("ocurrido_en", { ascending: true });

  if (evErr) {
    console.error("[GET /api/casos/[id]] error eventos:", evErr);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando eventos",
        ...(isDev() ? { detail: evErr.message } : {}),
      },
      500,
    );
  }

  return jsonResponse({ ...caso, eventos: eventos ?? [] }, 200);
}

// === PATCH /api/casos/[id] ===
//
// Edita la FICHA de la causa. Hasta la Fase 9 el recurso `caso` no tenía
// ninguna ruta de escritura: `titulo` se fijaba en el POST inicial y no había
// forma de corregirlo, que es parte de por qué 4 de 8 causas se llaman con un
// pedazo del relato.
//
// La lógica —lista blanca de columnas, `.eq("usuario_id")` dentro del UPDATE,
// body vacío sin UPDATE, fuero congelado con el mapa armado— vive en
// `src/lib/casos/escritura.ts` desde la Fase 11, porque las tools de LEXIE
// escriben la misma ficha y no puede haber dos versiones de esas reglas. Este
// handler parsea, delega y traduce el resultado a HTTP.
//
// Lo único que cambió de cara al cliente: un patch que repite lo que ya está
// (`sin_cambios`) responde 200 con la fila SIN escribir. Antes corría el
// UPDATE igual y el trigger `casos_set_actualizado_en` movía la causa al tope
// del Inicio, del buscador y del contexto de LEXIE por un guardado en vano.
export async function PATCH(
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

  const parsed = editarCasoInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }

  try {
    const r = await editarFicha(id, wl.usuario_id, parsed.data);

    if (r.ok) {
      return jsonResponse({ ok: true, caso: r.despues }, 200);
    }

    switch (r.motivo) {
      case "body_vacio":
        return jsonResponse(
          { ok: false, error: "No hay nada para actualizar" },
          400,
        );
      // Sin fila: o no existe o es de otro abogado. 404 en los dos casos,
      // igual que el GET — un 403 confirmaría que la causa existe.
      case "no_existe":
        return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
      // Igual que un rechazo de coherencia, no es un error técnico sino el
      // sistema frenando un cambio incoherente; se explica dónde hacerlo.
      case "fuero_congelado":
        return jsonResponse(
          { ok: false, error: r.detalle ?? MENSAJE_FUERO_CONGELADO },
          409,
        );
      case "sin_cambios": {
        // El formulario espera la fila para refrescar el detalle. Se la lee
        // (sin escribir): si desapareció en el medio, 404 como arriba.
        const actual = await leerFicha(id, wl.usuario_id);
        if (!actual) {
          return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
        }
        return jsonResponse({ ok: true, caso: actual }, 200);
      }
    }
  } catch (e) {
    console.error("[PATCH /api/casos/[id]] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error actualizando la causa",
        ...(isDev() ? { detail: e instanceof Error ? e.message : String(e) } : {}),
      },
      500,
    );
  }
}

// === DELETE /api/casos/[id] ===
// Cascade borra los eventos del caso (FK ON DELETE CASCADE).
export async function DELETE(
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

  const supabase = createServerClient();

  // Borramos directamente con doble filtro (id + usuario_id). Si la fila
  // existía pero era de otro usuario o no existía, count = 0 → 404.
  const { error, count } = await supabase
    .from("casos")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("usuario_id", wl.usuario_id);

  if (error) {
    console.error("[DELETE /api/casos/[id]] error:", error);
    return jsonResponse(
      {
        ok: false,
        error: "Error borrando caso",
        ...(isDev() ? { detail: error.message } : {}),
      },
      500,
    );
  }
  if (count === 0) {
    return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
  }

  return jsonResponse({ ok: true }, 200);
}
