import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse } from "@/lib/http";
import { getEstadoConexion, SCOPES_DRIVE } from "@/lib/google/token";
import { CATALOGO } from "@/lib/repositorio/catalogo";
import { contarDocumentosIndexados } from "@/lib/repositorio/rag";

// === GET /api/repositorio/estado ===
// ¿Puede este usuario abrir los PDF adentro de la app? El catálogo (títulos,
// materias, metadata) se lee siempre; lo que necesita permiso de Google es el
// binario. Por eso la UI puede listar la biblioteca completa aunque
// `conectado` sea false, ofreciendo "Abrir en Drive" como fallback.
export async function GET(): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  const [estado, indexados] = await Promise.all([
    getEstadoConexion(wl.clerk_user_id, SCOPES_DRIVE),
    contarDocumentosIndexados(),
  ]);

  return jsonResponse(
    {
      conectado: estado.habilitado,
      // `vinculado` distingue "no conectaste Google" de "conectaste Google pero
      // sin el permiso de Drive": son dos mensajes distintos en el banner.
      vinculado: estado.vinculado,
      total_documentos: CATALOGO.length,
      // Cuántos documentos puede CITAR el agente. Es un eje distinto de
      // `conectado`: navegar el catálogo sólo necesita el módulo TS, pero para
      // que la IA cite hace falta la ingesta del RAG. `null` = las tablas del
      // RAG todavía no existen (migración sin aplicar).
      documentos_indexados: indexados,
    },
    200,
  );
}
