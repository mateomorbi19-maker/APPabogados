import { NextRequest } from "next/server";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { jsonResponse, isDev } from "@/lib/http";
import { CATALOGO } from "@/lib/repositorio/catalogo";
import { buscarConFacetas, paginar } from "@/lib/repositorio/buscar";
import { filtrosRepositorioSchema, POR_PAGINA } from "@/lib/repositorio/types";

// === GET /api/repositorio/documentos ===
// Busca en la biblioteca de jurisprudencia y doctrina. El catálogo es un módulo
// en memoria (src/lib/repositorio/catalogo.ts), así que esto no toca ni la DB ni
// la red: es un scan de ~350 items. Devuelve además las facetas con los conteos
// para pintar los filtros con números reales.
export async function GET(req: NextRequest): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) return jsonResponse({ ok: false, error: wl.message }, wl.status);

  const sp = new URL(req.url).searchParams;
  const parsed = filtrosRepositorioSchema.safeParse({
    q: sp.get("q") ?? "",
    coleccion: sp.get("coleccion"),
    materia: sp.get("materia"),
    tribunal: sp.get("tribunal"),
    anio: sp.get("anio"),
    orden: sp.get("orden"),
    pagina: sp.get("pagina"),
  });
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Filtros inválidos", issues: parsed.error.issues },
      400,
    );
  }

  const { pagina, ...filtros } = parsed.data;

  try {
    const { documentos, total, facetas } = buscarConFacetas(CATALOGO, filtros);
    // Éxito de GET = objeto crudo (convención del repo: sólo los errores llevan
    // `ok: false`; ver GET /api/casos, GET /api/agenda/eventos).
    return jsonResponse(
      {
        documentos: paginar(documentos, pagina, POR_PAGINA),
        total,
        facetas,
        pagina,
        por_pagina: POR_PAGINA,
      },
      200,
    );
  } catch (e) {
    console.error("[GET /api/repositorio/documentos] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error buscando en el repositorio",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}
