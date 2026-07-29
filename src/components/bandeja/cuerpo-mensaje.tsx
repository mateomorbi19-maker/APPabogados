"use client";
// Render del cuerpo de un mensaje.
//
// POR QUÉ UN IFRAME Y NO dangerouslySetInnerHTML:
// el HTML llega ya sanitizado por `sanitizarHtml` (src/lib/gmail/parse.ts),
// pero esa función está documentada como un tokenizador por regex, no un
// parser DOM (no hay DOMPurify en el proyecto). Un iframe agrega dos garantías
// que el sanitizador no puede dar por sí solo:
//   1. aislamiento de CSS — los mails traen su propio CSS inline con colores
//      claros y anchos fijos, y adentro del iframe no pueden tocar el layout
//      ni el tema dark de la app;
//   2. una CSP propia con `default-src 'none'` y sin `script-src`, que corta
//      cualquier script que el sanitizador hubiese dejado pasar;
//   3. control sobre qué subrecursos puede pedir el mail — de ahí sale el
//      bloqueo de imágenes remotas de abajo.
//
// El sandbox lleva `allow-same-origin` SIN `allow-scripts`: sin scripts el
// documento no puede hacer nada con ese privilegio, y a cambio el padre puede
// leer `contentDocument` para medir el alto (un iframe de alto fijo en un
// cliente de correo es inusable). `allow-popups*` es para que los enlaces
// —que el sanitizador ya fuerza a target="_blank" rel="noopener"— abran.

import { ImageOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ATTR_IMG_BLOQUEADA, type MensajeCompleto } from "@/lib/gmail/types";

// Dos CSP, no una. Por defecto el documento NO puede pedir nada a la red: las
// únicas imágenes que se cargan son las `data:` (inline, sin request) y las
// `'self'` (imágenes incrustadas del propio mail, servidas por nuestra ruta de
// adjuntos). Un `<img>` remoto es un acuse de lectura hacia el remitente —que
// acá puede ser la contraparte o la fiscalía—, así que sólo se habilita
// cuando el abogado lo pide, y para ESE mensaje.
const CSP_BASE =
  "default-src 'none'; style-src 'unsafe-inline'; font-src data:; form-action 'none'; frame-src 'none'";
const CSP_SIN_REMOTAS = `${CSP_BASE}; img-src data: 'self'`;
const CSP_CON_REMOTAS = `${CSP_BASE}; img-src data: 'self' https: http:`;

const ALTO_INICIAL = 140;
const ALTO_MAXIMO = 4000;

const RE_IMG_BLOQUEADA = new RegExp(`\\b${ATTR_IMG_BLOQUEADA}=`, "gi");

/** ¿El sanitizador dejó alguna imagen remota guardada sin cargar? */
function tieneImagenesRemotas(html: string): boolean {
  return html.includes(`${ATTR_IMG_BLOQUEADA}=`);
}

/** Devuelve el atributo bloqueado a su lugar como `src`. */
function conImagenesRemotas(html: string): string {
  return html.replace(RE_IMG_BLOQUEADA, "src=");
}

