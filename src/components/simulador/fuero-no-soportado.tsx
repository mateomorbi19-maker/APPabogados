"use client";
// Pantalla de bloqueo cuando el caso no es del fuero que cubre el simulador.
// El guion v1 es exclusivamente CPP Buenos Aires (Ley 11.922) con una lista
// cerrada de artículos: correr un caso de Nación o Federal produciría una
// audiencia con el procedimiento equivocado, que es peor que no tenerla.
//
// Espeja el guard de la ruta POST /api/casos/[id]/simulacion, para que el
// abogado se entere ACÁ y no después de un 400.

import Link from "next/link";
import { ArrowLeft, Gavel, Info } from "lucide-react";

const FUERO_LABEL: Record<string, string> = {
  nacion: "Nación (CPPN Ley 23.984)",
  pba: "Prov. Buenos Aires (CPP Ley 11.922)",
  federal: "Federal (CPPF Ley 27.063)",
};

type Props = {
  casoId: string;
  casoTitulo: string;
  fueroCaso: string | null;
};

export function FueroNoSoportado({ casoId, casoTitulo, fueroCaso }: Props) {
  const sinFuero = fueroCaso === null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border bg-card/50 backdrop-blur">
        <div className="flex items-center gap-2 px-4 py-2 md:px-6">
          <Link
            href={`/dashboard/mis-casos/${casoId}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">Volver al caso</span>
          </Link>
          <span className="text-muted-foreground shrink-0">·</span>
          <span className="text-sm font-medium truncate" title={casoTitulo}>
            {casoTitulo}
          </span>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-xl px-4 py-12 md:px-6">
          <div className="rounded-md border border-border bg-card px-5 py-6 space-y-4">
            <div className="flex items-start gap-3">
              <Gavel className="size-5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <h1 className="text-base font-medium">
                  {sinFuero
                    ? "Falta definir el fuero del caso"
                    : "El simulador todavía no cubre este fuero"}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {sinFuero ? (
                    <>
                      El simulador necesita saber qué código procesal se aplica
                      para conducir la audiencia. El fuero se define al
                      inicializar el mapa procesal del caso.
                    </>
                  ) : (
                    <>
                      Este caso tramita en{" "}
                      <span className="text-foreground font-medium">
                        {FUERO_LABEL[fueroCaso] ?? fueroCaso}
                      </span>
                      . La audiencia de prisión preventiva del simulador está
                      escrita sobre el{" "}
                      <span className="text-foreground font-medium">
                        CPP de Buenos Aires (Ley 11.922)
                      </span>
                      .
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5 flex items-start gap-2">
              <Info className="size-4 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                Simular con el código procesal equivocado produciría una
                audiencia con institutos y artículos que no corresponden a la
                causa. Por eso está bloqueado en vez de degradado.
              </p>
            </div>

            <div className="pt-1">
              <Link
                href={
                  sinFuero
                    ? `/dashboard/mapa-procesal/${casoId}`
                    : `/dashboard/mis-casos/${casoId}`
                }
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline underline-offset-4"
              >
                {sinFuero ? "Ir al mapa procesal a definirlo" : "Volver al caso"}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
