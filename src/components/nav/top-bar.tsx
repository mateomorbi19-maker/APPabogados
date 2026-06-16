"use client";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { ConsumoBar } from "@/components/header/consumo-bar";

// Header reducido full-width: solo logo + medidor de consumo + avatar.
// La navegación migró a la sidebar. El medidor reusa ConsumoBar tal cual
// (requiere <ConsumoProvider> aguas arriba, igual que antes).
export function TopBar() {
  return (
    <header className="sticky top-0 z-20 h-14 border-b border-border bg-background/80 backdrop-blur">
      <div className="flex h-full items-center gap-4 px-4 md:px-6">
        <Link
          href="/"
          className="font-serif text-2xl tracking-tight transition-opacity hover:opacity-80"
        >
          EstrategiaLegal
        </Link>
        <div className="flex-1" />
        <ConsumoBar />
        <UserButton />
      </div>
    </header>
  );
}
