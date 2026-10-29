"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { ZodIssue } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { DictadoVoz } from "@/components/mis-casos/chat/dictado-voz";
import {
  fichaCargaSchema, guardarCargaSchema, MAX_PDF_BYTES, MAX_PDF_PAGINAS,
  MAX_TEXTO_CARGA, type FichaCarga,
} from "@/lib/casos/carga-schema";
import { RevisionCarga } from "./revision-carga";

type Props = { onClose: () => void; onGuardado: (id: string) => void };
type Ocupacion = "validando" | "preparando" | "guardando" | null;

function mensajeError(json: unknown, defecto: string): string {
  if (json && typeof json === "object" && "error" in json && typeof json.error === "string") {
    return json.error;
  }
  return defecto;
}

function errorRevision(issue: ZodIssue | undefined): string {
  if (!issue) return "Revisá los campos obligatorios.";
  if (issue.code !== "too_big") return issue.message;
  const campo = issue.path[1];
  if (campo === "delitos") return "Podés cargar hasta 20 delitos, de 200 caracteres cada uno.";
  if (campo === "partes") return "Revisá las personas: se admiten hasta 40, con nombres de hasta 300 caracteres y documentos de hasta 80.";
  return "Uno de los campos supera el límite de caracteres. Acortalo para guardar.";
}

