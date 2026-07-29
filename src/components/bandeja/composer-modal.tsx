"use client";
// Compositor. Modal único para mensaje nuevo, respuesta y reenvío: lo que
// cambia entre los tres es el borrador con el que se abre, que arma
// borrador.ts.
//
// El formulario vive en un componente aparte que sólo se monta cuando hay
// borrador: así el estado inicial sale de las props en el primer render y no
// hace falta un efecto que sincronice (regla react-hooks/set-state-in-effect).
//
// "Enviar" NO pide confirmación (es la acción explícita del botón). La que sí
// confirma es "Mover a papelera", en confirmar-papelera.tsx.

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChipsEmails } from "./chips-emails";
import { errorDe, pedirJson } from "./api";
import type { Borrador } from "./borrador";

const MAX_CUERPO = 100_000;
const MAX_ASUNTO = 300;

type Props = {
  /** null = cerrado. Cada apertura pasa un objeto nuevo. */
  borrador: Borrador | null;
  puedeEnviar: boolean;
  onClose: () => void;
  onEnviado: () => void;
};

function ComposerForm({
  borrador,
  puedeEnviar,
  onClose,
  onEnviado,
}: Props & { borrador: Borrador }) {
  const [para, setPara] = useState<string[]>(borrador.para);
  const [cc, setCc] = useState<string[]>(borrador.cc);
  const [ccAbierto, setCcAbierto] = useState(borrador.cc.length > 0);
  const [asunto, setAsunto] = useState(borrador.asunto);
  const [cuerpo, setCuerpo] = useState(borrador.cuerpo);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cuerpoRef = useRef<HTMLTextAreaElement | null>(null);

  // El borrador de respuesta arranca con la cita al pie; el cursor tiene que
  // quedar arriba de todo, no después del texto citado.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const el = cuerpoRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(0, 0);
      el.scrollTop = 0;
    }, 60);
    return () => window.clearTimeout(t);
  }, []);

  const cerrar = () => {
    if (enviando) return;
    onClose();
  };

  const enviar = () => {
    if (enviando) return;
    if (para.length === 0) {
      setError("Falta al menos un destinatario.");
      return;
    }
    setEnviando(true);
    setError(null);
    void (async () => {
      try {
        const { res, json } = await pedirJson("/api/bandeja/mensajes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            para,
            ...(cc.length > 0 ? { cc } : {}),
            asunto,
            cuerpo,
            ...(borrador.responde_a_thread_id
              ? { responde_a_thread_id: borrador.responde_a_thread_id }
              : {}),
            ...(borrador.responde_a_message_id
              ? { responde_a_message_id: borrador.responde_a_message_id }
              : {}),
          }),
        });
        if (!res.ok) {
          setError(errorDe(json, res.status, "No se pudo enviar el mensaje"));
          setEnviando(false);
          return;
        }
        toast.success("Mensaje enviado");
        onEnviado();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error de red");
        setEnviando(false);
      }
    })();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{borrador.titulo}</DialogTitle>
        <DialogDescription>
          {puedeEnviar
            ? "El mensaje sale desde tu cuenta de Gmail."
            : "El envío está deshabilitado hasta que autorices el acceso a Gmail."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <ChipsEmails
          label="Para"
          valores={para}
          onChange={setPara}
          disabled={enviando || !puedeEnviar}
          placeholder="nombre@dominio.com"
        />

        {ccAbierto ? (
          <ChipsEmails
            label="CC"
            valores={cc}
            onChange={setCc}
            disabled={enviando || !puedeEnviar}
            placeholder="Con copia a…"
          />
        ) : (
          <button
            type="button"
            onClick={() => setCcAbierto(true)}
            className="text-xs text-[var(--el-violet-light)] underline underline-offset-2 transition-opacity hover:opacity-80"
          >
            Agregar CC
          </button>
        )}

        <div className="space-y-1">
          <label
            htmlFor="bandeja-asunto"
            className="text-xs font-medium text-[var(--el-text-soft)]"
          >
            Asunto
          </label>
          <Input
            id="bandeja-asunto"
            value={asunto}
            maxLength={MAX_ASUNTO}
            disabled={enviando || !puedeEnviar}
            onChange={(e) => setAsunto(e.target.value)}
            placeholder="Asunto del mensaje"
          />
        </div>

        <div className="space-y-1">
          <label
            htmlFor="bandeja-cuerpo"
            className="text-xs font-medium text-[var(--el-text-soft)]"
          >
            Mensaje
          </label>
          <Textarea
            id="bandeja-cuerpo"
            ref={cuerpoRef}
            value={cuerpo}
            disabled={enviando || !puedeEnviar}
            onChange={(e) => setCuerpo(e.target.value.slice(0, MAX_CUERPO))}
            placeholder="Escribí el mensaje…"
            className="max-h-[40vh] min-h-40 overflow-y-auto"
          />
          <p className="text-right text-[11px] tabular-nums text-[var(--el-text-muted)]">
            {cuerpo.length.toLocaleString("es-AR")} /{" "}
            {MAX_CUERPO.toLocaleString("es-AR")}
          </p>
        </div>

        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={cerrar} disabled={enviando}>
          Cancelar
        </Button>
        <Button
          onClick={enviar}
          disabled={enviando || !puedeEnviar || para.length === 0}
        >
          {enviando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          {enviando ? "Enviando…" : "Enviar"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function ComposerModal({
  borrador,
  puedeEnviar,
  onClose,
  onEnviado,
}: Props) {
  return (
    <Dialog
      open={borrador !== null}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        {borrador ? (
          <ComposerForm
            borrador={borrador}
            puedeEnviar={puedeEnviar}
            onClose={onClose}
            onEnviado={onEnviado}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
