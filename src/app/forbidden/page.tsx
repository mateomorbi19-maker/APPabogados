import { SignOutButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { Button } from "@/components/ui/button";

export default async function ForbiddenPage() {
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="flex flex-col items-center gap-8 w-full max-w-md text-center">
        <div className="space-y-3">
          <h1 className="font-serif text-4xl tracking-tight">
            Acceso no autorizado
          </h1>
          <p className="text-sm text-muted-foreground">
            {email
              ? `Tu cuenta (${email}) no está habilitada para usar EstrategiaLegal.`
              : "Tu cuenta no está habilitada para usar EstrategiaLegal."}
          </p>
          <p className="text-xs text-muted-foreground/70">
            Si esto es un error, contactá al administrador.
          </p>
        </div>
        <SignOutButton redirectUrl="/sign-in">
          <Button>Cerrar sesión</Button>
        </SignOutButton>
      </div>
    </main>
  );
}
