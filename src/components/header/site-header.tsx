"use client";
import { UserButton } from "@clerk/nextjs";
import { ConsumoBar } from "./consumo-bar";

export function SiteHeader({ nombreUsuario }: { nombreUsuario: string }) {
  return (
    <header className="border-b border-border sticky top-0 z-10 bg-background/80 backdrop-blur">
      <div className="container max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
        <span className="font-serif text-2xl tracking-tight">
          EstrategiaLegal
        </span>
        <span className="hidden sm:inline text-sm text-muted-foreground">
          — {nombreUsuario}
        </span>
        <div className="flex-1" />
        <ConsumoBar />
        <UserButton />
      </div>
    </header>
  );
}
