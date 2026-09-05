import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import {
  editarParte,
  eliminarParte,
  leerParte,
} from "@/lib/casos/escritura";
import { editarParteInputSchema } from "@/lib/schemas";

const uuidSchema = z.string().uuid();

// Propiedad en dos filtros y no en dos queries: el UPDATE y el DELETE llevan
// SIEMPRE `caso_id` además del `id` de la parte, y antes se verifica que el
// caso sea del usuario. `partes_caso` no tiene `usuario_id` propio y el server
// bypassa RLS con service_role, así que sin esto alcanza con adivinar dos
// UUIDs para tocar la causa de otro abogado.
//
// Desde la Fase 11 las dos cosas las hace `src/lib/casos/escritura.ts` —el
// mismo código que usan las tools de LEXIE— y este handler sólo traduce el
// resultado a HTTP. `caso_ajeno` es 404 "Caso no encontrado", igual que
// antes: un 403 confirmaría que la causa existe.

type Ctx = { params: Promise<{ id: string; parte_id: string }> };

async function validar(ctx: Ctx) {
  const { id, parte_id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return { ok: false as const, status: 400, error: "id inválido" };
  }
  if (!uuidSchema.safeParse(parte_id).success) {
    return { ok: false as const, status: 400, error: "parte_id inválido" };
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return { ok: false as const, status: wl.status, error: wl.message };
  }
  return {
    ok: true as const,
    casoId: id,
    parteId: parte_id,
    usuarioId: wl.usuario_id,
  };
}

function error500(donde: string, e: unknown, mensaje: string): Response {
  console.error(`[${donde}] error:`, e);
  return jsonResponse(
    {
      ok: false,
      error: mensaje,
      ...(isDev() ? { detail: e instanceof Error ? e.message : String(e) } : {}),
    },
    500,
  );
}

// === PATCH /api/casos/[id]/partes/[parte_id] ===
export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const v = await validar(ctx);
  if (!v.ok) return jsonResponse({ ok: false, error: v.error }, v.status);

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = editarParteInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }

  // Un body sin ningún campo es 400, como siempre. Se decide acá y no en el
  // servicio porque para el servicio "no vino nada" y "vino lo mismo que ya
  // está" son el mismo resultado (`sin_cambios`: no se escribe), y para el
  // cliente no: lo primero es un pedido mal armado, lo segundo es un guardado
  // que no tenía nada que guardar.
  if (Object.values(parsed.data).every((valor) => valor === undefined)) {
    return jsonResponse({ ok: false, error: "No hay nada para actualizar" }, 400);
  }

  try {
    const r = await editarParte(v.casoId, v.usuarioId, v.parteId, parsed.data);

    if (r.ok) {
      return jsonResponse({ ok: true, parte: r.despues }, 200);
    }

    switch (r.motivo) {
      case "caso_ajeno":
        return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
      case "no_existe":
        return jsonResponse({ ok: false, error: "Parte no encontrada" }, 404);
      case "sin_cambios": {
        // Nada que escribir: se devuelve la fila tal como está, que es lo que
        // el formulario espera para refrescar la lista.
        const actual = await leerParte(v.casoId, v.parteId);
        if (!actual) {
          return jsonResponse({ ok: false, error: "Parte no encontrada" }, 404);
        }
        return jsonResponse({ ok: true, parte: actual }, 200);
      }
    }
  } catch (e) {
    return error500("PATCH parte", e, "Error actualizando la parte");
  }
}

// === DELETE /api/casos/[id]/partes/[parte_id] ===
export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const v = await validar(ctx);
  if (!v.ok) return jsonResponse({ ok: false, error: v.error }, v.status);

  try {
    const r = await eliminarParte(v.casoId, v.usuarioId, v.parteId);

    if (r.ok) {
      return jsonResponse({ ok: true }, 200);
    }

    switch (r.motivo) {
      case "caso_ajeno":
        return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
      case "no_existe":
        return jsonResponse({ ok: false, error: "Parte no encontrada" }, 404);
    }
  } catch (e) {
    return error500("DELETE parte", e, "Error borrando la parte");
  }
}
