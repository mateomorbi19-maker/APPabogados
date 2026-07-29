import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse } from "@/lib/http";
import { getEstadoConexion, SCOPES_DRIVE } from "@/lib/google/token";
import { CATALOGO } from "@/lib/repositorio/catalogo";

// === GET /api/repositorio/estado ===
// ¿Puede este usuario abrir los PDF adentro de la app? El catálogo (títulos,
// materias, metadata) se lee siempre; lo que necesita permiso de Google es el
// binario. Por eso la UI puede listar la biblioteca completa aunque
// `conectado` sea false, ofreciendo "Abrir en Drive" como fallback.
export async function GET(): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  const estado = await getEstadoConexion(wl.clerk_user_id, SCOPES_DRIVE);

  return jsonResponse(
    {
      conectado: estado.habilitado,
      // `vinculado` distingue "no conectaste Google" de "conectaste Google pero
      // sin el permiso de Drive": son dos mensajes distintos en el banner.
      vinculado: estado.vinculado,
      total_documentos: CATALOGO.length,
    },
    200,
  );
}
