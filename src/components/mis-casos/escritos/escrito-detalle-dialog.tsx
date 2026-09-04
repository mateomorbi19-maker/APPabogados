"use client";
// El escrito redactado: leerlo, corregirlo, bajar el PDF y marcarlo como
// presentado.
//
// El texto se edita en un textarea plano, sin editor enriquecido. Es
// deliberado: el formato del escrito es el markdown liviano que entiende el
// render (títulos con #, párrafos, negritas con **), y un abogado que corrige
// una fecha o cierra un [COMPLETAR] no necesita más que eso. Un editor WYSIWYG
// sería una dependencia nueva para resolver un problema que no hay.
//
// Las marcas [COMPLETAR: ...] son el contrato con el redactor: donde faltó un
// dato, dejó un hueco visible. Acá se cuentan y se listan, y "Marcar como
// presentado" está bloqueado hasta que no quede ninguna — el server lo
// rechaza igual (409), esto es para no ofrecer algo que va a fallar.

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Download,
  ExternalLink,
  Save,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtFecha } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { EventoCaso } from "@/lib/types";
import {
  ESTADO_ESCRITO_LABEL,
  MARCA_COMPLETAR_RE,
  type EscritoGenerado,
} from "@/lib/escritos/types";

type Props = {
  casoId: string;
  /** `null` = cerrado. */
  escritoId: string | null;
  onClose: () => void;
  onActualizado: (e: EscritoGenerado) => void;
  /** El evento del timeline que registró la presentación viene en la respuesta. */
  onPresentado: (e: EscritoGenerado, evento: EventoCaso) => void;
};

