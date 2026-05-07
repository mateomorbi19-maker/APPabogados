"use client";
// Sheet lateral para consultar al agente sobre un caso ya en marcha.
// Reusa AdjuntosUploader (con las correcciones A.1/A.2/A.3 del mismo
// PR). Tiene su propio endpoint POST /api/casos/[id]/consultar.
//
// Recovery post-502: si el server tarda más que el timeout del proxy
// de Easypanel, el cliente recibe 502 aunque el server haya alcanzado
// a crear el evento de respuesta. Polling al GET /eventos para
// recuperarla antes de mostrar error.

import { useEffect, useRef, useState } from "react";
import { Loader2, X as CloseIcon, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
import type { EventoCaso } from "@/lib/types";
import { AdjuntosUploader, type AdjuntoUI } from "./adjuntos-uploader";

type Props = {
  open: boolean;
  casoId: string;
  onClose: () => void;
  // Devuelve consulta + respuesta. El padre los inserta en el state
  // del timeline para que se vean inmediatamente sin refetch.
  onConsultaCompletada: (
    eventoConsulta: EventoCaso,
    eventoRespuesta: EventoCaso,
  ) => void;
};

const PREGUNTA_MIN = 30;
const PREGUNTA_MAX = 3000;

const RECUPERAR_TIMEOUT_MS = 60_000;
const RECUPERAR_INTERVALO_MS = 5_000;
const RECUPERAR_DELAY_INICIAL_MS = 2_000;

type RespBody =
  | {
      ok: true;
      evento_consulta: EventoCaso;
      evento_respuesta: EventoCaso;
      respuesta: unknown;
    }
  | {
      ok: false;
      error: string;
      evento_consulta_id?: string;
    };

// Si recibimos 502 pero el server alcanzó a crear el evento de
// respuesta, lo encontramos haciendo polling al endpoint GET de
// eventos del caso (filtrando tipo='agente' creado después del
// inicio del POST).
async function intentarRecuperarRespuesta(
  casoId: string,
  desdeIso: string,
  signal: AbortSignal,
): Promise<EventoCaso | null> {
  const inicio = Date.now();
  await new Promise((r) => setTimeout(r, RECUPERAR_DELAY_INICIAL_MS));
  if (signal.aborted) return null;

  while (Date.now() - inicio < RECUPERAR_TIMEOUT_MS) {
    if (signal.aborted) return null;
    try {
      const url = `/api/casos/${casoId}/eventos?tipo=agente&desde=${encodeURIComponent(desdeIso)}`;
      const res = await fetch(url, { signal });
      if (res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { eventos?: EventoCaso[] }
          | null;
        const evs = json?.eventos ?? [];
        const respuesta = evs.find(
          (e) => e.tipo === "agente" && e.categoria === "respuesta_agente",
        );
        if (respuesta) return respuesta;
      }
    } catch {
      // ignore — sigue intentando hasta el timeout total.
    }
    if (signal.aborted) return null;
    await new Promise((r) => setTimeout(r, RECUPERAR_INTERVALO_MS));
  }
  return null;
}

export function ConsultarAgenteSheet({
  open,
  casoId,
  onClose,
  onConsultaCompletada,
}: Props) {
  const [pregunta, setPregunta] = useState("");
  const [adjuntos, setAdjuntos] = useState<AdjuntoUI[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const preguntaTrim = pregunta.trim();
  const preguntaOk =
    preguntaTrim.length >= PREGUNTA_MIN &&
    preguntaTrim.length <= PREGUNTA_MAX;
  const adjuntosListos = adjuntos.every((a) => a.status === "done");
  const formOk = preguntaOk && adjuntosListos;

  const reset = () => {
    setPregunta("");
    setAdjuntos([]);
    setError(null);
  };

  const handleClose = () => {
    if (loading) return;
    onClose();
    setTimeout(reset, 200);
  };

  const handleEnviar = async () => {
    if (loading || !formOk) return;
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;
    // Restamos 5s para tolerar drift de reloj cliente↔server al filtrar
    // los eventos del polling de recovery.
    const desdeIso = new Date(Date.now() - 5_000).toISOString();

    const adjuntosBody = adjuntos
      .filter((a) => a.status === "done")
      .map((a) => ({
        filename: a.filename,
        storage_path: a.storage_path,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        descripcion: a.descripcion,
      }));

    try {
      const res = await fetch(`/api/casos/${casoId}/consultar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pregunta: preguntaTrim, adjuntos: adjuntosBody }),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => null)) as RespBody | null;

      if (controller.signal.aborted) return;

      if (res.status === 502) {
        // Recovery post-502: el server puede haber terminado OK pero
        // el proxy cortó. Polling al GET de eventos para ver si llegó.
        const recuperado = await intentarRecuperarRespuesta(
          casoId,
          desdeIso,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (recuperado) {
          // No tenemos el evento de consulta exacto (lo creó el server
          // antes del timeout). Lo buscamos también via polling.
          const url = `/api/casos/${casoId}/eventos?desde=${encodeURIComponent(desdeIso)}`;
          const r2 = await fetch(url, { signal: controller.signal });
          const j2 = (await r2.json().catch(() => null)) as
            | { eventos?: EventoCaso[] }
            | null;
          const consulta = j2?.eventos?.find(
            (e) => e.tipo === "manual" && e.categoria === "consulta_agente",
          );
          if (consulta) {
            onConsultaCompletada(consulta, recuperado);
            setLoading(false);
            reset();
            return;
          }
        }
        const msg =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : "El análisis falló. Probá de nuevo en unos minutos.";
        setError(msg);
        setLoading(false);
        return;
      }

      if (!res.ok || !json || ("ok" in json && json.ok === false)) {
        const msg =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : `Error consultando al agente (HTTP ${res.status})`;
        setError(msg);
        setLoading(false);
        return;
      }

      if (!("evento_consulta" in json) || !("evento_respuesta" in json)) {
        setError("Respuesta inesperada del servidor");
        setLoading(false);
        return;
      }

      onConsultaCompletada(json.evento_consulta, json.evento_respuesta);
      setLoading(false);
      reset();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("Consulta cancelada.");
        setLoading(false);
        return;
      }
      setError(e instanceof Error ? e.message : "Error de red");
      setLoading(false);
    } finally {
      abortRef.current = null;
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && handleClose()}>
      <div className="flex flex-col h-full">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card/95 backdrop-blur px-5 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h2 className="font-medium">Consultar al agente</h2>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleClose}
            disabled={loading}
            aria-label="Cerrar"
          >
            <CloseIcon className="size-4" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <p className="text-xs text-muted-foreground rounded-md border border-border bg-muted/20 px-3 py-2">
            El agente va a analizar tu pregunta con todo el contexto del caso:
            análisis original, estrategia elegida, eventos previos y los
            archivos que subas ahora.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="consulta-pregunta">
              Tu pregunta o situación a consultar
            </Label>
            <Textarea
              id="consulta-pregunta"
              value={pregunta}
              onChange={(e) => setPregunta(e.target.value)}
              disabled={loading}
              rows={6}
              maxLength={PREGUNTA_MAX}
              placeholder="Ej: La fiscalía pidió elevación a juicio. Quiero saber si todavía conviene insistir con la nulidad o si conviene preparar la defensa de fondo. Adjunté el dictamen fiscal."
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              {preguntaTrim.length} / {PREGUNTA_MAX} caracteres ·
              mínimo {PREGUNTA_MIN}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Adjuntos (opcional)</Label>
            <AdjuntosUploader
              casoId={casoId}
              value={adjuntos}
              onChange={setAdjuntos}
              disabled={loading}
            />
          </div>

          {!adjuntosListos ? (
            <p className="text-xs text-amber-500">
              Esperá a que los archivos terminen de subir (o quitá los que fallaron) para enviar la consulta.
            </p>
          ) : null}

          {loading ? (
            <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-primary flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              El agente está analizando tu caso. Esto puede tardar entre 30 y 90 segundos.
            </div>
          ) : null}

          {error ? (
            <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card/95 backdrop-blur px-5 py-3">
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleEnviar} disabled={loading || !formOk}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {loading ? "Enviando..." : "Enviar consulta"}
          </Button>
        </footer>
      </div>
    </Sheet>
  );
}
