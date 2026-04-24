import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";

export default async function Home() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const user = await currentUser();
  const nombre =
    user?.firstName ?? user?.primaryEmailAddress?.emailAddress ?? "invitado";

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <h1
        className="text-5xl sm:text-6xl tracking-tight text-primary"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        EstrategiaLegal
      </h1>
      <p className="mt-6 max-w-md text-base text-muted-foreground">
        Bienvenido, {nombre}.
      </p>
      <p className="mt-2 max-w-md text-sm text-muted-foreground/70">
        Fase 2 en progreso — la app completa llega en Fase 4.
      </p>
    </main>
  );
}