function documentoHtml(html: string, permitirRemotas: boolean): string {
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${
    permitirRemotas ? CSP_CON_REMOTAS : CSP_SIN_REMOTAS
  }">
<base target="_blank">
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; background: #ffffff; color: #18181b; }
  body {
    font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    padding: 14px 16px;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  img, video, table { max-width: 100%; }
  img { height: auto; }
  table { border-collapse: collapse; }
  a { color: #5b21b6; }
  pre { white-space: pre-wrap; }
  blockquote {
    margin: 0 0 0 8px;
    padding-left: 10px;
    border-left: 2px solid #d4d4d8;
    color: #52525b;
  }
</style>
</head><body>${html}</body></html>`;
}

function CuerpoHtml({
  html,
  permitirRemotas,
}: {
  html: string;
  permitirRemotas: boolean;
}) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [alto, setAlto] = useState(ALTO_INICIAL);
  const documento = useMemo(
    () => documentoHtml(permitirRemotas ? conImagenesRemotas(html) : html, permitirRemotas),
    [html, permitirRemotas],
  );

  const medir = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc) return;
    const h = Math.max(
      doc.documentElement?.scrollHeight ?? 0,
      doc.body?.scrollHeight ?? 0,
    );
    if (h > 0) setAlto(Math.min(h + 4, ALTO_MAXIMO));
  }, []);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    // El load puede haber ocurrido antes de este efecto (srcDoc es sincrónico
    // en algunos navegadores), así que medimos una vez de entrada.
    medir();
    frame.addEventListener("load", medir);

    // Las imágenes remotas terminan de cargar después del load y cambian el
    // alto; el observer sobre <body> lo captura sin polling.
    let observer: ResizeObserver | null = null;
    const body = frame.contentDocument?.body;
    if (body && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(medir);
      observer.observe(body);
    }
    return () => {
      frame.removeEventListener("load", medir);
      observer?.disconnect();
    };
  }, [medir, documento]);

  return (
    <iframe
      ref={ref}
      title="Contenido del mensaje"
      srcDoc={documento}
      // Sin allow-scripts: el documento es inerte. Ver comentario de cabecera.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      loading="lazy"
      className="w-full rounded-lg border border-[var(--el-border-soft)] bg-white"
      style={{ height: `${alto}px` }}
    />
  );
}

export function CuerpoMensaje({ mensaje }: { mensaje: MensajeCompleto }) {
  const html = mensaje.cuerpo_html ?? "";
  const hayHtml = Boolean(mensaje.cuerpo_html && mensaje.cuerpo_html.trim());
  const hayTexto = Boolean(mensaje.cuerpo_texto && mensaje.cuerpo_texto.trim());
  const [verTexto, setVerTexto] = useState(false);
  // Por mensaje, no global: mostrar las imágenes de un remitente no autoriza
  // a los otros. Se resetea al cambiar de hilo porque el componente se
  // desmonta con el bloque del mensaje.
  const [verImagenes, setVerImagenes] = useState(false);

  if (!hayHtml && !hayTexto) {
    return (
      <p className="text-sm italic text-[var(--el-text-muted)]">
        (Este mensaje no tiene cuerpo de texto)
      </p>
    );
  }

  const mostrarTexto = verTexto || !hayHtml;
  const hayRemotas = hayHtml && tieneImagenesRemotas(html);

  return (
    <div className="space-y-2">
      {!mostrarTexto && hayRemotas && !verImagenes ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--el-border-soft)] bg-white/[0.02] px-3 py-2">
          <ImageOff
            aria-hidden
            className="size-3.5 shrink-0 text-[var(--el-text-muted)]"
          />
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--el-text-muted)]">
            Las imágenes externas de este mensaje están bloqueadas: al cargarlas,
            el remitente se entera de cuándo lo abriste y desde qué IP.
          </p>
          <button
            type="button"
            onClick={() => setVerImagenes(true)}
            className="shrink-0 rounded-lg border border-[var(--el-border-soft)] px-2 py-1 text-[11px] text-[var(--el-text-soft)] transition-colors hover:border-[var(--el-violet)]/50 hover:text-[var(--el-text)]"
          >
            Mostrar imágenes
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        {mostrarTexto ? (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-[var(--el-text-soft)]">
            {mensaje.cuerpo_texto ?? ""}
          </pre>
        ) : (
          <CuerpoHtml html={html} permitirRemotas={verImagenes} />
        )}
      </div>

      {hayHtml && hayTexto ? (
        <button
          type="button"
          onClick={() => setVerTexto((v) => !v)}
          className="text-[11px] text-[var(--el-text-muted)] underline underline-offset-2 transition-colors hover:text-[var(--el-text-soft)]"
        >
          {mostrarTexto ? "Ver versión HTML" : "Ver versión en texto plano"}
        </button>
      ) : null}
    </div>
  );
}
