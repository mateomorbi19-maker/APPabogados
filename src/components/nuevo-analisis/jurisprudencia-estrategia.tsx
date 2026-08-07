"use client";
import Link from "next/link";
import { BookOpen, Gavel, Scale, SquareArrowOutUpRight } from "lucide-react";
import type { CitaRepositorio } from "@/lib/schemas";

// Bloque "Jurisprudencia y doctrina de respaldo" dentro de una estrategia.
//
// Lo que lo distingue de `fundamento_legal` es el link: cada cita lleva al
// documento real en el Repositorio del estudio. Esa es toda la garantía
// antialucinación que le podemos dar al abogado — puede abrir el fallo y
// verificar en un click que dice lo que el agente afirma que dice.
//
// Cuando el array viene vacío pero hay `nota`, se muestra la nota: "se buscó y
// no había" es información valiosa para el abogado, no un hueco a esconder.

export function JurisprudenciaEstrategia({
  citas,
  nota,
}: {
  citas: CitaRepositorio[];
  nota: string;
}) {
  if (citas.length === 0 && nota.trim().length === 0) return null;

  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        <Scale className="size-3.5" />
        Jurisprudencia y doctrina de respaldo
      </p>

      {citas.length === 0 ? (
        <p className="rounded border border-dashed border-border px-3 py-2 text-sm leading-relaxed text-muted-foreground">
          {nota}
        </p>
      ) : (
        <ul className="space-y-2">
          {citas.map((c, i) => {
            const Icono = c.tipo === "doctrina" ? BookOpen : Gavel;
            return (
              <li
                key={`${c.documento_id}-${i}`}
                className="rounded border border-border/70 bg-muted/30 px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <Icono className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium leading-snug">
                      {c.documento_id ? (
                        <Link
                          href={`/dashboard/repositorio/${c.documento_id}`}
                          className="inline-flex items-baseline gap-1 hover:text-primary hover:underline"
                          // El repositorio es una vista de lectura larga: se
                          // abre aparte para no perder el análisis.
                          target="_blank"
                        >
                          {c.cita}
                          <SquareArrowOutUpRight className="size-3 shrink-0 self-center opacity-60" />
                        </Link>
                      ) : (
                        c.cita
                      )}
                    </p>
                    {c.holding ? (
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {c.holding}
                      </p>
                    ) : null}
                    {c.aporte ? (
                      <p className="border-l-2 border-primary/40 pl-2 text-sm leading-relaxed">
                        {c.aporte}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
