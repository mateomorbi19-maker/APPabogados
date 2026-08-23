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
      {/* pr-8 en móvil: la X de cerrar del diálogo mide 40px abajo de 768px y
          se comía el renglón del título y la primera línea de la descripción. */}
      <DialogHeader className="shrink-0 max-md:pr-8">
        <DialogTitle>{borrador.titulo}</DialogTitle>
        <DialogDescription>
          {puedeEnviar
            ? "El mensaje sale desde tu cuenta de Gmail."
            : "El envío está deshabilitado hasta que autorices el acceso a Gmail."}
        </DialogDescription>
      </DialogHeader>

      {/* El que scrollea es este bloque, no el popup entero: así la botonera de
          abajo (Enviar) queda siempre a la vista. Con el teclado abierto en un
          iPhone 390x844 el alto visible baja a ~340px, y antes el footer
          quedaba abajo del teclado sin ninguna forma de llegar. El -mx-1/px-1
          es para que el anillo de foco (3px) no lo recorte el overflow. */}
      <div className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1">
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
            // En móvil el mínimo baja a 96px: con min-h-40 (160px) y el teclado
            // abierto el textarea solo se comía todo el alto útil y los campos
            // Para/Asunto quedaban fuera de alcance. dvh y no vh porque con el
            // teclado 100vh sigue midiendo la pantalla entera.
            className="max-h-[30dvh] min-h-24 overflow-y-auto sm:max-h-[40dvh] sm:min-h-40"
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

      <DialogFooter className="shrink-0">
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
      // Tocar afuera NO cierra el compositor: en el celular ese toque es el
      // gesto con el que uno baja el teclado, y cerrar ahí significaba perder
      // el borrador entero sin aviso. Se sale por Cancelar o por la X, que son
      // decisiones explícitas.
      disablePointerDismissal
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      {/* flex-col + el scroll adentro: el popup ya trae un max-h de pantalla
          (ui/dialog.tsx), pero scrolleaba entero, así que el footer con Enviar
          se iba abajo del teclado. Ahora el popup no scrollea y la botonera
          queda fija abajo. */}
      <DialogContent className="flex flex-col overflow-y-hidden sm:max-w-2xl">
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
