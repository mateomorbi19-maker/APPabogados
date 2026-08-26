"use client";
// La ficha de causa: la identidad del expediente.
//
// Dos decisiones de forma que se conservan del diseño original:
//
//   - El campo vacío se MUESTRA, con un botón "Cargar" que abre el formulario
//     enfocado ahí. Esconder los campos sin dato haría que la ficha parezca
//     completa cuando está a medias, y que nadie descubra que puede cargarlos.
//     Es la misma regla que rige para la jurisprudencia: si falta, se declara;
//     no se rellena con algo verosímil.
//   - La etapa procesal NO es un campo editable: la deriva el mapa.
//
// Lo que SÍ cambió (ago 2026): la grilla era de 2 columnas con divisores y una
// celda por fila, y gastaba ~450px de alto para ocho datos de los cuales cinco
// suelen estar vacíos diciendo "Cargar". Ahora es una grilla densa de hasta 3
// columnas SIN divisores internos, separada por aire en vez de por líneas.
// Mismo contenido, la mitad del alto, y de paso se va el cálculo de paridad que
// decidía en qué celda pintar el borde derecho (y que se desincronizaba con
// cada campo que ocupaba dos columnas).

import { useState } from "react";
import { Pencil } from "lucide-react";
import Link from "next/link";
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

  const campos: { campo: CampoFicha; label: string; valor: string | null }[] = [
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
    { campo: "organismo", label: "Juzgado / Tribunal", valor: caso.organismo },
    { campo: "secretaria", label: "Secretaría", valor: caso.secretaria },
    { campo: "juez", label: "Juez", valor: caso.juez },
    { campo: "fiscalia", label: "Fiscalía", valor: caso.fiscalia },
  ];

  const faltantes = campos.filter((c) => !c.valor).length;

  return (
    <section
      className="rounded-xl border border-[var(--el-border)] bg-[var(--el-surface-card)] shadow-[var(--el-shadow-card)]"
      aria-labelledby="ficha-titulo"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2
            id="ficha-titulo"
            className="text-sm font-medium text-[var(--el-text)]"
          >
            Ficha de la causa
          </h2>
          {/* El contador de faltantes va acá y no como badge en cada campo:
              uno solo dice cuánto trabajo queda, seis dicen que algo anda mal. */}
          <p className="text-xs text-[var(--el-text-muted)]">
            {faltantes === 0 ? "· Completa" : `· ${faltantes} sin cargar`}
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

      <div className="border-t border-[var(--el-border)] px-4 py-4 sm:px-5">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {campos.map((c) => (
            <div key={c.campo} className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-[var(--el-text-muted)]">
                {c.label}
              </dt>
              <dd className="mt-1 text-sm text-[var(--el-text)]">
                {c.valor ? (
                  <span className="break-words">{c.valor}</span>
                ) : (
                  <BotonCargar onClick={() => abrir(c.campo)} />
                )}
              </dd>
            </div>
          ))}

          {/* Delitos: chips, porque una causa real casi nunca tiene uno solo.
              A ancho completo para que no se corten en una columna. */}
          <div className="min-w-0 sm:col-span-2 lg:col-span-3">
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
                <BotonCargar onClick={() => abrir("delitos")} />
              )}
            </dd>
          </div>
        </dl>
      </div>

      {/* Los dos DERIVADOS, separados del resto: ninguno se edita acá. La etapa
          sale del mapa y la última actuación del timeline; mezclarlos con los
          campos cargables invitaba a buscarles un "Cargar" que no existe. */}
      <dl className="flex flex-wrap gap-x-8 gap-y-2 border-t border-[var(--el-border)] px-4 py-3 sm:px-5">
        <div className="min-w-0">
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
        <div className="min-w-0">
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

function BotonCargar({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded text-sm text-[var(--el-text-muted)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--el-violet-light)]"
    >
      Cargar
    </button>
  );
}