export default function CargarCausaDialog({ onClose, onGuardado }: Props) {
  const [texto, setTexto] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [ficha, setFicha] = useState<FichaCarga | null>(null);
  const [advertencias, setAdvertencias] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupacion, setOcupacion] = useState<Ocupacion>(null);
  const [vozOcupada, setVozOcupada] = useState(false);
  // Estas refs bloquean reentradas antes del próximo render y respuestas tras desmontar.
  const ocupadoRef = useRef(false);
  const vozRef = useRef(false);
  const montadoRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef<string | null>(null);
  const inputArchivoRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const bloqueado = ocupacion !== null || vozOcupada;
  const cerrar = () => {
    if (!ocupadoRef.current && !vozRef.current) onClose();
  };
  const liberar = () => {
    ocupadoRef.current = false;
    abortRef.current = null;
    if (montadoRef.current) setOcupacion(null);
  };

  const elegirArchivo = async (nuevo: File | undefined) => {
    if (!nuevo || ocupadoRef.current || vozRef.current) return;
    ocupadoRef.current = true;
    setOcupacion("validando");
    setError(null);
    try {
      if (!nuevo.name.toLowerCase().endsWith(".pdf") || (nuevo.type && nuevo.type !== "application/pdf")) {
        throw new Error("Elegí un archivo PDF.");
      }
      if (nuevo.size === 0 || nuevo.size > MAX_PDF_BYTES) {
        throw new Error(`El PDF debe pesar hasta ${(MAX_PDF_BYTES / 1024 / 1024).toLocaleString("es-AR")} MiB y no estar vacío.`);
      }
      // Carga diferida: el lector de PDF sólo se descarga al elegir un archivo.
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.load(await nuevo.arrayBuffer());
      if (pdf.getPageCount() > MAX_PDF_PAGINAS) {
        throw new Error(`El PDF supera el máximo de ${MAX_PDF_PAGINAS.toLocaleString("es-AR")} páginas.`);
      }
      if (montadoRef.current) setArchivo(nuevo);
    } catch (e) {
      if (montadoRef.current) {
        const detalle = e instanceof Error && (e.message.startsWith("El PDF") || e.message === "Elegí un archivo PDF.")
          ? e.message
          : "No se pudo leer el PDF. Revisá que sea válido y no esté protegido con contraseña.";
        setError(detalle);
      }
    } finally {
      if (inputArchivoRef.current) inputArchivoRef.current.value = "";
      liberar();
    }
  };

  const preparar = async () => {
    if (ocupadoRef.current || vozRef.current || (!archivo && !texto.trim())) return;
    if (texto.length > MAX_TEXTO_CARGA) {
      setError(`El relato admite hasta ${MAX_TEXTO_CARGA.toLocaleString("es-AR")} caracteres. Acortalo antes de continuar.`);
      return;
    }
    ocupadoRef.current = true;
    setOcupacion("preparando");
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const datos = new FormData();
      if (texto.trim()) datos.append("texto", texto);
      if (archivo) datos.append("archivo", archivo);
      const res = await fetch("/api/casos/preparar-carga", {
        method: "POST", body: datos, signal: controller.signal,
      });
      const json: unknown = await res.json().catch(() => null);
      if (!montadoRef.current) return;
      if (!res.ok || !json || typeof json !== "object" || !("ok" in json) || json.ok !== true || !("ficha" in json)) {
        throw new Error(mensajeError(json, "No se pudo preparar la ficha. Podés reintentar con los mismos datos."));
      }
      const resultado = fichaCargaSchema.safeParse(json.ficha);
      if (!resultado.success) throw new Error("La ficha recibida no tiene el formato esperado. Tus fuentes se conservaron; podés reintentar.");
      setFicha(resultado.data);
      setAdvertencias("advertencias" in json && Array.isArray(json.advertencias)
        ? json.advertencias.filter((a): a is string => typeof a === "string") : []);
    } catch (e) {
      if (!controller.signal.aborted && montadoRef.current) setError(e instanceof Error ? e.message : "Revisá la conexión y volvé a intentar.");
    } finally {
      liberar();
    }
  };

  const guardar = async () => {
    if (!ficha || ocupadoRef.current || vozRef.current) return;
    // Un único ID por diálogo, incluso si el servidor guardó y se perdió la respuesta.
    idRef.current ??= crypto.randomUUID();
    const resultado = guardarCargaSchema.safeParse({
      id: idRef.current,
      ficha: { ...ficha, delitos: ficha.delitos.map((d) => d.trim()).filter(Boolean) },
    });
    if (!resultado.success) {
      setError(errorRevision(resultado.error.issues[0]));
      return;
    }
    ocupadoRef.current = true;
    setOcupacion("guardando");
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const datos = new FormData();
      datos.append("datos", JSON.stringify(resultado.data));
      if (archivo) datos.append("archivo", archivo);
      const res = await fetch("/api/casos/importar", {
        method: "POST", body: datos, signal: controller.signal,
      });
      const json: unknown = await res.json().catch(() => null);
      if (!montadoRef.current) return;
      if (!res.ok || !json || typeof json !== "object" || !("ok" in json) || json.ok !== true
        || !("caso_id" in json) || typeof json.caso_id !== "string" || json.caso_id !== idRef.current) {
        throw new Error(mensajeError(json, "No se pudo confirmar el guardado. Conservamos los datos: reintentá para comprobarlo sin duplicar la causa."));
      }
      toast.success("Causa cargada");
      onGuardado(json.caso_id);
    } catch (e) {
      if (!controller.signal.aborted && montadoRef.current) setError(e instanceof Error ? e.message : "Revisá la conexión y volvé a intentar. Tus datos se conservaron.");
    } finally {
      liberar();
    }
  };

  return (
    <Dialog open onOpenChange={(abierto) => { if (!abierto) cerrar(); }}>
      <DialogContent className="flex flex-col sm:max-w-3xl" showCloseButton={!bloqueado}>
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle>{ficha ? "Revisar nueva causa" : "Cargar nueva causa"}</DialogTitle>
          <DialogDescription>
            {ficha ? "Paso 2 de 2 · corregí la ficha y guardá la causa para empezar a trabajar."
              : "Paso 1 de 2 · adjuntá un PDF, contá los hechos o combiná ambas fuentes."}
          </DialogDescription>
        </DialogHeader>
        <form id="form-carga-causa" className="-mx-4 min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4"
          onSubmit={(e) => { e.preventDefault(); void (ficha ? guardar() : preparar()); }}>
          {ficha ? (
            <>
              {advertencias.length > 0 ? (
                <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-3" role="status">
                  <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" /> Puntos para revisar</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {advertencias.map((aviso, i) => <li key={i}>{aviso}</li>)}
                  </ul>
                </div>
              ) : null}
              {archivo ? <p className="flex items-center gap-2 break-all text-xs text-muted-foreground"><FileText className="size-4 shrink-0" /> Se adjuntará {archivo.name} al evento inicial.</p> : null}
              <RevisionCarga ficha={ficha} onChange={setFicha} disabled={bloqueado} />
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="carga-archivo">Documento PDF</Label>
                <Input ref={inputArchivoRef} id="carga-archivo" type="file" accept="application/pdf,.pdf"
                  disabled={bloqueado} onChange={(e) => void elegirArchivo(e.target.files?.[0])} />
                <p className="text-xs text-muted-foreground">Hasta {(MAX_PDF_BYTES / 1024 / 1024).toLocaleString("es-AR")} MiB y {MAX_PDF_PAGINAS.toLocaleString("es-AR")} páginas, sin contraseña.</p>
                {archivo ? (
                  <div className="flex min-w-0 items-center gap-2 rounded-md border border-border p-2">
                    <FileText className="size-4 shrink-0" /><span className="min-w-0 flex-1 break-all text-sm">{archivo.name}</span>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Quitar PDF" disabled={bloqueado} onClick={() => setArchivo(null)}><X className="size-4" /></Button>
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="carga-texto">Relato o información adicional</Label>
                  <DictadoVoz disabled={ocupacion !== null} onOcupadoChange={(valor) => {
                    vozRef.current = valor;
                    setVozOcupada(valor);
                  }} onTexto={(nuevo) => setTexto((anterior) => anterior.trim() ? `${anterior}\n\n${nuevo}` : nuevo)} />
                </div>
                <Textarea id="carga-texto" value={texto} onChange={(e) => setTexto(e.target.value)}
                  disabled={ocupacion !== null} className="min-h-44" maxLength={MAX_TEXTO_CARGA}
                  placeholder="Describí los hechos, las personas involucradas y los datos del expediente que conozcas." />
                <p className="text-xs text-muted-foreground">{texto.length.toLocaleString("es-AR")} / {MAX_TEXTO_CARGA.toLocaleString("es-AR")} caracteres. Revisá el dictado antes de preparar la ficha.</p>
              </div>
              <p className="text-xs text-muted-foreground">La preparación usa IA para ordenar los datos. La causa se crea cuando revisás y guardás la ficha.</p>
            </>
          )}
        </form>
        {ocupacion ? <p className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" />{ocupacion === "validando" ? "Revisando el PDF…" : ocupacion === "preparando" ? "Preparando la ficha. Puede tardar unos instantes…" : "Guardando la causa…"}</p> : null}
        {error ? <p role="alert" className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" disabled={bloqueado} onClick={cerrar}>Cancelar</Button>
          <Button type="submit" form="form-carga-causa" disabled={bloqueado || (!ficha && !archivo && !texto.trim())}>
            {ocupacion ? <Loader2 className="size-4 animate-spin" /> : null}
            {ficha ? "Guardar y abrir causa" : "Preparar ficha"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
