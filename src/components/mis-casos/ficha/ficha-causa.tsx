"use client";
// La ficha de causa: la identidad del expediente.
//
// Dos decisiones de forma que vienen del mockup y NO se copiaron tal cual:
//
//   - Grilla de 2 columnas, no de 4. El mockup corre a ancho completo; esta
//     pantalla vive dentro de una columna de ~740px (max-w-6xl menos la
//     sidebar de 220px). A 4 columnas, "Juzgado Federal Criminal Nº 3" entra
//     en cuatro renglones.
//   - El campo vacío se MUESTRA, con un botón "Cargar" que abre el formulario
//     enfocado ahí. Esconder los campos sin dato haría que la ficha parezca
//     completa cuando está a medias, y que nadie descubra que puede cargarlos.
//     Es la misma regla que ya rige para la jurisprudencia: si falta, se
//     declara; no se rellena con algo verosímil.

import { useState } from "react";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { fmtFecha } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { FUERO_LABEL } from "@/lib/mapa-procesal/types";
import type { Fuero } from "@/lib/mapa-procesal/types";
import type { Caso } from "@/lib/types";
import { FichaForm, type CampoFicha } from "./ficha-form";

type Props = {
  caso: Caso;
  /** Etapa procesal derivada del mapa. `null` = mapa sin inicializar o sin nodos ocurridos. */
  etapa: { label: string; nodoTitulo: string } | null;
  /** Fecha del último movimiento del expediente (ISO), no `actualizado_en`. */
  ultimaActuacion: string | null;
  /** `true` si el caso ya tiene nodos de mapa: congela el fuero. */
  mapaInicializado: boolean;
  onCasoChange: (caso: Caso) => void;
};

