"use client";
import { useState, type Dispatch, type SetStateAction } from "react";
import { Plus, X, Sparkles, ChevronRight, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtFecha } from "@/lib/format";
import { CATEGORIA_LABEL } from "@/lib/casos/categorias";
import type { EventoCaso } from "@/lib/types";
import { AgregarEventoSheet } from "./agregar-evento-sheet";
import { EliminarEventoModal } from "./eliminar-evento-modal";
import { AdjuntosRender } from "./adjuntos-render";
import { RespuestaAgenteEvento } from "./respuesta-agente-evento";

type Props = {
  casoId: string;
  eventos: EventoCaso[];
  setEventos: Dispatch<SetStateAction<EventoCaso[]>>;
};

// Timeline procesal con eventos colapsables (PR4 corrección 3).
//
// Comportamiento del estado expandido:
//   - Si hay <= 2 eventos en el caso: todos arrancan expandidos (no
//     hay scroll problem y dejarlos colapsados es fricción gratuita).
//   - Si hay > 2: solo el último (más reciente) arranca expandido.
//     El abogado vuelve al caso y ve "lo último que pasó" sin scroll;
//     el resto colapsado para no saturar.
//   - Cuando se agrega un evento nuevo, queda expandido por default.
//   - Click en el header de cualquier evento toggle expandido.
//
// Botón "Agregar evento" (PR4 corrección 4): ahora vive al final del
// timeline en vez del header, para que el cursor de acción esté donde
// naturalmente termina la lista (metáfora "agregar al final del chat").
//
// Distinción visual por origen del evento — preservada del PR3:
//   - manual: bullet emerald/amber según estado, borde neutro.
//   - manual + categoria='consulta_agente': bullet primary tenue, borde
//     primary tenue. (Sub-PR2 va a sacar este flujo del timeline; en
//     este sub-PR sigue mostrándose.)
//   - sistema: bullet gris.
//   - agente + categoria='respuesta_agente': bullet primary, borde
//     primary, render rico via RespuestaAgenteEvento al expandir.
//
// Borrar solo está disponible para eventos manuales sin categoría
// 'consulta_agente'. El server además bloquea DELETE de no-manuales.
export function TimelineProcesal({ casoId, eventos, setEventos }: Props) {
  const [agregarOpen, setAgregarOpen] = useState(false);
  const [eliminarId, setEliminarId] = useState<string | null>(null);
  // Set de IDs expandidos. Init: todos si <=2, solo el último si >2.
  // El estado vive en el padre del item para que "agregar nuevo lo
  // expande automáticamente" sea trivial — solo agregamos al Set.
  const [expandidos, setExpandidos] = useState<Set<string>>(() => {
    if (eventos.length === 0) return new Set();
    if (eventos.length <= 2) return new Set(eventos.map((e) => e.id));
    const ultimo = eventos[eventos.length - 1];
    return new Set([ultimo.id]);
  });

  const toggle = (id: string) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const insertarOrdenado = (lista: EventoCaso[], nuevo: EventoCaso) => {
    const i = lista.findIndex(
      (e) => new Date(e.ocurrido_en) > new Date(nuevo.ocurrido_en),
    );
    if (i === -1) return [...lista, nuevo];
    return [...lista.slice(0, i), nuevo, ...lista.slice(i)];
  };

  const onEventoCreado = (nuevo: EventoCaso) => {
    setEventos((prev) => insertarOrdenado(prev, nuevo));
    // El evento recién agregado siempre expandido — el abogado
    // espera ver lo que acaba de cargar.
    setExpandidos((prev) => {
      const next = new Set(prev);
      next.add(nuevo.id);
      return next;
    });
    setAgregarOpen(false);
  };

  const onEventoBorrado = (id: string) => {
    setEventos((prev) => prev.filter((e) => e.id !== id));
    setExpandidos((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setEliminarId(null);
  };

  return (
    <section className="space-y-4">
      <h3 className="font-medium text-sm">
        Timeline procesal
        <span className="text-muted-foreground">
          {" · "}
          {eventos.length} {eventos.length === 1 ? "evento" : "eventos"}
        </span>
      </h3>

      {eventos.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          Todavía no hay eventos en el timeline.
        </p>
      ) : (
        <ol className="relative pl-6 border-l-2 border-border space-y-3">
          {eventos.map((e) => (
            <EventoItem
              key={e.id}
              casoId={casoId}
              evento={e}
              expandido={expandidos.has(e.id)}
              onToggle={() => toggle(e.id)}
              onEliminar={() => setEliminarId(e.id)}
            />
          ))}
        </ol>
      )}

      {/* Botón "Agregar evento" al final del timeline. */}
      <div className="pl-6">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAgregarOpen(true)}
        >
          <Plus />
          Agregar evento
        </Button>
      </div>

      <AgregarEventoSheet
        open={agregarOpen}
        casoId={casoId}
        onClose={() => setAgregarOpen(false)}
        onCreated={onEventoCreado}
      />

      <EliminarEventoModal
        eventoId={eliminarId}
        casoId={casoId}
        onClose={() => setEliminarId(null)}
        onDeleted={onEventoBorrado}
      />
    </section>
  );
}

