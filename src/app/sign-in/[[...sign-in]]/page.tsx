import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-col items-center gap-8 w-full max-w-md">
        <div className="text-center space-y-1.5">
          <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">
            EstrategiaLegal
          </h1>
          <p className="text-sm text-muted-foreground">
            Análisis estratégico de casos penales
          </p>
        </div>
        <SignIn />
      </div>
    </main>
  );
}
