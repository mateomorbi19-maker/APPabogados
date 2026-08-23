"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton, useUser } from "@clerk/nextjs";
import { LogOut } from "lucide-react";
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
  const { user } = useUser();
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

      {/* Bloque de perfil */}
      <div className="border-t border-[var(--el-border-soft)] px-3 py-3">
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
