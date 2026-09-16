"use client";
// El reporte generado: leerlo entero, corregirlo, y recién ahí mandarlo.
//
// Tres formas de salir, y ninguna a un click de «Generar»:
//   - ENVIAR POR CORREO: se abre un panel con la DIRECCIÓN COMPLETA del
//     cliente y un botón de confirmación. El server vuelve a comparar esa
//     dirección con la cargada en la parte. Un mail mal tipeado manda la
//     estrategia de defensa a un tercero, y de eso no se vuelve.
//   - ENVIAR POR WHATSAPP: mismo panel, con el NÚMERO COMPLETO ya normalizado
//     a formato internacional. El botón abre wa.me con el texto cargado en el
//     chat de esa persona; el «enviar» lo toca el abogado adentro de WhatsApp,
//     y al volver confirma acá para que quede registrado. Son dos pasos
//     porque la app no puede saber si él realmente lo mandó: decir «enviado»
//     sin que haya salido es peor que no decir nada.
//   - COPIAR: el texto va al portapapeles y el abogado lo manda por donde
//     quiera. Es la salida cuando no hay teléfono cargado o cuando el número
//     no se puede interpretar.
//
// Las marcas [FALTA: …] y [REDACTAR: …] bloquean todo envío (y el server lo
// rechaza igual con 409). Un reporte enviado se muestra en solo lectura.

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  MessageCircle,
  Save,
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
import type { ParteCaso } from "@/lib/types";
import {
  CANAL_REPORTE_LABEL,
  ESTADO_REPORTE_LABEL,
  MARCA_REPORTE_RE,
  type ReporteCliente,
} from "@/lib/reporteria/types";
import { plantillaPorId } from "@/lib/reporteria/plantillas";
import {
  enlaceWhatsApp,
  normalizarTelefonoAr,
  textoDemasiadoLargoParaLink,
} from "@/lib/reporteria/telefono";

type Props = {
  casoId: string;
  partes: ParteCaso[];
  /** `null` = cerrado. */
  reporteId: string | null;
  onClose: () => void;
  onActualizado: (r: ReporteCliente) => void;
};

type RespuestaEnvio =
  | { ok: true; reporte: ReporteCliente; enviado_a: string }
  | { ok: false; error: string; pendientes?: string[] }
  | null;

