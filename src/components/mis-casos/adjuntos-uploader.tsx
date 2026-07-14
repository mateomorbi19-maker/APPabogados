"use client";
// Sub-componente reusable para cargar archivos adjuntos a un evento o
// a una consulta del agente. Maneja el flujo completo:
//
//   1. File picker.
//   2. Validación local (mime + tamaño).
//   3. POST /api/casos/{caso_id}/eventos/upload-url para obtener signed URL.
//   4. PUT directo al storage de Supabase (no pasa por nuestro server).
//   5. Marca el item como "done" y expone su storage_path al padre.
//
// Patrón controlled: el padre tiene `value: AdjuntoUI[]` y `onChange`.
// El padre filtra por `.status === 'done'` para enviarlos en el body
// del POST de evento. Items fallidos se pueden reintentar o remover.
//
// El campo de descripción aparece desde el primer momento (no solo
// cuando termina el upload) — fix QA del director para que el abogado
// sepa que va a poder describir cada archivo.
//
// El botón "Quitar":
//   - status=uploading: aborta el upload en curso (AbortController).
//   - status=done: borra el objeto del bucket vía DELETE /adjuntos.
//   - status=error: solo lo saca del state local.

import { useEffect, useRef } from "react";
import {
  Loader2,
  Paperclip,
  X,
  AlertCircle,
  AudioLines,
  FileText,
  Image as ImageIcon,
  FileType,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  esAudio,
  esImagen,
  esMimePermitido,
  fmtBytes,
  MIME_LABEL,
  MIME_TYPES_PERMITIDOS,
  resolverMime,
  validarAdjunto,
  type MimeTypePermitido,
} from "@/lib/casos/adjuntos";
import { GrabadorAudio } from "@/components/mis-casos/chat/grabador-audio";

const DESCRIPCION_MAX = 200;

// Items en distintos estados durante el flujo. `done` es el estado que
// el padre va a enviar al backend al guardar el evento.
export type AdjuntoUI =
  | {
      tempId: string;
      status: "uploading";
      filename: string;
      mime_type: MimeTypePermitido;
      size_bytes: number;
      descripcion: string;
    }
  | {
      tempId: string;
      status: "done";
      filename: string;
      mime_type: MimeTypePermitido;
      size_bytes: number;
      storage_path: string;
      descripcion: string;
    }
  | {
      tempId: string;
      status: "error";
      filename: string;
      mime_type: string;
      size_bytes: number;
      descripcion: string;
      errorMsg: string;
    };

type Props = {
  casoId: string;
  value: AdjuntoUI[];
  onChange: (items: AdjuntoUI[]) => void;
  disabled?: boolean;
  // Habilita audio: suma los mimes de audio al picker y muestra el botón
  // de grabar nota de voz. Solo el chat lo usa (los audios se transcriben
  // con Whisper server-side); en eventos del timeline queda apagado.
  conAudio?: boolean;
  // Notifica al padre cuando hay una grabación de audio en curso (para
  // bloquear el envío del mensaje mientras tanto).
  onGrabandoChange?: (grabando: boolean) => void;
};

// accept combina mimes + extensiones: en Windows el browser reporta
// file.type = "" para .heic (la validación real usa resolverMime), y
// las extensiones hacen que el picker los muestre igual.
const EXT_DOCS = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.docx";
const EXT_AUDIO = ".webm,.mp3,.m4a,.wav,.ogg,.opus";
const MIMES_SIN_AUDIO = MIME_TYPES_PERMITIDOS.filter(
  (m) => !esAudio(m),
).join(",");
const ACCEPT_SIN_AUDIO = `${MIMES_SIN_AUDIO},${EXT_DOCS}`;
const ACCEPT_CON_AUDIO = `${MIME_TYPES_PERMITIDOS.join(",")},${EXT_DOCS},${EXT_AUDIO}`;

