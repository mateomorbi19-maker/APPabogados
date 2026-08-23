"use client";
import { useEffect, useRef } from "react";
import type { z } from "zod";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { preguntaSchema } from "@/lib/schemas";
import {
  esPreguntaDeOpciones,
  esRespuestaOpciones,
  RESPUESTA_OPCIONES_VACIA,
  type RespuestaOpciones,
  type RespuestaValor,
} from "@/lib/nuevo-analisis/respuestas";

type Pregunta = z.infer<typeof preguntaSchema>;

type Props = {
  pregunta: Pregunta;
  value: RespuestaValor | undefined;
  onChange: (v: RespuestaValor) => void;
  disabled?: boolean;
};

export function PreguntaField({ pregunta, value, onChange, disabled }: Props) {
  // Una pregunta de opciones no tiene UN control al que apuntar con htmlFor:
  // tiene varios checkboxes. Se marca como grupo y el enunciado lo nombra vía
  // aria-labelledby; con htmlFor apuntando a un id inexistente, un lector de
  // pantalla anuncia las opciones sin la pregunta.
  const esOpciones = esPreguntaDeOpciones(pregunta);
  const idEnunciado = `${pregunta.id}-enunciado`;

  const enunciado = (
    <>
      {pregunta.label}
      {pregunta.requerido ? <span className="text-destructive">*</span> : null}
    </>
  );

  return (
    <div
      className="space-y-2"
      role={esOpciones ? "group" : undefined}
      aria-labelledby={esOpciones ? idEnunciado : undefined}
    >
      {esOpciones ? (
        <p
          id={idEnunciado}
          className="text-sm leading-snug font-medium select-none"
        >
          {enunciado}
        </p>
      ) : (
        <Label htmlFor={pregunta.id} className="text-sm leading-snug">
          {enunciado}
        </Label>
      )}
      {/* El motivo va ARRIBA del control y no abajo: es el propósito diagnóstico
          de la pregunta ("qué cambia según cómo contestes"), así que se lee
          antes de responder, no después. */}
      <p className="text-sm text-muted-foreground">{pregunta.motivo}</p>
      <PreguntaControl
        pregunta={pregunta}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}

function PreguntaControl({ pregunta, value, onChange, disabled }: Props) {
  // El fallback a texto libre cuando el modelo dice "opciones" pero no manda
  // ninguna vive en `esPreguntaDeOpciones`, compartido con la inicialización y
  // la validación del estado.
  if (!esPreguntaDeOpciones(pregunta)) {
    return (
      <Input
        id={pregunta.id}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    );
  }

  const respuesta = esRespuestaOpciones(value) ? value : RESPUESTA_OPCIONES_VACIA;
  return (
    <OpcionesMultiples
      pregunta={pregunta}
      opciones={pregunta.opciones ?? []}
      respuesta={respuesta}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

// Lista de opciones NO excluyentes + "Otro" con campo libre.
//
// Multi-selección siempre, nunca radio: en un expediente real las situaciones se
// superponen (dos imputados con distinta situación de libertad, dos vicios en la
// misma detención). Obligar a elegir una sola opción fuerza al abogado a mentir
// o a no contestar.
function OpcionesMultiples({
  pregunta,
  opciones,
  respuesta,
  onChange,
  disabled,
}: {
  pregunta: Pregunta;
  opciones: string[];
  respuesta: RespuestaOpciones;
  onChange: (v: RespuestaValor) => void;
  disabled?: boolean;
}) {
  const otroRef = useRef<HTMLInputElement>(null);
  const otroActivo = respuesta.otroActivo;

  // Marcar "Otro" sin que el cursor caiga en el campo obliga a un click extra
  // para hacer lo único que "Otro" habilita.
  useEffect(() => {
    if (otroActivo) otroRef.current?.focus();
  }, [otroActivo]);

  function toggleOpcion(o: string, marcada: boolean) {
    onChange({
      ...respuesta,
      opciones: marcada
        ? [...respuesta.opciones, o]
        : respuesta.opciones.filter((s) => s !== o),
    });
  }

  const idOtro = `${pregunta.id}-otro`;

  return (
    // Zonas de toque en móvil (max-md:). La fila medía ~20px de alto y las
    // separaba space-y-2 (8px); el Checkbox compensa con after:-inset-y-2, así
    // que las zonas de dos opciones consecutivas se solapaban ~4px y tocar
    // entre dos marcaba la de abajo. Acá el Label pasa a ser el área tocable
    // (min-h-11 + py-2.5 ≈ 44px, ancho completo por flex-1) y el gap entre
    // filas baja a 4px, con lo que las zonas dejan de pisarse. Un mistap en
    // este control condiciona mal un análisis de ~90s y tokens reales.
    <div className="space-y-2 max-md:space-y-1">
      {opciones.map((o) => {
        const cbId = `${pregunta.id}-${o}`;
        return (
          <div key={o} className="flex items-start gap-2 max-md:gap-3">
            <Checkbox
              id={cbId}
              checked={respuesta.opciones.includes(o)}
              onCheckedChange={(c) => toggleOpcion(o, c === true)}
              disabled={disabled}
              className="mt-0.5 max-md:mt-3"
            />
            <Label
              htmlFor={cbId}
              className="flex-1 cursor-pointer items-start font-normal leading-snug max-md:min-h-11 max-md:py-2.5"
            >
              {o}
            </Label>
          </div>
        );
      })}

      <div className="flex items-start gap-2 max-md:gap-3">
        <Checkbox
          id={idOtro}
          checked={otroActivo}
          // Al destildar limpiamos el texto: dejar una aclaración escondida en
          // el estado y mandarla igual al análisis sería mentirle al abogado
          // sobre lo que está enviando.
          onCheckedChange={(c) =>
            onChange({
              ...respuesta,
              otroActivo: c === true,
              otro: c === true ? respuesta.otro : "",
            })
          }
          disabled={disabled}
          className="mt-0.5 max-md:mt-3"
        />
        <Label
          htmlFor={idOtro}
          className="flex-1 cursor-pointer items-start font-normal leading-snug max-md:min-h-11 max-md:py-2.5"
        >
          Otro
        </Label>
      </div>

      {otroActivo ? (
        <Input
          ref={otroRef}
          value={respuesta.otro}
          onChange={(e) => onChange({ ...respuesta, otro: e.target.value })}
          placeholder="Aclará lo que haga falta"
          disabled={disabled}
          aria-label={`Aclaración para: ${pregunta.label}`}
          // La sangría iguala el ancho del checkbox + el gap de la fila, que en
          // móvil es gap-3 (16+12=28px) y en escritorio gap-2 (16+8=24px).
          className="ml-6 w-[calc(100%-1.5rem)] max-md:ml-7 max-md:w-[calc(100%-1.75rem)]"
        />
      ) : null}
    </div>
  );
}
