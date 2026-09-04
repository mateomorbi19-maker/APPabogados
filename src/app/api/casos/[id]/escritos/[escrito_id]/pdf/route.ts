import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";
import { COLS_CASO_NOMBRE_EXPEDIENTE } from "@/lib/casos/columnas";
import { getPerfilProfesional, obtenerEscrito } from "@/lib/escritos/queries";
import { nombreArchivoPdf, renderEscritoPdf } from "@/lib/escritos/render-pdf";

const uuidSchema = z.string().uuid();

// === GET /api/casos/[id]/escritos/[escrito_id]/pdf ===
//
// El PDF se arma A PEDIDO desde `contenido`: no se guarda en ningún lado
// (salvo cuando el escrito se marca como presentado, que sube una copia al
// bucket como adjunto del evento). Editar el texto y volver a bajar es gratis.
//
// `?descargar=1` fuerza la descarga; sin eso el navegador lo abre en una
// pestaña, que es lo que se quiere para "ver cómo quedó".
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; escrito_id: string }> },
): Promise<Response> {
  const { id: casoId, escrito_id } = await params;
  if (
    !uuidSchema.safeParse(casoId).success ||
    !uuidSchema.safeParse(escrito_id).success
  ) {
    return jsonResponse({ ok: false, error: "id inválido" }, 400);
  }
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  try {
    const supabase = createServerClient();
    const [escrito, perfil, casoRes] = await Promise.all([
      obtenerEscrito(escrito_id, casoId, wl.usuario_id),
      getPerfilProfesional(wl.usuario_id),
      supabase
        .from("casos")
        .select(COLS_CASO_NOMBRE_EXPEDIENTE)
        .eq("id", casoId)
        .eq("usuario_id", wl.usuario_id)
        .maybeSingle(),
    ]);
    if (!escrito) {
      return jsonResponse({ ok: false, error: "Escrito no encontrado" }, 404);
    }
    const expediente = casoRes.data?.expediente_numero ?? null;

    const bytes = await renderEscritoPdf({
      contenido: escrito.contenido,
      titulo: escrito.titulo,
      autor: perfil.nombre_completo,
    });
    const nombre = nombreArchivoPdf(escrito.titulo, expediente);
    const descargar = req.nextUrl.searchParams.get("descargar") === "1";

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        "content-disposition": `${descargar ? "attachment" : "inline"}; filename="${nombre}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    console.error("[GET escrito pdf] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "No pude generar el PDF",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}
