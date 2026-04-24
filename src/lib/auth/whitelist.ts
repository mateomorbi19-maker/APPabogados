import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { createServerClient } from "@/lib/supabase/server";

export type WhitelistResult =
  | {
      ok: true;
      usuario_id: string;
      nombre: string;
      clerk_user_id: string;
      email: string;
    }
  | {
      ok: false;
      status: 401 | 403;
      message: string;
    };

/**
 * Valida la sesión de Clerk contra la whitelist en Supabase `usuarios`.
 * Nunca toca `nombre` ni `email`; sólo completa `clerk_user_id` si está NULL,
 * con guard `.is('clerk_user_id', null)` para evitar pisar una escritura concurrente.
 */
export async function requireUsuarioOr403(): Promise<WhitelistResult> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, status: 401, message: "No autenticado" };
  }

  const user = await currentUser();
  const clerkEmail = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (!clerkEmail) {
    return { ok: false, status: 401, message: "Sesión sin email primario" };
  }

  const supabase = createServerClient();

  const { data: match, error } = await supabase
    .from("usuarios")
    .select("id, nombre, email, clerk_user_id")
    .eq("email", clerkEmail)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase error al buscar usuario: ${error.message}`);
  }
  if (!match) {
    return {
      ok: false,
      status: 403,
      message: "Email no está en la whitelist",
    };
  }

  if (match.clerk_user_id === null) {
    const { error: updateError } = await supabase
      .from("usuarios")
      .update({ clerk_user_id: userId })
      .eq("id", match.id)
      .is("clerk_user_id", null);
    if (updateError) {
      throw new Error(
        `Supabase error al setear clerk_user_id: ${updateError.message}`,
      );
    }
  } else if (match.clerk_user_id !== userId) {
    return {
      ok: false,
      status: 403,
      message: "Email reclamado por otro usuario de Clerk",
    };
  }

  return {
    ok: true,
    usuario_id: match.id,
    nombre: match.nombre,
    clerk_user_id: userId,
    email: match.email,
  };
}