function bulletClassesPorEvento(evento: EventoCaso): string {
  if (evento.tipo === "agente") return "bg-primary";
  if (evento.tipo === "sistema") return "bg-muted-foreground/40";
  if (evento.categoria === "consulta_agente") return "bg-primary/60";
  return evento.estado === "sucedido" ? "bg-emerald-500" : "bg-amber-400";
}

function bordeIzqClassesPorEvento(evento: EventoCaso): string {
  if (evento.tipo === "agente") return "border-l-2 border-primary/60";
  if (evento.tipo === "sistema") return "border-l-2 border-muted";
  if (evento.categoria === "consulta_agente")
    return "border-l-2 border-primary/30";
  return "border-l-2 border-border";
}

// Devuelve un snippet de una línea para mostrar en el header colapsado.
// Para eventos del agente parsea el JSON; para el resto agarra la
// primera línea de la descripción.
function snippetParaColapsado(evento: EventoCaso): string {
  const MAX = 110;
  let texto = "";
  if (
    evento.tipo === "agente" &&
    evento.categoria === "respuesta_agente"
  ) {
    try {
      const parsed = JSON.parse(evento.descripcion) as {
        analisis?: { tesis_central?: string };
      };
      texto = parsed.analisis?.tesis_central ?? "(respuesta del agente)";
    } catch {
      texto = "(respuesta del agente)";
    }
  } else {
    // Primera línea de la descripción.
    texto = evento.descripcion.split("\n")[0] ?? "";
  }
  texto = texto.trim();
  if (texto.length > MAX) return texto.slice(0, MAX).trim() + "…";
  return texto;
}

