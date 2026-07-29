"use client";
// Confirmación antes de mandar un hilo a la papelera. El endpoint es
// reversible (threads.trash, nunca threads.delete), pero en un estudio la
// correspondencia puede ser prueba: se pregunta igual.

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
  asunto: string;
  procesando: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
};

export function ConfirmarPapelera({
  open,
  asunto,
  procesando,
  onCancelar,
  onConfirmar,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !procesando) onCancelar();
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!procesando}>
        <DialogHeader>
          <DialogTitle>¿Mover el hilo a la papelera?</DialogTitle>
          <DialogDescription>
            <span className="text-foreground font-medium">{asunto}</span> se va
            a mover a la papelera de Gmail. Podés restaurarlo desde ahí; la app
            nunca borra correo de forma permanente.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={onCancelar} disabled={procesando}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirmar}
            disabled={procesando}
          >
            {procesando ? <Loader2 className="size-4 animate-spin" /> : null}
            {procesando ? "Moviendo…" : "Mover a papelera"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
