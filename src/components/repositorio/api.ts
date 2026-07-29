// Contratos de /api/repositorio/* vistos desde el cliente, más los type guards
// que evitan castear a ciegas lo que devuelve `res.json()`.
// Los shapes de dominio (DocumentoRepositorio, Facetas, …) NO se redefinen acá:
// se importan de @/lib/repositorio/types, que es la fuente de verdad.

import type {
  Coleccion,
  DocumentoRepositorio,
  Facetas,
  Orden,
} from "@/lib/repositorio/types";

// ————————————————————————————————————————————————————————————————
// Filtros (estado de la UI ↔ query string)
// ————————————————————————————————————————————————————————————————

export type FiltrosRepo = {
  q: string;
  coleccion: Coleccion | null;
  /** Slug global de materia, con prefijo de colección (`jur-homicidio`). */
  materia: string | null;
  /** Código de tribunal (`CSJN`). */
  tribunal: string | null;
  anio: number | null;
  orden: Orden;
};

export const FILTROS_VACIOS: FiltrosRepo = {
  q: "",
  coleccion: null,
  materia: null,
  tribunal: null,
  anio: null,
  orden: "relevancia",
};

/** Filtros "de verdad": el orden no cuenta como filtro activo. */
export function hayFiltros(f: FiltrosRepo): boolean {
  return (
    f.q.trim() !== "" ||
    f.coleccion !== null ||
    f.materia !== null ||
    f.tribunal !== null ||
    f.anio !== null
  );
}

/**
 * Query string canónica. Se usa tanto para pegarle a la API como para reflejar
 * el estado en la URL del browser, así que omite todo lo que esté en su valor
 * por defecto: un link compartido no arrastra ruido.
 */
export function queryFiltros(f: FiltrosRepo, pagina?: number): string {
  const p = new URLSearchParams();
  if (f.q.trim() !== "") p.set("q", f.q.trim());
  if (f.coleccion) p.set("coleccion", f.coleccion);
  if (f.materia) p.set("materia", f.materia);
  if (f.tribunal) p.set("tribunal", f.tribunal);
  if (f.anio !== null) p.set("anio", String(f.anio));
  if (f.orden !== "relevancia") p.set("orden", f.orden);
  if (pagina !== undefined && pagina > 1) p.set("pagina", String(pagina));
  return p.toString();
}

// ————————————————————————————————————————————————————————————————
// Respuestas
// ————————————————————————————————————————————————————————————————

export type RespuestaDocumentos = {
  documentos: DocumentoRepositorio[];
  total: number;
  facetas: Facetas;
  pagina: number;
  por_pagina: number;
};

export type EstadoRepositorio = {
  conectado: boolean;
  vinculado: boolean;
  total_documentos: number;
};

/** Por qué no se pudo streamear el PDF. Lo devuelve el 409/404/502 del archivo. */
export type MotivoArchivo =
  | "sin_token"
  | "token_invalido"
  | "sin_permiso"
  | "no_encontrado"
  | "error_drive"
  | "tipo_cambiado";

export type FalloArchivo = {
  /** Ya viene redactado para el abogado: se muestra tal cual. */
  error: string;
  motivo: MotivoArchivo | null;
  view_url: string | null;
};

export type Resultado<T> =
  | { ok: true; datos: T }
  | { ok: false; error: string };

// ————————————————————————————————————————————————————————————————
// Type guards
// ————————————————————————————————————————————————————————————————

function comoObjeto(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null
    ? (v as Record<string, unknown>)
    : null;
}

function esRespuestaDocumentos(v: unknown): v is RespuestaDocumentos {
  const o = comoObjeto(v);
  if (!o) return false;
  const facetas = comoObjeto(o.facetas);
  return (
    Array.isArray(o.documentos) &&
    typeof o.total === "number" &&
    typeof o.pagina === "number" &&
    typeof o.por_pagina === "number" &&
    facetas !== null &&
    Array.isArray(facetas.materias) &&
    Array.isArray(facetas.tribunales) &&
    Array.isArray(facetas.decadas) &&
    Array.isArray(facetas.anios) &&
    typeof facetas.sin_anio === "number"
  );
}

function esEstado(v: unknown): v is EstadoRepositorio {
  const o = comoObjeto(v);
  return (
    o !== null &&
    typeof o.conectado === "boolean" &&
    typeof o.vinculado === "boolean" &&
    typeof o.total_documentos === "number"
  );
}

const MOTIVOS: readonly MotivoArchivo[] = [
  "sin_token",
  "token_invalido",
  "sin_permiso",
  "no_encontrado",
  "error_drive",
  "tipo_cambiado",
];

function leerFalloArchivo(v: unknown, status: number): FalloArchivo {
  const o = comoObjeto(v);
  const motivo = o && typeof o.motivo === "string" ? o.motivo : null;
  return {
    error:
      o && typeof o.error === "string" && o.error !== ""
        ? o.error
        : `No se pudo abrir el archivo (HTTP ${status}).`,
    motivo:
      motivo !== null && (MOTIVOS as readonly string[]).includes(motivo)
        ? (motivo as MotivoArchivo)
        : null,
    view_url: o && typeof o.view_url === "string" ? o.view_url : null,
  };
}

