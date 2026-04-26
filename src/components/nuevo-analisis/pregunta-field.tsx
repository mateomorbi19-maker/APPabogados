"use client";
import type { z } from "zod";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { preguntaSchema } from "@/lib/schemas";

type Pregunta = z.infer<typeof preguntaSchema>;

// El estado de una respuesta es un union por tipo de pregunta:
//   - select / radio / text → string
//   - checkbox con opciones → string[] (multi-select)
//   - checkbox sin opciones → boolean (toggle Sí/No)
// El padre usa Record<id, RespuestaValor> y normaliza el shape al
// armar el payload final (eso lo hace 4.5).
export type RespuestaValor = string | string[] | boolean;

type Props = {
  pregunta: Pregunta;
  value: RespuestaValor;
  onChange: (v: RespuestaValor) => void;
};

export function PreguntaField({ pregunta, value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <Label htmlFor={pregunta.id}>
        {pregunta.label}
        {pregunta.requerido ? (
          <span className="text-destructive">*</span>
        ) : null}
      </Label>
      <PreguntaControl
        pregunta={pregunta}
        value={value}
        onChange={onChange}
      />
      <p className="text-sm text-muted-foreground">{pregunta.motivo}</p>
    </div>
  );
}

function PreguntaControl({ pregunta, value, onChange }: Props) {
  const opciones = pregunta.opciones ?? [];

  switch (pregunta.tipo) {
    case "select": {
      // Base-UI Select interpreta value="" como "valor seleccionado vacío".
      // Pasamos null cuando no hay selección para que muestre el placeholder.
      const stringValue = typeof value === "string" && value !== "" ? value : null;
      return (
        <Select
          value={stringValue}
          onValueChange={(v) => onChange(typeof v === "string" ? v : "")}
        >
          <SelectTrigger id={pregunta.id} className="w-full sm:w-72">
            <SelectValue placeholder="Elegí una opción" />
          </SelectTrigger>
          <SelectContent>
            {opciones.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case "radio":
      return (
        <RadioGroup
          value={typeof value === "string" ? value : ""}
          onValueChange={(v) => onChange(typeof v === "string" ? v : "")}
        >
          {opciones.map((o) => (
            <div key={o} className="flex items-center gap-2">
              <RadioGroupItem value={o} id={`${pregunta.id}-${o}`} />
              <Label htmlFor={`${pregunta.id}-${o}`} className="font-normal">
                {o}
              </Label>
            </div>
          ))}
        </RadioGroup>
      );
    case "text":
      return (
        <Input
          id={pregunta.id}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "checkbox": {
      // Sin opciones → toggle único (boolean). Con opciones → multi-select
      // (array de strings que se actualiza on-toggle).
      if (opciones.length === 0) {
        const checked = value === true;
        return (
          <Checkbox
            id={pregunta.id}
            checked={checked}
            onCheckedChange={(c) => onChange(c)}
          />
        );
      }
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-2">
          {opciones.map((o) => {
            const isChecked = selected.includes(o);
            const cbId = `${pregunta.id}-${o}`;
            return (
              <div key={o} className="flex items-center gap-2">
                <Checkbox
                  id={cbId}
                  checked={isChecked}
                  onCheckedChange={(c) =>
                    onChange(
                      c ? [...selected, o] : selected.filter((s) => s !== o),
                    )
                  }
                />
                <Label htmlFor={cbId} className="font-normal">
                  {o}
                </Label>
              </div>
            );
          })}
        </div>
      );
    }
  }
}
