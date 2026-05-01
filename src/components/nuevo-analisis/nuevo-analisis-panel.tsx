"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConsumo } from "@/lib/hooks/use-consumo";
import {
  type AnalisisOutput,
  analisisOutputSchema,
  analizarCasoResponseSchema,
  type Busqueda,
  busquedaSchema,
  type PreAnalisisOutput,
} from "@/lib/schemas";
import {
  inicializarRespuestas,
  serializarRespuestas,
} from "@/lib/nuevo-analisis/serializar-respuestas";
import { CasoInput } from "./caso-input";
import { FormularioDinamico } from "./formulario-dinamico";
import type { RespuestaValor } from "./pregunta-field";
import { ProgresoAnalisis } from "./progreso-analisis";
import { ResultadosAnalisis } from "./resultados-analisis";
import type { Rol } from "./rol-selector";

// Contexto del formulario que se preserva en TODAS las fases post-form
// (analizando, resultado, error-analisis). El usuario no debe perder lo
// que llenó al volver desde un resultado o un error — mismo principio que
// el ajuste R1 de Fase 4.4 con el caso.
type FormCtx = {
  data: PreAnalisisOutput;
  respuestas: Record<string, RespuestaValor>;
  rol: Rol | null;
};

type ErrorAnalisisTipo =
  | "cupo"
  | "parse"
  | "general"
  | "red"
  | "cancelado";

type Fase =
  | { kind: "input"; caso: string }
  | { kind: "loading-pre"; caso: string }
  | {
      kind: "error-pre";
      caso: string;
      message: string;
      tipo: "rate-limit" | "general";
    }
  | { kind: "form"; caso: string; ctx: FormCtx }
  | { kind: "analizando"; caso: string; ctx: FormCtx; inicio: number }
  | {
      kind: "resultado";
      caso: string;
      ctx: FormCtx;
      analisis: AnalisisOutput;
      busquedas: Busqueda[];
      // Id de la ejecución que generó este resultado. Se usa para
      // habilitar el botón "Seleccionar estrategia" → POST /api/casos.
      // Puede ser undefined si el endpoint no lo devolvió (compat con
      // respuestas previas a Fase "Mis casos").
      ejecucionId: string | undefined;
    }
  | {
      kind: "error-analisis";
      caso: string;
      ctx: FormCtx;
      message: string;
      tipo: ErrorAnalisisTipo;
    };

type PreAnalisisOk = { ok: true } & PreAnalisisOutput;
type PreAnalisisErr = { ok: false; error: string };
type PreAnalisisResp = PreAnalisisOk | PreAnalisisErr;

function tituloError(tipo: ErrorAnalisisTipo): string {
  switch (tipo) {
    case "cupo":
      return "Cupo agotado";
    case "parse":
      return "Respuesta del modelo no procesable";
    case "general":
      return "Error analizando caso";
    case "red":
      return "Error de red";
    case "cancelado":
      return "Análisis cancelado";
  }
}

// El reintentar consume tokens nuevos. Para "cupo" no tiene sentido
// (vuelve a fallar). Para el resto sí. "Cancelado" también es reintentable.
function puedeReintentar(tipo: ErrorAnalisisTipo): boolean {
  return tipo !== "cupo";
}

function extraerError(json: unknown): string | null {
  if (
    json &&
    typeof json === "object" &&
    "error" in json &&
    typeof (json as { error?: unknown }).error === "string"
  ) {
    return (json as { error: string }).error;
  }
  return null;
}

// === Recuperación post-502 ===
// Easypanel/Traefik puede cortar al cliente con 502 si el análisis tarda más
// que el timeout del proxy (~60-90s default), aunque el server haya
// terminado y persistido el resultado en DB. Cuando vemos 502, hacemos
// polling al endpoint /api/ejecuciones/buscar buscando una fila reciente
// del usuario con el mismo `caso` + `rol` y `metadata.resultado` poblado.
// Si la encontramos, la usamos como si el POST hubiera devuelto 200.
const RECUPERAR_TIMEOUT_MS = 60_000;
const RECUPERAR_INTERVALO_MS = 5_000;
const RECUPERAR_DELAY_INICIAL_MS = 2_000;

