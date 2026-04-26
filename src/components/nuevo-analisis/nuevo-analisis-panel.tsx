"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConsumo } from "@/lib/hooks/use-consumo";
import type { PreAnalisisOutput } from "@/lib/schemas";
import { CasoInput } from "./caso-input";
import { FormularioDinamico } from "./formulario-dinamico";

// Tipo del fase del flujo. `caso` se conserva en TODAS las fases para que
// el botón Volver desde el formulario y la edición desde error mantengan
// el texto que el usuario ya escribió (R1 del ajuste de Fase 4.4).
type Fase =
  | { kind: "input"; caso: string }
  | { kind: "loading"; caso: string }
  | { kind: "form"; caso: string; data: PreAnalisisOutput }
  | {
      kind: "error";
      caso: string;
      message: string;
      tipo: "rate-limit" | "general";
    };

type PreAnalisisOk = { ok: true } & PreAnalisisOutput;
type PreAnalisisErr = { ok: false; error: string };
type PreAnalisisResp = PreAnalisisOk | PreAnalisisErr;

export function NuevoAnalisisPanel() {
  const { revalidate } = useConsumo();
  const [fase, setFase] = useState<Fase>({ kind: "input", caso: "" });
  // In-flight guard. Mismo motivo que en use-consumo.tsx: el `disabled` del
  // botón Continuar no alcanza porque React 18 batchea renders y múltiples
  // clicks pueden procesarse antes de que el disabled se propague al DOM.
  const inFlightRef = useRef(false);

  const submitCaso = async (caso: string) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setFase({ kind: "loading", caso });
    try {
      const res = await fetch("/api/pre-analisis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caso }),
      });
      const json = (await res
        .json()
        .catch(() => null)) as PreAnalisisResp | null;

      if (!res.ok || !json || json.ok === false) {
        const tipo: "rate-limit" | "general" =
          res.status === 429 ? "rate-limit" : "general";
        const message =
          tipo === "rate-limit"
            ? "Cupo mensual de tokens agotado. Esperá al próximo período de facturación."
            : json && "error" in json
              ? json.error
              : `Error procesando solicitud (HTTP ${res.status})`;
        setFase({ kind: "error", caso, message, tipo });
        return;
      }

      // Éxito: el pre-análisis insertó tokens en la DB, refrescamos el header
      // para que la barra de consumo refleje el nuevo total.
      void revalidate();
      setFase({
        kind: "form",
        caso,
        data: {
          resumen_preliminar: json.resumen_preliminar,
          datos_detectados: json.datos_detectados,
          preguntas: json.preguntas,
        },
      });
    } catch (e) {
      setFase({
        kind: "error",
        caso,
        message: e instanceof Error ? e.message : "Error de red",
        tipo: "general",
      });
    } finally {
      inFlightRef.current = false;
    }
  };

  if (fase.kind === "form") {
    return (
      <FormularioDinamico
        data={fase.data}
        onVolver={() => setFase({ kind: "input", caso: fase.caso })}
      />
    );
  }

  return (
    <div className="space-y-6">
      <CasoInput
        caso={fase.caso}
        // Editar el caso transiciona siempre a kind="input": limpia el error
        // visible y aborta cualquier estado anterior. El loading bloquea la
        // edición vía `disabled`.
        onCasoChange={(c) => setFase({ kind: "input", caso: c })}
        onSubmit={submitCaso}
        loading={fase.kind === "loading"}
      />
      {fase.kind === "error" ? (
        <Card className="p-6 border-destructive">
          <p className="text-destructive font-medium mb-1">
            {fase.tipo === "rate-limit"
              ? "Cupo agotado"
              : "Error consultando pre-análisis"}
          </p>
          <p className="text-sm text-muted-foreground mb-4">{fase.message}</p>
          {fase.tipo === "general" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void submitCaso(fase.caso)}
            >
              Reintentar
            </Button>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
