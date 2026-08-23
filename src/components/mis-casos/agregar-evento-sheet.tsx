"use client";
// Sheet lateral para agregar un evento manual al timeline. Reemplaza al
// viejo agregar-evento-modal: Dialog → Sheet, agrega `categoria` y
// `adjuntos` (con upload directo al storage vía signed URL).

import { useState } from "react";
import { Loader2, X as CloseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  CATEGORIAS_MANUALES,
  type CategoriaEvento,
} from "@/lib/casos/categorias";
import type { EstadoEvento, EventoCaso } from "@/lib/types";
import { AdjuntosUploader, type AdjuntoUI } from "./adjuntos-uploader";

type Props = {
  open: boolean;
  casoId: string;
  onClose: () => void;
  onCreated: (evento: EventoCaso) => void;
};

// `text-foreground` explícito porque el <select> nativo no hereda
// foreground en todos los browsers (Chromium en particular renderea
// el valor seleccionado con contraste apagado si no se fuerza).
//
// h-10 abajo de 640px: 36px es medio dedo y este sheet se llena desde el
// teléfono (cargar la audiencia que acaba de pasar). El font-size lo levanta
// a 16px la regla global de móvil de globals.css.
const SELECT_CLS =
  "h-10 sm:h-9 rounded-md border border-input bg-transparent text-foreground px-2 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20";

const DESCRIPCION_MIN = 20;
const DESCRIPCION_MAX = 2000;

// Categoría manual restringida (las dos del agente las setea el server).
type CategoriaManual = Exclude<
  CategoriaEvento,
  "consulta_agente" | "respuesta_agente"
>;

function nowDatetimeLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AgregarEventoSheet({
  open,
  casoId,
  onClose,
  onCreated,
}: Props) {
  const [categoria, setCategoria] = useState<CategoriaManual>("otro");
  const [descripcion, setDescripcion] = useState("");
  const [ocurridoLocal, setOcurridoLocal] = useState(() => nowDatetimeLocal());
  const [estado, setEstado] = useState<EstadoEvento>("sucedido");
  const [adjuntos, setAdjuntos] = useState<AdjuntoUI[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const descripcionTrim = descripcion.trim();
  const descripcionOk =
    descripcionTrim.length >= DESCRIPCION_MIN &&
    descripcionTrim.length <= DESCRIPCION_MAX;

  // Bloqueamos submit si hay adjuntos en `uploading` o `error`. El usuario
  // tiene que esperar a que terminen (o quitarlos) antes de guardar.
  const adjuntosListos = adjuntos.every((a) => a.status === "done");
  const formOk = descripcionOk && adjuntosListos;

  const reset = () => {
    setCategoria("otro");
    setDescripcion("");
    setOcurridoLocal(nowDatetimeLocal());
    setEstado("sucedido");
    setAdjuntos([]);
    setError(null);
  };

  const handleClose = () => {
    if (loading) return;
    onClose();
    setTimeout(reset, 200);
  };

  const handleAgregar = async () => {
    if (loading || !formOk) return;
    setLoading(true);
    setError(null);
    try {
      const ocurridoIso = new Date(ocurridoLocal).toISOString();
      const adjuntosBody = adjuntos
        .filter((a) => a.status === "done")
        .map((a) => ({
          filename: a.filename,
          storage_path: a.storage_path,
          mime_type: a.mime_type,
          size_bytes: a.size_bytes,
          descripcion: a.descripcion,
        }));

      const res = await fetch(`/api/casos/${casoId}/eventos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categoria,
          descripcion: descripcionTrim,
          ocurrido_en: ocurridoIso,
          estado,
          adjuntos: adjuntosBody,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; evento: EventoCaso }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !json || ("ok" in json && json.ok === false)) {
        const msg =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : `Error creando evento (HTTP ${res.status})`;
        setError(msg);
        setLoading(false);
        return;
      }
      if (!("evento" in json)) {
        setError("Respuesta inesperada del servidor");
        setLoading(false);
        return;
      }
      onCreated(json.evento);
      setLoading(false);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && handleClose()}>
      <div className="flex flex-col h-full">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card/95 backdrop-blur px-5 py-3">
          <h2 className="font-medium">Agregar evento al timeline</h2>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleClose}
            disabled={loading}
            aria-label="Cerrar"
          >
            <CloseIcon className="size-4" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="evento-categoria">Tipo</Label>
            <select
              id="evento-categoria"
              value={categoria}
              onChange={(e) =>
                setCategoria(e.target.value as CategoriaManual)
              }
              disabled={loading}
              className={cn(SELECT_CLS, "w-full sm:w-72")}
            >
              {CATEGORIAS_MANUALES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="evento-descripcion">¿Qué pasó?</Label>
            <Textarea
              id="evento-descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              disabled={loading}
              rows={4}
              maxLength={DESCRIPCION_MAX}
              placeholder="Describí qué pasó. Por ejemplo: 'Audiencia de imputación realizada el 14/03. El juez X formalizó la imputación por...'"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              {descripcionTrim.length} / {DESCRIPCION_MAX} caracteres ·
              mínimo {DESCRIPCION_MIN}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="evento-ocurrido">¿Cuándo?</Label>
              <input
                id="evento-ocurrido"
                type="datetime-local"
                value={ocurridoLocal}
                onChange={(e) => setOcurridoLocal(e.target.value)}
                disabled={loading}
                className="w-full h-10 sm:h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Estado</Label>
              <RadioGroup
                value={estado}
                onValueChange={(v) =>
                  typeof v === "string" &&
                  (v === "sucedido" || v === "pendiente")
                    ? setEstado(v)
                    : undefined
                }
                disabled={loading}
                className="flex flex-row gap-4 pt-1"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="sucedido" id="estado-sucedido" />
                  <Label htmlFor="estado-sucedido" className="font-normal">
                    Sucedido
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="pendiente" id="estado-pendiente" />
                  <Label htmlFor="estado-pendiente" className="font-normal">
                    Pendiente
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Adjuntos</Label>
            <AdjuntosUploader
              casoId={casoId}
              value={adjuntos}
              onChange={setAdjuntos}
              disabled={loading}
            />
          </div>

          {!adjuntosListos ? (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              Esperá a que los archivos terminen de subir (o quitá los que fallaron) para guardar.
            </p>
          ) : null}

          {error ? (
            <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card/95 backdrop-blur px-5 py-3">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button onClick={handleAgregar} disabled={loading || !formOk}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {loading ? "Guardando..." : "Guardar evento"}
          </Button>
        </footer>
      </div>
    </Sheet>
  );
}