/** Mensaje de error de la API si vino, o un fallback con el status. */
function mensajeError(json: unknown, status: number, fallback: string): string {
  const o = comoObjeto(json);
  if (o && typeof o.error === "string" && o.error !== "") return o.error;
  return `${fallback} (HTTP ${status})`;
}

// ————————————————————————————————————————————————————————————————
// Endpoints
//
// Invariante del módulo: NINGUNA de estas funciones rechaza. Un `fetch` que
// rechaza (red caída, server dormido, DNS, stream cortado a mitad) vuelve como
// `ok: false` con un mensaje ya redactado. La UI deriva "está cargando" de que
// todavía no llegó la respuesta, así que una promesa que rechaza en silencio
// deja la pantalla en esqueleto para siempre.
// ————————————————————————————————————————————————————————————————

const SIN_CONEXION = "No hay conexión con el servidor. Probá de nuevo.";

export function urlArchivo(id: string, descargar = false): string {
  return `/api/repositorio/documentos/${encodeURIComponent(id)}/archivo${
    descargar ? "?descargar=1" : ""
  }`;
}

export async function pedirDocumentos(
  filtros: FiltrosRepo,
  pagina: number,
  signal?: AbortSignal,
): Promise<Resultado<RespuestaDocumentos>> {
  const qs = queryFiltros(filtros, pagina);
  let res: Response;
  try {
    res = await fetch(`/api/repositorio/documentos${qs ? `?${qs}` : ""}`, {
      signal,
    });
  } catch {
    // Incluye el AbortError de cancelar la búsqueda anterior: el llamador ya
    // descarta la respuesta mirando `signal.aborted`.
    return { ok: false, error: SIN_CONEXION };
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok || !esRespuestaDocumentos(json)) {
    return {
      ok: false,
      error: mensajeError(json, res.status, "No se pudo buscar en el repositorio"),
    };
  }
  return { ok: true, datos: json };
}

export async function pedirEstado(
  signal?: AbortSignal,
): Promise<EstadoRepositorio | null> {
  try {
    const res = await fetch("/api/repositorio/estado", { signal });
    const json: unknown = await res.json().catch(() => null);
    return res.ok && esEstado(json) ? json : null;
  } catch {
    // El estado de Drive es informativo: si falla, la biblioteca se lista igual.
    return null;
  }
}

/**
 * ¿Se puede abrir este PDF acá adentro? Pide el archivo y **cancela el body**
 * apenas llegan los headers: alcanza con el status y, si falló, con el JSON del
 * error. Evita el iframe en blanco cuando falta el permiso de Drive.
 */
export async function probarArchivo(
  id: string,
  signal?: AbortSignal,
): Promise<{ ok: true } | ({ ok: false } & FalloArchivo)> {
  try {
    const res = await fetch(urlArchivo(id), { signal });
    if (res.ok) {
      // No queremos el binario: el que lo va a bajar es el <iframe>.
      await res.body?.cancel();
      return { ok: true };
    }
    const json: unknown = await res.json().catch(() => null);
    return { ok: false, ...leerFalloArchivo(json, res.status) };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: false, error: "", motivo: null, view_url: null };
    }
    return { ok: false, error: SIN_CONEXION, motivo: null, view_url: null };
  }
}

/**
 * Descarga por JS en vez de un `<a download>` directo: si el endpoint responde
 * 409 (falta permiso de Drive) el link crudo navegaría a un JSON en pantalla.
 * Así el error vuelve como dato y la UI lo puede mostrar como corresponde.
 */
export async function descargarArchivo(
  id: string,
  nombreArchivo: string,
): Promise<{ ok: true } | ({ ok: false } & FalloArchivo)> {
  let res: Response;
  try {
    res = await fetch(urlArchivo(id, true));
  } catch {
    return { ok: false, error: SIN_CONEXION, motivo: null, view_url: null };
  }
  if (!res.ok) {
    const json: unknown = await res.json().catch(() => null);
    return { ok: false, ...leerFalloArchivo(json, res.status) };
  }
  // El `fetch` resuelve con los headers, no con el body: el corte de la
  // transferencia (Drive corta el media, o se agota el maxDuration de la ruta)
  // rechaza acá, con el 200 ya recibido. Sin esta guarda el spinner se apaga y
  // no pasa nada: ni toast, ni archivo en Descargas.
  try {
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // El revoke inmediato corta la descarga en algunos browsers; un tick alcanza.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    return {
      ok: false,
      error: "Se cortó la descarga antes de terminar. Probá de nuevo.",
      motivo: null,
      view_url: null,
    };
  }
  return { ok: true };
}

// `pedirAnios` ya no existe: los años exactos vienen en `facetas.anios`, ya
// filtrados por la búsqueda en curso. Cuando se armaban acá (sin filtros, con
// un fetch aparte) los chips de año mostraban el catálogo entero mientras el
// conteo de la década de al lado mostraba el resultado, y la mayoría de los
// chips llevaba a cero resultados.
