"use client";
// Vista principal del Repositorio: la biblioteca jurídica del estudio.
//
// Dos entradas deliberadas: "Buscar" para el que llega con algo en la cabeza y
// "Explorar" para el que no sabe qué pedir. El estado de filtros vive acá y se
// refleja en la URL con history.replaceState (sin re-render del server): así el
// link es compartible y volver del lector no pierde la búsqueda.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Compass, LibraryBig, Loader2, Search, SearchX, SlidersHorizontal,
  TriangleAlert, X, type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtNumber } from "@/lib/format";
import {
  COLECCIONES, COLECCIONES_VALUES, ORDENES, ORDENES_VALUES,
  type Coleccion, type DocumentoRepositorio, type Facetas,
} from "@/lib/repositorio/types";
import { tokenizar } from "@/lib/repositorio/texto";
import {
  FILTROS_VACIOS, hayFiltros, pedirDocumentos, pedirEstado,
  queryFiltros, type EstadoRepositorio, type FiltrosRepo,
} from "./api";
import { BannerDrive } from "./aviso-drive";
import { ChipsFiltros } from "./chips-filtros";
import { DocumentoCard } from "./documento-card";
import { EsqueletoCards } from "./esqueletos";
import { ExplorarMaterias } from "./explorar-materias";
import { ICONO_COLECCION } from "./iconos";
import { PanelFiltros } from "./panel-filtros";

export type Vista = "buscar" | "explorar";

type Props = {
  filtrosIniciales: FiltrosRepo;
  vistaInicial: Vista;
  /** Tamaño del catálogo completo. Viene del server: no espera al primer fetch. */
  totalCatalogo: number;
};

/** Respuesta en pantalla, etiquetada con la búsqueda que la produjo. */
type Resultado = {
  clave: string;
  documentos: DocumentoRepositorio[];
  total: number;
  facetas: Facetas;
  pagina: number;
};

// Búsquedas de arranque para el empty state. Todas matchean materias reales del
// catálogo: nunca mandan al abogado a otro cero resultados.
const SUGERENCIAS = [
  "prisión preventiva",
  "penal económico",
  "legítima defensa",
  "imputación objetiva",
  "juicio abreviado",
];

const TABS: { id: Vista; label: string; icono: LucideIcon }[] = [
  { id: "buscar", label: "Buscar", icono: Search },
  { id: "explorar", label: "Explorar por tema", icono: Compass },
];

const DEBOUNCE_MS = 200;

