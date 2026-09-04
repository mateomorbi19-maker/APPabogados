"use client";
// "Generar escrito": el flujo entero, dentro de la ficha.
//
// Dos pasos y una espera:
//
//   1. ELEGIR EL MODELO. Los 50 del estudio y los propios en dos pestañas
//      (Gonzalo: "diferenciar por flujos el modelo que trajo el abogado del
//      que nosotros cargamos"), con búsqueda, categoría y el filtro por el rol
//      del estudio en la causa. Desde acá también se carga un modelo nuevo, se
//      duplica uno del estudio para adaptarlo, o se le pregunta a LEXIE cuál
//      conviene.
//   2. DATOS E INSTRUCCIONES. Antes de gastar en una generación, el abogado ve
//      exactamente qué datos del expediente va a usar el redactor y cuáles
//      faltan (van a quedar como [COMPLETAR]). Los datos del profesional
//      —firma, matrícula, domicilios— se completan acá mismo la primera vez y
//      quedan guardados en su perfil.
//   3. GENERANDO. 30 a 90 segundos: el redactor verifica artículos y busca un
//      precedente. El diálogo no se puede cerrar mientras tanto, porque la
//      request ya está en vuelo y se cobra igual.
//
// Al terminar, el escrito se abre en su detalle para leerlo y corregirlo.

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Plus,
  Search,
  Sparkles,
  Copy,
  Pencil,
  Archive,
  AlertTriangle,
  Check,
} from "lucide-react";
import { toast } from "sonner";
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
import { nombreCaso } from "@/lib/casos/nombre";
import {
  NIVELES_MODELO,
  NIVEL_DEFAULT,
  NIVEL_DESCRIPCION,
  NIVEL_LABEL,
  type NivelModelo,
} from "@/lib/agent/modelos";
import type { Caso, ParteCaso } from "@/lib/types";
import {
  CATEGORIAS_ESCRITO,
  CATEGORIA_ESCRITO_LABEL,
  ORIGEN_MODELO_LABEL,
  type CategoriaEscrito,
  type EscritoGenerado,
  type ModeloEscrito,
  type ModeloEscritoResumen,
  type PerfilProfesional,
} from "@/lib/escritos/types";
import { filtrarModelos } from "@/lib/escritos/filtrar";
import { armarDatosEscrito } from "@/lib/escritos/datos-causa";
import { ModeloForm } from "./modelo-form";

// Octava copia (ver la nota en ficha-form.tsx).
const SELECT_CLS =
  "h-9 max-md:h-10 w-full rounded-md border border-input bg-transparent text-foreground px-2 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-50";

type Props = {
  open: boolean;
  caso: Caso;
  partes: ParteCaso[];
  onClose: () => void;
  onGenerado: (escrito: EscritoGenerado) => void;
};

type Paso = "modelo" | "datos" | "generando";
type Pestana = "estudio" | "propios";

const PERFIL_VACIO: PerfilProfesional = {
  nombre_completo: null,
  matricula: null,
  domicilio_constituido: null,
  domicilio_electronico: null,
};

type PerfilForm = Record<keyof PerfilProfesional, string>;

function perfilAForm(p: PerfilProfesional): PerfilForm {
  return {
    nombre_completo: p.nombre_completo ?? "",
    matricula: p.matricula ?? "",
    domicilio_constituido: p.domicilio_constituido ?? "",
    domicilio_electronico: p.domicilio_electronico ?? "",
  };
}

function formAPerfil(f: PerfilForm): PerfilProfesional {
  const v = (s: string) => (s.trim() ? s.trim() : null);
  return {
    nombre_completo: v(f.nombre_completo),
    matricula: v(f.matricula),
    domicilio_constituido: v(f.domicilio_constituido),
    domicilio_electronico: v(f.domicilio_electronico),
  };
}

