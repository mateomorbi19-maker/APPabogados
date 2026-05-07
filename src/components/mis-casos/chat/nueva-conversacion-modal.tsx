"use client";
// Modal de confirmación para empezar una conversación nueva. Decisión
// del director (D3 del plan PR4): pedir confirmación porque archivar
// la activa es semi-irreversible (no hay "desarchivar" en v1).

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
import type { Conversacion } from "@/lib/types";

type Props = {
  open: boolean;
  casoId: string;
  onClose: () => void;
};

export function NuevaConversacionModal({ open, casoId, onClose }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (loading) return;
    setError(null);
    onClose();
  };

  const handleConfirmar = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/casos/${casoId}/conversaciones`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; conversacion: Conversacion }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !json || ("ok" in json && json.ok === false)) {
        const msg =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : `Error creando conversación (HTTP ${res.status})`;
        setError(msg);
        setLoading(false);
        return;
      }
      // La nueva ya es la activa. Navegamos a /chat plano.
      router.push(`/dashboard/mis-casos/${casoId}/chat`);
      router.refresh();
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
          <DialogTitle>¿Empezar una conversación nueva?</DialogTitle>
          <DialogDescription>
            La conversación actual va a quedar en{" "}
            <span className="text-foreground font-medium">
              Conversaciones anteriores
            </span>{" "}
            y la podés volver a abrir en cualquier momento. Empezás una
            nueva con el contexto del caso pero sin el historial del chat
            previo.
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
          <Button onClick={handleConfirmar} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {loading ? "Creando..." : "Empezar nueva"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
