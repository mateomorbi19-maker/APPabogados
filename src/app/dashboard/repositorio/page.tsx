import type { Metadata } from "next";
import { CATALOGO } from "@/lib/repositorio/catalogo";
import { COLECCIONES_VALUES, ORDENES_VALUES } from "@/lib/repositorio/types";
import { FILTROS_VACIOS, type FiltrosRepo } from "@/components/repositorio/api";
import {
  RepositorioView,
  type Vista,
} from "@/components/repositorio/repositorio-view";

export const metadata: Metadata = {
  title: "Repositorio · EstrategiaLegal",
  description: "Jurisprudencia y doctrina penal del estudio.",
};

type SearchParams = Record<string, string | string[] | undefined>;

/** Primer valor no vacío de un param repetible. */
function unico(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() !== "" ? s : null;
}

/**
 * Los filtros se hidratan desde la URL para que un link compartido (o el back
 * del browser desde el lector) abra la misma búsqueda. Se validan igual que en
 * el borde de la API: un `?tribunal=<script>` no tiene que llegar al cliente.
 */
function leerFiltros(sp: SearchParams): FiltrosRepo {
  const coleccion = unico(sp.coleccion);
  const materia = unico(sp.materia);
  const tribunal = unico(sp.tribunal);
  const anio = Number(unico(sp.anio));
  const orden = unico(sp.orden);

  return {
    q: (unico(sp.q) ?? "").slice(0, 120),
    coleccion: COLECCIONES_VALUES.find((c) => c === coleccion) ?? null,
    materia:
      materia !== null && materia.length <= 80 && /^[a-z0-9-]+$/.test(materia)
        ? materia
        : null,
    tribunal:
      tribunal !== null && tribunal.length <= 12 && /^[A-Z]+$/.test(tribunal)
        ? tribunal
        : null,
    // Mismo rango que `filtrosRepositorioSchema.anio`: el catálogo tiene fallos
    // de la CSJN del siglo XIX, así que el piso es 1850 y no 1900.
    anio:
      Number.isInteger(anio) && anio >= 1850 && anio <= 2100 ? anio : null,
    orden: ORDENES_VALUES.find((o) => o === orden) ?? FILTROS_VACIOS.orden,
  };
}

export default async function RepositorioPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // La auth y el shell los resuelve layout.tsx.
  const sp = await searchParams;
  const vista: Vista = unico(sp.vista) === "explorar" ? "explorar" : "buscar";

  return (
    <RepositorioView
      filtrosIniciales={leerFiltros(sp)}
      vistaInicial={vista}
      totalCatalogo={CATALOGO.length}
    />
  );
}