export function GenerarEscritoDialog({
  open,
  caso,
  partes,
  onClose,
  onGenerado,
}: Props) {
  const [paso, setPaso] = useState<Paso>("modelo");
  const [modelos, setModelos] = useState<ModeloEscritoResumen[] | null>(null);
  const [perfil, setPerfil] = useState<PerfilProfesional>(PERFIL_VACIO);
  const [perfilForm, setPerfilForm] = useState<PerfilForm>(perfilAForm(PERFIL_VACIO));
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [pestana, setPestana] = useState<Pestana>("estudio");
  const [q, setQ] = useState("");
  const [categoria, setCategoria] = useState<CategoriaEscrito | "">("");
  const [soloMiRol, setSoloMiRol] = useState(true);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);

  const [instrucciones, setInstrucciones] = useState("");
  const [nivel, setNivel] = useState<NivelModelo>(NIVEL_DEFAULT);
  const [error, setError] = useState<string | null>(null);

  const [modeloFormOpen, setModeloFormOpen] = useState(false);
  const [semilla, setSemilla] = useState<ModeloEscrito | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  // Re-sembrar al abrir, durante el render (ver ficha-form.tsx). La carga de
  // red sí va en un efecto: es un side effect, no estado derivado.
  const [abiertoAntes, setAbiertoAntes] = useState(open);
  if (open !== abiertoAntes) {
    setAbiertoAntes(open);
    if (open) {
      setPaso("modelo");
      setSeleccionado(null);
      setInstrucciones("");
      setError(null);
      setQ("");
      setCategoria("");
      setSoloMiRol(true);
      setPestana("estudio");
      setCargando(true);
      setErrorCarga(null);
    }
  }

  // La carga de red. Todo setState va adentro de los callbacks de la promesa
  // (el lint del repo prohíbe setearlo sincrónicamente en el cuerpo del
  // efecto). `recarga` es el contador que "Reintentar" bumpea para volver a
  // correrlo.
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    if (!open) return;
    let vivo = true;
    Promise.all([
      fetch("/api/escritos/modelos").then((r) => r.json()),
      fetch("/api/perfil").then((r) => r.json()),
    ])
      .then(([rm, rp]) => {
        if (!vivo) return;
        if (!rm?.ok) {
          setErrorCarga(rm?.error ?? "No pude cargar los modelos");
          return;
        }
        setModelos(rm.modelos as ModeloEscritoResumen[]);
        if (rp?.ok) {
          setPerfil(rp.perfil as PerfilProfesional);
          setPerfilForm(perfilAForm(rp.perfil as PerfilProfesional));
        }
      })
      .catch(() => {
        if (vivo) setErrorCarga("No pude cargar los modelos. Revisá la conexión.");
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [open, recarga]);

  const reintentar = () => {
    setCargando(true);
    setErrorCarga(null);
    setRecarga((n) => n + 1);
  };

  const rolFiltro = soloMiRol && caso.rol !== "ambos" ? caso.rol : null;
  const visibles = useMemo(() => {
    if (!modelos) return [];
    const base = modelos.filter((m) =>
      pestana === "estudio" ? m.origen === "estudio" : m.origen !== "estudio",
    );
    return filtrarModelos(base, {
      q,
      categoria: categoria || null,
      rol: rolFiltro,
    });
  }, [modelos, pestana, q, categoria, rolFiltro]);

  const propiosCount = modelos?.filter((m) => m.origen !== "estudio").length ?? 0;
  const modeloElegido = modelos?.find((m) => m.id === seleccionado) ?? null;

  const datos = useMemo(
    () => armarDatosEscrito(caso, partes, formAPerfil(perfilForm)),
    [caso, partes, perfilForm],
  );

  const perfilDirty =
    JSON.stringify(formAPerfil(perfilForm)) !== JSON.stringify(perfil);

  const handleClose = () => {
    if (paso === "generando") return;
    onClose();
  };

  // --- Acciones sobre modelos ---

  const traerCompleto = async (id: string): Promise<ModeloEscrito | null> => {
    const r = await fetch(`/api/escritos/modelos/${id}`).then((x) => x.json());
    return r?.ok ? (r.modelo as ModeloEscrito) : null;
  };

  const duplicar = async (m: ModeloEscritoResumen) => {
    setOcupado(m.id);
    try {
      const completo = await traerCompleto(m.id);
      if (!completo) {
        toast.error("No pude abrir el modelo");
        return;
      }
      setSemilla(completo);
      setModeloFormOpen(true);
    } finally {
      setOcupado(null);
    }
  };

  const editar = async (m: ModeloEscritoResumen) => duplicar(m);

  const archivar = async (m: ModeloEscritoResumen) => {
    if (!window.confirm(`¿Archivar el modelo "${m.titulo}"?`)) return;
    setOcupado(m.id);
    try {
      const res = await fetch(`/api/escritos/modelos/${m.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("No se pudo archivar el modelo");
        return;
      }
      setModelos((prev) => prev?.filter((x) => x.id !== m.id) ?? prev);
      if (seleccionado === m.id) setSeleccionado(null);
      toast.success("Modelo archivado");
    } finally {
      setOcupado(null);
    }
  };

  const handleModeloGuardado = (m: ModeloEscrito) => {
    const { cuerpo: _c, ...resumen } = m;
    void _c;
    setModelos((prev) => {
      if (!prev) return [resumen];
      const existe = prev.some((x) => x.id === m.id);
      return existe
        ? prev.map((x) => (x.id === m.id ? resumen : x))
        : [...prev, resumen];
    });
    setPestana("propios");
    setSeleccionado(m.id);
  };

  const preguntarALexie = () => {
    const mensaje = `Estoy en la causa «${nombreCaso(caso)}». ¿Qué escrito me conviene presentar ahora, y qué modelo del catálogo uso? Si no hay uno que sirva, redactámelo vos.`;
    window.dispatchEvent(
      new CustomEvent("lexie-abrir", { detail: { mensaje } }),
    );
    // El diálogo es modal (z-50) y LEXIE flota abajo (z-40): con esto abierto
    // no se podría escribirle. Se cierra; el abogado vuelve con la respuesta.
    onClose();
  };

  // --- Generar ---

  const generar = async () => {
    if (!modeloElegido || paso === "generando") return;
    setError(null);
    setPaso("generando");
    try {
      if (perfilDirty) {
        const rp = await fetch("/api/perfil", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(formAPerfil(perfilForm)),
        });
        const jp = await rp.json().catch(() => null);
        if (!rp.ok || !jp?.ok) {
          throw new Error(jp?.error ?? "No pude guardar tus datos profesionales");
        }
        setPerfil(jp.perfil as PerfilProfesional);
      }

      const res = await fetch(`/api/casos/${caso.id}/escritos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelo_id: modeloElegido.id,
          instrucciones: instrucciones,
          nivel,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; escrito: EscritoGenerado }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !json || json.ok !== true) {
        throw new Error(
          json && json.ok === false ? json.error : "No pude redactar el escrito",
        );
      }
      toast.success("Escrito redactado");
      onGenerado(json.escrito);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pude redactar el escrito");
      setPaso("datos");
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) handleClose();
        }}
      >
        {/* Altura fija (no `max-h`) a propósito: es lo que le da a la lista de
            modelos un alto definido para scrollear adentro con `flex-1`, y
            deja el pie con Siguiente/Generar siempre a la vista. Con `h-auto`
            la lista de 50 crecería entera y el botón quedaría abajo de todo. */}
        <DialogContent
          className="flex h-[calc(100dvh-2rem)] flex-col sm:max-w-3xl"
          showCloseButton={paso !== "generando"}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {paso === "modelo"
                ? "Generar escrito · Elegí el modelo"
                : paso === "datos"
                  ? "Generar escrito · Datos e instrucciones"
                  : "Redactando el escrito"}
            </DialogTitle>
          </DialogHeader>

          {paso === "modelo" ? (
            <PasoModelo
              cargando={cargando}
              errorCarga={errorCarga}
              reintentar={reintentar}
              pestana={pestana}
              setPestana={setPestana}
              propiosCount={propiosCount}
              q={q}
              setQ={setQ}
              categoria={categoria}
              setCategoria={setCategoria}
              soloMiRol={soloMiRol}
              setSoloMiRol={setSoloMiRol}
              rolCaso={caso.rol}
              visibles={visibles}
              seleccionado={seleccionado}
              setSeleccionado={setSeleccionado}
              ocupado={ocupado}
              onNuevo={() => {
                setSemilla(null);
                setModeloFormOpen(true);
              }}
              onDuplicar={duplicar}
              onEditar={editar}
              onArchivar={archivar}
              onLexie={preguntarALexie}
            />
          ) : paso === "datos" ? (
            <PasoDatos
              modelo={modeloElegido}
              datos={datos}
              perfilForm={perfilForm}
              setPerfilForm={setPerfilForm}
              instrucciones={instrucciones}
              setInstrucciones={setInstrucciones}
              nivel={nivel}
              setNivel={setNivel}
              error={error}
            />
          ) : (
            <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="size-8 animate-spin text-[var(--el-violet-light)]" />
              <p className="text-sm font-medium text-[var(--el-text)]">
                Redactando «{modeloElegido?.titulo}»
              </p>
              <p className="max-w-sm text-xs leading-relaxed text-[var(--el-text-muted)]">
                Verifica los artículos en el Código Penal y el CPPF y busca un
                precedente en el Repositorio. Suele tardar entre 30 y 90
                segundos. No cierres esta ventana.
              </p>
            </div>
          )}

          <DialogFooter className="shrink-0">
            {paso === "modelo" ? (
              <>
                <Button variant="outline" onClick={handleClose}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => setPaso("datos")}
                  disabled={!modeloElegido}
                >
                  Siguiente
                </Button>
              </>
            ) : paso === "datos" ? (
              <>
                <Button variant="outline" onClick={() => setPaso("modelo")}>
                  Atrás
                </Button>
                <Button onClick={generar} disabled={!modeloElegido}>
                  <Sparkles className="size-4" />
                  Generar escrito
                </Button>
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ModeloForm
        open={modeloFormOpen}
        semilla={semilla}
        onClose={() => setModeloFormOpen(false)}
        onSaved={handleModeloGuardado}
      />
    </>
  );
}

