"use client";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { RolSelector, type Rol } from "./rol-selector";

// Espejo del min del schema server-side (preAnalisisInputSchema en
// src/lib/schemas.ts). Si en el futuro se cambia, actualizar acá también
// — la validación final la hace el server, pero gateamos client-side
// para evitar el round-trip.
const MIN_CHARS = 20;

type Props = {
  caso: string;
  onCasoChange: (caso: string) => void;
  rol: Rol | null;
  onRolChange: (r: Rol) => void;
  onSubmit: () => void;
  loading: boolean;
};

export function CasoInput({
  caso,
  onCasoChange,
  rol,
  onRolChange,
  onSubmit,
  loading,
}: Props) {
  const trimmedLength = caso.trim().length;
  const casoValido = trimmedLength >= MIN_CHARS;
  const puedeContinuar = casoValido && rol !== null && !loading;

  const hint = !casoValido
    ? `Mínimo ${MIN_CHARS} caracteres (${trimmedLength}/${MIN_CHARS})`
    : rol === null
      ? "Elegí un rol para continuar"
      : null;

  return (
    <div className="space-y-6">
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
        <p className="text-xs text-muted-foreground">
          {trimmedLength < MIN_CHARS
            ? `Mínimo ${MIN_CHARS} caracteres (${trimmedLength}/${MIN_CHARS})`
            : `${trimmedLength} caracteres`}
        </p>
      </div>

      <Separator />

      <div className="space-y-3">
        <h3 className="font-medium text-xs uppercase tracking-wider text-muted-foreground">
          Rol del análisis
        </h3>
        <RolSelector value={rol} onChange={onRolChange} disabled={loading} />
      </div>

      <div className="flex flex-col items-end gap-1.5 pt-2">
        <Button type="button" onClick={onSubmit} disabled={!puedeContinuar}>
          {loading ? <Loader2 className="animate-spin" /> : null}
          Continuar
        </Button>
        {hint && !loading ? (
          <p className="text-sm text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}
