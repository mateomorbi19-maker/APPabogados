"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
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
  open: boolean;
  casoId: string;
  onClose: () => void;
};

// Confirm modal para eliminar el caso. Bloqueante durante el DELETE
// (mismo patrón que SeleccionarEstrategiaModal). Al éxito, redirect a
// /dashboard/mis-casos (sin id).
export function EliminarCasoModal({ open, casoId, onClose }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (loading) return;
    setError(null);
    onClose();
  };

  const handleEliminar = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/casos/${casoId}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !json || ("ok" in json && json.ok === false)) {
        const msg =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : `Error eliminando caso (HTTP ${res.status})`;
        setError(msg);
        setLoading(false);
        return;
      }
      router.push("/dashboard/mis-casos");
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
      <DialogContent className="sm:max-w-md" showCloseButton={!loading}>
        <DialogHeader>
          <DialogTitle>¿Estás seguro?</DialogTitle>
          <DialogDescription>
            Esto borrará el caso y todos sus eventos. Esta acción no se
            puede deshacer.
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
            {loading ? "Eliminando..." : "Eliminar caso"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
