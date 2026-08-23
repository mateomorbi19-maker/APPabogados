import {
  BarChart3,
  CalendarDays,
  FolderOpen,
  Home,
  Inbox,
  Library,
  Shield,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

// Fuente única de la navegación principal. La consumen la sidebar de
// escritorio (app-sidebar.tsx) y el drawer de móvil (mobile-nav.tsx): si los
// items vivieran duplicados, agregar una sección la dejaría accesible desde
// una sola de las dos.
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  // Cómo se decide si el item está activo según el pathname.
  match: (pathname: string) => boolean;
  // Solo visible para admins.
  adminOnly?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
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
    href: "/dashboard/bandeja",
    label: "Bandeja de entrada",
    icon: Inbox,
    match: (p) => p.startsWith("/dashboard/bandeja"),
  },
  {
    href: "/dashboard/repositorio",
    label: "Repositorio",
    icon: Library,
    match: (p) => p.startsWith("/dashboard/repositorio"),
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

// Los items que le corresponden a un usuario según su rol.
export function itemsVisibles(isAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin);
}

// Label de la sección activa, para el título del header en móvil (donde no hay
// sidebar que muestre dónde está parado el abogado).
export function seccionActiva(pathname: string, isAdmin: boolean): string | null {
  return itemsVisibles(isAdmin).find((i) => i.match(pathname))?.label ?? null;
}
