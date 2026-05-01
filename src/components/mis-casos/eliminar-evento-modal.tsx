"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Props = {
  // Cuando es null el modal está cerrado. Cuando es string, es el id del
  // evento a eliminar y el modal se abre.
  eventoId: string | null;
  casoId: string;
  onClose: () => void;
  onDeleted: (eventoId: string) => void;
};

// Confirm modal corto para eliminar un evento del timeline. Bloqueante
// durante el DELETE.
export function EliminarEventoModal({
  eventoId,
  casoId,
  onClose,
  onDeleted,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = eventoId !== null;

  const handleClose = () => {
    if (loading) return;
    setError(null);
    onClose();
  };

  const handleEliminar = async () => {
    if (loading || !eventoId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/casos/${casoId}/eventos/${eventoId}`,
        { method: "DELETE" },
      );
      const json = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !json || ("ok" in json && json.ok === false)) {
        const msg =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : `Error eliminando evento (HTTP ${res.status})`;
        setError(msg);
        setLoading(false);
        return;
      }
      onDeleted(eventoId);
      setLoading(false);
      setError(null);
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
      <DialogContent className="sm:max-w-sm" showCloseButton={!loading}>
        <DialogHeader>
          <DialogTitle>¿Eliminar evento?</DialogTitle>
          <DialogDescription>
            El evento se borrará del timeline. No se puede deshacer.
          </DialogDescription>
        </DialogHeader>

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
            variant="destructive"
            onClick={handleEliminar}
            disabled={loading}
          >
            {loading ? <Loader2 className="animate-spin" /> : null}
            {loading ? "Eliminando..." : "Eliminar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
