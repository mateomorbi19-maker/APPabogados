"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuCuenta } from "@/components/cuenta/menu-cuenta";
import { itemsVisibles } from "./nav-items";
import { cn } from "@/lib/utils";

export function AppSidebar({
  nombreUsuario,
  isAdmin,
}: {
  nombreUsuario: string;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const items = itemsVisibles(isAdmin);

  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col border-r border-[var(--el-border)] bg-[var(--el-surface-side)] md:flex">
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => {
          const activo = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-[9px] px-3 py-2 text-sm transition-colors",
                activo
                  ? "bg-[rgba(139,92,246,0.22)] font-medium text-violet-800 dark:text-[#CDBEFF]"
                  : "text-[var(--el-text-soft)] hover:bg-black/5 dark:hover:bg-white/5 hover:text-[var(--el-text)]",
              )}
            >
              <Icon
                className={cn(
                  "size-[18px] shrink-0",
                  !activo && "text-[var(--el-text-muted)]",
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Menú de cuenta: foto y nombre; se despliega hacia arriba. */}
      <div className="border-t border-[var(--el-border-soft)] p-2">
        <MenuCuenta nombreUsuario={nombreUsuario} />
      </div>
    </aside>
  );
}
