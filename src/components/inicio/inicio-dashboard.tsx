import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CalendarPlus,
  CalendarX2,
  ChevronRight,
  Clock3,
  FolderOpen,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtNumber, fmtRelativo } from "@/lib/format";
import { claveDia, etiquetaDiaPartes, fmtHora } from "@/lib/agenda/fechas";
import { tipoLabel } from "@/lib/agenda/types";
import { rolBadge, rolLabel } from "@/lib/casos/rol";
import {
  construirResumen,
  DIAS_VENTANA,
  type CasoResumen,
  type EventoResumen,
} from "@/lib/inicio/resumen";
import { BuscadorTrigger } from "@/components/buscador/buscador-global";

export type CasoReciente = CasoResumen;
export type EventoProximo = EventoResumen;

// Cuántas causas hacen falta para que el abogado deje de ser "nuevo". A partir
// de acá el banner de "Analizar un caso nuevo" se reduce a una barra: para
// alguien que ya trabaja con la app, el punto de entrada es la causa que tiene
// abierta, no el flujo de alta.
const CASOS_PARA_CTA_COMPACTO = 3;

// Cuántas filas mostramos en cada lista del panel antes de mandar a la vista
// completa de la sección.
const FILAS_VISIBLES = 4;

// Tiempo estimado del flujo de análisis, de punta a punta (describir el caso,
// contestar las preguntas, leer las estrategias). Los abogados no arrancan un
// flujo sin saber cuánto les va a llevar.
const DURACION_ANALISIS = "~5 min";

// "Hoy · 14:30", "Mañana · 09:00", "Viernes · 11:00" — o solo el día si es
// todo el día.
function etiquetaEvento(e: EventoProximo): string {
  const { label } = etiquetaDiaPartes(claveDia(e.fecha_inicio));
  return e.todo_el_dia ? label : `${label} · ${fmtHora(e.fecha_inicio)}`;
}

export function InicioDashboard({
  nombre,
  casos,
  eventos,
}: {
  nombre: string;
  /** TODAS las causas del usuario: el panel corta lo que muestra, pero los
   *  contadores tienen que ver el total. */
  casos: CasoReciente[];
  /** Eventos futuros del usuario, ordenados por fecha_inicio ascendente. */
  eventos: EventoProximo[];
}) {
  const resumen = construirResumen({ casos, eventos });
  const ctaCompacto = casos.length > CASOS_PARA_CTA_COMPACTO;
  const casosVisibles = casos.slice(0, FILAS_VISIBLES);
  const eventosVisibles = eventos.slice(0, FILAS_VISIBLES);

  return (
    <div className="space-y-6">
      {/* 1. Saludo contextual */}
      <div>
        <h1 className="font-display text-[25px] font-semibold text-[var(--el-text)]">
          Hola, {nombre}
        </h1>
        <p className="mt-1 text-[var(--el-text-soft)]">{resumen.linea}</p>
      </div>

      {/* 2. Buscador global — arriba de todo, antes que cualquier acción: si el
             abogado ya sabe qué causa busca, no tiene por qué recorrer el panel. */}
      <BuscadorTrigger />

      {/* 3. Punto de entrada al análisis */}
      {ctaCompacto ? <CtaCompacto /> : <CtaCompleto />}

      {/* 4. Indicadores con dato real */}
      <div className="grid gap-4 sm:grid-cols-2">
        <TarjetaCausas total={casos.length} porRol={resumen.porRol} />
        <TarjetaVencimientos
          cantidad={resumen.vencimientos}
          urgente={resumen.urgente}
          proximo={resumen.proximoVencimiento}
        />
      </div>

      {/* 5. Detalle: causas a la izquierda, agenda a la derecha */}
      <div className="grid gap-4 lg:grid-cols-5">
        <CasosRecientes
          casos={casosVisibles}
          total={casos.length}
          className="lg:col-span-3"
        />
        <PanelAgenda
          eventos={eventosVisibles}
          vencimientos={resumen.vencimientos}
          urgente={resumen.urgente}
          className="lg:col-span-2"
        />
      </div>
    </div>
  );
}

// === Punto de entrada al análisis ===

