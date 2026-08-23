"use client";
// El formulario de la ficha de causa.
//
// Un solo formulario y un solo Guardar, y no edición campo por campo. La ficha
// se carga de una sentada, con el expediente delante: nueve guardados de un
// campo cada uno son nueve viajes al server y nueve bumpeos de
// `casos.actualizado_en`, que es lo que ordena el Inicio, el buscador y el
// contexto de LEXIE.
//
// Va en Dialog y no en el Sheet de la casa a propósito: `ui/sheet.tsx` no es el
// de shadcn, es un drawer escrito a mano sin focus trap ni título accesible.
// Para un formulario de once campos que se llena con teclado, eso importa.
//
// Solo se mandan los campos que CAMBIARON. La ruta distingue `undefined`
// (no lo mandó, no lo toques) de `null` (lo vació a propósito, borralo).

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FUERO_LABEL, FUEROS } from "@/lib/mapa-procesal/types";
import {
  ESTADOS_SEGUIMIENTO,
  ESTADO_SEGUIMIENTO_LABEL,
} from "@/lib/casos/ficha";
import type { Caso, EstadoSeguimiento } from "@/lib/types";
import type { Fuero } from "@/lib/mapa-procesal/types";

// Quinta copia de esta constante en el repo, y las cinco divergieron. No se
// unifica acá porque hacerlo cambia el aspecto de cuatro pantallas ajenas a la
// ficha; queda como tarea aparte. `text-foreground` explícito porque el
// <select> nativo no hereda foreground en Chromium.
const SELECT_CLS =
  "h-9 max-md:h-10 w-full rounded-md border border-input bg-transparent text-foreground px-2 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-50";

/** Los campos que el formulario sabe enfocar al abrirse. */
export type CampoFicha =
  | "caratula"
  | "expediente_numero"
  | "organismo"
  | "secretaria"
  | "juez"
  | "fiscalia"
  | "delitos"
  | "fuero"
  | "estado_seguimiento"
  | "titulo";

type Props = {
  open: boolean;
  caso: Caso;
  /** Campo a enfocar al abrir. Viene del botón "Cargar" del campo vacío. */
  campoInicial?: CampoFicha;
  onClose: () => void;
  onSaved: (caso: Caso) => void;
};

type FormState = {
  caratula: string;
  expediente_numero: string;
  organismo: string;
  secretaria: string;
  juez: string;
  fiscalia: string;
  delitos: string[];
  fuero: Fuero | "";
  estado_seguimiento: EstadoSeguimiento;
  titulo: string;
};

function desdeCaso(c: Caso): FormState {
  return {
    caratula: c.caratula ?? "",
    expediente_numero: c.expediente_numero ?? "",
    organismo: c.organismo ?? "",
    secretaria: c.secretaria ?? "",
    juez: c.juez ?? "",
    fiscalia: c.fiscalia ?? "",
    delitos: c.delitos ?? [],
    fuero: c.fuero ?? "",
    estado_seguimiento: c.estado_seguimiento,
    titulo: c.titulo,
  };
}

