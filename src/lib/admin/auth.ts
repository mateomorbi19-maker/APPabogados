import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { createServerClient } from "@/lib/supabase/server";

// Resultado discriminado: el caller del helper distingue OK de "no admin".
// `ok: false` no lleva detalle: por contrato la respuesta a no-admin es 404
// (ni siquiera revelamos que la ruta existe), así que no necesitamos message.
export type AdminResult =
  | {
      ok: true;
      usuario_id: string;
      nombre: string;
      email: string;
      clerk_user_id: string;
    }
  | { ok: false };

/**
 * Verifica que la sesión de Clerk corresponda a un `usuarios.role = 'admin'`
 * en Supabase. Pensado para envolver pages (con `notFound()`) y route
 * handlers (con response 404).
 *
 * NO usa RLS — ese flag sigue desactivado en `usuarios`. La protección es
 * 100% server-side: cliente Supabase con `service_role`, lookup por email.
 */
export async function requireAdminOr404(): Promise<AdminResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false };

  const user = await currentUser();
  const clerkEmail = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (!clerkEmail) return { ok: false };

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("usuarios")
    .select("id, nombre, email, clerk_user_id, role")
    .eq("email", clerkEmail)
    .maybeSingle();

  if (error) {
    // Si la query falla, devolvemos 404 igual: no queremos filtrar info al
    // borde admin. El error queda en logs server-side.
    console.error("[requireAdminOr404] supabase error:", error);
    return { ok: false };
  }
  if (!data) return { ok: false };
  if (data.role !== "admin") return { ok: false };

  return {
    ok: true,
    usuario_id: data.id,
    nombre: data.nombre,
    email: data.email,
    clerk_user_id: data.clerk_user_id,
  };
}
