"use client";
// Confirmación de cierre. Cerrar es irreversible (la sesión pasa a
// 'finalizada' y ya no admite intervenciones) y además genera el informe, que
// es la operación más cara del módulo: conviene un paso explícito.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SimulacionAudiencia } from "@/lib/types";

type Props = {
  open: boolean;
  casoId: string;
  simulacionId: string;
  onClose: () => void;
  onCerrada: (sim: SimulacionAudiencia) => void;
};

export function CerrarAudienciaModal({
  open,
  casoId,
  simulacionId,
  onClose,
  onCerrada,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (loading) return;
    setError(null);
    onClose();
  };

  const confirmar = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/casos/${casoId}/simulacion/${simulacionId}/cerrar`,
        { method: "POST" },
      );
      const json = (await res.json().catch(() => null)) as
        | { ok: true; simulacion: SimulacionAudiencia }
        | { ok: false; error: string }
        | null;

      if (!res.ok || !json || json.ok === false) {
        setError(
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : `No se pudo cerrar la audiencia (HTTP ${res.status})`,
        );
        setLoading(false);
        return;
      }
      setLoading(false);
      onCerrada(json.simulacion);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={!loading}>
        <DialogHeader>
          <DialogTitle>¿Cerrar la audiencia?</DialogTitle>
          <DialogDescription>
            Se genera el informe de desempeño sobre todo lo que se dijo en la
            sala. Después del cierre la audiencia queda de solo lectura: no vas
            a poder seguir interviniendo, pero el transcript y el informe
            quedan guardados.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-xs text-muted-foreground">
            Evaluando la audiencia. Puede tardar hasta un minuto.
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Seguir en la audiencia
          </Button>
          <Button onClick={confirmar} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {loading ? "Generando informe…" : "Cerrar y ver informe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
