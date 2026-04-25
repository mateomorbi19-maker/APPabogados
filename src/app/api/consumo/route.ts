import { requireUsuarioOr403 } from "@/lib/auth/whitelist";
import { createServerClient } from "@/lib/supabase/server";
import { jsonResponse, isDev } from "@/lib/http";

type EjecucionRow = {
  id: string;
  tipo: string;
  modelo: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  costo_usd: number;
  ejecutado_en: string;
};

function startOfMonthUTC(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  ).toISOString();
}

export async function GET(): Promise<Response> {
  const wl = await requireUsuarioOr403();
  if (!wl.ok) {
    return jsonResponse({ ok: false, error: wl.message }, wl.status);
  }

  const supabase = createServerClient();
  const startIso = startOfMonthUTC();

  const [consumoRes, historialRes] = await Promise.all([
    supabase
      .from("v_consumo_mensual")
      .select(
        "nombre, limite_tokens_mensual, tokens_usados_mes, gasto_usd_mes, ejecuciones_mes, tokens_restantes",
      )
      .eq("usuario_id", wl.usuario_id)
      .maybeSingle(),
    supabase
      .from("ejecuciones")
      .select(
        "id, tipo, modelo, input_tokens, output_tokens, total_tokens, costo_usd, ejecutado_en",
      )
      .eq("usuario_id", wl.usuario_id)
      .gte("ejecutado_en", startIso)
      .order("ejecutado_en", { ascending: false })
      .limit(20),
  ]);

  if (consumoRes.error) {
    console.error("[/api/consumo] v_consumo_mensual error:", consumoRes.error);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando consumo",
        ...(isDev() ? { detail: consumoRes.error.message } : {}),
      },
      500,
    );
  }
  if (historialRes.error) {
    console.error("[/api/consumo] ejecuciones error:", historialRes.error);
    return jsonResponse(
      {
        ok: false,
        error: "Error consultando historial",
        ...(isDev() ? { detail: historialRes.error.message } : {}),
      },
      500,
    );
  }

  const historial = (historialRes.data ?? []) as EjecucionRow[];

  if (consumoRes.data === null) {
    // Fallback graceful: usuario válido (pasó whitelist) pero sin fila en la vista.
    // Caso esperado para usuarios sin ejecuciones todavía este mes si el join es INNER;
    // con LEFT JOIN actual no debería pasar, pero se mantiene defensivo.
    const { data: userData, error: userErr } = await supabase
      .from("usuarios")
      .select("nombre, limite_tokens_mensual")
      .eq("id", wl.usuario_id)
      .single();

    if (userErr || !userData) {
      console.error("[/api/consumo] usuario en whitelist pero no en tabla", {
        usuario_id: wl.usuario_id,
        error: userErr,
      });
      return jsonResponse(
        {
          ok: false,
          error: "Error consultando consumo",
          ...(isDev() && userErr ? { detail: userErr.message } : {}),
        },
        500,
      );
    }

    return jsonResponse(
      {
        consumo: {
          nombre: userData.nombre,
          tokens_usados_mes: 0,
          gasto_usd_mes: 0,
          ejecuciones_mes: 0,
          tokens_restantes: userData.limite_tokens_mensual,
          limite_tokens_mensual: userData.limite_tokens_mensual,
        },
        historial: [],
      },
      200,
    );
  }

  const c = consumoRes.data;
  return jsonResponse(
    {
      consumo: {
        nombre: c.nombre,
        tokens_usados_mes: Number(c.tokens_usados_mes ?? 0),
        gasto_usd_mes: Number(c.gasto_usd_mes ?? 0),
        ejecuciones_mes: Number(c.ejecuciones_mes ?? 0),
        tokens_restantes: Number(c.tokens_restantes ?? 0),
        limite_tokens_mensual: Number(c.limite_tokens_mensual ?? 0),
      },
      historial,
    },
    200,
  );
}
