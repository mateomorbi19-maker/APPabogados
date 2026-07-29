import { NextRequest } from "next/server";
import { jsonResponse, isDev } from "@/lib/http";
import { gmailErrorMessage, gmailErrorStatus } from "@/lib/gmail/client";
import { filtrarHilosDemo } from "@/lib/gmail/demo";
import { listarHilos } from "@/lib/gmail/mensajes";
import { abrirSesionBandeja } from "@/lib/gmail/sesion";
import { listarHilosQuerySchema } from "@/lib/gmail/types";

export const runtime = "nodejs";
export const maxDuration = 30;

// === GET /api/bandeja/hilos ===
//
// Listado de hilos del buzón pedido. Sin conexión con Gmail devuelve 200 con
// los hilos demo y `demo: true` — la bandeja siempre tiene algo que mostrar.
export async function GET(req: NextRequest): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const parsed = listarHilosQuerySchema.safeParse({
    buzon: sp.get("buzon") ?? undefined,
    q: sp.get("q") ?? undefined,
    pageToken: sp.get("pageToken") ?? undefined,
    limite: sp.get("limite") ?? undefined,
  });
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: "Query inválida", issues: parsed.error.issues },
      400,
    );
  }
  const { buzon, q, pageToken, limite } = parsed.data;

  const sesion = await abrirSesionBandeja();
  if (sesion.estado === "error") {
    return jsonResponse({ ok: false, error: sesion.error }, sesion.status);
  }

  const respuestaDemo = (): Response =>
    jsonResponse(
      {
        hilos: filtrarHilosDemo(buzon, q).slice(0, limite),
        nextPageToken: null,
        conectado: false,
        demo: true,
      },
      200,
    );

  if (sesion.estado === "demo") return respuestaDemo();

  try {
    const { hilos, nextPageToken } = await listarHilos(sesion.gmail, {
      buzon,
      q,
      pageToken,
      limite,
    });
    return jsonResponse(
      { hilos, nextPageToken, conectado: true, demo: false },
      200,
    );
  } catch (e) {
    const error = gmailErrorMessage(e);
    const status = gmailErrorStatus(e);
    console.error("[GET /api/bandeja/hilos] error:", error);

    // Token revocado del lado de Google mientras Clerk sigue reportando el
    // scope: /api/bandeja/estado ya lo detecta con getProfile y responde
    // demo:true. Si acá devolviéramos 502, el abogado vería el banner
    // "estás viendo datos de ejemplo" y, al lado, un error rojo sin ningún
    // hilo. Degradamos igual que /estado y queda un solo mensaje coherente.
    if (status === 401 || status === 403) return respuestaDemo();

    // 502: el fallo es del upstream (Google), no del request del cliente.
    return jsonResponse(
      {
        ok: false,
        error: "No se pudieron leer los mensajes de Gmail",
        ...(isDev() ? { detail: error } : {}),
      },
      502,
    );
  }
}