function BadgeDuracion({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      <Clock3 className="size-3.5" />
      {DURACION_ANALISIS}
    </span>
  );
}

function CtaCompleto() {
  return (
    <Link
      href="/analisis"
      className="group flex items-center gap-4 rounded-[13px] bg-[var(--el-cta)] px-6 py-5 text-white shadow-[0_4px_20px_rgba(124,92,252,0.32)] transition-opacity hover:opacity-90"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-white/15">
        <Sparkles className="size-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold">
          Analizar un caso nuevo
        </span>
        <span className="block text-sm text-white/80">
          Cargá el caso y recibí estrategias fundamentadas
        </span>
      </span>
      <BadgeDuracion className="hidden bg-white/15 text-white sm:inline-flex" />
      <ArrowRight className="size-5 shrink-0 transition-transform group-hover:translate-x-1" />
    </Link>
  );
}

function CtaCompacto() {
  return (
    <Link
      href="/analisis"
      className="group flex items-center gap-3 rounded-[11px] border border-[var(--el-violet)]/40 bg-[var(--el-violet)]/8 px-4 py-3 transition-colors hover:border-[var(--el-violet)] hover:bg-[var(--el-violet)]/14"
    >
      <Sparkles className="size-4 shrink-0 text-[var(--el-violet-light)]" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--el-text)]">
        Analizar un caso nuevo
      </span>
      <BadgeDuracion className="bg-[var(--el-violet)]/15 text-[var(--el-violet-light)]" />
      <ArrowRight className="size-4 shrink-0 text-[var(--el-violet-light)] transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

// === Tarjetas de indicadores ===

function Tarjeta({
  titulo,
  tono = "neutro",
  children,
}: {
  titulo: string;
  tono?: "neutro" | "alerta";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[11px] border p-5 shadow-[var(--el-shadow-card)]",
        tono === "alerta"
          ? "border-rose-500/35 bg-rose-500/6"
          : "border-[var(--el-border)] bg-[var(--el-surface-card)]",
      )}
    >
      <p
        className={cn(
          "text-xs font-medium tracking-wider uppercase",
          tono === "alerta"
            ? "text-rose-700 dark:text-rose-300"
            : "text-[var(--el-text-muted)]",
        )}
      >
        {titulo}
      </p>
      {children}
    </div>
  );
}

function TarjetaCausas({
  total,
  porRol,
}: {
  total: number;
  porRol: Array<{ rol: string; cantidad: number }>;
}) {
  return (
    <Tarjeta titulo="Causas">
      <p className="mt-3 font-display text-3xl leading-none font-semibold text-[var(--el-text)]">
        {fmtNumber(total)}
      </p>
      <p className="mt-1.5 text-xs text-[var(--el-text-muted)]">
        {total === 1 ? "causa activa" : "causas activas"}
      </p>
      {porRol.length > 0 ? (
        <p className="mt-3 border-t border-[var(--el-border-soft)] pt-3 text-xs text-[var(--el-text-soft)]">
          {porRol
            .map((r) => `${r.cantidad} como ${rolLabel(r.rol).toLowerCase()}`)
            .join(" · ")}
        </p>
      ) : null}
    </Tarjeta>
  );
}

function TarjetaVencimientos({
  cantidad,
  urgente,
  proximo,
}: {
  cantidad: number;
  urgente: boolean;
  proximo: EventoProximo | undefined;
}) {
  const hay = cantidad > 0;
  return (
    <Tarjeta titulo="Vencimientos" tono={hay && urgente ? "alerta" : "neutro"}>
      <p
        className={cn(
          "mt-3 font-display text-3xl leading-none font-semibold",
          hay && urgente
            ? "text-rose-700 dark:text-rose-300"
            : "text-[var(--el-text)]",
        )}
      >
        {fmtNumber(cantidad)}
      </p>
      <p className="mt-1.5 text-xs text-[var(--el-text-muted)]">
        en los próximos {DIAS_VENTANA} días
      </p>
      <p className="mt-3 border-t border-[var(--el-border-soft)] pt-3 text-xs text-[var(--el-text-soft)]">
        {proximo ? (
          <>
            Próximo: {etiquetaEvento(proximo)} ·{" "}
            <span className="text-[var(--el-text)]">{proximo.titulo}</span>
          </>
        ) : (
          "Sin plazos a la vista"
        )}
      </p>
    </Tarjeta>
  );
}