type RecuperadoOk = {
  analisis: AnalisisOutput;
  busquedas: Busqueda[];
  ejecucionId: string;
};

async function intentarRecuperarAnalisis(
  desdeIso: string,
  caso: string,
  rol: string,
  signal: AbortSignal,
): Promise<RecuperadoOk | null> {
  const inicio = Date.now();
  // Esperita inicial: el server puede tardar 1-2s extra en hacer el INSERT
  // después del corte del proxy. Polling inmediato sería desperdicio.
  await new Promise((r) => setTimeout(r, RECUPERAR_DELAY_INICIAL_MS));
  if (signal.aborted) return null;

  while (Date.now() - inicio < RECUPERAR_TIMEOUT_MS) {
    if (signal.aborted) return null;
    try {
      const url = `/api/ejecuciones/buscar?tipo=analizar_caso&desde=${encodeURIComponent(desdeIso)}`;
      const res = await fetch(url, { signal });
      if (res.ok) {
        const json = (await res.json().catch(() => null)) as {
          ejecuciones?: Array<{
            id: string;
            metadata: unknown;
          }>;
        } | null;
        const lista = json?.ejecuciones ?? [];
        for (const ej of lista) {
          if (!ej.metadata || typeof ej.metadata !== "object") continue;
          const meta = ej.metadata as Record<string, unknown>;
          if (meta.caso !== caso) continue;
          if (meta.rol !== rol) continue;
          if (!meta.resultado) continue;
          // Validar shapes — si vinieron malformados saltar y seguir poll.
          const parsedAnalisis = analisisOutputSchema.safeParse(meta.resultado);
          const parsedBusquedas = z
            .array(busquedaSchema)
            .safeParse(meta.busquedas ?? []);
          if (!parsedAnalisis.success || !parsedBusquedas.success) continue;
          return {
            analisis: parsedAnalisis.data,
            busquedas: parsedBusquedas.data,
            ejecucionId: ej.id,
          };
        }
      }
    } catch {
      // Errores de red durante el polling: seguir intentando hasta el
      // timeout total. El AbortSignal corta limpio si el usuario
      // cancela o se desmonta el panel.
    }
    if (signal.aborted) return null;
    await new Promise((r) => setTimeout(r, RECUPERAR_INTERVALO_MS));
  }
  return null;
}

