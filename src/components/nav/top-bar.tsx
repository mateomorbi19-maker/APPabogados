"use client";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { ConsumoBar } from "@/components/header/consumo-bar";
import { AjustesDialog } from "@/components/tema/ajustes-dialog";

// Header reducido full-width: logo + medidor de consumo + ajustes + avatar.
// La navegación migró a la sidebar. El medidor reusa ConsumoBar tal cual
// (requiere <ConsumoProvider> aguas arriba, igual que antes).
export function TopBar() {
  return (
    <header className="sticky top-0 z-20 h-14 border-b border-[var(--el-border-soft)] bg-[var(--el-canvas)]/80 backdrop-blur">
      <div className="flex h-full items-center gap-4 px-4 md:px-6">
        <Link
          href="/"
          className="font-display text-2xl font-semibold transition-opacity hover:opacity-80"
        >
          <span className="text-[var(--el-text)]">Estrategia</span>
          <span className="text-[var(--el-violet-light)]">Legal</span>
        </Link>
        <div className="flex-1" />
        <ConsumoBar />
        <AjustesDialog />
        <UserButton />
      </div>
    </header>
  );
}
