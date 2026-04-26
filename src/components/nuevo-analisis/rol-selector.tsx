"use client";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export type Rol = "defensor" | "querellante" | "ambos";

const ROLES: ReadonlyArray<{
  value: Rol;
  titulo: string;
  descripcion: string;
}> = [
  {
    value: "defensor",
    titulo: "Defensor",
    descripcion: "Estrategias de defensa para el/los imputado/s.",
  },
  {
    value: "querellante",
    titulo: "Querellante / Fiscal",
    descripcion: "Estrategias de acusación.",
  },
  {
    value: "ambos",
    titulo: "Ambos",
    descripcion: "Estrategias de defensa y acusación en paralelo.",
  },
];

type Props = {
  value: Rol | null;
  onChange: (r: Rol) => void;
  disabled?: boolean;
};

export function RolSelector({ value, onChange, disabled }: Props) {
  return (
    <RadioGroup
      value={value ?? ""}
      onValueChange={(v) => {
        if (v === "defensor" || v === "querellante" || v === "ambos") {
          onChange(v);
        }
      }}
      disabled={disabled}
      className="grid grid-cols-1 sm:grid-cols-3 gap-3"
    >
      {ROLES.map((r) => (
        <Label
          key={r.value}
          htmlFor={`rol-${r.value}`}
          className={cn(
            "flex flex-col gap-1.5 p-4 rounded-md border cursor-pointer transition-colors font-normal",
            "hover:border-primary/50",
            value === r.value
              ? "border-primary bg-primary/5"
              : "border-border",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value={r.value} id={`rol-${r.value}`} />
            <span className="font-medium text-sm">{r.titulo}</span>
          </div>
          <span className="text-xs text-muted-foreground pl-6">
            {r.descripcion}
          </span>
        </Label>
      ))}
    </RadioGroup>
  );
}
