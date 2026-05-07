"use client";
// Render de los adjuntos persistidos de un evento del timeline. Muestra
// mini-cards con icono + nombre + descripción + botón "Descargar".
// Click en descargar → fetch a /adjuntos/download-url?path=... → URL
// firmada → forzar descarga.

import { useState } from "react";
import { Download, FileText, Image, FileType, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  esMimePermitido,
  fmtBytes,
  MIME_LABEL,
  type Adjunto,
} from "@/lib/casos/adjuntos";

type Props = {
  casoId: string;
  adjuntos: Adjunto[];
};

export function AdjuntosRender({ casoId, adjuntos }: Props) {
  if (adjuntos.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {adjuntos.map((a, i) => (
        <AdjuntoItem key={i} casoId={casoId} adjunto={a} />
      ))}
    </ul>
  );
}

function iconoMime(mime: string) {
  if (mime === "application/pdf") return <FileText className="size-3.5" />;
  if (mime === "image/jpeg" || mime === "image/png")
    return <Image className="size-3.5" aria-label="imagen" />;
  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return <FileType className="size-3.5" />;
  return <FileText className="size-3.5" />;
}

function AdjuntoItem({
  casoId,
  adjunto,
}: {
  casoId: string;
  adjunto: Adjunto;
}) {
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mimeLabel = esMimePermitido(adjunto.mime_type)
    ? MIME_LABEL[adjunto.mime_type]
    : "archivo";

  const descargar = async () => {
    if (descargando) return;
    setDescargando(true);
    setError(null);
    try {
      const url = `/api/casos/${casoId}/adjuntos/download-url?path=${encodeURIComponent(adjunto.storage_path)}`;
      const res = await fetch(url);
      const json = (await res.json().catch(() => null)) as
        | { ok: true; signed_url: string }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !json || ("ok" in json && json.ok === false)) {
        const msg =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : `Error generando descarga (HTTP ${res.status})`;
        setError(msg);
        return;
      }
      // `<a download>` programático: forza la descarga con el nombre
      // original del archivo en vez de abrirlo en una pestaña.
      const link = document.createElement("a");
      link.href = json.signed_url;
      link.download = adjunto.filename;
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setDescargando(false);
    }
  };

  return (
    <li className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground mt-0.5 shrink-0">
          {iconoMime(adjunto.mime_type)}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{adjunto.filename}</p>
          <p className="text-[10px] text-muted-foreground">
            {mimeLabel} · {fmtBytes(adjunto.size_bytes)}
          </p>
          {adjunto.descripcion ? (
            <p className="text-xs text-muted-foreground mt-1 italic">
              {adjunto.descripcion}
            </p>
          ) : null}
          {error ? (
            <p className="text-[11px] text-destructive mt-1">{error}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 shrink-0"
          onClick={descargar}
          disabled={descargando}
          aria-label="Descargar"
        >
          {descargando ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
        </Button>
      </div>
    </li>
  );
}
