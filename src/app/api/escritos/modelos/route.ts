import { NextRequest } from "next/server";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import { modeloEscritoInputSchema } from "@/lib/schemas";
import { crearModelo, listarModelos } from "@/lib/escritos/queries";

// Los modelos de escrito que el abogado puede elegir: los 50 del estudio (en
// código) más los suyos (en la tabla). Un solo listado, con `origen` para que
// el UI los muestre en flujos separados, como pidió Gonzalo.

// === GET /api/escritos/modelos ===
// Devuelve los RESÚMENES (sin cuerpo). El cuerpo se pide por id al generar o
// al abrir el modelo: son 50 cuerpos de ~1.500 caracteres que nadie lee en
// una lista.
export async function GET(): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  try {
    const modelos = await listarModelos(wl.usuario_id);
    return jsonResponse({ ok: true, modelos }, 200);
  } catch (e) {
    console.error("[GET escritos/modelos] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error listando los modelos",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}

// === POST /api/escritos/modelos ===
// "Nuevo modelo": el abogado trae su propio escrito. Origen 'abogado' siempre;
// el origen 'lexie' sólo lo escribe la tool de LEXIE.
export async function POST(req: NextRequest): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = modeloEscritoInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }

  try {
    const d = parsed.data;
    const modelo = await crearModelo(
      wl.usuario_id,
      {
        categoria: d.categoria,
        titulo: d.titulo,
        suma: d.suma,
        cuando: d.cuando ?? null,
        base_normativa: d.base_normativa ?? null,
        cuerpo: d.cuerpo,
        claves: d.claves ?? null,
        rol_sugerido: d.rol_sugerido,
      },
      "abogado",
    );
    return jsonResponse({ ok: true, modelo }, 201);
  } catch (e) {
    console.error("[POST escritos/modelos] error:", e);
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("tope")) {
      return jsonResponse({ ok: false, error: msg }, 400);
    }
    return jsonResponse(
      {
        ok: false,
        error: "Error creando el modelo",
        ...(isDev() ? { detail: msg } : {}),
      },
      500,
    );
  }
}
