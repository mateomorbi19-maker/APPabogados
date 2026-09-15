"use client";
// Alta y edición de una persona de la causa.
//
// El DNI es un dato de IDENTIDAD (Fase 10): el encabezado de todo escrito lo
// pide ("{{IMPUTADO}}, DNI {{DNI}}"). Sin él, el redactor deja [COMPLETAR: DNI].
//
// Teléfono y correo llegaron con la Fase 12 (reportería), cuando la pregunta
// «¿el reporte es por causa o por persona?» se contestó POR PERSONA
// (docs/PLAN_REPORTERIA.md §2). Son datos de CONTACTO y sólo sirven para
// reportarle al cliente: el correo es la dirección a la que sale un reporte,
// y se muestra completa antes de confirmar el envío.

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
  const [documento, setDocumento] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
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
      setDocumento(parte?.documento ?? "");
      setTelefono(parte?.telefono ?? "");
      setEmail(parte?.email ?? "");
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
      // "" viaja como "" y el schema del server la convierte en NULL.
      documento: documento,
      telefono,
      email,
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
            <Label htmlFor="p-documento">Documento</Label>
            <Input
              id="p-documento"
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              disabled={loading}
              maxLength={80}
              placeholder="DNI 30.123.456"
            />
            <p className="text-xs text-muted-foreground">
              Va en el encabezado de los escritos. Si falta, el escrito lo deja
              marcado para completar.
            </p>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="p-email">Correo</Label>
              <Input
                id="p-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                maxLength={200}
                placeholder="cliente@ejemplo.com"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-telefono">Teléfono</Label>
              <Input
                id="p-telefono"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                disabled={loading}
                maxLength={60}
                placeholder="+54 9 11 5555-5555"
                autoComplete="off"
              />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Sólo para reportarle al cliente. El correo es adonde sale un
              reporte por mail: se muestra completo antes de enviarlo.
            </p>
          </div>

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
