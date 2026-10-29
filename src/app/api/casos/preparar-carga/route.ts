import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { enforceTokenLimit } from "@/lib/auth/enforce-rate";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse } from "@/lib/http";
import { MAX_TEXTO_CARGA } from "@/lib/casos/carga-schema";
import { ErrorCarga, leerFormularioCarga, validarCamposFormulario, validarPdfCarga } from "@/lib/casos/carga-archivo";
import { verificarCargaDisponible } from "@/lib/casos/carga-persistencia";
import { extraerFichaCarga } from "@/lib/casos/carga-extraer";

export const runtime = "nodejs";
export const maxDuration = 120;
const textoSchema = z.string().trim().max(MAX_TEXTO_CARGA);

export async function POST(req: Request): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);
  try {
    const form = await leerFormularioCarga(req);
    validarCamposFormulario(form, ["texto", "archivo"]);
    const texto = textoSchema.safeParse(form.get("texto") ?? "");
    if (!texto.success) throw new ErrorCarga("El texto es inválido o supera los 50.000 caracteres");
    if (!form.has("archivo") && !texto.data) throw new ErrorCarga("Adjuntá un PDF o contá los datos de la causa por voz o texto");
    const db = createServerClient();
    await verificarCargaDisponible(db, wl.usuario_id);
    const cuota = await enforceTokenLimit(wl.usuario_id);
    if (!cuota.ok) return jsonResponse({ ok: false, error: "Cupo mensual de tokens agotado" }, 429);
    const pdf = await validarPdfCarga(form.get("archivo"));
    const salida = await extraerFichaCarga(db, wl.usuario_id, texto.data, pdf);
    return jsonResponse({ ok: true, ...salida }, 200);
  } catch (e) {
    if (e instanceof ErrorCarga) return jsonResponse({ ok: false, error: e.message }, e.status);
    console.error("[preparar-carga] error inesperado", e instanceof Error ? e.name : "desconocido");
    return jsonResponse({ ok: false, error: "No se pudo preparar la ficha. Tus archivos y texto siguen disponibles para reintentar." }, 500);
  }
}
