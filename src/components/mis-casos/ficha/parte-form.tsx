"use client";
// Alta y edición de una persona de la causa.
//
// Sin teléfono, mail ni DNI a propósito. La pregunta que define si el contacto
// hace falta —¿el reporte al cliente es por causa o por persona?— sigue sin
// contestar en REPORTERIA_AL_CLIENTE_PARA_DECIDIR.md, y modelar datos de
// contacto antes de esa respuesta es adivinar. La tabla 1:N, en cambio,
// funciona igual con las dos respuestas posibles, así que no es una apuesta.

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
import { Checkbox } from "@/components/ui/checkbox";
import {
  ROLES_PARTE,
  ROL_PARTE_LABEL,
  SITUACIONES_LIBERTAD,
  SITUACION_LIBERTAD_LABEL,
} from "@/lib/casos/ficha";
import type { ParteCaso, RolParte, SituacionLibertad } from "@/lib/types";

// Sexta copia de esta constante en el repo (ver la nota en ficha-form.tsx).
const SELECT_CLS =
  "h-9 max-md:h-10 w-full rounded-md border border-input bg-transparent text-foreground px-2 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-50";

type Props = {
  open: boolean;
  casoId: string;
  /** `null` = alta. */
  parte: ParteCaso | null;
  onClose: () => void;
  onSaved: (parte: ParteCaso) => void;
};

export function ParteForm({ open, casoId, parte, onClose, onSaved }: Props) {
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState<RolParte>("imputado");
  const [esCliente, setEsCliente] = useState(false);
  const [situacion, setSituacion] = useState<SituacionLibertad | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Se siembra durante el render y no en un useEffect: el mismo diálogo sirve
  // para alta y para edición, así que al abrirlo tiene que reflejar la persona
  // elegida sin pintar antes un frame con la anterior. Ver la nota larga en
  // ficha-form.tsx.
  const [semilla, setSemilla] = useState<string | null>(null);
  const claveActual = open ? (parte?.id ?? "nueva") : null;
  if (claveActual !== semilla) {
    setSemilla(claveActual);
    if (open) {
      setNombre(parte?.nombre ?? "");
      setRol(parte?.rol ?? "imputado");
      setEsCliente(parte?.es_cliente ?? false);
      setSituacion(parte?.situacion_libertad ?? "");
      setError(null);
    }
  }

  const nombreOk = nombre.trim().length > 0;
  const editando = parte !== null;

  const handleClose = () => {
    if (loading) return;
    onClose();
  };

  const handleGuardar = async () => {
    if (loading || !nombreOk) return;
    setLoading(true);
    setError(null);

    // La situación de libertad sólo se manda para imputados. Si el abogado
    // cargó "detenido" y después cambió el rol a testigo, el dato viejo no
    // tiene que quedar colgado en la fila.
    const situacionFinal =
      rol === "imputado" && situacion !== "" ? situacion : null;

    const body = {
      nombre: nombre.trim(),
      rol,
      es_cliente: esCliente,
      situacion_libertad: situacionFinal,
    };

    try {
      const url = editando
        ? `/api/casos/${casoId}/partes/${parte.id}`
        : `/api/casos/${casoId}/partes`;
      const res = await fetch(url, {
        method: editando ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; parte: ParteCaso }
        | { ok: false; error: string }
        | null;

      if (!res.ok || !json || json.ok !== true) {
        setError(
          json && json.ok === false
            ? json.error
            : "No se pudo guardar la persona",
        );
        return;
      }
      onSaved(json.parte);
      toast.success(editando ? "Persona actualizada" : "Persona agregada");
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
      <DialogContent className="flex flex-col sm:max-w-md" showCloseButton={!loading}>
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {editando ? "Editar persona" : "Agregar persona"}
          </DialogTitle>
        </DialogHeader>

        <div className="-mx-4 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4">
          <div className="space-y-2">
            <Label htmlFor="p-nombre">Nombre</Label>
            <Input
              id="p-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              disabled={loading}
              maxLength={300}
              placeholder="Rodríguez, Carlos Alberto"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="p-rol">Rol en la causa</Label>
            <select
              id="p-rol"
              className={SELECT_CLS}
              value={rol}
              disabled={loading}
              onChange={(e) => setRol(e.target.value as RolParte)}
            >
              {ROLES_PARTE.map((r) => (
                <option key={r} value={r}>
                  {ROL_PARTE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>

          {/* Sólo para imputados: la situación de libertad de un testigo no
              significa nada, y ofrecerla invita a completar ruido. */}
          {rol === "imputado" ? (
            <div className="space-y-2">
              <Label htmlFor="p-situacion">Situación de libertad</Label>
              <select
                id="p-situacion"
                className={SELECT_CLS}
                value={situacion}
                disabled={loading}
                onChange={(e) =>
                  setSituacion(e.target.value as SituacionLibertad | "")
                }
              >
                <option value="">Sin definir</option>
                {SITUACIONES_LIBERTAD.map((s) => (
                  <option key={s} value={s}>
                    {SITUACION_LIBERTAD_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <label className="flex items-start gap-2.5 rounded-md border border-border p-3">
            <Checkbox
              checked={esCliente}
              disabled={loading}
              onCheckedChange={(v) => setEsCliente(v === true)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                Es cliente del estudio
              </span>
              {/* Vale la aclaración: es la confusión que este campo existe para
                  evitar. */}
              <span className="block text-xs text-muted-foreground">
                Independiente del rol. En una querella el cliente es la víctima,
                no el imputado.
              </span>
            </span>
          </label>

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
          <Button onClick={handleGuardar} disabled={loading || !nombreOk}>
            {loading ? <Loader2 className="animate-spin" /> : null}
            {loading ? "Guardando..." : editando ? "Guardar" : "Agregar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
