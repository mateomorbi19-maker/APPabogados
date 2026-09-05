"use client";
// Lector de un documento. El visor es el nativo del browser sobre el endpoint
// que streamea desde Drive.
//
// Antes de montar el <iframe> se sondea el endpoint y se cancela el body apenas
// llegan los headers: si falta el permiso de Drive (409) el iframe quedaría en
// blanco para siempre, y acá en cambio se muestra el aviso con "Abrir en Drive".

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  EyeOff,
  FileText,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useMediaQuery } from "@/lib/hooks/use-cliente";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtFecha } from "@/lib/format";
import {
  COLECCIONES,
  esInlineSeguro,
  etiquetaTipoArchivo,
  metaTribunal,
  slugMateria,
  type DocumentoRepositorio,
} from "@/lib/repositorio/types";
import { normalizarTexto } from "@/lib/repositorio/texto";
import {
  descargarArchivo,
  probarArchivo,
  urlArchivo,
  type FalloArchivo,
} from "./api";
import { AvisoDrive } from "./aviso-drive";
import { EsqueletoLector } from "./esqueletos";
import { ICONO_COLECCION } from "./iconos";

/**
 * Resultado del sondeo, etiquetado con la clave del intento que lo produjo.
 * "Está probando" se deriva de que la sonda en estado no corresponda al intento
 * actual, en vez de setearse a mano dentro del efecto.
 */
type Sonda = { clave: string } & (
  | { estado: "ok" }
  | ({ estado: "fallo" } & FalloArchivo)
);

/**
 * Formatos que el visor nativo del browser abre embebido. Es la MISMA lista que
 * decide `inline` vs `attachment` en la ruta del archivo: si divergieran, el
 * iframe pediría algo que el servidor manda como descarga.
 */
function esPrevisualizable(mime: string): boolean {
  return esInlineSeguro(mime);
}

function Dato({ termino, valor }: { termino: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] tracking-wide text-[var(--el-text-muted)] uppercase">
        {termino}
      </dt>
      <dd className="text-sm text-[var(--el-text)]">{valor}</dd>
    </div>
  );
}

