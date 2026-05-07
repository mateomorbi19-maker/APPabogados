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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Conversacion } from "@/lib/types";

type Props = {
  open: boolean;
  casoId: string;
  conversacion: Conversacion;
  onClose: () => void;
  onRenombrado: (nuevoTitulo: string) => void;
};

const TITULO_MAX = 200;

export function RenombrarConversacionModal({
  open,
  casoId,
  conversacion,
  onClose,
  onRenombrado,
}: Props) {
  const [titulo, setTitulo] = useState(conversacion.titulo);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (loading) return;
    setError(null);
    setTitulo(conversacion.titulo);
    onClose();
  };

  const tituloTrim = titulo.trim();
  const ok = tituloTrim.length > 0 && tituloTrim.length <= TITULO_MAX;

  const handleGuardar = async () => {
    if (loading || !ok) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/casos/${casoId}/conversaciones/${conversacion.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ titulo: tituloTrim }),
        },
      );
      const json = (await res.json().catch(() => null)) as
        | { ok: true; conversacion: Conversacion }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !json || ("ok" in json && json.ok === false)) {
        const msg =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : `Error renombrando (HTTP ${res.status})`;
        setError(msg);
        setLoading(false);
        return;
      }
      onRenombrado(tituloTrim);
      setLoading(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={!loading}>
        <DialogHeader>
          <DialogTitle>Renombrar conversación</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="titulo-conv">Título</Label>
          <Input
            id="titulo-conv"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            disabled={loading}
            maxLength={TITULO_MAX}
            autoFocus
          />
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
          <Button onClick={handleGuardar} disabled={loading || !ok}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
