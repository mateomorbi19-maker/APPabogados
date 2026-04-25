import "server-only";
import { createServerClient } from "@/lib/supabase/server";

export type RateLimitResult =
  | { ok: true; tokens_restantes: number; limite: number; tokens_usados: number }
  | { ok: false; tokens_restantes: number; limite: number; tokens_usados: number };

/**
 * Lee `v_consumo_mensual` para el usuario y devuelve si tiene cupo.
 * Si la query a Supabase falla, throwea (es fallo de infra).
 * Si el usuario no tiene fila (caso anómalo), devuelve ok:false con valores 0.
 */
export async function enforceTokenLimit(
  usuario_id: string,
): Promise<RateLimitResult> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("v_consumo_mensual")
    .select("limite_tokens_mensual, tokens_usados_mes, tokens_restantes")
    .eq("usuario_id", usuario_id)
    .maybeSingle();

  if (error) {
    throw new Error(`v_consumo_mensual error: ${error.message}`);
  }
  if (!data) {
    return { ok: false, tokens_restantes: 0, limite: 0, tokens_usados: 0 };
  }

  const tokens_restantes = Number(data.tokens_restantes ?? 0);
  const limite = Number(data.limite_tokens_mensual ?? 0);
  const tokens_usados = Number(data.tokens_usados_mes ?? 0);

  if (tokens_restantes <= 0) {
    return { ok: false, tokens_restantes, limite, tokens_usados };
  }
  return { ok: true, tokens_restantes, limite, tokens_usados };
}
