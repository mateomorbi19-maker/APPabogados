"use client";
// «Nuevo reporte»: el flujo entero, dentro de la ficha.
//
//   1. A QUIÉN, QUÉ Y POR DÓNDE. La persona (sólo las marcadas como cliente),
//      la plantilla (el sistema sugiere una y dice por qué), la variante si la
//      plantilla la tiene, y el canal.
//   2. LO QUE SABE EL SISTEMA Y LO QUE PONÉS VOS. Se muestra qué datos de la
//      causa se van a usar y cuáles faltan, y el formulario corto con el
//      criterio profesional de esa plantilla. Nada de eso lo inventa la app.
//   3. GENERANDO. Unos segundos. Las variantes de peores noticias no pasan
//      por el modelo: el cuerpo lo escribe el abogado en el detalle.
//
// Al terminar, el reporte se abre en su detalle para leerlo entero antes de
// mandarlo.

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  NIVELES_MODELO,
  NIVEL_DEFAULT,
  NIVEL_DESCRIPCION,
  NIVEL_LABEL,
  type NivelModelo,
} from "@/lib/agent/modelos";
import type { Caso, ParteCaso } from "@/lib/types";
import {
  CANALES_REPORTE,
  CANAL_REPORTE_LABEL,
  type CanalReporte,
  type PlantillaReporte,
  type ReporteCliente,
} from "@/lib/reporteria/types";
import {
  camposAplicables,
  PLANTILLAS,
  plantillaPorId,
  variantePorId,
  type CampoCriterio,
} from "@/lib/reporteria/plantillas";
import type { DatosReporte } from "@/lib/reporteria/datos";
import type { SugerenciaPlantilla } from "@/lib/reporteria/sugerir";

// Novena copia (ver la nota en ficha-form.tsx).
const SELECT_CLS =
  "h-9 max-md:h-10 w-full rounded-md border border-input bg-transparent text-foreground px-2 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-50";

type Props = {
  open: boolean;
  caso: Caso;
  partes: ParteCaso[];
  onClose: () => void;
  onGenerado: (reporte: ReporteCliente) => void;
};

type Paso = "elegir" | "criterio" | "generando";

type Prevuelo = {
  datos: DatosReporte;
  sugerencia: SugerenciaPlantilla;
  faltantes_por_plantilla: Record<PlantillaReporte, string[]>;
  costo_estimado_usd: number;
  duracion_estimada_s: string;
};

type Criterio = Record<string, string | boolean>;

