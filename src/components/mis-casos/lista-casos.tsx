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

// La lista de causas de la columna izquierda.
//
// Antes cada fila gastaba cuatro renglones —título, expediente, rol·estado y
// fecha, uno debajo del otro— para tres datos cortos, y con las carátulas
// provisorias (que son las primeras líneas del relato, en cursiva) la columna
// se leía como un párrafo cortado, no como una lista.
//
// Ahora: el nombre manda, y todo el resto entra en UNA línea de metadatos
// separada por puntos medios, omitiendo lo que no aporta. El expediente sigue
// primero porque es lo que distingue dos causas del mismo imputado.
export function ListaCasos({ casos, idActivo }: Props) {
  return (
    <div className="py-2">
      <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--el-text-muted)]">
        {casos.length} {casos.length === 1 ? "causa" : "causas"}
      </p>
      <ul className="flex flex-col">
        {casos.map((c) => {
          const activo = c.id === idActivo;
          // Se arma con lo que EXISTE: una lista de metadatos con huecos
          // ("Defensor · · 22-jul") se lee como un error de la app.
          const meta = [
            capitalizar(c.rol),
            c.estado_seguimiento !== "activa"
              ? estadoSeguimientoLabel(c.estado_seguimiento)
              : null,
            c.jurisdiccion,
            fmtRelativo(c.creado_en),
          ].filter(Boolean);

          return (
            <li key={c.id}>
              <Link
                href={`/dashboard/mis-casos/${c.id}`}
                aria-current={activo ? "page" : undefined}
                className={cn(
                  "block border-l-2 px-3 py-2.5 transition-colors",
                  activo
                    ? "border-[var(--el-violet)] bg-[var(--el-violet)]/10"
                    : "border-transparent hover:bg-[var(--el-glass)]",
                )}
              >
                <p
                  className={cn(
                    "line-clamp-2 text-sm leading-snug",
                    activo
                      ? "font-semibold text-[var(--el-text)]"
                      : "font-medium text-[var(--el-text)]",
                    // La carátula provisoria se marca, pero sin cursiva: en una
                    // columna angosta y con dos renglones, la cursiva sobre
                    // texto chico es lo que hacía que la lista pareciera prosa.
                    c.sin_caratula && "text-[var(--el-text-soft)]",
                  )}
                  title={c.sin_caratula ? "Sin carátula cargada" : c.titulo}
                >
                  {c.titulo}
                </p>
                {c.expediente_numero ? (
                  <p className="mt-1 truncate text-xs tabular-nums text-[var(--el-text-soft)]">
                    Exp. {c.expediente_numero}
                  </p>
                ) : null}
                <p className="mt-1 truncate text-xs text-[var(--el-text-muted)]">
                  {meta.join(" · ")}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function capitalizar(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
