"use client";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { fmtRelativo } from "@/lib/format";
import { estadoSeguimientoLabel } from "@/lib/casos/ficha";

export type CasoListItem = {
  id: string;
  /** Nombre YA RESUELTO por `nombreCaso()` en la ruta: carátula o título. */
  titulo: string;
  /** `true` si todavía se llama por el título automático del relato. */
  sin_caratula: boolean;
  rol: string;
  fuero: string | null;
  estado_seguimiento: string;
  expediente_numero: string | null;
  organismo: string | null;
  jurisdiccion: string | null;
  creado_en: string;
  ultimo_evento: { descripcion: string; ocurrido_en: string } | null;
  cantidad_eventos: number;
};

type Props = {
  casos: CasoListItem[];
  idActivo: string | null;
};

// Lista de cards verticales en la sidebar (220px). El caso "activo" (el de
// la URL `/dashboard/mis-casos/[id]`) se resalta con borde izquierdo violeta
// y un fondo violeta sutil.
export function ListaCasos({ casos, idActivo }: Props) {
  return (
    <ul className="flex flex-col gap-1.5">
      {casos.map((c) => {
        const activo = c.id === idActivo;
        return (
          <li key={c.id}>
            <Link
              href={`/dashboard/mis-casos/${c.id}`}
              className={cn(
                "block rounded-md p-3 border-l-2 transition-colors",
                activo
                  ? "border-primary bg-primary/10"
                  : "border-transparent hover:bg-muted/60",
              )}
            >
              <p
                className={cn(
                  "text-sm font-medium leading-snug line-clamp-2",
                  c.sin_caratula && "italic text-muted-foreground",
                )}
                title={c.sin_caratula ? "Sin carátula cargada" : undefined}
              >
                {c.titulo}
              </p>
              {/* El expediente va antes que el rol: en una sidebar de 220px es
                  el dato que distingue dos causas del mismo imputado, y el rol
                  ya se repite en casi todas (este estudio es mayormente
                  defensa). */}
              {c.expediente_numero ? (
                <p className="text-xs text-muted-foreground mt-1 tabular-nums break-all">
                  Exp. {c.expediente_numero}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground mt-1">
                {capitalizar(c.rol)}
                {c.estado_seguimiento !== "activa"
                  ? ` · ${estadoSeguimientoLabel(c.estado_seguimiento)}`
                  : ""}
                {c.jurisdiccion ? ` · ${c.jurisdiccion}` : ""}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {fmtRelativo(c.creado_en)}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function capitalizar(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