export function NuevoReporteDialog({ open, caso, partes, onClose, onGenerado }: Props) {
  const [paso, setPaso] = useState<Paso>("elegir");
  const [prevuelo, setPrevuelo] = useState<Prevuelo | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [parteId, setParteId] = useState<string | null>(null);
  const [plantillaId, setPlantillaId] = useState<PlantillaReporte>("P01");
  const [varianteId, setVarianteId] = useState<string | null>(null);
  const [canal, setCanal] = useState<CanalReporte>("whatsapp");
  const [criterio, setCriterio] = useState<Criterio>({});
  const [nivel, setNivel] = useState<NivelModelo>(NIVEL_DEFAULT);
  const [error, setError] = useState<string | null>(null);

  const clientes = partes.filter((p) => p.es_cliente);

  // Re-sembrar al abrir, durante el render (patrón de ficha-form.tsx).
  const [abiertoAntes, setAbiertoAntes] = useState(open);
  if (open !== abiertoAntes) {
    setAbiertoAntes(open);
    if (open) {
      setPaso("elegir");
      setPrevuelo(null);
      setParteId(clientes.length === 1 ? clientes[0].id : null);
      setCriterio({});
      setError(null);
      setErrorCarga(null);
      setCargando(true);
    }
  }

  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    if (!open) return;
    let vivo = true;
    fetch(`/api/casos/${caso.id}/reportes/preparar`)
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        if (!j?.ok) {
          setErrorCarga(j?.error ?? "No pude preparar el reporte");
          return;
        }
        const pv = j as Prevuelo;
        setPrevuelo(pv);
        setPlantillaId(pv.sugerencia.plantilla);
        const p = plantillaPorId(pv.sugerencia.plantilla);
        setVarianteId(p && p.variantes.length > 0 ? p.variantes[0].id : null);
        setCanal(p?.canal_sugerido ?? "whatsapp");
      })
      .catch(() => {
        if (vivo) setErrorCarga("No pude preparar el reporte. Revisá la conexión.");
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [open, caso.id, recarga]);

  const plantilla = plantillaPorId(plantillaId);
  const variante = plantilla ? variantePorId(plantilla, varianteId) : null;
  const destinatario = clientes.find((p) => p.id === parteId) ?? null;
  const campos = plantilla ? camposAplicables(plantilla, variante?.id ?? null, criterio) : [];
  const faltanRequeridos = campos.filter(
    (c) => c.requerido && !(typeof criterio[c.clave] === "string" && (criterio[c.clave] as string).trim()),
  );
  const sinIa = !!variante?.sin_ia;

  const elegirPlantilla = (id: PlantillaReporte) => {
    setPlantillaId(id);
    const p = plantillaPorId(id);
    setVarianteId(p && p.variantes.length > 0 ? p.variantes[0].id : null);
    setCanal(p?.canal_sugerido ?? "whatsapp");
    setCriterio({});
  };

  const handleClose = () => {
    if (paso === "generando") return;
    onClose();
  };

  const generar = async () => {
    if (!plantilla || !parteId) return;
    setPaso("generando");
    setError(null);
    try {
      const res = await fetch(`/api/casos/${caso.id}/reportes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parte_id: parteId,
          plantilla: plantilla.id,
          variante: variante?.id ?? null,
          canal,
          criterio,
          nivel,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; reporte: ReporteCliente }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !json || json.ok !== true) {
        setError(json && json.ok === false ? json.error : "No se pudo generar el reporte");
        setPaso("criterio");
        return;
      }
      onGenerado(json.reporte);
    } catch {
      setError("No se pudo generar el reporte. Revisá la conexión.");
      setPaso("criterio");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose();
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-2xl"
        showCloseButton={paso !== "generando"}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>
            {paso === "elegir"
              ? "Nuevo reporte al cliente"
              : paso === "criterio"
                ? `${plantilla?.codigo} · ${plantilla?.titulo}`
                : "Generando el reporte"}
          </DialogTitle>
          {paso === "elegir" ? (
            <p className="text-xs text-muted-foreground">
              Paso 1 de 2 · a quién, con qué plantilla y por qué canal
            </p>
          ) : paso === "criterio" ? (
            <p className="text-xs text-muted-foreground">
              Paso 2 de 2 · lo que sabe el sistema y lo que ponés vos
            </p>
          ) : null}
        </DialogHeader>

        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
          {cargando ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Leyendo la causa…
            </div>
          ) : errorCarga ? (
            <div className="space-y-3 py-6 text-center">
              <p className="text-sm text-destructive">{errorCarga}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCargando(true);
                  setErrorCarga(null);
                  setRecarga((n) => n + 1);
                }}
              >
                Reintentar
              </Button>
            </div>
          ) : paso === "elegir" && prevuelo ? (
            <PasoElegir
              clientes={clientes}
              parteId={parteId}
              setParteId={setParteId}
              plantillaId={plantillaId}
              elegirPlantilla={elegirPlantilla}
              varianteId={varianteId}
              setVarianteId={(v) => {
                setVarianteId(v);
                setCriterio({});
              }}
              canal={canal}
              setCanal={setCanal}
              sugerencia={prevuelo.sugerencia}
              destinatario={destinatario}
            />
          ) : paso === "criterio" && prevuelo && plantilla ? (
            <PasoCriterio
              prevuelo={prevuelo}
              plantillaId={plantillaId}
              campos={campos}
              criterio={criterio}
              setCriterio={setCriterio}
              sinIa={sinIa}
              nivel={nivel}
              setNivel={setNivel}
              error={error}
              esQuerella={caso.rol === "querellante"}
              destinatario={destinatario}
              canal={canal}
            />
          ) : paso === "generando" ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Loader2 className="size-6 animate-spin text-[var(--el-violet-light)]" />
              <p className="text-sm text-[var(--el-text)]">
                {sinIa ? "Armando el borrador…" : "Redactando el mensaje…"}
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">
                {sinIa
                  ? "Esta variante no pasa por la IA: el cuerpo lo escribís vos."
                  : `Suele tardar ${prevuelo?.duracion_estimada_s ?? "10-25"} segundos. No cierres la ventana.`}
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 sm:justify-between">
          <div className="text-xs text-muted-foreground">
            {paso === "criterio" && prevuelo && !sinIa
              ? `Costo estimado: USD ${prevuelo.costo_estimado_usd.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : null}
          </div>
          <div className="flex gap-2">
            {paso === "elegir" ? (
              <>
                <Button variant="outline" onClick={handleClose}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => setPaso("criterio")}
                  disabled={!prevuelo || !parteId || !plantilla || (plantilla.variantes.length > 0 && !variante)}
                >
                  Siguiente
                </Button>
              </>
            ) : paso === "criterio" ? (
              <>
                <Button variant="outline" onClick={() => setPaso("elegir")}>
                  Atrás
                </Button>
                <Button onClick={generar} disabled={faltanRequeridos.length > 0}>
                  <Sparkles className="size-4" />
                  {sinIa ? "Armar borrador" : "Generar"}
                </Button>
              </>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ————————————————————————————————————————————————————————————————
// Paso 1
// ————————————————————————————————————————————————————————————————

function PasoElegir({
  clientes,
  parteId,
  setParteId,
  plantillaId,
  elegirPlantilla,
  varianteId,
  setVarianteId,
  canal,
  setCanal,
  sugerencia,
  destinatario,
}: {
  clientes: ParteCaso[];
  parteId: string | null;
  setParteId: (id: string) => void;
  plantillaId: PlantillaReporte;
  elegirPlantilla: (id: PlantillaReporte) => void;
  varianteId: string | null;
  setVarianteId: (id: string) => void;
  canal: CanalReporte;
  setCanal: (c: CanalReporte) => void;
  sugerencia: SugerenciaPlantilla;
  destinatario: ParteCaso | null;
}) {
  const plantilla = plantillaPorId(plantillaId);
  return (
    <div className="space-y-5 py-1">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">¿A quién?</legend>
        {clientes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay personas marcadas como cliente del estudio. Marcá una en el bloque Partes.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {clientes.map((p) => (
              <label
                key={p.id}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-sm",
                  parteId === p.id ? "border-[var(--el-violet)] bg-[var(--el-violet)]/8" : "border-border",
                )}
              >
                <input
                  type="radio"
                  name="destinatario"
                  className="mt-0.5"
                  checked={parteId === p.id}
                  onChange={() => setParteId(p.id)}
                />
                <span className="min-w-0">
                  <span className="block font-medium">{p.nombre}</span>
                  <span className="block text-xs text-muted-foreground">
                    {p.email ?? "sin correo"} · {p.telefono ?? "sin teléfono"}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">¿Qué plantilla?</legend>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[var(--el-violet-light)]" />
          <span>
            Sugerida: <strong>{sugerencia.plantilla.replace(/^P0?/, "P-")}</strong>. {sugerencia.motivo}
          </span>
        </p>
        <div className="grid gap-2">
          {PLANTILLAS.map((p) => (
            <label
              key={p.id}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-sm",
                plantillaId === p.id ? "border-[var(--el-violet)] bg-[var(--el-violet)]/8" : "border-border",
              )}
            >
              <input
                type="radio"
                name="plantilla"
                className="mt-0.5"
                checked={plantillaId === p.id}
                onChange={() => elegirPlantilla(p.id)}
              />
              <span className="min-w-0">
                <span className="block font-medium">
                  {p.codigo} · {p.titulo}
                  {sugerencia.plantilla === p.id ? (
                    <span className="ml-2 rounded-full bg-[var(--el-violet)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--el-violet-light)]">
                      sugerida
                    </span>
                  ) : null}
                </span>
                <span className="block text-xs text-muted-foreground">{p.cuando}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {plantilla && plantilla.variantes.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">¿Qué resolvió el tribunal?</legend>
          <div className="grid gap-2">
            {plantilla.variantes.map((v) => (
              <label
                key={v.id}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-sm",
                  varianteId === v.id ? "border-[var(--el-violet)] bg-[var(--el-violet)]/8" : "border-border",
                )}
              >
                <input
                  type="radio"
                  name="variante"
                  className="mt-0.5"
                  checked={varianteId === v.id}
                  onChange={() => setVarianteId(v.id)}
                />
                <span className="min-w-0">
                  <span className="block font-medium">
                    {v.label}
                    {v.sin_ia ? (
                      <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        sin IA
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">{v.descripcion}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="r-canal">¿Por dónde?</Label>
        <select
          id="r-canal"
          className={SELECT_CLS}
          value={canal}
          onChange={(e) => setCanal(e.target.value as CanalReporte)}
        >
          {CANALES_REPORTE.map((c) => (
            <option key={c} value={c}>
              {CANAL_REPORTE_LABEL[c]}
              {plantilla?.canal_sugerido === c ? " (sugerido)" : ""}
            </option>
          ))}
        </select>
        {canal === "email" && destinatario && !destinatario.email ? (
          <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {destinatario.nombre} no tiene correo cargado. Podés generar igual y cargarlo en Partes antes de enviar.
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
// Paso 2
// ————————————————————————————————————————————————————————————————

function PasoCriterio({
  prevuelo,
  plantillaId,
  campos,
  criterio,
  setCriterio,
  sinIa,
  nivel,
  setNivel,
  error,
  esQuerella,
  destinatario,
  canal,
}: {
  prevuelo: Prevuelo;
  plantillaId: PlantillaReporte;
  campos: CampoCriterio[];
  criterio: Criterio;
  setCriterio: (c: Criterio) => void;
  sinIa: boolean;
  nivel: NivelModelo;
  setNivel: (n: NivelModelo) => void;
  error: string | null;
  esQuerella: boolean;
  destinatario: ParteCaso | null;
  canal: CanalReporte;
}) {
  const d = prevuelo.datos;
  const faltantes = prevuelo.faltantes_por_plantilla[plantillaId] ?? [];
  const set = (clave: string, valor: string | boolean) =>
    setCriterio({ ...criterio, [clave]: valor });

  const sabidos: Array<[string, string | null]> = [
    ["Cliente", destinatario?.nombre ?? null],
    ["Etapa", d.etapa ? `${d.etapa.label} → «${d.etapa.coloquial}»` : null],
    [
      "Último movimiento",
      d.ultimo_movimiento ? `${d.ultimo_movimiento.fecha}: ${d.ultimo_movimiento.descripcion}` : null,
    ],
    [
      "Próximo en la agenda",
      d.proximos[0] ? `${d.proximos[0].fecha}${d.proximos[0].hora ? ` ${d.proximos[0].hora}` : ""} — ${d.proximos[0].titulo}` : null,
    ],
    ["Juez", d.valores.NOMBRE_JUEZ ?? null],
    ["Tribunal", d.valores.JUZGADO_O_TRIBUNAL ?? null],
    ["Firma", d.valores.NOMBRE_ABOGADO ?? null],
  ];

  return (
    <div className="space-y-5 py-1">
      <section className="rounded-md border border-border p-3">
        <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Lo que ya sabe el sistema
        </h3>
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          {sabidos.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className={cn("min-w-0 break-words", !v && "text-muted-foreground italic")}>
                {v ?? "no cargado"}
              </dd>
            </div>
          ))}
        </dl>
        {faltantes.length > 0 ? (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Van a quedar como <code>[FALTA: …]</code>: {faltantes.join(", ")}. Se completan a mano antes de enviar, o cargalos en la ficha.
            </span>
          </p>
        ) : null}
        {esQuerella ? (
          <p className="mt-2 text-xs text-muted-foreground">
            El estudio actúa como querella: las plantillas están escritas desde la defensa y el redactor adapta la perspectiva. Leé el resultado con eso en mente.
          </p>
        ) : null}
      </section>

      {sinIa ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          Esta variante no pasa por la IA. La app arma el encabezado y el cierre; el cuerpo del mensaje lo escribís vos en el paso siguiente, sobre la marca [REDACTAR].
        </p>
      ) : null}

      {campos.length > 0 ? (
        <section className="space-y-4">
          <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Tu criterio
          </h3>
          {campos.map((c) => {
            const propuesto = d.valores[c.clave] ?? null;
            const valor = criterio[c.clave];
            if (c.tipo === "checkbox") {
              return (
                <label key={c.clave} className="flex items-start gap-2.5 rounded-md border border-border p-3">
                  <Checkbox
                    checked={valor === true}
                    onCheckedChange={(v) => set(c.clave, v === true)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{c.label}</span>
                    {c.ayuda ? (
                      <span className="block text-xs text-muted-foreground">{c.ayuda}</span>
                    ) : null}
                  </span>
                </label>
              );
            }
            if (c.tipo === "opciones") {
              return (
                <div key={c.clave} className="space-y-1.5">
                  <Label htmlFor={`c-${c.clave}`}>
                    {c.label}
                    {c.requerido ? " *" : ""}
                  </Label>
                  <select
                    id={`c-${c.clave}`}
                    className={SELECT_CLS}
                    value={typeof valor === "string" ? valor : ""}
                    onChange={(e) => set(c.clave, e.target.value)}
                  >
                    <option value="">Elegí una opción</option>
                    {(c.opciones ?? []).map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {c.ayuda ? <p className="text-xs text-muted-foreground">{c.ayuda}</p> : null}
                </div>
              );
            }
            const Campo = c.tipo === "textarea" ? Textarea : Input;
            return (
              <div key={c.clave} className="space-y-1.5">
                <Label htmlFor={`c-${c.clave}`}>
                  {c.label}
                  {c.requerido ? " *" : ""}
                </Label>
                <Campo
                  id={`c-${c.clave}`}
                  value={typeof valor === "string" ? valor : ""}
                  onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                    set(c.clave, e.target.value)
                  }
                  placeholder={c.placeholder}
                  maxLength={2000}
                  className={c.tipo === "textarea" ? "min-h-[72px]" : undefined}
                />
                {propuesto ? (
                  <p className="text-xs text-muted-foreground">
                    Propuesto por el sistema si lo dejás vacío: «{propuesto}»
                  </p>
                ) : c.ayuda ? (
                  <p className="text-xs text-muted-foreground">{c.ayuda}</p>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {!sinIa ? (
        <div className="space-y-1.5">
          <Label htmlFor="r-nivel">Nivel del modelo</Label>
          <select
            id="r-nivel"
            className={SELECT_CLS}
            value={nivel}
            onChange={(e) => setNivel(e.target.value as NivelModelo)}
          >
            {NIVELES_MODELO.map((n) => (
              <option key={n} value={n}>
                {NIVEL_LABEL[n]} — {NIVEL_DESCRIPCION[n]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {canal === "email" && destinatario && !destinatario.email ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Recordá cargar el correo de {destinatario.nombre} en Partes antes de enviar.
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
