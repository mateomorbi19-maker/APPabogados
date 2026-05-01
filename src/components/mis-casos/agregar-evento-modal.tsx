"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { EstadoEvento, EventoCaso } from "@/lib/types";

type Props = {
  open: boolean;
  casoId: string;
  onClose: () => void;
  onCreated: (evento: EventoCaso) => void;
};

// Formato YYYY-MM-DDTHH:MM en hora LOCAL para el default del input
// type="datetime-local". El navegador lo interpreta como local; al
// crear new Date(value) ese valor se vuelve a un Date en UTC interno y
// .toISOString() devuelve UTC para mandar al server.
function nowDatetimeLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AgregarEventoModal({
  open,
  casoId,
  onClose,
  onCreated,
}: Props) {
  const [descripcion, setDescripcion] = useState("");
  const [ocurridoLocal, setOcurridoLocal] = useState(() => nowDatetimeLocal());
  const [estado, setEstado] = useState<EstadoEvento>("sucedido");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const descripcionOk = descripcion.trim().length > 0;

  const handleClose = () => {
    if (loading) return;
    setError(null);
    onClose();
    // Reset para próximo open. Lo hacemos en el efecto de cierre porque
    // si lo hago durante el render del padre genera flash.
    setTimeout(() => {
      setDescripcion("");
      setOcurridoLocal(nowDatetimeLocal());
      setEstado("sucedido");
    }, 200);
  };

  const handleAgregar = async () => {
    if (loading || !descripcionOk) return;
    setLoading(true);
    setError(null);
    try {
      const ocurridoIso = new Date(ocurridoLocal).toISOString();
      const res = await fetch(`/api/casos/${casoId}/eventos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          descripcion: descripcion.trim(),
          ocurrido_en: ocurridoIso,
          estado,
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
      // Reset y cerrar.
      setLoading(false);
      setError(null);
      setDescripcion("");
      setOcurridoLocal(nowDatetimeLocal());
      setEstado("sucedido");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
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
      <DialogContent className="sm:max-w-lg" showCloseButton={!loading}>
        <DialogHeader>
          <DialogTitle>Agregar evento al timeline</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="evento-descripcion">¿Qué pasó?</Label>
          <Textarea
            id="evento-descripcion"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            disabled={loading}
            rows={3}
            placeholder="Ej: Audiencia de control de detención, prisión preventiva dictada..."
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="evento-ocurrido">¿Cuándo?</Label>
          <input
            id="evento-ocurrido"
            type="datetime-local"
            value={ocurridoLocal}
            onChange={(e) => setOcurridoLocal(e.target.value)}
            disabled={loading}
            className="w-full sm:w-72 h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <div className="space-y-2">
          <Label>Estado</Label>
          <RadioGroup
            value={estado}
            onValueChange={(v) =>
              typeof v === "string" && (v === "sucedido" || v === "pendiente")
                ? setEstado(v)
                : undefined
            }
            disabled={loading}
            className="flex flex-row gap-4"
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

        {error ? (
          <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            onClick={handleAgregar}
            disabled={loading || !descripcionOk}
          >
            {loading ? <Loader2 className="animate-spin" /> : null}
            {loading ? "Agregando..." : "Agregar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