export function LectorDocumento({ doc }: { doc: DocumentoRepositorio }) {
  // El visor embebido se decide en JS y no con `max-md:hidden`:
  // display:none esconde el iframe pero NO evita que el browser pida el
  // PDF igual. Un fallo escaneado son varios MB que el telefono se bajaba
  // —con datos moviles— para no mostrarlos nunca.
  const enEscritorio = useMediaQuery("(min-width: 768px)");
  const router = useRouter();
  const meta = COLECCIONES[doc.coleccion];
  const Icono = ICONO_COLECCION[doc.coleccion];
  const previsualizable = esPrevisualizable(doc.mime_type);

  const [sonda, setSonda] = useState<Sonda | null>(null);
  const [bajando, setBajando] = useState(false);
  const [intento, setIntento] = useState(0);

  const clave = `${intento}|${doc.id}`;
  // null = todavía no volvió el sondeo de ESTE intento ⇒ está probando.
  const resultado = sonda?.clave === clave ? sonda : null;

  useEffect(() => {
    if (!previsualizable) return;
    const ctrl = new AbortController();
    void probarArchivo(doc.id, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      setSonda(
        r.ok ? { clave, estado: "ok" } : { clave, estado: "fallo", ...r },
      );
    });
    return () => ctrl.abort();
  }, [clave, doc.id, previsualizable]);

  const handleDescargar = useCallback(async () => {
    if (bajando) return;
    setBajando(true);
    try {
      const r = await descargarArchivo(doc.id, doc.titulo_original);
      if (!r.ok) toast.error(r.error);
    } finally {
      setBajando(false);
    }
  }, [bajando, doc.id, doc.titulo_original]);

  // Volver a la lista conservando la búsqueda: el estado de filtros vive en la
  // URL de la sección, así que el back del browser la restituye tal cual. Sin
  // historial (link abierto de cero) se cae al índice de la sección.
  const volver = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push("/dashboard/repositorio");
  }, [router]);

  const metadatos: { termino: string; valor: string }[] = [];
  if (doc.tribunal) {
    metadatos.push({ termino: "Tribunal", valor: metaTribunal(doc.tribunal).label });
  }
  if (doc.anio !== null) metadatos.push({ termino: "Año", valor: String(doc.anio) });
  // Mismo criterio que la card: la carátula se recorta del nombre del archivo
  // con heurísticas, así que cuando ya está contenida en el título no aporta
  // nada y sí puede exhibir un recorte fallido como si fuera la cita del fallo.
  if (
    doc.caratula &&
    !normalizarTexto(doc.titulo).includes(normalizarTexto(doc.caratula))
  ) {
    metadatos.push({ termino: "Carátula", valor: doc.caratula });
  }
  if (doc.autor) metadatos.push({ termino: "Autor", valor: doc.autor });
  if (doc.causa) metadatos.push({ termino: "Causa", valor: doc.causa });
  if (doc.registro) metadatos.push({ termino: "Registro", valor: doc.registro });
  metadatos.push({
    termino: "Actualizado en Drive",
    valor: fmtFecha(doc.modificado_en),
  });

  return (
    <div className="space-y-4">
      {/* max-md:h-10: es el único “atrás” visible de la pantalla, no puede
          quedarse en los 36px que da `size="sm"` en móvil. */}
      <Button
        variant="ghost"
        size="sm"
        onClick={volver}
        className="-ml-2 max-md:h-10"
      >
        <ArrowLeft aria-hidden />
        Volver al repositorio
      </Button>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              meta.badge,
            )}
          >
            <Icono className="size-3" aria-hidden />
            {meta.label}
          </span>
          {doc.anonimizado ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-[var(--el-border-soft)] px-2 py-0.5 text-[10px] text-[var(--el-text-muted)]"
              title="El nombre viene testado o con iniciales."
            >
              <EyeOff className="size-3" aria-hidden />
              Identidad reservada
            </span>
          ) : null}
        </div>

        <h1 className="font-display text-xl leading-snug font-semibold text-[var(--el-text)] md:text-2xl">
          {doc.titulo}
        </h1>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          {metadatos.map((m) => (
            <Dato key={m.termino} termino={m.termino} valor={m.valor} />
          ))}
        </dl>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] tracking-wide text-[var(--el-text-muted)] uppercase">
            Materias
          </span>
          {doc.materias.map((label) => (
            <Link
              key={label}
              href={`/dashboard/repositorio?coleccion=${doc.coleccion}&materia=${slugMateria(doc.coleccion, label)}`}
              // Cada materia es un link a la lista filtrada: 18px de alto no se
              // tocan. En esta pantalla no hay presión de densidad, así que van
              // al piso completo de 40px.
              className="rounded-md border border-[var(--el-border-soft)] px-1.5 py-0.5 text-[11px] text-[var(--el-text-soft)] transition-colors hover:border-[var(--el-violet)]/45 hover:text-[var(--el-text)] max-md:inline-flex max-md:min-h-10 max-md:items-center max-md:px-3 max-md:text-xs"
            >
              {label}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button onClick={handleDescargar} disabled={bajando}>
            {bajando ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Download aria-hidden />
            )}
            Descargar
          </Button>
          <a
            href={doc.view_url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <ExternalLink aria-hidden />
            Abrir en Drive
          </a>
        </div>
      </header>

      {/* ——— Visor ——— */}
      {!previsualizable ? (
        <div className="flex min-h-[40dvh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--el-border-soft)] px-6 py-12 text-center">
          <p className="text-sm text-[var(--el-text-soft)]">
            Este archivo es {etiquetaTipoArchivo(doc.mime_type)} y no se puede
            previsualizar acá adentro.
          </p>
          <p className="text-xs text-[var(--el-text-muted)]">
            Descargalo o abrilo en Drive para leerlo.
          </p>
        </div>
      ) : resultado === null ? (
        <EsqueletoLector />
      ) : resultado.estado === "fallo" ? (
        <AvisoDrive
          error={resultado.error}
          motivo={resultado.motivo}
          viewUrl={resultado.view_url ?? doc.view_url}
          onReintentar={() => setIntento((i) => i + 1)}
        />
      ) : (
        <div className="space-y-2">
          {/* Sin `sandbox` a propósito: Chrome bloquea el visor de PDF dentro
              de un iframe sandboxeado (net::ERR_BLOCKED_BY_CLIENT, con
              cualquier combinación de flags) y se caería el lector entero. El
              aislamiento lo pone el servidor en la respuesta del binario:
              Content-Type del catálogo + nosniff + CSP `default-src 'none'`
              + `attachment` para todo lo que no sea previsualizable. Ver
              src/app/api/repositorio/documentos/[id]/archivo/route.ts. */}
          {/* El iframe no se monta en móvil. Safari iOS renderiza un PDF
              embebido como una imagen fija de la PRIMERA página, sin scroll
              interno: leer un fallo de 30 carillas desde el teléfono es
              imposible y el visor aparece roto en vez de derivar limpio. El
              alto va en dvh y no en vh porque vh mide contra el viewport
              grande de iOS y el marco se metía abajo de la barra de URL. */}
          {enEscritorio ? (
            <iframe
              src={urlArchivo(doc.id)}
              title={`Documento: ${doc.titulo}`}
              referrerPolicy="no-referrer"
              className="h-[78dvh] min-h-[440px] w-full rounded-xl border border-[var(--el-border)] bg-[var(--el-surface-card)]"
            />
          ) : null}
          {/* La salida del celular: el visor nativo de iOS y Android abre el
              PDF a pantalla completa y ahí sí scrollea, hace zoom y busca. */}
          <div className="flex flex-col items-center gap-3 rounded-xl border border-[var(--el-border-soft)] bg-[var(--el-surface-card)]/50 px-5 py-8 text-center md:hidden">
            <FileText
              className="size-8 text-[var(--el-text-muted)]"
              aria-hidden
            />
            <p className="text-sm text-[var(--el-text-soft)]">
              En el celular el documento se lee mejor en el visor del teléfono,
              a pantalla completa.
            </p>
            <a
              href={urlArchivo(doc.id)}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ size: "lg" }), "w-full max-w-xs")}
            >
              <ExternalLink aria-hidden />
              Abrir el PDF
            </a>
            {/* size="lg" y no un `h-11` suelto: el primitivo trae
                `max-md:h-10`, y una utility con variante le gana a una sin
                variante, asi que el h-11 nunca se aplicaba justo en movil, que
                es el unico ancho donde este bloque existe (md:hidden). `lg` da
                los 44px de verdad. */}
            <Button
              variant="outline"
              size="lg"
              onClick={handleDescargar}
              disabled={bajando}
              className="w-full max-w-xs"
            >
              {bajando ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Download aria-hidden />
              )}
              Descargar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
