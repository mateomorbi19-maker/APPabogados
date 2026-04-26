import { redirect } from "next/navigation";

// Acceso por whitelist + sólo Google OAuth (Decisión 1.7). El sign-up
// público no aplica: las altas se hacen agregando el email a la tabla
// `usuarios` desde el dashboard de Supabase. Server-side redirect a /sign-in
// para que cualquier link entrante (compartido, deep-link de Clerk) caiga
// en el flujo de Google.
export default function SignUpPage(): never {
  redirect("/sign-in");
}