// === Listas ===

function CabeceraSeccion({
  icono,
  titulo,
  href,
  accion,
}: {
  icono: ReactNode;
  titulo: string;
  href?: string;
  accion?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--el-text)]">
        {icono}
        {titulo}
      </h2>
      {href && accion ? (
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-0.5 text-xs text-[var(--el-violet-light)] hover:underline"
        >
          {accion}
          <ChevronRight className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

function CasosRecientes({
  casos,
  total,
  className,
}: {
  casos: CasoReciente[];
  total: number;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-[11px] border border-[var(--el-border)] bg-[var(--el-surface-card)] p-5 shadow-[var(--el-shadow-card)]",
        className,
      )}
    >
      <CabeceraSeccion
        icono={<FolderOpen className="size-4 text-[var(--el-text-muted)]" />}
        titulo="Causas recientes"
        href={total > 0 ? "/dashboard/mis-casos" : undefined}
        accion={total > casos.length ? `Ver las ${total}` : "Ver todas"}
      />

      {casos.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-[var(--el-text-soft)]">
            Todavía no analizaste ningún caso.
          </p>
          <Link
            href="/analisis"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--el-violet-light)] hover:underline"
          >
            <Sparkles className="size-4" /> Analizar un caso nuevo
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--el-border-soft)]">
          {casos.map((c) => (
            <li key={c.id}>
              <Link
                href={`/dashboard/mis-casos/${c.id}`}
                className="group flex items-center gap-3 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--el-text)] transition-colors group-hover:text-[var(--el-violet-light)]">
                    {c.titulo}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--el-text-muted)]">
                    {fmtRelativo(c.actualizado_en)}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
                    rolBadge(c.rol),
                  )}
                >
                  {rolLabel(c.rol)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PanelAgenda({
  eventos,
  vencimientos,
  urgente,
  className,
}: {
  eventos: EventoProximo[];
  vencimientos: number;
  urgente: boolean;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-[11px] border border-[var(--el-border)] bg-[var(--el-surface-card)] shadow-[var(--el-shadow-card)]",
        className,
      )}
    >
      {/* Franja de alerta: sólo aparece si hay algo con plazo en la ventana.
          Un banner permanente se vuelve invisible a la semana. */}
      {vencimientos > 0 ? (
        <div className="flex items-center gap-2.5 border-b border-rose-500/25 bg-rose-500/8 px-5 py-2.5">
          <span className="size-1.5 shrink-0 rounded-full bg-rose-500" />
          <p className="min-w-0 flex-1 text-xs text-rose-700 dark:text-rose-300">
            {vencimientos === 1
              ? "1 vencimiento"
              : `${fmtNumber(vencimientos)} vencimientos`}{" "}
            en los próximos {DIAS_VENTANA} días
          </p>
          {urgente ? (
            <span className="shrink-0 rounded-full border border-rose-500/40 px-2 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300">
              Urgente
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 p-5">
        <CabeceraSeccion
          icono={<CalendarClock className="size-4 text-[var(--el-text-muted)]" />}
          titulo="Próximos eventos"
          href="/dashboard/agenda"
          accion={eventos.length > 0 ? "Ir a la agenda" : undefined}
        />

        {eventos.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CalendarX2 className="size-7 text-[var(--el-text-muted)]" />
            <p className="text-sm text-[var(--el-text-soft)]">
              No tenés audiencias agendadas.
            </p>
            <Link
              href="/dashboard/agenda"
              className="inline-flex items-center gap-1.5 text-sm text-[var(--el-violet-light)] hover:underline"
            >
              <CalendarPlus className="size-4" /> Agregar evento
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--el-border-soft)]">
            {eventos.map((e) => (
              <li key={e.id}>
                <Link
                  href="/dashboard/agenda"
                  className="group flex items-baseline gap-3 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--el-text)] transition-colors group-hover:text-[var(--el-violet-light)]">
                      {e.titulo}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--el-text-muted)]">
                      {tipoLabel(e.tipo)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-[var(--el-text-muted)]">
                    {etiquetaEvento(e)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
