"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type {
  AnalisisOutput,
  Busqueda,
  Estrategia,
  RolEstrategia,
  SeccionAnalisis,
  TipoEstrategia,
} from "@/lib/schemas";
import { sugerirTitulo } from "@/lib/nuevo-analisis/sugerir-titulo";
import { BusquedasRag } from "./busquedas-rag";
import { JurisprudenciaEstrategia } from "./jurisprudencia-estrategia";

// === Paleta por perfil de estrategia ============================================
// Cada perfil tiene un color de acento que vive en:
//   - el borde superior de 3px de la card colapsada,
//   - el badge "Conservadora/Moderada/Agresiva" que va en el header,
//   - el header del modal de despliegue (live).
// Mantenerla acá centralizada simplifica el rediseño futuro: cambiar 1 línea
// propaga al grid, al modal y al card del caso elegido (que importa el mismo
// helper).
//
// Tailwind no soporta concatenación dinámica de clases (purga estática), así
// que las clases están escritas literales — NO hagas `border-t-${color}-500`.

type ColoresTipo = {
  borde: string; // border-t-X-500 con grosor base 3
  badge: string; // bg/text/border consistentes para el Badge
  label: string;
};

export const COLORES_TIPO: Record<TipoEstrategia, ColoresTipo> = {
  conservadora: {
    borde: "border-t-emerald-500",
    badge:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15",
    label: "Conservadora",
  },
  moderada: {
    borde: "border-t-amber-500",
    badge:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/15",
    label: "Moderada",
  },
  agresiva: {
    borde: "border-t-rose-500",
    badge:
      "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/15",
    label: "Agresiva",
  },
};

// === Tipos compartidos =========================================================

type Props = {
  data: AnalisisOutput;
  busquedas: Busqueda[];
  // CTAs opcionales: cuando el componente se reusa en el modal del historial,
  // no aplican "Volver al formulario" ni "Nuevo análisis" — son acciones del
  // flujo en vivo, no del archivo histórico.
  onVolver?: () => void;
  onReiniciar?: () => void;
  // Cuando ambos están presentes, las cards muestran "Desplegar" → modal con
  // flujo de selección. Si falta cualquiera, las cards se expanden inline con
  // Collapsible (modo lectura) y no hay flow de creación de caso.
  ejecucionId?: string;
  caso?: string;
};

type Seleccion = {
  rolEstrategia: RolEstrategia;
  idx: number;
  estrategia: Estrategia;
};

// === Componente raíz ===========================================================

