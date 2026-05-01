"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { ConsumoBar } from "./consumo-bar";

export function SiteHeader({ nombreUsuario }: { nombreUsuario: string }) {
  const pathname = usePathname();
  const enHome = pathname === "/";
  const enMisCasos = pathname.startsWith("/dashboard/mis-casos");

  return (
    <header className="border-b border-border sticky top-0 z-10 bg-background/80 backdrop-blur">
      <div className="container max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
        <Link
          href="/"
          className="font-serif text-2xl tracking-tight hover:opacity-80 transition-opacity"
        >
          EstrategiaLegal
        </Link>
        <span className="hidden sm:inline text-sm text-muted-foreground">
          — {nombreUsuario}
        </span>

        <nav className="hidden sm:flex items-center gap-1 ml-2">
          <Link
            href="/"
            className={cn(
              "px-3 py-1.5 text-sm rounded-md transition-colors",
              enHome
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            Análisis
          </Link>
          <Link
            href="/dashboard/mis-casos"
            className={cn(
              "px-3 py-1.5 text-sm rounded-md transition-colors",
              enMisCasos
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            Mis casos
          </Link>
        </nav>

        <div className="flex-1" />
        <ConsumoBar />
        <UserButton />
      </div>
    </header>
  );
}
