import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CalendarX2,
  FolderOpen,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtRelativo } from "@/lib/format";
import { claveDia, etiquetaDiaPartes, fmtHora } from "@/lib/agenda/fechas";
import { tipoLabel } from "@/lib/agenda/types";

export type CasoReciente = {
  id: string;
  titulo: string;
  rol: string;
  actualizado_en: string;
};

export type EventoProximo = {
  id: string;
  titulo: string;
  tipo: string;
  fecha_inicio: string;
  todo_el_dia: boolean;
};

// Color del badge de rol. Tonos suaves /10 sobre dark, mismo criterio que los
// badges de tipo de evento de la agenda. Clases literales completas porque
// Tailwind v4 escanea strings (no construye `bg-${x}` en runtime).
const ROL_BADGE: Record<string, string> = {
  defensor: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  querellante: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  ambos: "bg-violet-500/10 text-violet-300 border-violet-500/20",
};

function capitalizar(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function RolBadge({ rol }: { rol: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        ROL_BADGE[rol] ?? "bg-zinc-500/10 text-zinc-300 border-zinc-500/20",
      )}
    >
      {capitalizar(rol)}
    </span>
  );
}

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
  casos: CasoReciente[];
  eventos: EventoProximo[];
}) {
  return (
    <div className="space-y-8">
      {/* 1. Saludo */}
      <div>
        <h1 className="font-serif text-3xl tracking-tight">Hola, {nombre}</h1>
        <p className="mt-1 text-muted-foreground">¿Qué querés hacer hoy?</p>
      </div>

      {/* 2. CTA destacado */}
      <Link
        href="/analisis"
        className="group flex items-center gap-4 rounded-xl bg-primary px-6 py-5 text-primary-foreground transition-opacity hover:opacity-90"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-white/15">
          <Sparkles className="size-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-semibold">
            Analizar un caso nuevo
          </span>
          <span className="block text-sm text-primary-foreground/80">
            Cargá el caso y recibí estrategias fundamentadas
          </span>
        </span>
        <ArrowRight className="size-5 shrink-0 transition-transform group-hover:translate-x-1" />
      </Link>

      {/* 3. Casos recientes */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <FolderOpen className="size-4" /> Casos recientes
          </h2>
          {casos.length > 0 ? (
            <Link
              href="/dashboard/mis-casos"
              className="text-xs text-primary hover:underline"
            >
              Ver todos
            </Link>
          ) : null}
        </div>

        {casos.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card/40 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Todavía no analizaste ningún caso.
            </p>
            <Link
              href="/analisis"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <Sparkles className="size-4" /> Analizar un caso nuevo
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {casos.map((c) => (
              <Link
                key={c.id}
                href={`/dashboard/mis-casos/${c.id}`}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card/40 p-4 transition-colors hover:border-primary/40 hover:bg-card"
              >
                <p className="line-clamp-2 text-sm font-medium leading-snug">
                  {c.titulo}
                </p>
                <div className="mt-auto flex items-center justify-between gap-2">
                  <RolBadge rol={c.rol} />
                  <span className="text-xs text-muted-foreground">
                    {fmtRelativo(c.actualizado_en)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* 4. Próximos eventos */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <CalendarClock className="size-4" /> Próximos eventos
          </h2>
          {eventos.length > 0 ? (
            <Link
              href="/dashboard/agenda"
              className="text-xs text-primary hover:underline"
            >
              Ver agenda
            </Link>
          ) : null}
        </div>

        {eventos.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card/40 py-10 text-center">
            <CalendarX2 className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No tenés audiencias agendadas.
            </p>
            <Link
              href="/dashboard/agenda"
              className="text-sm text-primary hover:underline"
            >
              Ir a la agenda
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/40">
            {eventos.map((e) => (
              <li key={e.id}>
                <Link
                  href="/dashboard/agenda"
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {e.titulo}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {tipoLabel(e.tipo)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                    {etiquetaEvento(e)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
