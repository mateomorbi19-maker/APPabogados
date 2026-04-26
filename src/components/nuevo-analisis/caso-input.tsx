"use client";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Espejo del min del schema server-side (preAnalisisInputSchema en
// src/lib/schemas.ts). Si en el futuro se cambia, actualizar acá también
// — la validación final la hace el server, pero gateamos client-side
// para evitar el round-trip.
const MIN_CHARS = 20;

type Props = {
  caso: string;
  onCasoChange: (caso: string) => void;
  onSubmit: (caso: string) => void;
  loading: boolean;
};

export function CasoInput({ caso, onCasoChange, onSubmit, loading }: Props) {
  const trimmedLength = caso.trim().length;
  const valid = trimmedLength >= MIN_CHARS;

  return (
    <div className="space-y-3">
      <Label htmlFor="caso">Describí el caso</Label>
      <Textarea
        id="caso"
        value={caso}
        onChange={(e) => onCasoChange(e.target.value)}
        placeholder="Contá qué pasó: hechos, personas involucradas, dónde, cuándo, etapa procesal si la conocés…"
        disabled={loading}
        className="min-h-40 text-sm"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {trimmedLength < MIN_CHARS
            ? `Mínimo ${MIN_CHARS} caracteres (${trimmedLength}/${MIN_CHARS})`
            : `${trimmedLength} caracteres`}
        </span>
        <Button
          type="button"
          onClick={() => onSubmit(caso)}
          disabled={!valid || loading}
        >
          {loading ? <Loader2 className="animate-spin" /> : null}
          Continuar
        </Button>
      </div>
    </div>
  );
}
