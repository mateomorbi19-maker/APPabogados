import { SignOutButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";

export default async function ForbiddenPage() {
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-4xl mb-4">Acceso no autorizado</h1>
        <p className="text-muted-foreground mb-2">
          {email
            ? `Tu cuenta (${email}) no está habilitada para usar EstrategiaLegal.`
            : "Tu cuenta no está habilitada para usar EstrategiaLegal."}
        </p>
        <p className="text-sm text-muted-foreground/70 mb-6">
          Si esto es un error, contactá al administrador.
        </p>
        <SignOutButton redirectUrl="/sign-in">
          <button className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 transition">
            Cerrar sesión
          </button>
        </SignOutButton>
      </div>
    </main>
  );
}