export function FichaCausa({
  caso,
  etapa,
  ultimaActuacion,
  mapaInicializado,
  onCasoChange,
}: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [campoInicial, setCampoInicial] = useState<CampoFicha | undefined>();

  const abrir = (campo?: CampoFicha) => {
    setCampoInicial(campo);
    setFormOpen(true);
  };

  const campos: {
    campo: CampoFicha;
    label: string;
    valor: string | null;
    ancho?: boolean;
  }[] = [
    {
      campo: "expediente_numero",
      label: "Nº de expediente",
      valor: caso.expediente_numero,
    },
    {
      campo: "fuero",
      label: "Fuero",
      valor: caso.fuero ? FUERO_LABEL[caso.fuero as Fuero] : null,
    },
    {
      campo: "organismo",
      label: "Juzgado / Tribunal",
      valor: caso.organismo,
      ancho: true,
    },
    { campo: "secretaria", label: "Secretaría", valor: caso.secretaria },
    { campo: "juez", label: "Juez", valor: caso.juez },
    {
      campo: "fiscalia",
      label: "Fiscalía",
      valor: caso.fiscalia,
      ancho: true,
    },
  ];

  const faltantes = campos.filter((c) => !c.valor).length;

  return (
    <section
      className="rounded-xl border border-[var(--el-border)] bg-[var(--el-surface-card)] shadow-[var(--el-shadow-card)]"
      aria-labelledby="ficha-titulo"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2
            id="ficha-titulo"
            className="text-sm font-medium text-[var(--el-text)]"
          >
            Ficha de la causa
          </h2>
          {/* El contador de faltantes va acá y no como badge en cada campo:
              uno solo dice cuánto trabajo queda, seis dicen que algo anda mal. */}
          <p className="mt-0.5 text-xs text-[var(--el-text-muted)]">
            {faltantes === 0
              ? "Completa"
              : `${faltantes} ${faltantes === 1 ? "dato" : "datos"} sin cargar`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => abrir()}
          className="shrink-0"
        >
          <Pencil className="size-4" />
          Editar ficha
        </Button>
      </header>

      <dl className="grid grid-cols-1 border-t border-[var(--el-border)] sm:grid-cols-2">
        {campos.map((c, i) => {
          // En qué columna cae realmente esta celda. NO alcanza la paridad del
          // índice: los campos `ancho` ocupan DOS celdas, así que cada uno
          // corre la paridad de todo lo que viene después y el borde derecho
          // terminaba pintado en la columna equivocada.
          const columna =
            campos.slice(0, i).reduce((n, x) => n + (x.ancho ? 2 : 1), 0) % 2;
          return (
          <div
            key={c.campo}
            className={cn(
              "min-w-0 border-b border-[var(--el-border)] px-4 py-3 sm:px-5",
              c.ancho && "sm:col-span-2",
              // El borde derecho solo en la columna izquierda de la grilla de
              // 2, y nunca en las filas que ocupan el ancho completo.
              !c.ancho && columna === 0 && "sm:border-r",
            )}
          >
            <dt className="text-[11px] uppercase tracking-wide text-[var(--el-text-muted)]">
              {c.label}
            </dt>
            <dd className="mt-0.5 text-sm text-[var(--el-text)]">
              {c.valor ? (
                <span className="break-words">{c.valor}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => abrir(c.campo)}
                  className="rounded text-sm text-[var(--el-text-muted)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--el-violet-light)]"
                >
                  Cargar
                </button>
              )}
            </dd>
          </div>
          );
        })}

        {/* Delitos: chips, porque una causa real casi nunca tiene uno solo. */}
        <div className="min-w-0 border-b border-[var(--el-border)] px-4 py-3 sm:col-span-2 sm:px-5">
          <dt className="text-[11px] uppercase tracking-wide text-[var(--el-text-muted)]">
            Delitos
          </dt>
          <dd className="mt-1 text-sm text-[var(--el-text)]">
            {caso.delitos && caso.delitos.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {caso.delitos.map((d) => (
                  <li
                    key={d}
                    className="rounded-md border border-[var(--el-border)] bg-[var(--el-glass)] px-2 py-0.5 text-xs break-words"
                  >
                    {d}
                  </li>
                ))}
              </ul>
            ) : (
              <button
                type="button"
                onClick={() => abrir("delitos")}
                className="rounded text-sm text-[var(--el-text-muted)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--el-violet-light)]"
              >
                Cargar
              </button>
            )}
          </dd>
        </div>

        {/* Etapa procesal: DERIVADA del mapa, no editable. Si fuera un campo
            más de la ficha se contradiría con el mapa el primer día. */}
        <div className="min-w-0 px-4 py-3 sm:border-r sm:border-[var(--el-border)] sm:px-5">
          <dt className="text-[11px] uppercase tracking-wide text-[var(--el-text-muted)]">
            Etapa procesal
          </dt>
          <dd className="mt-0.5 text-sm text-[var(--el-text)]">
            {etapa ? (
              <span title={`Según el mapa: ${etapa.nodoTitulo}`}>
                {etapa.label}
              </span>
            ) : (
              <Link
                href={`/dashboard/mapa-procesal/${caso.id}`}
                className="text-sm text-[var(--el-text-muted)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--el-violet-light)]"
              >
                Sin mapa · Iniciar
              </Link>
            )}
          </dd>
        </div>

        {/* Última ACTUACIÓN, no `actualizado_en`: esa columna la pisa un
            trigger en cada UPDATE, así que corregir una coma en la ficha diría
            "actualizado hoy" con el expediente quieto hace tres meses. */}
        <div className="min-w-0 px-4 py-3 sm:px-5">
          <dt className="text-[11px] uppercase tracking-wide text-[var(--el-text-muted)]">
            Última actuación
          </dt>
          <dd className="mt-0.5 text-sm text-[var(--el-text)]">
            {ultimaActuacion ? (
              fmtFecha(ultimaActuacion)
            ) : (
              <span className="text-[var(--el-text-muted)]">
                Sin movimientos cargados
              </span>
            )}
          </dd>
        </div>
      </dl>

      <FichaForm
        open={formOpen}
        caso={caso}
        campoInicial={campoInicial}
        mapaInicializado={mapaInicializado}
        onClose={() => setFormOpen(false)}
        onSaved={onCasoChange}
      />
    </section>
  );
}
