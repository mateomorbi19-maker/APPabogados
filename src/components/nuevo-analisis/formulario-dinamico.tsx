"use client";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { PreAnalisisOutput } from "@/lib/schemas";
import { PreguntaField, type RespuestaValor } from "./pregunta-field";
import { RolSelector, type Rol } from "./rol-selector";

type Props = {
  data: PreAnalisisOutput;
  respuestas: Record<string, RespuestaValor>;
  onRespuestasChange: (r: Record<string, RespuestaValor>) => void;
  rol: Rol | null;
  onRolChange: (r: Rol) => void;
  onVolver: () => void;
  onAnalizar: () => void;
  loading: boolean;
};

// Una pregunta requerida está completa si:
//   - text/select/radio: string non-vacío
//   - checkbox sin opciones (toggle Sí/No): siempre completa, el default
//     `false` ya es respuesta válida ("el usuario respondió No")
//   - checkbox con opciones (multi): al menos una opción seleccionada
function preguntaRequeridaCompleta(
  p: PreAnalisisOutput["preguntas"][number],
  v: RespuestaValor | undefined,
): boolean {
  if (!p.requerido) return true;
  if (p.tipo === "checkbox") {
    if (Array.isArray(v)) return v.length > 0;
    return typeof v === "boolean";
  }
  return typeof v === "string" && v.trim() !== "";
}

export function FormularioDinamico({
  data,
  respuestas,
  onRespuestasChange,
  rol,
  onRolChange,
  onVolver,
  onAnalizar,
  loading,
}: Props) {
  const dd = data.datos_detectados;

  const requeridasCompletas = data.preguntas.every((p) =>
    preguntaRequeridaCompleta(p, respuestas[p.id]),
  );
  const puedeAnalizar = requeridasCompletas && rol !== null && !loading;

  const hint = !requeridasCompletas
    ? "Completá las preguntas requeridas para continuar"
    : rol === null
      ? "Elegí un rol para continuar"
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-serif text-3xl">Pre-análisis</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={onVolver}
          disabled={loading}
        >
          <ArrowLeft />
          Volver
        </Button>
      </div>

      <Card className="p-6 space-y-2">
        <h3 className="font-medium text-xs uppercase tracking-wider text-muted-foreground">
          Resumen preliminar
        </h3>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {data.resumen_preliminar}
        </p>
      </Card>

      <Card className="p-6">
        <h3 className="font-medium text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Datos detectados
        </h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Jurisdicción</dt>
            <dd>{dd.jurisdiccion_inferida ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Etapa procesal</dt>
            <dd>{dd.etapa_procesal ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">¿Hay detenidos?</dt>
            <dd>{dd.hay_detenidos ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Delitos posibles</dt>
            <dd>
              {dd.delitos_posibles.length > 0
                ? dd.delitos_posibles.join(", ")
                : "—"}
            </dd>
          </div>
        </dl>
      </Card>

      <Separator />

      <div className="space-y-5">
        <h3 className="font-medium text-xs uppercase tracking-wider text-muted-foreground">
          Preguntas
        </h3>
        {data.preguntas.map((p) => (
          <PreguntaField
            key={p.id}
            pregunta={p}
            value={respuestas[p.id]}
            onChange={(v) =>
              onRespuestasChange({ ...respuestas, [p.id]: v })
            }
          />
        ))}
      </div>

      <Separator />

      <div className="space-y-3">
        <h3 className="font-medium text-xs uppercase tracking-wider text-muted-foreground">
          Rol del análisis
        </h3>
        <RolSelector value={rol} onChange={onRolChange} disabled={loading} />
      </div>

      <div className="flex flex-col items-end gap-1.5 pt-2">
        <Button onClick={onAnalizar} disabled={!puedeAnalizar}>
          {loading ? <Loader2 className="animate-spin" /> : null}
          Analizar caso
        </Button>
        {hint && !loading ? (
          <p className="text-sm text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}
