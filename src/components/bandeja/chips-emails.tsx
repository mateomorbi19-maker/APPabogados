"use client";
// Campo de destinatarios con chips. Confirma la dirección al escribir coma,
// Enter, Tab o al perder el foco; Backspace con el input vacío borra el último
// chip (el gesto que ya tiene aprendido cualquiera que usó un cliente de mail).

import { useId, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
// Misma regex que usa el parseo de headers entrantes (parse.ts), para que no
// se pueda cargar en el borrador algo que después el server rechace con 400.
import { RE_EMAIL_LAXO as RE_EMAIL } from "@/lib/gmail/types";

type Props = {
  label: string;
  valores: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Tope del server (20 direcciones por campo). */
  maximo?: number;
};

export function ChipsEmails({
  label,
  valores,
  onChange,
  disabled,
  placeholder,
  maximo = 20,
}: Props) {
  const id = useId();
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);

  const confirmar = (crudo: string): boolean => {
    // Un pegado de "a@x.com, b@y.com" tiene que entrar como dos chips.
    const partes = crudo
      .split(/[,;\s]+/)
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.length > 0);
    if (partes.length === 0) {
      setError(null);
      return true;
    }

    const invalidos = partes.filter((p) => !RE_EMAIL.test(p));
    if (invalidos.length > 0) {
      setError(`No parece una dirección válida: ${invalidos[0]}`);
      return false;
    }

    const nuevos = [...valores];
    for (const p of partes) {
      if (nuevos.includes(p)) continue;
      if (nuevos.length >= maximo) {
        setError(`Máximo ${maximo} destinatarios`);
        onChange(nuevos);
        return false;
      }
      nuevos.push(p);
    }
    setError(null);
    onChange(nuevos);
    setTexto("");
    return true;
  };

  const quitar = (email: string) => {
    setError(null);
    onChange(valores.filter((v) => v !== email));
  };

  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="text-xs font-medium text-[var(--el-text-soft)]"
      >
        {label}
      </label>
      <div
        className={cn(
          "flex min-h-8 flex-wrap items-center gap-1.5 rounded-lg border bg-input/30 px-2 py-1.5 transition-colors",
          error
            ? "border-destructive"
            : "border-input focus-within:border-ring",
          disabled && "opacity-50",
        )}
      >
        {valores.map((v) => (
          <span
            key={v}
            className="inline-flex max-w-full items-center gap-1 rounded-4xl bg-[rgba(139,92,246,0.18)] py-0.5 pr-1 pl-2 text-xs text-[#c4b5fd]"
          >
            <span className="truncate">{v}</span>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Quitar ${v}`}
              onClick={() => quitar(v)}
              className="rounded-full p-0.5 transition-colors hover:bg-white/15"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          inputMode="email"
          autoComplete="off"
          disabled={disabled}
          value={texto}
          placeholder={valores.length === 0 ? placeholder : ""}
          onChange={(e) => {
            const v = e.target.value;
            // Una coma pegada o tipeada cierra el chip en el acto.
            if (/[,;]/.test(v)) {
              confirmar(v);
              return;
            }
            setTexto(v);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Tab") {
              if (texto.trim().length === 0) return;
              e.preventDefault();
              confirmar(texto);
              return;
            }
            if (e.key === "Backspace" && texto.length === 0 && valores.length > 0) {
              e.preventDefault();
              quitar(valores[valores.length - 1]);
            }
          }}
          onBlur={() => {
            if (texto.trim().length > 0) confirmar(texto);
          }}
          className="min-w-32 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--el-text-muted)] disabled:cursor-not-allowed"
        />
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
