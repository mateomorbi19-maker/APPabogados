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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Estrategia, RolEstrategia } from "@/lib/schemas";

type Props = {
  open: boolean;
  ejecucionId: string;
  caso: string;
  rolEstrategia: RolEstrategia;
  idxEstrategia: number;
  estrategia: Estrategia;
  // Cierre desde el botón "Cancelar" o tras éxito (el redirect se hace
  // dentro del modal, pero si querés desmontarlo, llamá onClose).
  onClose: () => void;
};

// Sugerencia automática del título a partir del caso. Estrategia:
// si el caso ≤ 60 chars → tal cual.
// Si > 60: tomar los primeros 60 chars y cortar en el ÚLTIMO punto, coma o
// salto de línea encontrado, para no cortar a mitad de palabra y mantener
// una frase legible. Si en esos 60 chars no hay ningún separador, cortar
// en char 60 y agregar "..." (caso raro: caso sin puntuación).
//
// Esta interpretación matchea el ejemplo dado: "Sebastián, ciudadano
// paraguayo de 34 años, llegó a Ezeiza..." (>60 chars) →
// "Sebastián, ciudadano paraguayo de 34 años" (corta en la última coma
// antes del char 60). Una interpretación literal "primer separador" daría
// solo "Sebastián", que no es lo que se pidió.
export function sugerirTitulo(caso: string): string {
  const t = caso.trim();
  if (t.length <= 60) return t;
  const inicio = t.slice(0, 60);
  const seps = [".", ",", "\n"];
  for (let i = inicio.length - 1; i >= 0; i--) {
    if (seps.includes(inicio[i])) {
      return inicio.slice(0, i).trim();
    }
  }
  return inicio.trim() + "...";
}

export function SeleccionarEstrategiaModal({
  open,
  ejecucionId,
  caso,
  rolEstrategia,
  idxEstrategia,
  estrategia,
  onClose,
}: Props) {
  const router = useRouter();
  const [titulo, setTitulo] = useState(() => sugerirTitulo(caso));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tituloOk = titulo.trim().length > 0 && titulo.trim().length <= 500;

  const handleClose = () => {
    if (loading) return; // bloqueante: no cerrar mientras hay POST in-flight
    setError(null);
    onClose();
  };

  const handleCrear = async () => {
    if (loading || !tituloOk) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/casos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          titulo: titulo.trim(),
          ejecucion_origen_id: ejecucionId,
          rol_estrategia: rolEstrategia,
          idx_estrategia: idxEstrategia,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; caso_id: string }
        | { ok: false; error: string }
        | null;

      if (!res.ok || !json || ("ok" in json && json.ok === false)) {
        const msg =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : `Error creando caso (HTTP ${res.status})`;
        setError(msg);
        setLoading(false);
        return;
      }

      // TODO Fase 5: cuando exista /dashboard/mis-casos/[id], redirigir ahí
      // con el caso_id. Por ahora redirect a la lista (404 temporal hasta
      // que Fase 4 monte la página).
      router.push("/dashboard/mis-casos");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error de red";
      setError(msg);
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Mientras dura el POST, bloqueamos el cierre por ESC / click fuera /
        // botón X. Como el dialog está controlado por la prop `open`, si no
        // llamamos onClose() el state del padre no cambia y queda abierto.
        // Adicionalmente ocultamos la X (showCloseButton={!loading}).
        if (!v) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={!loading}>
        <DialogHeader>
          <DialogTitle>Crear caso a partir de esta estrategia</DialogTitle>
          <DialogDescription>
            Estrategia elegida:{" "}
            <span className="text-foreground font-medium">
              {estrategia.nombre}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="titulo-caso">Título del caso</Label>
          <Input
            id="titulo-caso"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            disabled={loading}
            maxLength={500}
            autoFocus
          />
          {!tituloOk ? (
            <p className="text-xs text-muted-foreground">
              El título no puede estar vacío.
            </p>
          ) : null}
        </div>

        {error ? (
          <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button onClick={handleCrear} disabled={loading || !tituloOk}>
            {loading ? <Loader2 className="animate-spin" /> : null}
            {loading ? "Creando..." : "Crear caso"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
