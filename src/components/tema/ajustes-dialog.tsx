"use client";
import { useState } from "react";
import { Check, Monitor, Moon, Settings } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TEMA_META, TEMAS, type Tema } from "./tema";
import { useTema } from "./tema-provider";

// Engranaje de la top bar → diálogo de Ajustes.
//
// Hoy tiene una sola sección (Apariencia) y está bien que se note: el diálogo
// es el lugar donde van a vivir las preferencias que vengan después, así que se
// arma con secciones desde el principio en vez de ser un menú de tema que
// después haya que convertir en otra cosa.

const ICONO: Record<Tema, typeof Moon> = {
  oscuro: Moon,
  sistema: Monitor,
};

export function AjustesDialog() {
  const [abierto, setAbierto] = useState(false);
  const { tema, setTema } = useTema();

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label="Ajustes"
        title="Ajustes"
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-[var(--el-text-soft)] transition-colors hover:bg-[var(--el-surface-card)] hover:text-[var(--el-text)]"
      >
        <Settings className="size-[18px]" />
      </button>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Ajustes</DialogTitle>
          </DialogHeader>

          <section className="space-y-3">
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Apariencia
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                El Mapa procesal y el Simulador de audiencias se ven siempre en
                oscuro: su diseño está hecho sobre fondo negro.
              </p>
            </div>

            <div
              role="radiogroup"
              aria-label="Tema de la aplicación"
              className="space-y-2"
            >
              {TEMAS.map((t) => {
                const Icono = ICONO[t];
                const activo = tema === t;
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={activo}
                    onClick={() => setTema(t)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      activo
                        ? "border-primary/60 bg-primary/10"
                        : "border-border hover:bg-muted/60",
                    )}
                  >
                    <Icono
                      className={cn(
                        "mt-0.5 size-[18px] shrink-0",
                        activo ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {TEMA_META[t].label}
                      </span>
                      <span className="block text-xs leading-relaxed text-muted-foreground">
                        {TEMA_META[t].descripcion}
                      </span>
                    </span>
                    {activo ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        </DialogContent>
      </Dialog>
    </>
  );
}