export function AdjuntosUploader({
  casoId,
  value,
  onChange,
  disabled = false,
  conAudio = false,
  onGrabandoChange,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // AbortControllers por tempId para poder cancelar el upload en curso
  // cuando el usuario clickea "Quitar". Se borra la entry cuando el
  // upload termina (ok o error) o cuando se aborta.
  const abortersRef = useRef<Map<string, AbortController>>(new Map());
  // Ref siempre apuntando al `value` más reciente. Lo necesitamos porque
  // `subirArchivo` se llama desde un event handler y sus closures
  // capturan el `value` viejo: si el usuario tipea la descripción
  // mientras el upload está en curso, esa edición vive en `value` (el
  // padre la propaga al state) pero `subirArchivo` no la ve. Sin esto,
  // al pasar a "done" se reseteaba la descripción a "" — el director
  // observó esto cuando subía PDFs chicos que terminaban en <1s.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const reemplazar = (tempId: string, next: AdjuntoUI | null) => {
    // Leemos del valueRef en vez del `value` capturado para que dos
    // uploads concurrentes no se pisen entre sí al terminar.
    const actual = valueRef.current;
    onChange(
      next === null
        ? actual.filter((i) => i.tempId !== tempId)
        : actual.map((i) => (i.tempId === tempId ? next : i)),
    );
  };

  const subirArchivo = async (file: File) => {
    // randomUUID en vez de Date.now()+Math.random(): mismo propósito
    // (id local único) sin violar react-hooks/purity.
    const tempId = crypto.randomUUID();

    // Mime efectivo: si el browser no reporta type (típico de .heic en
    // Windows) o reporta uno raro, resolvemos por extensión.
    const mimeEfectivo = resolverMime(file.name, file.type);

    const v = validarAdjunto({
      filename: file.name,
      mime_type: mimeEfectivo,
      size_bytes: file.size,
    });
    if (!v.ok) {
      onChange([
        ...valueRef.current,
        {
          tempId,
          status: "error",
          filename: file.name,
          mime_type: mimeEfectivo,
          size_bytes: file.size,
          descripcion: "",
          errorMsg: v.error,
        },
      ]);
      return;
    }

    // Insertamos en estado uploading antes de empezar el fetch.
    const mimeTyped = mimeEfectivo as MimeTypePermitido;
    const itemUploading: AdjuntoUI = {
      tempId,
      status: "uploading",
      filename: file.name,
      mime_type: mimeTyped,
      size_bytes: file.size,
      descripcion: "",
    };
    onChange([...valueRef.current, itemUploading]);

    const controller = new AbortController();
    abortersRef.current.set(tempId, controller);

    try {
      const resUrl = await fetch(
        `/api/casos/${casoId}/eventos/upload-url`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            mime_type: mimeTyped,
            size_bytes: file.size,
          }),
          signal: controller.signal,
        },
      );
      const jsonUrl = (await resUrl.json().catch(() => null)) as
        | { ok: true; signed_url: string; storage_path: string }
        | { ok: false; error: string }
        | null;
      if (!resUrl.ok || !jsonUrl || ("ok" in jsonUrl && jsonUrl.ok === false)) {
        const msg =
          jsonUrl && "error" in jsonUrl && typeof jsonUrl.error === "string"
            ? jsonUrl.error
            : `Error pidiendo URL (HTTP ${resUrl.status})`;
        reemplazar(tempId, {
          tempId,
          status: "error",
          filename: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          descripcion: "",
          errorMsg: msg,
        });
        return;
      }

      // PUT directo al storage. Header content-type = mime efectivo (el
      // bucket valida contra su allowlist de mimes).
      const resPut = await fetch(jsonUrl.signed_url, {
        method: "PUT",
        headers: { "content-type": mimeTyped },
        body: file,
        signal: controller.signal,
      });
      if (!resPut.ok) {
        reemplazar(tempId, {
          tempId,
          status: "error",
          filename: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          descripcion: "",
          errorMsg: `Error subiendo archivo (HTTP ${resPut.status})`,
        });
        return;
      }

      // Preservamos la descripción que el usuario haya tipeado mientras
      // subía. Leemos del valueRef (el state actual) en vez del `value`
      // capturado por closure — ese último puede ser obsoleto si el
      // usuario editó descripción durante el upload.
      const actual = valueRef.current.find((v) => v.tempId === tempId);
      reemplazar(tempId, {
        tempId,
        status: "done",
        filename: file.name,
        mime_type: mimeTyped,
        size_bytes: file.size,
        storage_path: jsonUrl.storage_path,
        descripcion: actual?.descripcion ?? "",
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // El usuario abortó: ya se removió del state en `quitar`. Nada
        // que hacer acá.
        return;
      }
      reemplazar(tempId, {
        tempId,
        status: "error",
        filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        descripcion: "",
        errorMsg: e instanceof Error ? e.message : "Error de red",
      });
    } finally {
      abortersRef.current.delete(tempId);
    }
  };

  const quitar = async (item: AdjuntoUI) => {
    if (item.status === "uploading") {
      // Cancelamos el fetch pendiente. El catch en subirArchivo detecta
      // AbortError y no actualiza el state — sí lo actualizamos acá.
      const ctrl = abortersRef.current.get(item.tempId);
      ctrl?.abort();
      abortersRef.current.delete(item.tempId);
      reemplazar(item.tempId, null);
      return;
    }

    if (item.status === "done") {
      // Sacamos del state inmediatamente para feedback rápido. El
      // DELETE al storage corre en background; si falla, el archivo
      // queda huérfano (acepta — datos de prueba en beta).
      reemplazar(item.tempId, null);
      void fetch(`/api/casos/${casoId}/adjuntos`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storage_path: item.storage_path }),
      }).catch((e) => {
        console.warn(
          "[adjuntos-uploader] no se pudo borrar el adjunto del storage:",
          e,
        );
      });
      return;
    }

    // status === "error": solo limpiar del state local.
    reemplazar(item.tempId, null);
  };

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // Subimos en paralelo. Cada uno actualiza el state independiente.
    Array.from(files).forEach((f) => void subirArchivo(f));
    // Reset del input para permitir re-seleccionar el mismo archivo si
    // por alguna razón hace falta.
    e.target.value = "";
  };

  const setDescripcion = (tempId: string, descripcion: string) => {
    onChange(
      valueRef.current.map((i) =>
        i.tempId === tempId ? { ...i, descripcion } : i,
      ),
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
        >
          <Paperclip className="size-3.5" />
          Agregar archivo
        </Button>
        {conAudio ? (
          <GrabadorAudio
            disabled={disabled}
            onAudioListo={(f) => void subirArchivo(f)}
            onGrabandoChange={onGrabandoChange}
          />
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept={conAudio ? ACCEPT_CON_AUDIO : ACCEPT_SIN_AUDIO}
          multiple
          onChange={handleFileChange}
          disabled={disabled}
          className="hidden"
        />
        <span className="text-xs text-muted-foreground">
          PDF (≤10 MB) · imágenes/DOCX (≤5 MB)
          {conAudio ? " · audio (≤10 MB)" : ""}
        </span>
      </div>

      {value.length === 0 ? null : (
        <ul className="space-y-2">
          {value.map((item) => (
            <AdjuntoCard
              key={item.tempId}
              item={item}
              disabled={disabled}
              onQuitar={() => void quitar(item)}
              onDescripcionChange={(d) => setDescripcion(item.tempId, d)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function iconoMime(mime: string) {
  if (mime === "application/pdf") return <FileText className="size-4" />;
  if (esImagen(mime))
    return <ImageIcon className="size-4" aria-label="imagen" />;
  if (esAudio(mime))
    return <AudioLines className="size-4" aria-label="audio" />;
  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return <FileType className="size-4" />;
  return <FileText className="size-4" />;
}

function AdjuntoCard({
  item,
  disabled,
  onQuitar,
  onDescripcionChange,
}: {
  item: AdjuntoUI;
  disabled: boolean;
  onQuitar: () => void;
  onDescripcionChange: (d: string) => void;
}) {
  const mimeLabel = esMimePermitido(item.mime_type)
    ? MIME_LABEL[item.mime_type]
    : "?";

  // El campo de descripción es opcional pero recomendado (ayuda al
  // agente a entender de qué se trata cada adjunto). Lo mostramos
  // siempre que el item no esté en error — incluso mientras sube.
  const mostrarDescripcion = item.status !== "error";
  const descripcionDisabled = disabled || item.status === "uploading";

  return (
    <li className="rounded-md border border-border bg-card/30 px-3 py-2 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-muted-foreground shrink-0">
            {item.status === "uploading" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : item.status === "error" ? (
              <AlertCircle className="size-4 text-destructive" />
            ) : (
              iconoMime(item.mime_type)
            )}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">{item.filename}</p>
            <p className="text-[11px] text-muted-foreground">
              {mimeLabel} · {fmtBytes(item.size_bytes)}
              {item.status === "uploading" ? " · subiendo…" : ""}
              {item.status === "done" ? " · listo" : ""}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
          onClick={onQuitar}
          disabled={disabled}
          aria-label="Quitar"
          title="Quitar"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {item.status === "error" ? (
        <p className="text-xs text-destructive">{item.errorMsg}</p>
      ) : null}

      {mostrarDescripcion ? (
        <div className="space-y-1">
          <Input
            type="text"
            placeholder="Descripción (opcional pero recomendada). Ej: Resolución del juez rechazando la nulidad"
            value={item.descripcion}
            onChange={(e) => onDescripcionChange(e.target.value)}
            disabled={descripcionDisabled}
            maxLength={DESCRIPCION_MAX}
            className="h-8 text-xs"
          />
          {item.descripcion.length > 0 ? (
            <p className="text-[10px] text-muted-foreground text-right">
              {item.descripcion.length} / {DESCRIPCION_MAX}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
