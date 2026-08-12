import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { buscarCasos } from "@/lib/casos/buscar";
import { jsonResponse, isDev } from "@/lib/http";

// === GET /api/buscar?q=... ===
// Buscador global de la app. Hoy busca sobre los casos del usuario (título,
// relato e imputados que aparezcan en ellos, y las respuestas del formulario).
// No toca el LLM ni el RAG: es búsqueda literal, gratis y sin latencia de red
// externa, así que puede correr a cada tecla del usuario.
//
// El alcance por usuario NO es una decisión del cliente: sale de
// requireUsuarioOr403, igual que el resto de la app.

const querySchema = z.object({
  q: z.string().trim().min(2).max(120),
});

export async function GET(req: NextRequest): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  const parsed = querySchema.safeParse({
    q: req.nextUrl.searchParams.get("q") ?? "",
  });
  // Una consulta demasiado corta no es un error del usuario: todavía está
  // escribiendo. Devolvemos vacío en vez de 400 para que el UI no tenga que
  // distinguir "no encontré" de "todavía no busques".
  if (!parsed.success) {
    return jsonResponse({ ok: true, resultados: [] }, 200);
  }

  try {
    const resultados = await buscarCasos(wl.usuario_id, parsed.data.q);
    return jsonResponse({ ok: true, resultados }, 200);
  } catch (e) {
    console.error("[GET /api/buscar] error:", e);
    return jsonResponse(
      {
        ok: false,
        error: "Error buscando",
        ...(isDev() && e instanceof Error ? { detail: e.message } : {}),
      },
      500,
    );
  }
}