export function ResultadosAnalisis({
  data,
  busquedas,
  onVolver,
  onReiniciar,
  ejecucionId,
  caso,
}: Props) {
  const warning = data.metadata?.warning;
  const articulos = data.metadata?.articulos_consultados ?? [];
  const tieneCtas = onVolver !== undefined || onReiniciar !== undefined;
  const modoLive = ejecucionId !== undefined && caso !== undefined;

  const [seleccion, setSeleccion] = useState<Seleccion | null>(null);
  const [flowState, setFlowState] = useState<FlowState>("inicial");

  // La atenuación de hermanas se activa cuando el usuario está más allá del
  // estado inicial del modal: ya tocó "Seleccionar" → su atención está
  // comprometida con esa card específica.
  const atenuarHermanas = flowState !== "inicial";

  const cerrarModal = () => {
    setSeleccion(null);
    setFlowState("inicial");
  };

  return (
    <div className="space-y-6">
      {tieneCtas ? (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="font-serif text-3xl">Estrategias</h2>
          <div className="flex items-center gap-2">
            {onVolver ? (
              <Button variant="outline" size="sm" onClick={onVolver}>
                <ArrowLeft />
                Volver al formulario
              </Button>
            ) : null}
            {onReiniciar ? (
              <Button size="sm" onClick={onReiniciar}>
                <RotateCcw />
                Nuevo análisis
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {warning ? (
        <Card className="p-4 border-amber-500/40 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-500" />
            <p className="text-sm text-amber-800 dark:text-amber-200">{warning}</p>
          </div>
        </Card>
      ) : null}

      {data.defensor ? (
        <Seccion
          seccion={data.defensor}
          rolEstrategia="defensor"
          modoLive={modoLive}
          seleccionActiva={seleccion}
          atenuarHermanas={atenuarHermanas}
          onDesplegar={(idx, estrategia) =>
            setSeleccion({ rolEstrategia: "defensor", idx, estrategia })
          }
        />
      ) : null}
      {data.defensor && data.querellante ? <Separator /> : null}
      {data.querellante ? (
        <Seccion
          seccion={data.querellante}
          rolEstrategia="querellante"
          modoLive={modoLive}
          seleccionActiva={seleccion}
          atenuarHermanas={atenuarHermanas}
          onDesplegar={(idx, estrategia) =>
            setSeleccion({ rolEstrategia: "querellante", idx, estrategia })
          }
        />
      ) : null}

      {articulos.length > 0 ? (
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Artículos consultados
          </p>
          <div className="flex flex-wrap gap-1.5">
            {articulos.map((a) => (
              <span
                key={a}
                className="text-xs px-2 py-0.5 rounded bg-muted font-mono"
              >
                {a}
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      <BusquedasRag busquedas={busquedas} />

      {seleccion && modoLive ? (
        <ModalDesplegue
          ejecucionId={ejecucionId!}
          caso={caso!}
          seleccion={seleccion}
          flowState={flowState}
          onFlowChange={setFlowState}
          onClose={cerrarModal}
        />
      ) : null}
    </div>
  );
}

// === Sección por rol ===========================================================

function Seccion({
  seccion,
  rolEstrategia,
  modoLive,
  seleccionActiva,
  atenuarHermanas,
  onDesplegar,
}: {
  seccion: SeccionAnalisis;
  rolEstrategia: RolEstrategia;
  modoLive: boolean;
  seleccionActiva: Seleccion | null;
  atenuarHermanas: boolean;
  onDesplegar: (idx: number, estrategia: Estrategia) => void;
}) {
  const cantidad = seccion.estrategias.length;
  // Warning visible cuando el modelo no devolvió las 3 estrategias esperadas
  // (la regla del prompt es "exactamente 3 por rol" pero por defensa en
  // profundidad toleramos otros valores).
  const cantidadInesperada = cantidad !== 3 && cantidad > 0;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-serif text-2xl">{seccion.rol}</h3>
        {(seccion.imputados_identificados.length > 0 ||
          seccion.delitos_imputables.length > 0) && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {seccion.imputados_identificados.map((i) => (
              <span
                key={`imp-${i}`}
                className="text-xs px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/30"
              >
                {i}
              </span>
            ))}
            {seccion.delitos_imputables.map((d) => (
              <span
                key={`del-${d}`}
                className="text-xs px-2 py-0.5 rounded bg-destructive/15 text-destructive border border-destructive/30"
              >
                {d}
              </span>
            ))}
          </div>
        )}
      </div>

      {cantidadInesperada ? (
        <Card className="p-3 border-amber-500/40 bg-amber-500/5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-500" />
            <p className="text-xs text-amber-800 dark:text-amber-200">
              El modelo devolvió {cantidad}{" "}
              {cantidad === 1 ? "estrategia" : "estrategias"} para este rol en
              lugar de las 3 esperadas (una por perfil). Mostramos lo recibido.
            </p>
          </div>
        </Card>
      ) : null}

      <div
        className={cn(
          "grid grid-cols-1 gap-4",
          cantidad === 3
            ? "md:grid-cols-3"
            : cantidad === 2
              ? "md:grid-cols-2"
              : "md:grid-cols-1",
        )}
      >
        {seccion.estrategias.map((e, idx) => {
          const isSeleccionada =
            seleccionActiva?.rolEstrategia === rolEstrategia &&
            seleccionActiva?.idx === idx;
          const isAtenuada = atenuarHermanas && !isSeleccionada;
          return (
            <EstrategiaCard
              key={`${rolEstrategia}-${idx}`}
              estrategia={e}
              modoLive={modoLive}
              isAtenuada={isAtenuada}
              onDesplegar={() => onDesplegar(idx, e)}
            />
          );
        })}
      </div>
    </div>
  );
}

// === Card individual ===========================================================

function EstrategiaCard({
  estrategia,
  modoLive,
  isAtenuada,
  onDesplegar,
}: {
  estrategia: Estrategia;
  modoLive: boolean;
  isAtenuada: boolean;
  onDesplegar: () => void;
}) {
  const colores = COLORES_TIPO[estrategia.tipo];
  // Fallback defensivo: aunque el schema garantiza resumen_ejecutivo no
  // vacío por el preprocess, si por algún edge case llegara vacío caemos
  // a tesis_central truncada para no mostrar una card sin contenido.
  const preview =
    estrategia.resumen_ejecutivo && estrategia.resumen_ejecutivo.trim().length > 0
      ? estrategia.resumen_ejecutivo
      : estrategia.tesis_central.slice(0, 240).trim();

  return (
    <Card
      className={cn(
        "p-6 space-y-4 border-t-[3px] flex flex-col transition-opacity",
        colores.borde,
        isAtenuada && "opacity-50",
      )}
    >
      <div className="space-y-2">
        <Badge variant="outline" className={cn("border", colores.badge)}>
          {colores.label}
        </Badge>
        <h4 className="font-serif text-xl leading-tight">{estrategia.nombre}</h4>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground flex-1">
        {preview}
      </p>

      {modoLive ? (
        <Button
          variant="outline"
          className="w-full"
          onClick={onDesplegar}
          disabled={isAtenuada}
        >
          Desplegar
        </Button>
      ) : (
        // Modo lectura (historial): el contenido se expande inline en lugar
        // de abrir un modal. Evita Dialog dentro de Dialog (que es lo que
        // hay en historial-detalle.tsx, que ya envuelve este componente en
        // su propio Dialog).
        <ContenidoColapsableLectura estrategia={estrategia} />
      )}
    </Card>
  );
}

// === Contenido completo (compartido por modal y collapsible lectura) ==========

function ContenidoEstrategia({ estrategia }: { estrategia: Estrategia }) {
  const e = estrategia;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
          Tesis central
        </p>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {e.tesis_central}
        </p>
      </div>

      {e.fundamento_legal.length > 0 ? (
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
            Fundamento legal
          </p>
          <ul className="text-sm space-y-1 list-disc pl-5">
            {e.fundamento_legal.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {e.doctrina_aplicable ? (
        <div className="border-l-2 border-primary/40 pl-3 italic text-sm text-muted-foreground">
          {e.doctrina_aplicable}
        </div>
      ) : null}

      {/* Va DESPUÉS del fundamento normativo y la doctrina, no antes: es el
          orden en el que se construye la estrategia (hechos → dogmática →
          hipótesis → precedente) y el orden en que conviene leerla. */}
      <JurisprudenciaEstrategia
        citas={e.jurisprudencia_aplicable}
        nota={e.nota_jurisprudencia}
      />

      {(e.fortalezas.length > 0 || e.riesgos.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {e.fortalezas.length > 0 ? (
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                Fortalezas
              </p>
              <ul className="text-sm space-y-1.5">
                {e.fortalezas.map((f, i) => (
                  <li key={i} className="flex gap-2">
                    <CheckCircle className="size-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-500" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {e.riesgos.length > 0 ? (
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                Riesgos
              </p>
              <ul className="text-sm space-y-1.5">
                {e.riesgos.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-500" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      {e.pasos_procesales.length > 0 ? (
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
            Pasos procesales
          </p>
          <ol className="text-sm space-y-1 list-decimal pl-5">
            {e.pasos_procesales.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function ContenidoColapsableLectura({
  estrategia,
}: {
  estrategia: Estrategia;
}) {
  return (
    <Collapsible className="space-y-3">
      <CollapsibleTrigger
        render={
          <Button
            variant="outline"
            className="group w-full"
          />
        }
      >
        <span className="group-data-open:hidden">Desplegar</span>
        <span className="hidden group-data-open:inline">Ocultar</span>
        <ChevronDown className="size-4 ml-1.5 transition-transform group-data-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-2">
        <ContenidoEstrategia estrategia={estrategia} />
      </CollapsibleContent>
    </Collapsible>
  );
}

// === Modal de despliegue (modo live) ===========================================

type FlowState = "inicial" | "confirmando" | "ingresando_titulo";

function ModalDesplegue({
  ejecucionId,
  caso,
  seleccion,
  flowState,
  onFlowChange,
  onClose,
}: {
  ejecucionId: string;
  caso: string;
  seleccion: Seleccion;
  flowState: FlowState;
  onFlowChange: (s: FlowState) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const { estrategia, rolEstrategia, idx } = seleccion;
  const colores = COLORES_TIPO[estrategia.tipo];

  const [titulo, setTitulo] = useState(() => sugerirTitulo(caso));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tituloOk = titulo.trim().length > 0 && titulo.trim().length <= 500;

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    // Si está cargando, bloqueamos cierre — el POST a /api/casos está en
    // vuelo y el redirect lo desmonta cuando termine OK.
    if (loading) return;
    setError(null);
    onClose();
  };

  // inicial → confirmando: el usuario tocó "Seleccionar".
  const handleSeleccionar = () => {
    setError(null);
    onFlowChange("confirmando");
  };

  // confirmando → ingresando_titulo: el usuario tocó "Confirmar".
  const handleConfirmarAvance = () => {
    setError(null);
    onFlowChange("ingresando_titulo");
  };

  // Cancelar desde cualquier paso > inicial vuelve a inicial. El spec
  // dice "vuelve al estado anterior" pero como solo hay 3 estados y
  // "anterior" siempre es inicial, simplificamos.
  const handleCancelar = () => {
    setError(null);
    onFlowChange("inicial");
  };

  const handleCrear = async () => {
    if (loading || !tituloOk) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/casos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          titulo: titulo.trim(),
          ejecucion_origen_id: ejecucionId,
          rol_estrategia: rolEstrategia,
          // idx_estrategia es el ÍNDICE del array original, no el `numero` ni
          // un orden visual. El backend hace `estrategias[idx_estrategia]`,
          // así que enviar el orden del array es lo que persiste la
          // estrategia correcta — mantenerlo así si en el futuro se reordena
          // visualmente.
          idx_estrategia: idx,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; caso_id: string }
        | { ok: false; error: string }
        | null;

      if (!res.ok || !json || ("ok" in json && json.ok === false)) {
        const msg =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : `Error creando caso (HTTP ${res.status})`;
        setError(msg);
        setLoading(false);
        return;
      }

      router.push(`/dashboard/mis-casos/${json.caso_id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error de red";
      setError(msg);
      setLoading(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-3xl max-h-[85vh] overflow-y-auto"
        showCloseButton={!loading}
      >
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={cn("border", colores.badge)}
            >
              {colores.label}
            </Badge>
          </div>
          <DialogTitle className="font-serif text-2xl mt-2">
            {estrategia.nombre}
          </DialogTitle>
        </DialogHeader>

        {flowState === "ingresando_titulo" ? (
          <div className="space-y-2 pt-2">
            <Label htmlFor="titulo-caso">Título del caso</Label>
            <Input
              id="titulo-caso"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              disabled={loading}
              maxLength={500}
              autoFocus
            />
            {!tituloOk ? (
              <p className="text-xs text-muted-foreground">
                El título no puede estar vacío.
              </p>
            ) : null}
          </div>
        ) : null}

        <ContenidoEstrategia estrategia={estrategia} />

        {error ? (
          <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {flowState === "inicial" ? (
          <DialogFooter>
            <Button
              className="w-full sm:w-auto sm:ml-auto"
              onClick={handleSeleccionar}
            >
              Seleccionar
            </Button>
          </DialogFooter>
        ) : flowState === "confirmando" ? (
          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            <p className="text-sm text-muted-foreground sm:mr-auto">
              ¿Deseas avanzar con esta estrategia?
            </p>
            <Button variant="link" size="sm" onClick={handleCancelar}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmarAvance} className="sm:w-auto">
              Confirmar
            </Button>
          </DialogFooter>
        ) : (
          // ingresando_titulo
          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button
              variant="link"
              size="sm"
              onClick={handleCancelar}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCrear}
              disabled={loading || !tituloOk}
              className="sm:w-auto"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : null}
              {loading ? "Creando..." : "Crear caso"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