export function NuevoAnalisisPanel() {
  const { revalidate } = useConsumo();
  const [fase, setFase] = useState<Fase>({ kind: "input", caso: "" });
  // Dos in-flight guards independientes: uno para el pre-análisis y otro
  // para el análisis profundo. Mismo patrón que use-consumo.tsx — el
  // disabled del botón no alcanza con React 18 batching.
  const inFlightPreRef = useRef(false);
  const inFlightAnalisisRef = useRef(false);
  // Controller del fetch del análisis profundo. Lo guardamos en ref para
  // que ProgresoAnalisis pueda dispararlo via onCancel y para abortar en
  // unmount del panel.
  const analisisControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      analisisControllerRef.current?.abort();
    };
  }, []);

  const submitCaso = async (caso: string) => {
    if (inFlightPreRef.current) return;
    inFlightPreRef.current = true;
    setFase({ kind: "loading-pre", caso });
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
        setFase({ kind: "error-pre", caso, message, tipo });
        return;
      }

      // Éxito: el pre-análisis insertó tokens en la DB, refrescamos el header.
      void revalidate();
      const data: PreAnalisisOutput = {
        resumen_preliminar: json.resumen_preliminar,
        datos_detectados: json.datos_detectados,
        preguntas: json.preguntas,
      };
      setFase({
        kind: "form",
        caso,
        ctx: {
          data,
          respuestas: inicializarRespuestas(data.preguntas),
          rol: null,
        },
      });
    } catch (e) {
      setFase({
        kind: "error-pre",
        caso,
        message: e instanceof Error ? e.message : "Error de red",
        tipo: "general",
      });
    } finally {
      inFlightPreRef.current = false;
    }
  };

  const submitAnalisis = async (ctx: FormCtx, caso: string) => {
    if (inFlightAnalisisRef.current) return;
    if (ctx.rol === null) return; // doble guard, ya gateado en UI
    inFlightAnalisisRef.current = true;

    const controller = new AbortController();
    analisisControllerRef.current = controller;
    const inicio = Date.now();
    // Timestamp ISO usado para el endpoint de recuperación post-502: filtra
    // ejecuciones que arrancaron desde antes de este POST. Restamos 5s para
    // tolerar drift de reloj cliente↔server.
    const desdeIso = new Date(inicio - 5_000).toISOString();
    setFase({ kind: "analizando", caso, ctx, inicio });

    const contexto = serializarRespuestas(ctx.respuestas, ctx.data.preguntas);

    try {
      const res = await fetch("/api/analizar-caso", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caso, rol: ctx.rol, contexto }),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => null)) as unknown;

      if (controller.signal.aborted) return;

      if (!res.ok || !json || typeof json !== "object") {
        // Map de status → tipo de error + si consumió tokens.
        // 429: el rate limiter cortó ANTES del LLM → no consumió.
        // 502: el agente corrió y luego falló parse o iteraciones → SÍ consumió.
        //      ANTES de mostrar error, intentamos recuperar (Easypanel/Traefik
        //      puede haber cortado por timeout aunque el server terminó OK).
        // 500: típicamente errores de infra (env vars, DB, etc.) → no consumió.
        // Otros: incierto, no revalidamos para no pisar al header.
        let tipo: ErrorAnalisisTipo;
        let consumioTokens = false;
        let message: string;
        if (res.status === 429) {
          tipo = "cupo";
          message =
            extraerError(json) ??
            "Cupo mensual de tokens agotado. Esperá al próximo período.";
        } else if (res.status === 502) {
          // Intento de recuperación: si el server alcanzó a persistir el
          // resultado, lo encontramos vía polling y mostramos como éxito.
          const recuperado = await intentarRecuperarAnalisis(
            desdeIso,
            caso,
            ctx.rol,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          if (recuperado) {
            void revalidate();
            setFase({
              kind: "resultado",
              caso,
              ctx,
              analisis: recuperado.analisis,
              busquedas: recuperado.busquedas,
              ejecucionId: recuperado.ejecucionId,
            });
            return;
          }
          tipo = "parse";
          consumioTokens = true;
          message =
            extraerError(json) ??
            "El modelo devolvió una respuesta que no se pudo procesar.";
        } else if (res.status === 500) {
          tipo = "general";
          message = extraerError(json) ?? "Error interno del servidor.";
        } else {
          tipo = "general";
          message =
            extraerError(json) ??
            `Error procesando solicitud (HTTP ${res.status})`;
        }
        if (consumioTokens) void revalidate();
        setFase({ kind: "error-analisis", caso, ctx, message, tipo });
        return;
      }

      // 200 OK → validar shape con Zod. Defensa en profundidad: si el
      // contrato del endpoint cambia o el parser server-side deja pasar
      // algo malformado, fallamos a "parse error" en vez de explotar el
      // árbol de render. Los tokens reales ya se cobraron server-side.
      const parsed = analizarCasoResponseSchema.safeParse(json);
      if (!parsed.success) {
        void revalidate();
        setFase({
          kind: "error-analisis",
          caso,
          ctx,
          message: "El servidor devolvió una respuesta en formato inesperado.",
          tipo: "parse",
        });
        return;
      }

      void revalidate();
      const { defensor, querellante, metadata, busquedas, ejecucion_id } =
        parsed.data;
      setFase({
        kind: "resultado",
        caso,
        ctx,
        analisis: { defensor, querellante, metadata },
        busquedas,
        ejecucionId: ejecucion_id,
      });
    } catch (e) {
      // AbortError: el usuario canceló o el panel se desmontó. En ambos
      // casos, NO revalidamos: el server sigue corriendo y persiste tokens
      // cuando termine, pero no sabemos cuándo. Si revalidáramos ahora,
      // habría una ventana en la que el header diría "0 tokens nuevos" y
      // luego el próximo render los traería. Mejor que el próximo trigger
      // de revalidate (siguiente fetch del usuario) los lea.
      if (e instanceof DOMException && e.name === "AbortError") {
        setFase({
          kind: "error-analisis",
          caso,
          ctx,
          message: "Análisis cancelado.",
          tipo: "cancelado",
        });
        return;
      }
      setFase({
        kind: "error-analisis",
        caso,
        ctx,
        message: e instanceof Error ? e.message : "Error de red",
        tipo: "red",
      });
    } finally {
      inFlightAnalisisRef.current = false;
      analisisControllerRef.current = null;
    }
  };

  // === Render ===

  // Form vivo — durante "form" y "analizando" mostramos el formulario.
  // En "analizando" el form va `loading={true}` (botón deshabilitado, rol
  // y respuestas no editables vía el `disabled` que cada control respeta).
  if (fase.kind === "form" || fase.kind === "analizando") {
    const ctx = fase.ctx;
    const loading = fase.kind === "analizando";
    return (
      <div className="space-y-6">
        <FormularioDinamico
          data={ctx.data}
          respuestas={ctx.respuestas}
          onRespuestasChange={(r) =>
            setFase((prev) =>
              prev.kind === "form"
                ? { ...prev, ctx: { ...prev.ctx, respuestas: r } }
                : prev,
            )
          }
          rol={ctx.rol}
          onRolChange={(rol) =>
            setFase((prev) =>
              prev.kind === "form"
                ? { ...prev, ctx: { ...prev.ctx, rol } }
                : prev,
            )
          }
          onVolver={() => setFase({ kind: "input", caso: fase.caso })}
          onAnalizar={() => void submitAnalisis(ctx, fase.caso)}
          loading={loading}
        />
        {fase.kind === "analizando" ? (
          <ProgresoAnalisis
            inicio={fase.inicio}
            onCancel={() => analisisControllerRef.current?.abort()}
          />
        ) : null}
      </div>
    );
  }

  if (fase.kind === "resultado") {
    return (
      <ResultadosAnalisis
        data={fase.analisis}
        busquedas={fase.busquedas}
        onVolver={() =>
          setFase({ kind: "form", caso: fase.caso, ctx: fase.ctx })
        }
        onReiniciar={() => setFase({ kind: "input", caso: "" })}
        ejecucionId={fase.ejecucionId}
        caso={fase.caso}
      />
    );
  }

  if (fase.kind === "error-analisis") {
    return (
      <div className="space-y-6">
        <FormularioDinamico
          data={fase.ctx.data}
          respuestas={fase.ctx.respuestas}
          onRespuestasChange={(r) =>
            setFase((prev) =>
              prev.kind === "error-analisis"
                ? { ...prev, ctx: { ...prev.ctx, respuestas: r } }
                : prev,
            )
          }
          rol={fase.ctx.rol}
          onRolChange={(rol) =>
            setFase((prev) =>
              prev.kind === "error-analisis"
                ? { ...prev, ctx: { ...prev.ctx, rol } }
                : prev,
            )
          }
          onVolver={() => setFase({ kind: "input", caso: fase.caso })}
          onAnalizar={() => void submitAnalisis(fase.ctx, fase.caso)}
          loading={false}
        />
        <Card className="p-6 border-destructive">
          <p className="text-destructive font-medium mb-1">
            {tituloError(fase.tipo)}
          </p>
          <p className="text-sm text-muted-foreground mb-4">{fase.message}</p>
          {puedeReintentar(fase.tipo) ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void submitAnalisis(fase.ctx, fase.caso)}
            >
              Reintentar
            </Button>
          ) : null}
        </Card>
      </div>
    );
  }

  // input | loading-pre | error-pre
  return (
    <div className="space-y-6">
      <CasoInput
        caso={fase.caso}
        onCasoChange={(c) => setFase({ kind: "input", caso: c })}
        onSubmit={submitCaso}
        loading={fase.kind === "loading-pre"}
      />
      {fase.kind === "error-pre" ? (
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
