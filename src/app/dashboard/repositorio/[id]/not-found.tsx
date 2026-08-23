import Link from "next/link";
import { FileSearch } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 404 dentro del shell de la sección: el abogado sigue viendo la navegación en
// vez de caer al not-found global de la app.
export default function DocumentoNoEncontrado() {
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-3 text-center max-md:px-2">
      <FileSearch className="size-9 text-[var(--el-text-muted)]" aria-hidden />
      <h1 className="font-display text-lg font-semibold text-[var(--el-text)]">
        Ese documento no está en el repositorio
      </h1>
      <p className="max-w-sm text-sm leading-relaxed text-[var(--el-text-soft)]">
        Puede que el link esté viejo o que el archivo haya cambiado de nombre en
        la carpeta de Drive del estudio.
      </p>
      <Link
        href="/dashboard/repositorio"
        className={cn(buttonVariants({ variant: "outline" }))}
      >
        Volver al repositorio
      </Link>
    </div>
  );
}
