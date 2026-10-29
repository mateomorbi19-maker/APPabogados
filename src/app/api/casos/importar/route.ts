import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse } from "@/lib/http";
import { guardarCargaSchema } from "@/lib/casos/carga-schema";
import { ErrorCarga, leerFormularioCarga, validarCamposFormulario, validarPdfCarga } from "@/lib/casos/carga-archivo";
import { guardarCausaImportada, verificarCargaDisponible } from "@/lib/casos/carga-persistencia";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);
  try {
    const form = await leerFormularioCarga(req);
    validarCamposFormulario(form, ["datos", "archivo"]);
    const raw = form.get("datos");
    if (typeof raw !== "string" || raw.length > 150_000) throw new ErrorCarga("Los datos de la ficha son inválidos");
    let json: unknown;
    try { json = JSON.parse(raw); } catch { throw new ErrorCarga("Los datos de la ficha son inválidos"); }
    const parsed = guardarCargaSchema.safeParse(json);
    if (!parsed.success) throw new ErrorCarga(parsed.error.issues[0]?.message ?? "Revisá los datos de la ficha");
    const db = createServerClient();
    await verificarCargaDisponible(db, wl.usuario_id);
    const pdf = await validarPdfCarga(form.get("archivo"));
    const casoId = await guardarCausaImportada(db, wl.usuario_id, parsed.data, pdf);
    return jsonResponse({ ok: true, caso_id: casoId }, 201);
  } catch (e) {
    if (e instanceof ErrorCarga) return jsonResponse({ ok: false, error: e.message }, e.status);
    console.error("[importar-causa] error inesperado", e instanceof Error ? e.name : "desconocido");
    return jsonResponse({ ok: false, error: "No se pudo confirmar el guardado. Reintentá sin cerrar esta ficha." }, 500);
  }
}