export function FichaForm({
  open,
  caso,
  campoInicial,
  onClose,
  onSaved,
}: Props) {
  const [form, setForm] = useState<FormState>(() => desdeCaso(caso));
  const [delitoNuevo, setDelitoNuevo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sembrar al abrir: si el abogado cancela con cambios y vuelve a entrar,
  // tiene que ver la ficha guardada y no su edición abandonada.
  //
  // Se ajusta DURANTE EL RENDER y no en un useEffect. Con efecto, el diálogo
  // pinta un frame con el estado viejo antes de corregirse, y React lo marca
  // como render en cascada. Este es el patrón de "ajustar estado cuando cambia
  // una prop": comparar contra el valor anterior y re-sembrar en el acto.
  const [abiertoAntes, setAbiertoAntes] = useState(open);
  if (open !== abiertoAntes) {
    setAbiertoAntes(open);
    if (open) {
      setForm(desdeCaso(caso));
      setDelitoNuevo("");
      setError(null);
    }
  }

  const inicial = desdeCaso(caso);
  const dirty =
    JSON.stringify({ ...form, delitos: [...form.delitos] }) !==
    JSON.stringify({ ...inicial, delitos: [...inicial.delitos] });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const agregarDelito = () => {
    const t = delitoNuevo.trim();
    if (!t) return;
    // Deduplicación case-insensitive también acá y no solo en el server: si el
    // chip no aparece, el abogado lo vuelve a tipear pensando que falló.
    const yaEsta = form.delitos.some((d) => d.toLowerCase() === t.toLowerCase());
    if (!yaEsta) set("delitos", [...form.delitos, t]);
    setDelitoNuevo("");
  };

  const handleClose = () => {
    if (loading) return;
    onClose();
  };

  const handleGuardar = async () => {
    if (loading || !dirty) return;
    setLoading(true);
    setError(null);

    // Solo lo que cambió. La cadena vacía viaja como "" y el schema del server
    // la convierte en NULL: así "lo borré" y "no lo toqué" son cosas distintas.
    const body: Record<string, unknown> = {};
    const texto = [
      "caratula",
      "expediente_numero",
      "organismo",
      "secretaria",
      "juez",
      "fiscalia",
      "titulo",
    ] as const;
    for (const k of texto) {
      if (form[k] !== inicial[k]) body[k] = form[k];
    }
    // `titulo` es NOT NULL en la base: si lo vació, no se manda.
    if (typeof body.titulo === "string" && body.titulo.trim() === "") {
      delete body.titulo;
    }
    if (JSON.stringify(form.delitos) !== JSON.stringify(inicial.delitos)) {
      body.delitos = form.delitos;
    }
    if (form.fuero !== inicial.fuero) {
      body.fuero = form.fuero === "" ? null : form.fuero;
    }
    if (form.estado_seguimiento !== inicial.estado_seguimiento) {
      body.estado_seguimiento = form.estado_seguimiento;
    }

    if (Object.keys(body).length === 0) {
      setLoading(false);
      onClose();
      return;
    }

    try {
      const res = await fetch(`/api/casos/${caso.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; caso: Caso }
        | { ok: false; error: string }
        | null;

      if (!res.ok || !json || json.ok !== true) {
        setError(
          json && json.ok === false ? json.error : "No se pudo guardar la ficha",
        );
        return;
      }
      onSaved(json.caso);
      toast.success("Ficha actualizada");
      onClose();
    } catch {
      setError("No se pudo guardar la ficha. Revisá la conexión.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose();
      }}
    >
      {/* Misma estructura que evento-form: columna con scroll interno, para que
          el pie con Guardar quede siempre a la vista y no haya que recorrer
          once campos para llegar al botón. */}
      <DialogContent
        className="flex flex-col sm:max-w-2xl"
        showCloseButton={!loading}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>Ficha de la causa</DialogTitle>
        </DialogHeader>

        <div className="-mx-4 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4">
          <Campo
            id="f-caratula"
            label="Carátula"
            ayuda="El nombre oficial del expediente. Manda sobre el título de trabajo en toda la app."
            value={form.caratula}
            onChange={(v) => set("caratula", v)}
            disabled={loading}
            maxLength={500}
            placeholder="Rodríguez, Carlos Alberto s/ defraudación"
            autoFocus={campoInicial === "caratula" || campoInicial === undefined}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              id="f-expediente"
              label="Nº de expediente"
              value={form.expediente_numero}
              onChange={(v) => set("expediente_numero", v)}
              disabled={loading}
              maxLength={120}
              placeholder="12345/2026 · IPP 08-00-012345-26"
              autoFocus={campoInicial === "expediente_numero"}
            />

            <div className="space-y-2">
              <Label htmlFor="f-fuero">Fuero</Label>
              <select
                id="f-fuero"
                className={SELECT_CLS}
                value={form.fuero}
                disabled={loading}
                autoFocus={campoInicial === "fuero"}
                onChange={(e) => set("fuero", e.target.value as Fuero | "")}
              >
                <option value="">Sin definir</option>
                {FUEROS.map((f) => (
                  <option key={f} value={f}>
                    {FUERO_LABEL[f]}
                  </option>
                ))}
              </select>
              {/* El fuero también lo escribe el mapa procesal al inicializarse.
                  Si se reinicia el mapa eligiendo otro fuero, ese valor pisa
                  este: el mapa es destructivo por diseño y el abogado confirma
                  el fuero ahí también. */}
              <p className="text-xs text-muted-foreground">
                Define la plantilla del mapa procesal.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              id="f-organismo"
              label="Juzgado / Tribunal"
              ayuda="Dónde tramita hoy. Cambia a lo largo del proceso."
              value={form.organismo}
              onChange={(v) => set("organismo", v)}
              disabled={loading}
              maxLength={300}
              placeholder="Juzgado Federal Criminal Nº 3"
              autoFocus={campoInicial === "organismo"}
            />
            <Campo
              id="f-secretaria"
              label="Secretaría"
              value={form.secretaria}
              onChange={(v) => set("secretaria", v)}
              disabled={loading}
              maxLength={200}
              placeholder="Secretaría Nº 6"
              autoFocus={campoInicial === "secretaria"}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              id="f-juez"
              label="Juez"
              value={form.juez}
              onChange={(v) => set("juez", v)}
              disabled={loading}
              maxLength={200}
              placeholder="Dr. Marcelo Suárez"
              autoFocus={campoInicial === "juez"}
            />
            <Campo
              id="f-fiscalia"
              label="Fiscalía"
              ayuda="Fiscal y dependencia, como se escriben."
              value={form.fiscalia}
              onChange={(v) => set("fiscalia", v)}
              disabled={loading}
              maxLength={300}
              placeholder="Dra. Benítez — UFI Delitos Económicos"
              autoFocus={campoInicial === "fiscalia"}
            />
          </div>

          {/* Delitos: chips. Una causa real casi nunca tiene un solo delito, y
              en array el buscador puede pegarle a uno sin depender de cómo se
              separaron con comas. */}
          <div className="space-y-2">
            <Label htmlFor="f-delito">Delitos</Label>
            {form.delitos.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {form.delitos.map((d) => (
                  <li key={d}>
                    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/50 py-1 pl-2.5 pr-1 text-xs">
                      <span className="break-all">{d}</span>
                      <button
                        type="button"
                        onClick={() =>
                          set(
                            "delitos",
                            form.delitos.filter((x) => x !== d),
                          )
                        }
                        disabled={loading}
                        aria-label={`Quitar ${d}`}
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex gap-2">
              <Input
                id="f-delito"
                value={delitoNuevo}
                onChange={(e) => setDelitoNuevo(e.target.value)}
                disabled={loading}
                maxLength={200}
                placeholder="Robo agravado por el uso de arma"
                autoFocus={campoInicial === "delitos"}
                onKeyDown={(e) => {
                  // Enter agrega el chip y NO envía el formulario: dentro de un
                  // diálogo, un Enter distraído guardaría la ficha a medio
                  // cargar.
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    agregarDelito();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={agregarDelito}
                disabled={loading || delitoNuevo.trim().length === 0}
              >
                Agregar
              </Button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="f-estado">Estado de la causa</Label>
              <select
                id="f-estado"
                className={SELECT_CLS}
                value={form.estado_seguimiento}
                disabled={loading}
                autoFocus={campoInicial === "estado_seguimiento"}
                onChange={(e) =>
                  set("estado_seguimiento", e.target.value as EstadoSeguimiento)
                }
              >
                {ESTADOS_SEGUIMIENTO.map((e) => (
                  <option key={e} value={e}>
                    {ESTADO_SEGUIMIENTO_LABEL[e]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Cómo la lleva el estudio. No es la etapa procesal: esa la
                calcula el mapa.
              </p>
            </div>

            <Campo
              id="f-titulo"
              label="Título de trabajo"
              ayuda="Cómo la llamás mientras no haya carátula."
              value={form.titulo}
              onChange={(v) => set("titulo", v)}
              disabled={loading}
              maxLength={500}
              autoFocus={campoInicial === "titulo"}
            />
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleGuardar} disabled={loading || !dirty}>
            {loading ? <Loader2 className="animate-spin" /> : null}
            {loading ? "Guardando..." : "Guardar ficha"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Campo({
  id,
  label,
  ayuda,
  value,
  onChange,
  disabled,
  maxLength,
  placeholder,
  autoFocus,
}: {
  id: string;
  label: string;
  ayuda?: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  maxLength: number;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={cn("space-y-2")}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      {ayuda ? <p className="text-xs text-muted-foreground">{ayuda}</p> : null}
    </div>
  );
}
