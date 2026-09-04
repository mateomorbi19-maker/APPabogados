"use client";
// Alta y edición de un modelo de escrito PROPIO del abogado.
//
// Es el "Nuevo escrito" de las ideas del 8/8/2026: "que el abogado pueda
// traer sus propios escritos". El modelo propio tiene la misma forma que los
// del estudio (suma, cuándo, base normativa, cuerpo, claves) para que el
// redactor lo use exactamente igual — y para que "duplicar como propio" un
// modelo del estudio sea copiar campo por campo.
//
// El cuerpo se escribe con placeholders {{ASI}} donde va el dato de la causa.
// No es obligatorio: un cuerpo sin placeholders también funciona, el redactor
// lo adapta igual. La convención está explicada al pie del textarea.

import { useState } from "react";
import { Loader2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  CATEGORIAS_ESCRITO,
  CATEGORIA_ESCRITO_LABEL,
  ROLES_SUGERIDOS,
  type CategoriaEscrito,
  type ModeloEscrito,
  type RolSugerido,
} from "@/lib/escritos/types";

// Séptima copia (ver la nota en ficha-form.tsx).
const SELECT_CLS =
  "h-9 max-md:h-10 w-full rounded-md border border-input bg-transparent text-foreground px-2 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-50";

const ROL_SUGERIDO_LABEL: Record<RolSugerido, string> = {
  defensor: "Defensa",
  querellante: "Querella",
  ambos: "Cualquiera",
};

type Props = {
  open: boolean;
  /**
   * `null` = alta en blanco. Un modelo con `origen: "estudio"` se trata como
   * SEMILLA (duplicar como propio): se copian los campos y se crea uno nuevo.
   * Un modelo propio se edita.
   */
  semilla: ModeloEscrito | null;
  onClose: () => void;
  onSaved: (modelo: ModeloEscrito) => void;
};

type FormState = {
  titulo: string;
  categoria: CategoriaEscrito;
  rol_sugerido: RolSugerido;
  suma: string;
  cuando: string;
  base_normativa: string;
  cuerpo: string;
  claves: string;
};

function desde(m: ModeloEscrito | null): FormState {
  return {
    titulo: m ? (m.origen === "estudio" ? `${m.titulo} (propio)` : m.titulo) : "",
    categoria: m?.categoria ?? "otro",
    rol_sugerido: m?.rol_sugerido ?? "ambos",
    suma: m?.suma ?? "",
    cuando: m?.cuando ?? "",
    base_normativa: m?.base_normativa ?? "",
    cuerpo: m?.cuerpo ?? "",
    claves: m?.claves ?? "",
  };
}