export function ReporteDetalleDialog({ casoId, partes, reporteId, onClose, onActualizado }: Props) {
  const open = reporteId !== null;
  const [reporte, setReporte] = useState<ReporteCliente | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [asunto, setAsunto] = useState("");
  const [contenido, setContenido] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [panelCorreo, setPanelCorreo] = useState(false);
  const [panelWhatsapp, setPanelWhatsapp] = useState(false);
  // Se enciende recién cuando se abrió wa.me. Hasta entonces no se ofrece
  // registrar el envío: nada salió todavía.
  const [abrioWhatsapp, setAbrioWhatsapp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [idVisto, setIdVisto] = useState<string | null>(null);
  if (reporteId !== idVisto) {
    setIdVisto(reporteId);
    setReporte(null);
    setErrorCarga(null);
    setError(null);
    setPanelCorreo(false);
    setPanelWhatsapp(false);
    setAbrioWhatsapp(false);
    setCargando(reporteId !== null);
  }

  useEffect(() => {
    if (!reporteId) return;
    let vivo = true;
    fetch(`/api/casos/${casoId}/reportes/${reporteId}`)
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        if (!j?.ok) {
          setErrorCarga(j?.error ?? "No pude abrir el reporte");
          return;
        }
        const r = j.reporte as ReporteCliente;
        setReporte(r);
        setAsunto(r.asunto ?? "");
        setContenido(r.contenido);
      })
      .catch(() => {
        if (vivo) setErrorCarga("No pude abrir el reporte. Revisá la conexión.");
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [casoId, reporteId]);

  const pendientes = useMemo(
    () => Array.from(new Set(contenido.match(MARCA_REPORTE_RE) ?? [])),
    [contenido],
  );
  const plantilla = reporte ? plantillaPorId(reporte.plantilla) : null;
  const parte = reporte?.parte_id ? (partes.find((p) => p.id === reporte.parte_id) ?? null) : null;
  const email = parte?.email?.trim().toLowerCase() ?? null;
  // El mismo número que va a releer el servidor al registrar el envío. Si acá
  // no se puede interpretar, tampoco allá: el panel muestra el motivo en vez
  // del botón.
  const tel = useMemo(() => normalizarTelefonoAr(parte?.telefono), [parte?.telefono]);
  const enviado = reporte?.estado === "enviado";
  const descartado = reporte?.estado === "descartado";
  const soloLectura = enviado || descartado;
  const dirty =
    reporte !== null &&
    (contenido !== reporte.contenido || asunto.trim() !== (reporte.asunto ?? "").trim());
  const ocupado = guardando || enviando;

  const handleClose = () => {
    if (ocupado) return;
    if (dirty && !window.confirm("Hay cambios sin guardar. ¿Cerrar igual?")) return;
    onClose();
  };

  const guardar = async (): Promise<ReporteCliente | null> => {
    if (!reporte || !dirty) return reporte;
    setGuardando(true);
    setError(null);
    try {
      const body: Record<string, string> = {};
      if (contenido !== reporte.contenido) body.contenido = contenido;
      if (asunto.trim() !== (reporte.asunto ?? "").trim()) body.asunto = asunto;
      const res = await fetch(`/api/casos/${casoId}/reportes/${reporte.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; reporte: ReporteCliente }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !json || json.ok !== true) {
        setError(json && json.ok === false ? json.error : "No se pudo guardar");
        return null;
      }
      setReporte(json.reporte);
      onActualizado(json.reporte);
      toast.success("Reporte guardado");
      return json.reporte;
    } catch {
      setError("No se pudo guardar. Revisá la conexión.");
      return null;
    } finally {
      setGuardando(false);
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(contenido);
      toast.success("Texto copiado");
    } catch {
      toast.error("No pude copiar. Seleccioná el texto y copialo a mano.");
    }
  };

  /**
   * Abre wa.me con el texto ya cargado en el chat del cliente. GUARDA ANTES:
   * el link se lleva el texto que está en pantalla y el registro del envío se
   * lleva el que está en la base, así que si no coincidieran quedaría
   * asentado un mensaje distinto del que salió.
   */
  const abrirWhatsapp = async () => {
    if (!reporte || ocupado || pendientes.length > 0 || !tel.ok) return;
    setError(null);
    // La pestaña se abre EN EL CLICK, vacía, y recién después se navega. Si se
    // abriera después del `await` del guardado, el navegador ya no la vería
    // como consecuencia de un gesto del usuario y la trataría como popup.
    const ventana = window.open("", "_blank");
    if (ventana) ventana.opener = null;
    const guardado = dirty ? await guardar() : reporte;
    if (!guardado) {
      ventana?.close();
      return;
    }
    if (!ventana) {
      setError(
        "El navegador bloqueó la ventana de WhatsApp. Permitilas para este sitio, o copiá el texto y pegalo vos.",
      );
      return;
    }
    ventana.location.replace(enlaceWhatsApp(tel.e164, guardado.contenido));
    setAbrioWhatsapp(true);
  };

  const enviar = async (canal: "email" | "whatsapp" | "copia") => {
    if (!reporte || ocupado || pendientes.length > 0) return;
    if (canal === "copia") {
      if (!window.confirm("¿Marcar este reporte como copiado a mano? Después no se puede editar.")) return;
    }
    if (canal === "whatsapp" && !tel.ok) return;
    const guardado = dirty ? await guardar() : reporte;
    if (!guardado) return;
    setEnviando(true);
    setError(null);
    try {
      const para = canal === "email" ? email : canal === "whatsapp" && tel.ok ? tel.e164 : null;
      const res = await fetch(`/api/casos/${casoId}/reportes/${guardado.id}/enviar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(para ? { canal, para } : { canal }),
      });
      const json = (await res.json().catch(() => null)) as RespuestaEnvio;
      if (!res.ok || !json || json.ok !== true) {
        setError(json && json.ok === false ? json.error : "No pude enviar el reporte");
        return;
      }
      setReporte(json.reporte);
      onActualizado(json.reporte);
      setPanelCorreo(false);
      setPanelWhatsapp(false);
      toast.success(
        canal === "email"
          ? `Enviado a ${json.enviado_a}`
          : canal === "whatsapp"
            ? `Registrado: ${json.enviado_a}`
            : "Reporte marcado como enviado",
      );
    } catch {
      setError("No pude enviar el reporte. Revisá la conexión.");
    } finally {
      setEnviando(false);
    }
  };

  const descartar = async () => {
    if (!reporte || ocupado) return;
    if (!window.confirm("¿Descartar este borrador? Queda guardado como descartado, sin enviar.")) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/casos/${casoId}/reportes/${reporte.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ estado: "descartado" }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; reporte: ReporteCliente }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !json || json.ok !== true) {
        setError(json && json.ok === false ? json.error : "No se pudo descartar");
        return;
      }
      setReporte(json.reporte);
      onActualizado(json.reporte);
      toast.success("Reporte descartado");
    } catch {
      setError("No se pudo descartar. Revisá la conexión.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose();
      }}
    >
      <DialogContent
        className="flex h-[calc(100dvh-2rem)] flex-col sm:max-w-3xl sm:max-h-[calc(100dvh-2rem)]"
        showCloseButton={!ocupado}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{plantilla ? `${plantilla.codigo} · ${plantilla.titulo}` : "Reporte"}</span>
            {reporte ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  enviado
                    ? "bg-[rgba(16,185,129,0.22)] text-emerald-800 dark:text-[#A7F3D0]"
                    : descartado
                      ? "bg-[rgba(113,113,122,0.22)] text-zinc-700 dark:text-zinc-300"
                      : "bg-[rgba(245,158,11,0.22)] text-amber-800 dark:text-[#FFE0A3]",
                )}
              >
                {ESTADO_REPORTE_LABEL[reporte.estado]}
              </span>
            ) : null}
          </DialogTitle>
          {reporte ? (
            <p className="text-xs text-muted-foreground">
              Para {reporte.destinatario_nombre} · {CANAL_REPORTE_LABEL[reporte.canal]} · generado{" "}
              {fmtFecha(reporte.creado_en)}
              {reporte.sin_ia ? " · sin IA" : ""}
              {enviado && reporte.enviado_en
                ? ` · enviado ${fmtFecha(reporte.enviado_en)} a ${reporte.enviado_a ?? "—"}`
                : ""}
            </p>
          ) : null}
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4">
          {cargando ? (
            <div className="flex flex-1 items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Abriendo el reporte…
            </div>
          ) : errorCarga ? (
            <p className="py-10 text-center text-sm text-destructive">{errorCarga}</p>
          ) : reporte ? (
            <>
              {reporte.canal === "email" || asunto ? (
                <Input
                  value={asunto}
                  onChange={(e) => setAsunto(e.target.value)}
                  disabled={ocupado || soloLectura}
                  maxLength={300}
                  placeholder="Asunto del correo"
                  aria-label="Asunto"
                />
              ) : null}

              {pendientes.length > 0 ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  <p className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="size-3.5" />
                    {pendientes.length} marca{pendientes.length === 1 ? "" : "s"} por completar antes de enviar
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {pendientes.map((m) => (
                      <li key={m} className="rounded border border-amber-500/30 bg-background/40 px-1.5 py-0.5 font-mono">
                        {m}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : !soloLectura ? (
                <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" /> Sin datos pendientes. Leelo entero antes de mandarlo.
                </p>
              ) : null}

              <Textarea
                value={contenido}
                onChange={(e) => setContenido(e.target.value)}
                disabled={ocupado || soloLectura}
                spellCheck
                aria-label="Texto del reporte"
                className="min-h-0 flex-1 resize-none text-[15px] leading-relaxed"
              />

              {panelCorreo && !soloLectura ? (
                <div className="rounded-lg border border-[var(--el-violet)]/40 bg-[var(--el-violet)]/8 px-3 py-3 text-sm">
                  {email ? (
                    <>
                      <p className="font-medium">Este correo va a salir desde tu Gmail a:</p>
                      <p className="mt-1 break-all font-mono text-base">{email}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {reporte.destinatario_nombre}. Revisá la dirección completa: un mail mal cargado manda la estrategia de la causa a un tercero.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => enviar("email")} disabled={ocupado || pendientes.length > 0}>
                          {enviando ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
                          Confirmar y enviar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setPanelCorreo(false)} disabled={ocupado}>
                          Cancelar
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="font-medium">{reporte.destinatario_nombre} no tiene correo cargado.</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Cargalo en el bloque Partes de la ficha y volvé a abrir este reporte, o mandalo por otro canal.
                      </p>
                      <Button size="sm" variant="outline" className="mt-3" onClick={() => setPanelCorreo(false)}>
                        Cerrar
                      </Button>
                    </>
                  )}
                </div>
              ) : null}

              {panelWhatsapp && !soloLectura ? (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/8 px-3 py-3 text-sm">
                  {tel.ok ? (
                    <>
                      <p className="font-medium">
                        {abrioWhatsapp ? "Se abrió WhatsApp con el mensaje cargado en el chat de:" : "Se va a abrir el chat de WhatsApp de:"}
                      </p>
                      <p className="mt-1 break-all font-mono text-base">{tel.visible}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {reporte.destinatario_nombre}. Revisá el número completo: un teléfono mal cargado abre el chat de otra persona con el mensaje ya escrito.
                      </p>

                      {textoDemasiadoLargoParaLink(tel.e164, contenido) ? (
                        <p className="mt-2 flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-300">
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                          <span>
                            El mensaje es largo y algunos teléfonos recortan el texto al abrirlo por link. Conviene copiarlo y pegarlo en WhatsApp a mano.
                          </span>
                        </p>
                      ) : null}

                      {abrioWhatsapp ? (
                        <>
                          <p className="mt-2 text-xs text-muted-foreground">
                            El mensaje todavía no salió: en WhatsApp tenés que tocar enviar vos. Cuando lo hayas mandado, registralo acá.
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => enviar("whatsapp")} disabled={ocupado || pendientes.length > 0}>
                              {enviando ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                              Ya lo mandé, registralo
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => void abrirWhatsapp()} disabled={ocupado}>
                              <ExternalLink className="size-3.5" />
                              Volver a abrir
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setPanelWhatsapp(false)} disabled={ocupado}>
                              Todavía no
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => void abrirWhatsapp()} disabled={ocupado || pendientes.length > 0}>
                            {guardando ? <Loader2 className="size-3.5 animate-spin" /> : <MessageCircle className="size-3.5" />}
                            Abrir WhatsApp
                          </Button>
                          <Button size="sm" variant="outline" onClick={copiar} disabled={ocupado}>
                            <Copy className="size-3.5" />
                            Copiar el texto
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setPanelWhatsapp(false)} disabled={ocupado}>
                            Cancelar
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="font-medium">
                        {tel.motivo === "vacio"
                          ? `${reporte.destinatario_nombre} no tiene teléfono cargado.`
                          : `No puedo usar el teléfono de ${reporte.destinatario_nombre}.`}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {tel.motivo === "vacio"
                          ? "Cargalo en el bloque Partes de la ficha y volvé a abrir este reporte."
                          : tel.mensaje}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={copiar} disabled={ocupado}>
                          <Copy className="size-3.5" />
                          Copiar el texto
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => enviar("copia")} disabled={ocupado || pendientes.length > 0}>
                          Marcarlo como copiado a mano
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setPanelWhatsapp(false)} disabled={ocupado}>
                          Cerrar
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
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
            <Button variant="outline" size="sm" onClick={copiar} disabled={!reporte || ocupado}>
              <Copy className="size-3.5" />
              Copiar texto
            </Button>
            {!soloLectura ? (
              <Button
                variant="outline"
                size="sm"
                onClick={descartar}
                disabled={!reporte || ocupado}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Ban className="size-3.5" />
                Descartar
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {!soloLectura ? (
              <>
                <Button variant="outline" size="sm" onClick={() => void guardar()} disabled={!dirty || ocupado}>
                  {guardando ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Guardar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPanelCorreo(false);
                    setPanelWhatsapp(true);
                  }}
                  disabled={!reporte || ocupado || pendientes.length > 0 || panelWhatsapp}
                  title={pendientes.length > 0 ? "Completá las marcas antes de enviar" : "Abre el chat del cliente con el mensaje ya escrito"}
                >
                  <MessageCircle className="size-3.5" />
                  Enviar por WhatsApp
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setPanelWhatsapp(false);
                    setPanelCorreo(true);
                  }}
                  disabled={!reporte || ocupado || pendientes.length > 0 || panelCorreo}
                  title={pendientes.length > 0 ? "Completá las marcas antes de enviar" : undefined}
                >
                  <Mail className="size-3.5" />
                  Enviar por correo
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