// ————————————————————————————————————————————————————————————————
// Paso 1: el modelo
// ————————————————————————————————————————————————————————————————

function PasoModelo(props: {
  cargando: boolean;
  errorCarga: string | null;
  reintentar: () => void;
  pestana: Pestana;
  setPestana: (p: Pestana) => void;
  propiosCount: number;
  q: string;
  setQ: (q: string) => void;
  categoria: CategoriaEscrito | "";
  setCategoria: (c: CategoriaEscrito | "") => void;
  soloMiRol: boolean;
  setSoloMiRol: (v: boolean) => void;
  rolCaso: Caso["rol"];
  visibles: ModeloEscritoResumen[];
  seleccionado: string | null;
  setSeleccionado: (id: string | null) => void;
  ocupado: string | null;
  onNuevo: () => void;
  onDuplicar: (m: ModeloEscritoResumen) => void;
  onEditar: (m: ModeloEscritoResumen) => void;
  onArchivar: (m: ModeloEscritoResumen) => void;
  onLexie: () => void;
}) {
  const {
    cargando,
    errorCarga,
    reintentar,
    pestana,
    setPestana,
    propiosCount,
    q,
    setQ,
    categoria,
    setCategoria,
    soloMiRol,
    setSoloMiRol,
    rolCaso,
    visibles,
    seleccionado,
    setSeleccionado,
    ocupado,
    onNuevo,
    onDuplicar,
    onEditar,
    onArchivar,
    onLexie,
  } = props;

  const rolLabel = rolCaso === "querellante" ? "querella" : "defensa";

  return (
    <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4">
      {/* Pestañas: los dos flujos, separados. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          className="inline-flex h-8 items-center rounded-lg bg-muted p-[3px] text-muted-foreground"
        >
          {(
            [
              ["estudio", "Del estudio · 50"],
              ["propios", `Míos · ${propiosCount}`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={pestana === k}
              onClick={() => setPestana(k)}
              className={cn(
                "h-full rounded-md px-3 text-xs font-medium transition-colors",
                pestana === k
                  ? "bg-background text-foreground shadow-sm"
                  : "hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={onLexie}>
            <Sparkles className="size-3.5" />
            ¿Cuál conviene? Preguntale a LEXIE
          </Button>
          <Button variant="outline" size="sm" onClick={onNuevo}>
            <Plus className="size-3.5" />
            Nuevo modelo
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar: excarcelación, nulidad allanamiento, apelación…"
            className="pl-8"
            autoFocus
          />
        </div>
        <select
          className={cn(SELECT_CLS, "sm:w-64")}
          value={categoria}
          onChange={(e) => setCategoria(e.target.value as CategoriaEscrito | "")}
          aria-label="Categoría"
        >
          <option value="">Todas las categorías</option>
          {CATEGORIAS_ESCRITO.map((c) => (
            <option key={c} value={c}>
              {CATEGORIA_ESCRITO_LABEL[c]}
            </option>
          ))}
        </select>
      </div>

      {rolCaso !== "ambos" ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={soloMiRol}
            onCheckedChange={(v) => setSoloMiRol(v === true)}
          />
          Solo los modelos pensados para la {rolLabel} (el rol del estudio en
          esta causa)
        </label>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border border-[var(--el-border)]">
        {cargando && !visibles.length ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Cargando modelos…
          </div>
        ) : errorCarga ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm">
            <p className="text-destructive">{errorCarga}</p>
            <Button variant="outline" size="sm" onClick={reintentar}>
              Reintentar
            </Button>
          </div>
        ) : visibles.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            {pestana === "propios" && propiosCount === 0
              ? "Todavía no cargaste modelos propios. «Nuevo modelo» para traer uno, o duplicá uno del estudio para adaptarlo."
              : "Ningún modelo coincide con la búsqueda."}
          </div>
        ) : (
          <ul role="listbox" aria-label="Modelos de escrito">
            {visibles.map((m) => {
              const sel = m.id === seleccionado;
              return (
                <li
                  key={m.id}
                  role="option"
                  aria-selected={sel}
                  className={cn(
                    "border-b border-[var(--el-border)] last:border-b-0",
                    sel && "bg-[var(--el-glass)]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSeleccionado(sel ? null : m.id)}
                    className="flex w-full items-start gap-3 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                        sel
                          ? "border-[var(--el-violet)] bg-[var(--el-violet)] text-white"
                          : "border-[var(--el-border)]",
                      )}
                      aria-hidden
                    >
                      {sel ? <Check className="size-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-[var(--el-text)]">
                        {m.numero ? `${m.numero}. ` : ""}
                        {m.titulo}
                      </span>
                      <span className="block truncate text-xs text-[var(--el-text-soft)]">
                        {m.suma}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-md border border-[var(--el-border)] bg-[var(--el-glass)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--el-text-muted)]">
                          {CATEGORIA_ESCRITO_LABEL[m.categoria]}
                        </span>
                        {m.origen !== "estudio" ? (
                          <span className="rounded-md border border-[var(--el-violet)]/40 bg-[var(--el-violet)]/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--el-violet-light)]">
                            {ORIGEN_MODELO_LABEL[m.origen]}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>

                  {sel ? (
                    <div className="space-y-2 px-3 pb-3 pl-10 text-xs leading-relaxed text-[var(--el-text-soft)]">
                      {m.cuando ? (
                        <p>
                          <span className="font-medium text-[var(--el-text)]">
                            Cuándo:{" "}
                          </span>
                          {m.cuando}
                        </p>
                      ) : null}
                      {m.base_normativa ? (
                        <p>
                          <span className="font-medium text-[var(--el-text)]">
                            Base normativa (orientativa):{" "}
                          </span>
                          {m.base_normativa}
                        </p>
                      ) : null}
                      {m.claves ? (
                        <p>
                          <span className="font-medium text-[var(--el-text)]">
                            Claves:{" "}
                          </span>
                          {m.claves}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {m.origen === "estudio" ? (
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => onDuplicar(m)}
                            disabled={ocupado === m.id}
                          >
                            <Copy className="size-3" />
                            Duplicar como propio
                          </Button>
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => onEditar(m)}
                              disabled={ocupado === m.id}
                            >
                              <Pencil className="size-3" />
                              Editar
                            </Button>
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => onArchivar(m)}
                              disabled={ocupado === m.id}
                            >
                              <Archive className="size-3" />
                              Archivar
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
// Paso 2: los datos y las instrucciones
// ————————————————————————————————————————————————————————————————

function PasoDatos(props: {
  modelo: ModeloEscritoResumen | null;
  datos: ReturnType<typeof armarDatosEscrito>;
  perfilForm: PerfilForm;
  setPerfilForm: (f: PerfilForm) => void;
  instrucciones: string;
  setInstrucciones: (s: string) => void;
  nivel: NivelModelo;
  setNivel: (n: NivelModelo) => void;
  error: string | null;
}) {
  const {
    modelo,
    datos,
    perfilForm,
    setPerfilForm,
    instrucciones,
    setInstrucciones,
    nivel,
    setNivel,
    error,
  } = props;

  const deFicha = datos.datos.filter((d) => d.fuente !== "perfil" && d.fuente !== "sistema");
  const faltanFicha = deFicha.filter((d) => d.valor === null).length;
  const setP = (k: keyof PerfilForm, v: string) =>
    setPerfilForm({ ...perfilForm, [k]: v });

  return (
    <div className="-mx-4 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4">
      {modelo ? (
        <div className="rounded-lg border border-[var(--el-border)] bg-[var(--el-glass)] px-3 py-2.5">
          <p className="text-sm font-medium text-[var(--el-text)]">
            {modelo.numero ? `${modelo.numero}. ` : ""}
            {modelo.titulo}
          </p>
          <p className="text-xs text-[var(--el-text-muted)]">{modelo.suma}</p>
        </div>
      ) : null}

      {/* Los datos del expediente que van al encabezado. Se muestran ANTES de
          generar para que el abogado vea qué falta y decida si carga la ficha
          primero o deja el hueco. */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium text-[var(--el-text)]">
            Datos del expediente
          </h3>
          <p className="text-xs text-[var(--el-text-muted)]">
            {faltanFicha === 0
              ? "Completos"
              : `${faltanFicha} sin cargar · quedarán como [COMPLETAR]`}
          </p>
        </div>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-lg border border-[var(--el-border)] p-3 sm:grid-cols-2">
          {deFicha.map((d) => (
            <div key={d.clave} className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-[var(--el-text-muted)]">
                {d.label}
              </dt>
              <dd className="text-sm text-[var(--el-text)] break-words">
                {d.valor ?? (
                  <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="size-3" /> Falta
                    <span className="text-[var(--el-text-muted)]">
                      · {d.fuente === "partes" ? "cargalo en Partes" : "cargalo en la ficha"}
                    </span>
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
        {datos.caratulaProvisoria ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            La causa no tiene carátula cargada: el escrito la va a dejar como
            [COMPLETAR]. Podés cargarla desde «Editar ficha».
          </p>
        ) : null}
      </section>

      {/* El perfil profesional, editable acá para no mandar al abogado a otra
          pantalla la primera vez. Se guarda al generar. */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-[var(--el-text)]">
          Tus datos profesionales
        </h3>
        <p className="text-xs text-[var(--el-text-muted)]">
          Van en el encabezado y la firma de todos tus escritos. Se guardan en
          tu perfil.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pf-nombre">Cómo firmás</Label>
            <Input
              id="pf-nombre"
              value={perfilForm.nombre_completo}
              onChange={(e) => setP("nombre_completo", e.target.value)}
              maxLength={200}
              placeholder="Dr. Juan Pérez"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-matricula">Matrícula</Label>
            <Input
              id="pf-matricula"
              value={perfilForm.matricula}
              onChange={(e) => setP("matricula", e.target.value)}
              maxLength={120}
              placeholder="T° 123 F° 456 C.P.A.C.F."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-dom">Domicilio constituido</Label>
            <Input
              id="pf-dom"
              value={perfilForm.domicilio_constituido}
              onChange={(e) => setP("domicilio_constituido", e.target.value)}
              maxLength={300}
              placeholder="Av. Corrientes 1234, piso 5, CABA"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-elec">Domicilio electrónico</Label>
            <Input
              id="pf-elec"
              value={perfilForm.domicilio_electronico}
              onChange={(e) => setP("domicilio_electronico", e.target.value)}
              maxLength={120}
              placeholder="20-12345678-9"
            />
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <Label htmlFor="ge-instrucciones">Instrucciones para este escrito</Label>
        <Textarea
          id="ge-instrucciones"
          value={instrucciones}
          onChange={(e) => setInstrucciones(e.target.value)}
          maxLength={4000}
          rows={4}
          placeholder="Lo que el redactor no puede saber por la ficha: el hecho nuevo, qué ofrecer en subsidio, la fecha de la resolución que se recurre, los testigos a citar…"
        />
        <p className="text-xs text-[var(--el-text-muted)]">
          Lo que escribas acá manda sobre el modelo. Todo lo demás lo toma del
          relato, la estrategia elegida, las partes y el timeline de la causa.
        </p>
      </section>

      <section className="space-y-2">
        <Label htmlFor="ge-nivel">Nivel del modelo</Label>
        <select
          id="ge-nivel"
          className={cn(SELECT_CLS, "sm:w-72")}
          value={nivel}
          onChange={(e) => setNivel(e.target.value as NivelModelo)}
        >
          {NIVELES_MODELO.map((n) => (
            <option key={n} value={n}>
              {NIVEL_LABEL[n]} — {NIVEL_DESCRIPCION[n]}
            </option>
          ))}
        </select>
      </section>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
