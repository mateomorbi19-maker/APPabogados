import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";
import { COLS_CASO } from "@/lib/casos/columnas";
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
// Tres cosas que no se pueden aflojar acá:
//
//   1. El `.eq("usuario_id", ...)` va DENTRO del UPDATE, no en un SELECT
//      previo. El server entra con la service_role key, que bypassa RLS: este
//      filtro es el único control real de propiedad, y hacerlo en dos pasos
//      abre una ventana entre el chequeo y la escritura.
//   2. Las columnas escribibles se enumeran A MANO abajo. Nunca se derrama
//      `parsed.data` en el `.update()`: un campo de más en el schema pasaría
//      a poder mover `usuario_id`, `ejecucion_origen_id` o
//      `estrategia_snapshot`.
//   3. Un body vacío es 400 y no un UPDATE sin columnas. Un UPDATE vacío
//      igual dispararía el trigger `casos_set_actualizado_en`, y esa columna
//      ordena la lista del Inicio, el buscador y el contexto de LEXIE: un
//      guardado sin cambios saltearía la causa al tope de las tres listas.
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

  // Lista blanca explícita. `undefined` = el formulario no mandó ese campo, se
  // deja como está. `null` = el abogado lo vació a propósito, se borra. La
  // distinción importa: sin ella, guardar la ficha desde un formulario parcial
  // borraría todo lo que ese formulario no muestra.
  const d = parsed.data;
  const patchCols: Record<string, unknown> = {};
  if (d.caratula !== undefined) patchCols.caratula = d.caratula;
  if (d.expediente_numero !== undefined)
    patchCols.expediente_numero = d.expediente_numero;
  if (d.organismo !== undefined) patchCols.organismo = d.organismo;
  if (d.secretaria !== undefined) patchCols.secretaria = d.secretaria;
  if (d.juez !== undefined) patchCols.juez = d.juez;
  if (d.fiscalia !== undefined) patchCols.fiscalia = d.fiscalia;
  if (d.delitos !== undefined) patchCols.delitos = d.delitos;
  if (d.estado_seguimiento !== undefined)
    patchCols.estado_seguimiento = d.estado_seguimiento;
  if (d.fuero !== undefined) patchCols.fuero = d.fuero;
  if (d.titulo !== undefined) patchCols.titulo = d.titulo.trim();

  if (Object.keys(patchCols).length === 0) {
    return jsonResponse(
      { ok: false, error: "No hay nada para actualizar" },
      400,
    );
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("casos")
    .update(patchCols)
    .eq("id", id)
    .eq("usuario_id", wl.usuario_id)
    .select(COLS_CASO)
    .maybeSingle();

  if (error) {
    console.error("[PATCH /api/casos/[id]] error:", error);
    return jsonResponse(
      {
        ok: false,
        error: "Error actualizando la causa",
        ...(isDev() ? { detail: error.message } : {}),
      },
      500,
    );
  }
  // Sin fila: o no existe o es de otro abogado. 404 en los dos casos, igual
  // que el GET — un 403 confirmaría que la causa existe.
  if (!data) {
    return jsonResponse({ ok: false, error: "Caso no encontrado" }, 404);
  }

  return jsonResponse({ ok: true, caso: data }, 200);
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