function EventoItem({
  casoId,
  evento,
  expandido,
  onToggle,
  onEliminar,
}: {
  casoId: string;
  evento: EventoCaso;
  expandido: boolean;
  onToggle: () => void;
  onEliminar: () => void;
}) {
  const esManualEditable =
    evento.tipo === "manual" && evento.categoria !== "consulta_agente";
  const esRespuestaAgente =
    evento.tipo === "agente" && evento.categoria === "respuesta_agente";
  const esConsultaAgente =
    evento.tipo === "manual" && evento.categoria === "consulta_agente";
  const colorBullet = bulletClassesPorEvento(evento);
  const bordeCard = bordeIzqClassesPorEvento(evento);
  const tieneAdjuntos = evento.adjuntos && evento.adjuntos.length > 0;
  const numAdjuntos = evento.adjuntos?.length ?? 0;

  // Label del header colapsado.
  const labelCabecera = esRespuestaAgente
    ? "Análisis del agente"
    : esConsultaAgente
      ? "Consulta del abogado"
      : evento.categoria !== null
        ? CATEGORIA_LABEL[evento.categoria]
        : evento.tipo === "sistema"
          ? "Sistema"
          : "Evento";

  return (
    <li className="relative group">
      <span
        className={cn(
          "absolute -left-[7px] top-3 size-3 rounded-full ring-4 ring-background",
          colorBullet,
        )}
        aria-hidden="true"
      />
      <div className={cn("rounded-md bg-card/30 pl-3.5", bordeCard)}>
        {/* Header clickeable: siempre visible, toggle el expandido. */}
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-muted/20 rounded-md transition-colors"
          aria-expanded={expandido}
        >
          <ChevronRight
            className={cn(
              "size-3.5 mt-0.5 shrink-0 text-muted-foreground transition-transform",
              expandido && "rotate-90",
            )}
            aria-hidden="true"
          />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {esRespuestaAgente || esConsultaAgente ? (
                <Sparkles
                  className="size-3 text-primary/80 shrink-0"
                  aria-hidden="true"
                />
              ) : null}
              <span
                className={cn(
                  "text-[10px] uppercase tracking-wider",
                  esRespuestaAgente || esConsultaAgente
                    ? "text-primary/80 font-medium"
                    : "text-muted-foreground",
                )}
              >
                {labelCabecera}
              </span>
              <span className="text-[10px] text-muted-foreground">
                · {fmtFecha(evento.ocurrido_en)}
              </span>
              {evento.estado === "pendiente" ? (
                <span className="text-[10px] uppercase tracking-wider text-amber-500">
                  · pendiente
                </span>
              ) : null}
              {numAdjuntos > 0 ? (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                  <Paperclip className="size-3" />
                  {numAdjuntos}
                </span>
              ) : null}
            </div>
            {!expandido ? (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {snippetParaColapsado(evento)}
              </p>
            ) : null}
          </div>
        </button>

        {/* Body expandido: contenido completo. */}
        {expandido ? (
          <div className="px-3 pb-3 -mt-1">
            {esRespuestaAgente ? (
              <RespuestaAgenteEvento evento={evento} />
            ) : esConsultaAgente ? (
              <ConsultaAgenteContenido evento={evento} casoId={casoId} />
            ) : (
              <EventoManualOSistemaContenido
                evento={evento}
                casoId={casoId}
                esEditable={esManualEditable}
                onEliminar={onEliminar}
                tieneAdjuntos={tieneAdjuntos ?? false}
              />
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function EventoManualOSistemaContenido({
  evento,
  casoId,
  esEditable,
  onEliminar,
  tieneAdjuntos,
}: {
  evento: EventoCaso;
  casoId: string;
  esEditable: boolean;
  onEliminar: () => void;
  tieneAdjuntos: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug whitespace-pre-wrap">
          {evento.descripcion}
        </p>
        {tieneAdjuntos ? (
          <AdjuntosRender casoId={casoId} adjuntos={evento.adjuntos} />
        ) : null}
      </div>
      {esEditable ? (
        <Button
          variant="ghost"
          size="sm"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onEliminar}
          aria-label="Eliminar evento"
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

// Body expandido para la consulta del abogado al agente. Muestra
// pregunta + adjuntos. (Sub-PR2 va a sacar este flujo del timeline.)
function ConsultaAgenteContenido({
  evento,
  casoId,
}: {
  evento: EventoCaso;
  casoId: string;
}) {
  const tieneAdjuntos = evento.adjuntos && evento.adjuntos.length > 0;
  return (
    <div>
      <p className="text-sm leading-snug whitespace-pre-wrap text-muted-foreground italic">
        {evento.descripcion}
      </p>
      {tieneAdjuntos ? (
        <AdjuntosRender casoId={casoId} adjuntos={evento.adjuntos} />
      ) : null}
    </div>
  );
}