export function EscritoDetalleDialog({
  casoId,
  escritoId,
  onClose,
  onActualizado,
  onPresentado,
}: Props) {
  const open = escritoId !== null;
  const [escrito, setEscrito] = useState<EscritoGenerado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const [contenido, setContenido] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [presentando, setPresentando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El reset al cambiar de escrito se hace DURANTE EL RENDER (patrón de
  // "ajustar estado cuando cambia una prop", ver ficha-form.tsx): así el
  // diálogo no pinta un frame con el escrito anterior, y el efecto de abajo
  // queda sólo con la carga de red — que es lo único que un efecto debe hacer.
  const [idVisto, setIdVisto] = useState<string | null>(null);
  if (escritoId !== idVisto) {
    setIdVisto(escritoId);
    setEscrito(null);
    setErrorCarga(null);
    setError(null);
    setCargando(escritoId !== null);
  }

  useEffect(() => {
    if (!escritoId) return;
    let vivo = true;
    fetch(`/api/casos/${casoId}/escritos/${escritoId}`)
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        if (!j?.ok) {
          setErrorCarga(j?.error ?? "No pude abrir el escrito");
          return;
        }
        const e = j.escrito as EscritoGenerado;
        setEscrito(e);
        setTitulo(e.titulo);
        setContenido(e.contenido);
        setError(null);
      })
      .catch(() => {
        if (vivo) setErrorCarga("No pude abrir el escrito. Revisá la conexión.");
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [casoId, escritoId]);

  const pendientes = useMemo(
    () => contenido.match(MARCA_COMPLETAR_RE) ?? [],
    [contenido],
  );
  const dirty =
    escrito !== null &&
    (titulo !== escrito.titulo || contenido !== escrito.contenido);
  const ocupado = guardando || presentando;
  const presentado = escrito?.estado === "presentado";

  const handleClose = () => {
    if (ocupado) return;
    if (dirty && !window.confirm("Hay cambios sin guardar. ¿Cerrar igual?")) {
      return;
    }
    onClose();
  };

  const guardar = async (): Promise<EscritoGenerado | null> => {
    if (!escrito || !dirty) return escrito;
    setGuardando(true);
    setError(null);
    try {
      const body: Record<string, string> = {};
      if (titulo.trim() !== escrito.titulo) body.titulo = titulo.trim();
      if (contenido !== escrito.contenido) body.contenido = contenido;
      const res = await fetch(`/api/casos/${casoId}/escritos/${escrito.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; escrito: EscritoGenerado }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !json || json.ok !== true) {
        setError(json && json.ok === false ? json.error : "No se pudo guardar");
        return null;
      }
      setEscrito(json.escrito);
      onActualizado(json.escrito);
      toast.success("Escrito guardado");
      return json.escrito;
    } catch {
      setError("No se pudo guardar. Revisá la conexión.");
      return null;
    } finally {
      setGuardando(false);
    }
  };

  const presentar = async () => {
    if (!escrito || ocupado || pendientes.length > 0) return;
    if (
      !window.confirm(
        "¿Marcar este escrito como presentado? Se guarda el PDF definitivo en el timeline de la causa y el texto deja de ser un borrador.",
      )
    ) {
      return;
    }
    // Primero los cambios pendientes: el PDF que se archiva es el texto final.
    const guardado = dirty ? await guardar() : escrito;
    if (!guardado) return;
    setPresentando(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/casos/${casoId}/escritos/${guardado.id}/presentar`,
        { method: "POST" },
      );
      const json = (await res.json().catch(() => null)) as
        | { ok: true; escrito: EscritoGenerado; evento: EventoCaso }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !json || json.ok !== true) {
        setError(
          json && json.ok === false ? json.error : "No pude registrar la presentación",
        );
        return;
      }
      setEscrito(json.escrito);
      onPresentado(json.escrito, json.evento);
      toast.success("Escrito marcado como presentado");
    } catch {
      setError("No pude registrar la presentación. Revisá la conexión.");
    } finally {
      setPresentando(false);
    }
  };

  const urlPdf = escrito
    ? `/api/casos/${casoId}/escritos/${escrito.id}/pdf`
    : "#";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose();
      }}
    >
      <DialogContent
        className="flex h-[calc(100dvh-2rem)] flex-col sm:max-w-4xl sm:max-h-[calc(100dvh-2rem)]"
        showCloseButton={!ocupado}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>Escrito</span>
            {escrito ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  presentado
                    ? "bg-[rgba(16,185,129,0.22)] text-emerald-800 dark:text-[#A7F3D0]"
                    : "bg-[rgba(245,158,11,0.22)] text-amber-800 dark:text-[#FFE0A3]",
                )}
              >
                {ESTADO_ESCRITO_LABEL[escrito.estado]}
              </span>
            ) : null}
          </DialogTitle>
          {escrito ? (
            <p className="text-xs text-muted-foreground">
              Modelo: {escrito.modelo_titulo} · redactado {fmtFecha(escrito.creado_en)}
              {escrito.presentado_en
                ? ` · presentado ${fmtFecha(escrito.presentado_en)}`
                : ""}
            </p>
          ) : null}
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4">
          {cargando ? (
            <div className="flex flex-1 items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Abriendo el escrito…
            </div>
          ) : errorCarga ? (
            <p className="py-10 text-center text-sm text-destructive">{errorCarga}</p>
          ) : escrito ? (
            <>
              <Input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                disabled={ocupado || presentado}
                maxLength={300}
                aria-label="Título del escrito"
                className="font-medium"
              />

              {pendientes.length > 0 ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  <p className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="size-3.5" />
                    {pendientes.length} dato{pendientes.length === 1 ? "" : "s"} por
                    completar antes de presentar
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {Array.from(new Set(pendientes)).map((m) => (
                      <li
                        key={m}
                        className="rounded border border-amber-500/30 bg-background/40 px-1.5 py-0.5 font-mono"
                      >
                        {m}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : !presentado ? (
                <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" /> Sin datos pendientes. Revisá el
                  texto y, cuando esté, marcalo como presentado.
                </p>
              ) : null}

              <Textarea
                value={contenido}
                onChange={(e) => setContenido(e.target.value)}
                disabled={ocupado || presentado}
                spellCheck
                aria-label="Texto del escrito"
                className="min-h-0 flex-1 resize-none font-serif text-[15px] leading-relaxed"
              />
              <p className="text-[11px] text-muted-foreground">
                Formato: la primera línea con <code>#</code> es la suma; las secciones
                con <code>##</code>; negritas con <code>**</code>. El PDF respeta esa
                estructura. Lo que sigue a «SERÁ JUSTICIA.» va como firma.
              </p>
            </>
          ) : null}

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!escrito || ocupado}
              nativeButton={false}
              render={<a href={urlPdf} target="_blank" rel="noreferrer" />}
            >
              <ExternalLink className="size-3.5" />
              Ver PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!escrito || ocupado}
              nativeButton={false}
              render={<a href={`${urlPdf}?descargar=1`} />}
            >
              <Download className="size-3.5" />
              Descargar PDF
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {!presentado ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void guardar()}
                  disabled={!dirty || ocupado}
                >
                  {guardando ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Save className="size-3.5" />
                  )}
                  Guardar
                </Button>
                <Button
                  size="sm"
                  onClick={presentar}
                  disabled={!escrito || ocupado || pendientes.length > 0}
                  title={
                    pendientes.length > 0
                      ? "Completá las marcas [COMPLETAR] antes de presentar"
                      : undefined
                  }
                >
                  {presentando ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                  Marcar como presentado
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={handleClose}>
                Cerrar
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
