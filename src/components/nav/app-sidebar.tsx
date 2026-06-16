"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton, useUser } from "@clerk/nextjs";
import {
  BarChart3,
  CalendarDays,
  FolderOpen,
  Home,
  LogOut,
  Shield,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  // Cómo se decide si el item está activo según el pathname.
  match: (pathname: string) => boolean;
  // Solo visible para admins.
  adminOnly?: boolean;
};

const ITEMS: NavItem[] = [
  { href: "/", label: "Inicio", icon: Home, match: (p) => p === "/" },
  {
    href: "/analisis",
    label: "Nuevo análisis",
    icon: Sparkles,
    match: (p) => p === "/analisis" || p.startsWith("/analisis/"),
  },
  {
    href: "/dashboard/mis-casos",
    label: "Mis casos",
    icon: FolderOpen,
    match: (p) => p.startsWith("/dashboard/mis-casos"),
  },
  {
    href: "/dashboard/agenda",
    label: "Agenda",
    icon: CalendarDays,
    match: (p) => p.startsWith("/dashboard/agenda"),
  },
  {
    href: "/consumo",
    label: "Mi consumo",
    icon: BarChart3,
    match: (p) => p === "/consumo" || p.startsWith("/consumo/"),
  },
  {
    href: "/admin",
    label: "Admin",
    icon: Shield,
    match: (p) => p.startsWith("/admin"),
    adminOnly: true,
  },
];

export function AppSidebar({
  nombreUsuario,
  isAdmin,
}: {
  nombreUsuario: string;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const { user } = useUser();
  const items = ITEMS.filter((i) => !i.adminOnly || isAdmin);

  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col border-r border-border bg-card/40 md:flex">
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => {
          const activo = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm transition-colors",
                activo
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-[18px] shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bloque de perfil */}
      <div className="border-t border-border px-3 py-3">
        <div className="flex items-center gap-3 px-1">
          {user?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.imageUrl}
              alt=""
              className="size-8 shrink-0 rounded-full"
            />
          ) : (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-sm font-medium text-primary">
              {nombreUsuario.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {nombreUsuario}
          </span>
        </div>
        <SignOutButton>
          <button
            type="button"
            className="mt-2 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-[18px] shrink-0" />
            Salir
          </button>
        </SignOutButton>
      </div>
    </aside>
  );
}