export function RepositorioView({
  filtrosIniciales,
  vistaInicial,
  totalCatalogo,
}: Props) {
  const [filtros, setFiltros] = useState<FiltrosRepo>(filtrosIniciales);
  // El input es su propio estado: se vuelca a `filtros.q` recién con el debounce.
  const [qInput, setQInput] = useState(filtrosIniciales.q);
  const [vista, setVista] = useState<Vista>(vistaInicial);

  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<{ clave: string; mensaje: string } | null>(
    null,
  );
  const [intento, setIntento] = useState(0);
  const [cargandoMas, setCargandoMas] = useState(false);

  const [estadoDrive, setEstadoDrive] = useState<EstadoRepositorio | null>(null);
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  // Identidad de la búsqueda en curso. `intento` la ensucia a propósito para
  // que "Reintentar" cuente como una búsqueda nueva aunque los filtros no hayan
  // cambiado. Con la clave, "está cargando" se DERIVA (la respuesta en estado
  // todavía no corresponde a los filtros actuales) en vez de setearse a mano
  // dentro del efecto.
  const clave = `${intento}|${queryFiltros(filtros)}`;
  const enPantalla = resultado?.clave === clave ? resultado : null;
  const mensajeError = error?.clave === clave ? error.mensaje : null;
  const cargando = enPantalla === null && mensajeError === null;

  const documentos = enPantalla?.documentos ?? [];
  const total = enPantalla?.total ?? 0;
  // Las facetas sobreviven al cambio de búsqueda: que los conteos del panel
  // parpadeen con cada tecla es peor que mostrarlos 200 ms desactualizados.
  const facetas = resultado?.facetas ?? null;

  // ——— Cambios de filtro ———
  // Un solo camino de entrada: si el cambio toca `q`, el input se sincroniza en
  // el mismo tick (si no, el debounce lo pisaría de vuelta al valor viejo).
  const aplicar = useCallback((parcial: Partial<FiltrosRepo>) => {
    if (parcial.q !== undefined) setQInput(parcial.q);
    setFiltros((f) => {
      const siguiente = { ...f, ...parcial };
      // Si el cambio no mueve la aguja (reclickear un filtro que ya estaba
      // puesto), se devuelve la MISMA referencia: un objeto nuevo re-dispararía
      // la búsqueda y tiraría las páginas ya acumuladas con "Cargar más".
      // Se compara por la query canónica, que es la misma identidad que usa el
      // efecto de búsqueda.
      return queryFiltros(siguiente) === queryFiltros(f) ? f : siguiente;
    });
  }, []);

  const limpiar = useCallback(() => {
    setQInput("");
    setFiltros({ ...FILTROS_VACIOS });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      // Se vuelca TRIMEADO: `clave` sale de `queryFiltros`, que trimea, así que
      // un espacio al final produciría un objeto `filtros` nuevo con la misma
      // clave. El efecto de búsqueda se re-dispararía, pediría la página 1 y
      // pisaría en silencio lo acumulado con "Cargar más".
      const q = qInput.trim();
      setFiltros((f) => (f.q === q ? f : { ...f, q }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [qInput]);

  // ——— Búsqueda (página 1) ———
  useEffect(() => {
    const ctrl = new AbortController();
    void pedirDocumentos(filtros, 1, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.ok) {
        setResultado({
          clave,
          documentos: r.datos.documentos,
          total: r.datos.total,
          facetas: r.datos.facetas,
          pagina: 1,
        });
      } else {
        setError({ clave, mensaje: r.error });
      }
    });
    return () => ctrl.abort();
  }, [clave, filtros]);

  // ——— Paginado explícito: "Cargar más" en vez de scroll infinito ———
  const cargarMas = useCallback(async () => {
    if (cargandoMas || enPantalla === null) return;
    setCargandoMas(true);
    // `finally`: nada puede dejar el botón deshabilitado con "Cargando…" para
    // siempre. Es el único estado del módulo que no se deriva de la respuesta.
    try {
      const r = await pedirDocumentos(filtros, enPantalla.pagina + 1);
      if (!r.ok) {
        // Fallar al pedir más no puede borrar lo que ya se está leyendo.
        toast.error(r.error);
        return;
      }
      setResultado((prev) => {
        // La búsqueda pudo cambiar mientras viajaba la página.
        if (prev === null || prev.clave !== clave) return prev;
        const vistos = new Set(prev.documentos.map((d) => d.id));
        return {
          ...prev,
          documentos: [
            ...prev.documentos,
            ...r.datos.documentos.filter((d) => !vistos.has(d.id)),
          ],
          total: r.datos.total,
          pagina: r.datos.pagina,
        };
      });
    } finally {
      setCargandoMas(false);
    }
  }, [cargandoMas, enPantalla, filtros, clave]);

  // ——— Foco inicial del buscador, sólo en escritorio ———
  // Era un `autoFocus` en el input. En el teléfono eso levanta el teclado
  // virtual apenas se entra a la sección: se come media pantalla y tapa los
  // resultados y el botón de Filtros antes de que el abogado haya decidido si
  // quería buscar o explorar por tema. En escritorio el foco automático es lo
  // correcto y se conserva.
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      inputRef.current?.focus();
    }
  }, []);

  // ——— Estado de Drive (una sola vez) ———
  useEffect(() => {
    const ctrl = new AbortController();
    void pedirEstado(ctrl.signal).then((e) => {
      if (!ctrl.signal.aborted) setEstadoDrive(e);
    });
    return () => ctrl.abort();
  }, []);

  // ——— Estado → URL ———
  useEffect(() => {
    const p = new URLSearchParams(queryFiltros(filtros));
    if (vista === "explorar") p.set("vista", "explorar");
    const qs = p.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `/dashboard/repositorio?${qs}` : "/dashboard/repositorio",
    );
  }, [filtros, vista]);

  const elegirMateria = useCallback(
    (slug: string, coleccion: Coleccion) => {
      aplicar({ materia: slug, coleccion });
      setVista("buscar");
      setFiltrosAbiertos(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [aplicar],
  );

  // Una query sin ningún carácter buscable ("¿?", "...") se descarta entera y
  // el resultado es el catálogo completo: anunciarlo como "N resultados para
  // «¿?»" diría que esos N documentos coinciden con lo que el abogado escribió.
  const consulta = tokenizar(filtros.q).length > 0 ? filtros.q.trim() : "";
  const filtrado = hayFiltros(filtros);
  const quedan = total - documentos.length;
  const conteo = `${fmtNumber(total)} ${total === 1 ? "resultado" : "resultados"}`;
  const resumen = `${conteo}${consulta !== "" ? ` para “${consulta}”` : ""}`;

  return (
    <div className="space-y-5">
      {/* ——— Header de la sección ——— */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-[var(--el-text)]">
            <LibraryBig
              className="size-6 text-[var(--el-violet-light)]"
              aria-hidden
            />
            Repositorio
          </h1>
          <span className="text-sm text-[var(--el-text-muted)]">
            {fmtNumber(totalCatalogo)} documentos
          </span>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-[var(--el-text-soft)]">
          Repositorio de fallos, sentencias y textos doctrinarios obtenidos de
          fuentes oficiales. Buscables por carátula, tema, tribunal o autor.
          Listos para ser analizados y aplicados en tus casos.
        </p>
        {/* Las dos colecciones, explicadas a la vista. No es un tooltip: quien
            usa esto no tiene por qué saber qué distingue una de la otra. */}
        <dl className="grid gap-2 sm:grid-cols-2">
          {COLECCIONES_VALUES.map((c) => {
            const meta = COLECCIONES[c];
            const Icono = ICONO_COLECCION[c];
            return (
              <div
                key={c}
                className="rounded-lg border border-[var(--el-border-soft)] bg-[var(--el-surface-card)]/50 px-3 py-2"
              >
                <dt
                  className={cn(
                    "flex items-center gap-1.5 text-sm font-medium",
                    meta.text,
                  )}
                >
                  <Icono className="size-4" aria-hidden />
                  {meta.label}
                </dt>
                <dd className="mt-0.5 text-xs leading-relaxed text-[var(--el-text-muted)]">
                  {meta.descripcion} {meta.para_que}
                </dd>
              </div>
            );
          })}
        </dl>
      </header>

      {estadoDrive && !estadoDrive.conectado ? (
        <BannerDrive vinculado={estadoDrive.vinculado} />
      ) : null}

      {/* ——— Tabs ——— */}
      <div
        role="tablist"
        aria-label="Modo de navegación del repositorio"
        className="inline-flex gap-1 rounded-lg border border-[var(--el-border-soft)] bg-[var(--el-surface-card)]/50 p-1"
      >
        {TABS.map((t) => {
          const activo = vista === t.id;
          const Icono = t.icono;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`repo-tab-${t.id}`}
              aria-selected={activo}
              aria-controls={`repo-panel-${t.id}`}
              tabIndex={activo ? 0 : -1}
              onClick={() => setVista(t.id)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                const otro = TABS.find((x) => x.id !== t.id);
                if (otro) {
                  setVista(otro.id);
                  document.getElementById(`repo-tab-${otro.id}`)?.focus();
                }
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                // 32px de alto para el switch principal de la sección: en móvil
                // sube a 40px, que es el piso tocable.
                "max-md:min-h-10",
                activo
                  ? "bg-[var(--el-violet)]/20 text-[var(--el-text)]"
                  : "text-[var(--el-text-soft)] hover:bg-black/5 dark:hover:bg-white/5 hover:text-[var(--el-text)]",
              )}
            >
              <Icono className="size-4" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      {vista === "explorar" ? (
        <div
          role="tabpanel"
          id="repo-panel-explorar"
          aria-labelledby="repo-tab-explorar"
        >
          <ExplorarMaterias onElegir={elegirMateria} />
        </div>
      ) : (
        <div
          role="tabpanel"
          id="repo-panel-buscar"
          aria-labelledby="repo-tab-buscar"
          className="space-y-4"
        >
          {/* ——— Buscador protagonista ——— */}
          <div>
            <label htmlFor="repo-q" className="sr-only">
              Buscar en el repositorio
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-[var(--el-text-muted)]"
                aria-hidden
              />
              <input
                id="repo-q"
                ref={inputRef}
                type="search"
                value={qInput}
                autoComplete="off"
                maxLength={120}
                onChange={(e) => setQInput(e.target.value)}
                placeholder='Buscar por carátula, tema, tribunal o autor — ej. "Díaz Bessone prisión preventiva"'
                // max-md:pr-12 para que la X de limpiar, que en móvil crece a
                // 40px para poder tocarla, no se monte sobre el texto escrito.
                className="h-12 w-full rounded-xl border border-[var(--el-border)] bg-[var(--el-surface-card)] pr-11 pl-11 text-sm text-[var(--el-text)] outline-none placeholder:text-[var(--el-text-muted)] focus-visible:border-[var(--el-violet)]/70 focus-visible:ring-2 focus-visible:ring-[var(--el-violet)]/25 max-md:pr-12"
              />
              {qInput !== "" ? (
                <button
                  type="button"
                  onClick={() => {
                    aplicar({ q: "" });
                    inputRef.current?.focus();
                  }}
                  aria-label="Limpiar la búsqueda"
                  className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1 text-[var(--el-text-muted)] transition-colors hover:text-[var(--el-text)] max-md:right-1 max-md:p-3"
                >
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-4 md:flex-row">
            {/* ——— Filtros ——— */}
            {/* En móvil el panel es una hoja FIJA sobre el contenido, no un
                bloque del flujo. El <aside> es el primer hijo de este flex y el
                botón que lo abre vive abajo, en la columna de resultados: al
                abrirlo el panel se insertaba ARRIBA del botón, así que a 390px
                el abogado tocaba “Filtros” y no veía aparecer nada (quedaba
                fuera de pantalla, por encima) o los resultados le saltaban
                ~600px. Fijo, se abre siempre a la vista. De md para arriba
                vuelve a ser la columna de 240px de siempre. */}
            {filtrosAbiertos ? (
              <button
                type="button"
                tabIndex={-1}
                aria-label="Cerrar los filtros"
                onClick={() => setFiltrosAbiertos(false)}
                className="fixed inset-0 z-40 touch-none bg-black/50 md:hidden"
              />
            ) : null}
            <aside
              className={cn(
                "md:block md:w-60 md:shrink-0",
                "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-50 max-md:max-h-[80dvh] max-md:overflow-y-auto max-md:overscroll-contain max-md:rounded-t-2xl max-md:border-t max-md:border-[var(--el-border)] max-md:bg-[var(--el-surface-card)] max-md:p-4 max-md:shadow-2xl",
                // viewportFit=cover: la barra de gestos del iPhone taparía el
                // último filtro si el padding de abajo no la compensara.
                "max-md:pb-[calc(1rem+env(safe-area-inset-bottom))]",
                filtrosAbiertos ? "block" : "hidden",
              )}
              aria-label="Filtros"
            >
              <div className="mb-3 flex items-center justify-between md:hidden">
                <h2 className="font-display text-sm font-semibold text-[var(--el-text)]">
                  Filtros
                </h2>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setFiltrosAbiertos(false)}
                  aria-label="Cerrar los filtros"
                >
                  <X aria-hidden />
                </Button>
              </div>

              <PanelFiltros
                filtros={filtros}
                facetas={facetas}
                onChange={aplicar}
                onLimpiar={limpiar}
              />

              {/* Cierre explícito abajo de todo: la hoja tapa los resultados,
                  así que el filtro se aplica en vivo pero recién se ve al
                  cerrar. El conteo lo anticipa. */}
              <Button
                className="mt-3 w-full md:hidden"
                onClick={() => setFiltrosAbiertos(false)}
              >
                {cargando ? "Ver resultados" : `Ver ${conteo}`}
              </Button>
            </aside>

            {/* ——— Resultados ——— */}
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 md:hidden"
                  onClick={() => setFiltrosAbiertos((o) => !o)}
                  aria-expanded={filtrosAbiertos}
                >
                  <SlidersHorizontal aria-hidden />
                  Filtros
                </Button>
                <p
                  className="text-sm text-[var(--el-text-soft)]"
                  aria-live="polite"
                >
                  {cargando ? "Buscando…" : mensajeError ? "" : resumen}
                </p>
                {filtrado && !cargando ? (
                  <button
                    type="button"
                    onClick={limpiar}
                    className="text-xs text-[var(--el-violet-light)] hover:underline max-md:inline-flex max-md:min-h-10 max-md:items-center max-md:px-1"
                  >
                    Limpiar
                  </button>
                ) : null}
                {/* El espaciador empuja “Ordenar” a la derecha en escritorio.
                    En móvil la fila ya viene envuelta y el espaciador dejaba el
                    <select> solo en un renglón propio pegado a la izquierda,
                    con el label “Ordenar” colgado en el renglón de arriba. */}
                <div className="flex-1 max-md:hidden" />
                <label
                  htmlFor="repo-orden"
                  className="text-xs text-[var(--el-text-muted)]"
                >
                  Ordenar
                </label>
                <select
                  id="repo-orden"
                  value={filtros.orden}
                  onChange={(e) =>
                    aplicar({
                      orden:
                        ORDENES_VALUES.find((o) => o === e.target.value) ??
                        "relevancia",
                    })
                  }
                  // max-md:h-10: globals.css le fuerza 16px a los <select> en
                  // móvil (piso anti-zoom de iOS) y ese texto no entra en una
                  // caja de 32px; además 32px es poco para el dedo.
                  className="h-8 rounded-md border border-[var(--el-border-soft)] bg-transparent px-2 text-xs text-[var(--el-text)] outline-none focus-visible:border-[var(--el-violet)]/60 max-md:h-10 max-md:px-3"
                >
                  {ORDENES_VALUES.map((o) => (
                    <option key={o} value={o} className="bg-[var(--el-canvas)]">
                      {ORDENES[o].label}
                    </option>
                  ))}
                </select>
              </div>

              <ChipsFiltros
                filtros={filtros}
                onChange={aplicar}
                onLimpiar={limpiar}
              />

              {cargando ? (
                <EsqueletoCards />
              ) : mensajeError !== null ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-6 py-12 text-center">
                  <TriangleAlert className="size-7 text-destructive" aria-hidden />
                  <p className="text-sm text-[var(--el-text-soft)]">
                    {mensajeError}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setIntento((i) => i + 1)}
                  >
                    Reintentar
                  </Button>
                </div>
              ) : documentos.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-[var(--el-border-soft)] px-6 py-12 text-center">
                  <SearchX
                    className="size-8 text-[var(--el-text-muted)]"
                    aria-hidden
                  />
                  <p className="text-sm text-[var(--el-text-soft)]">
                    No hay documentos que coincidan con esta búsqueda.
                  </p>
                  <p className="text-xs text-[var(--el-text-muted)]">
                    Probá con algo más corto, o arrancá por acá:
                  </p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {SUGERENCIAS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => aplicar({ ...FILTROS_VACIOS, q: s })}
                        className="rounded-full border border-[var(--el-border-soft)] px-2.5 py-1 text-xs text-[var(--el-text-soft)] transition-colors hover:border-[var(--el-violet)]/45 hover:text-[var(--el-text)] max-md:inline-flex max-md:min-h-10 max-md:items-center max-md:px-4 max-md:text-sm"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVista("explorar")}
                  >
                    <Compass aria-hidden />
                    Explorar por tema
                  </Button>
                </div>
              ) : (
                <>
                  <div
                    role="list"
                    className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
                  >
                    {documentos.map((d) => (
                      <DocumentoCard
                        key={d.id}
                        doc={d}
                        onMateria={(slug) =>
                          aplicar({ materia: slug, coleccion: d.coleccion })
                        }
                      />
                    ))}
                  </div>

                  {quedan > 0 ? (
                    <div className="flex flex-col items-center gap-1.5 pt-2">
                      <Button
                        variant="outline"
                        onClick={() => void cargarMas()}
                        disabled={cargandoMas}
                      >
                        {cargandoMas ? (
                          <Loader2 className="animate-spin" aria-hidden />
                        ) : null}
                        {cargandoMas
                          ? "Cargando…"
                          : `Cargar más (${fmtNumber(quedan)} restantes)`}
                      </Button>
                      <p className="text-xs text-[var(--el-text-muted)]">
                        Mostrando {fmtNumber(documentos.length)} de{" "}
                        {fmtNumber(total)}
                      </p>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
