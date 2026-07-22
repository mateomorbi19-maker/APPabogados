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
  // El cierre quedó sin confirmar: reintentar generaría un segundo informe y
  // lo cobraría. La salida es recargar.
  const [indeterminado, setIndeterminado] = useState(false);

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
        // 409 = el server YA cerró la audiencia y guardó el informe (este
        // mismo request que se cortó por timeout del proxy, u otro desde otra
        // pestaña). El informe está pago y persistido; como no hay GET de la
        // simulación, recargar es la única forma de que el abogado lo vea en
        // vez de quedarse con un error sobre algo que en realidad salió bien.
        if (res.status === 409) {
          window.location.reload();
          return;
        }
        // Body ilegible (proxy que devolvió HTML): el cierre pudo haber
        // terminado igual. Ofrecemos recargar en vez de sugerir reintentar,
        // que generaría —y cobraría— un segundo informe.
        if (!json) {
          setIndeterminado(true);
          setError(
            "No pudimos confirmar el cierre. Es posible que el informe se haya generado igual: recargá la página para verlo.",
          );
          setLoading(false);
          return;
        }
        setError(
          "error" in json && typeof json.error === "string"
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
          {indeterminado ? (
            <Button onClick={() => window.location.reload()}>
              Recargar la página
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={loading}>
                Seguir en la audiencia
              </Button>
              <Button onClick={confirmar} disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : null}
                {loading ? "Generando informe…" : "Cerrar y ver informe"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
