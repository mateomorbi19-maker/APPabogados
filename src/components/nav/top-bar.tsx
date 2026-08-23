"use client";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { ConsumoBar } from "@/components/header/consumo-bar";
import { AjustesDialog } from "@/components/tema/ajustes-dialog";
import { MobileNav } from "./mobile-nav";

// Header reducido full-width: logo + medidor de consumo + ajustes + avatar.
// La navegación migró a la sidebar. El medidor reusa ConsumoBar tal cual
// (requiere <ConsumoProvider> aguas arriba, igual que antes).
//
// En móvil la sidebar no existe, así que el header suma la hamburguesa que
// abre el drawer y necesita saber quién es el usuario para armarlo.
export function TopBar({
  nombreUsuario,
  isAdmin,
}: {
  nombreUsuario: string;
  isAdmin: boolean;
}) {
  return (
    <header
      className="sticky top-0 z-20 border-b border-[var(--el-border-soft)] bg-[var(--el-canvas)]/80 backdrop-blur"
      // El header es sticky arriba de todo: en un iPhone en modo standalone
      // (PWA) sin este padding queda debajo de la isla dinámica / notch.
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex h-14 items-center gap-2 px-3 sm:gap-4 sm:px-4 md:px-6">
        <MobileNav nombreUsuario={nombreUsuario} isAdmin={isAdmin} />
        <Link
          href="/"
          // text-lg en móvil: a text-2xl el wordmark solo se come ~180px de
          // los 360 de un Android chico y empuja al avatar fuera de pantalla.
          className="min-w-0 truncate font-display text-lg font-semibold transition-opacity hover:opacity-80 sm:text-2xl"
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
