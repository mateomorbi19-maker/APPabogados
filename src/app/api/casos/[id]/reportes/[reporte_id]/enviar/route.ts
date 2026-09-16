import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import { enviarReporteInputSchema } from "@/lib/schemas";
import { enviarReporte } from "@/lib/reporteria/enviar-reporte";

export const runtime = "nodejs";
export const maxDuration = 30;

const uuidSchema = z.string().uuid();

// === POST /api/casos/[id]/reportes/[reporte_id]/enviar ===
//
// El único punto por el que un reporte sale de la app. Las reglas viven en
// enviar-reporte.ts; acá sólo se traducen a HTTP:
//   409  ya enviado / marcas pendientes / destinatario que no coincide
//   412  sin correo o sin teléfono usable en la parte, o sin Gmail con
//        permiso de envío
//   502  Gmail rechazó el envío (el reporte volvió a borrador)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; reporte_id: string }> },
): Promise<Response> {
  const { id: casoId, reporte_id } = await params;
  if (!uuidSchema.safeParse(casoId).success || !uuidSchema.safeParse(reporte_id).success) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const parsed = enviarReporteInputSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Body inválido", issues: parsed.error.issues },
      400,
    );
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  try {
    const r = await enviarReporte({
      casoId,
      usuarioId: wl.usuario_id,
      clerkUserId: wl.clerk_user_id,
      reporteId: reporte_id,
      canal: parsed.data.canal,
      para: parsed.data.para ?? null,
    });
    if (r.ok) {
      return jsonResponse({ ok: true, reporte: r.reporte, enviado_a: r.enviado_a }, 200);
    }
    switch (r.motivo) {
      case "caso_ajeno":
      case "no_existe":
        return jsonResponse({ ok: false, error: r.mensaje }, 404);
      case "ya_enviado":
      case "destinatario_no_coincide":
        return jsonResponse({ ok: false, error: r.mensaje }, 409);
      case "marcas_pendientes":
        return jsonResponse(
          { ok: false, error: r.mensaje, pendientes: r.pendientes ?? [] },
          409,
        );
      case "sin_email":
      case "sin_telefono":
      case "telefono_invalido":
      case "sin_gmail":
        return jsonResponse({ ok: false, error: r.mensaje }, 412);
      case "gmail_rechazo":
        return jsonResponse({ ok: false, error: r.mensaje }, 502);
    }
  } catch (e) {
    console.error("[POST reporte enviar] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "No pude enviar el reporte",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}