export function ModeloForm({ open, semilla, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => desde(semilla));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sembrar al abrir, durante el render (ver la nota larga de ficha-form).
  const [clave, setClave] = useState<string | null>(null);
  const claveActual = open ? (semilla?.id ?? "nuevo") : null;
  if (claveActual !== clave) {
    setClave(claveActual);
    if (open) {
      setForm(desde(semilla));
      setError(null);
    }
  }

  const editando = semilla !== null && semilla.origen !== "estudio";
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const valido =
    form.titulo.trim().length >= 3 &&
    form.suma.trim().length >= 3 &&
    form.cuerpo.trim().length >= 20;

  const handleClose = () => {
    if (loading) return;
    onClose();
  };

  const handleGuardar = async () => {
    if (loading || !valido) return;
    setLoading(true);
    setError(null);
    const body = {
      titulo: form.titulo.trim(),
      categoria: form.categoria,
      rol_sugerido: form.rol_sugerido,
      suma: form.suma.trim(),
      cuando: form.cuando,
      base_normativa: form.base_normativa,
      cuerpo: form.cuerpo.trim(),
      claves: form.claves,
    };
    try {
      const url = editando
        ? `/api/escritos/modelos/${semilla.id}`
        : "/api/escritos/modelos";
      const res = await fetch(url, {
        method: editando ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; modelo: ModeloEscrito }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !json || json.ok !== true) {
        setError(
          json && json.ok === false ? json.error : "No se pudo guardar el modelo",
        );
        return;
      }
      onSaved(json.modelo);
      toast.success(editando ? "Modelo actualizado" : "Modelo guardado");
      onClose();
    } catch {
      setError("No se pudo guardar. Revisá la conexión.");
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
      <DialogContent
        className="flex flex-col sm:max-w-2xl"
        showCloseButton={!loading}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {editando
              ? "Editar modelo propio"
              : semilla
                ? "Duplicar como modelo propio"
                : "Nuevo modelo de escrito"}
          </DialogTitle>
        </DialogHeader>

        <div className="-mx-4 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4">
          <div className="space-y-2">
            <Label htmlFor="m-titulo">Título</Label>
            <Input
              id="m-titulo"
              value={form.titulo}
              onChange={(e) => set("titulo", e.target.value)}
              disabled={loading}
              maxLength={200}
              placeholder="Solicitud de arresto domiciliario por enfermedad"
              autoFocus
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="m-categoria">Categoría</Label>
              <select
                id="m-categoria"
                className={SELECT_CLS}
                value={form.categoria}
                disabled={loading}
                onChange={(e) => set("categoria", e.target.value as CategoriaEscrito)}
              >
                {CATEGORIAS_ESCRITO.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORIA_ESCRITO_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="m-rol">Para quién</Label>
              <select
                id="m-rol"
                className={SELECT_CLS}
                value={form.rol_sugerido}
                disabled={loading}
                onChange={(e) => set("rol_sugerido", e.target.value as RolSugerido)}
              >
                {ROLES_SUGERIDOS.map((r) => (
                  <option key={r} value={r}>
                    {ROL_SUGERIDO_LABEL[r]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Filtra el catálogo según el rol del estudio en la causa.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="m-suma">Suma</Label>
            <Input
              id="m-suma"
              value={form.suma}
              onChange={(e) => set("suma", e.target.value)}
              disabled={loading}
              maxLength={300}
              placeholder="SOLICITA PRISIÓN DOMICILIARIA."
            />
            <p className="text-xs text-muted-foreground">
              El encabezado en mayúsculas con el que arranca el escrito.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="m-cuando">Cuándo se presenta</Label>
            <Input
              id="m-cuando"
              value={form.cuando}
              onChange={(e) => set("cuando", e.target.value)}
              disabled={loading}
              maxLength={500}
              placeholder="Con el imputado detenido, en cualquier estado del proceso."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="m-base">Base normativa</Label>
            <Input
              id="m-base"
              value={form.base_normativa}
              onChange={(e) => set("base_normativa", e.target.value)}
              disabled={loading}
              maxLength={1000}
              placeholder="art. 10 CP; arts. 32/34 Ley 24.660"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="m-cuerpo">Cuerpo tipo</Label>
            <Textarea
              id="m-cuerpo"
              value={form.cuerpo}
              onChange={(e) => set("cuerpo", e.target.value)}
              disabled={loading}
              maxLength={20000}
              rows={12}
              className="min-h-48 font-mono text-xs leading-relaxed"
              placeholder={
                "Que vengo a solicitar el arresto domiciliario de {{IMPUTADO}}, por encuadrar en el supuesto del art. 32 inc. {{INCISO}} de la Ley 24.660..."
              }
            />
            <p className="text-xs text-muted-foreground">
              Pegá el escrito tipo. Donde va un dato de la causa podés poner un
              marcador entre dobles llaves ({"{{IMPUTADO}}"}, {"{{NRO_CAUSA}}"},{" "}
              {"{{FECHA_HECHO}}"}); el redactor lo reemplaza con el dato del
              expediente o lo deja marcado para completar.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="m-claves">Claves</Label>
            <Textarea
              id="m-claves"
              value={form.claves}
              onChange={(e) => set("claves", e.target.value)}
              disabled={loading}
              maxLength={1000}
              rows={2}
              placeholder="Acompañar informe médico y conformidad del titular del inmueble."
            />
            <p className="text-xs text-muted-foreground">
              Instrucciones para el redactor: qué no puede faltar, qué pedir en
              subsidio.
            </p>
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
          <Button onClick={handleGuardar} disabled={loading || !valido}>
            {loading ? <Loader2 className="animate-spin" /> : null}
            {loading ? "Guardando..." : editando ? "Guardar" : "Guardar modelo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
