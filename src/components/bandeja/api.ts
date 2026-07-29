// Contratos de respuesta de /api/bandeja/* vistos desde el cliente, más los
// type guards que evitan castear a ciegas lo que devuelve `res.json()`.
// Los shapes de dominio (HiloResumen, HiloCompleto, …) NO se redefinen acá:
// se importan de @/lib/gmail/types, que es la fuente de verdad compartida.

import type { HiloCompleto, HiloResumen } from "@/lib/gmail/types";

export type EstadoConexion = {
  conectado: boolean;
  vinculado: boolean;
  email: string | null;
  puede_enviar: boolean;
  demo: boolean;
  /** Detalle del error de Google. Sólo viaja en desarrollo. */
  detail?: string;
};

export type RespuestaHilos = {
  hilos: HiloResumen[];
  nextPageToken: string | null;
  conectado: boolean;
  demo: boolean;
};

export type RespuestaHilo = {
  hilo: HiloCompleto;
  conectado: boolean;
  demo: boolean;
};

/** fetch + json tolerante: un 502 con HTML de proxy no puede tirar la UI. */
export async function pedirJson(
  url: string,
  init?: RequestInit,
): Promise<{ res: Response; json: unknown }> {
  const res = await fetch(url, init);
  const json: unknown = await res.json().catch(() => null);
  return { res, json };
}

/** Mensaje de error de la API si vino, o un fallback con el status. */
export function errorDe(
  json: unknown,
  status: number,
  fallback: string,
): string {
  if (json !== null && typeof json === "object" && "error" in json) {
    const e = (json as { error?: unknown }).error;
    if (typeof e === "string" && e.length > 0) return e;
  }
  return `${fallback} (HTTP ${status})`;
}

function esObjeto(j: unknown): j is Record<string, unknown> {
  return j !== null && typeof j === "object";
}

export function esEstadoConexion(j: unknown): j is EstadoConexion {
  return (
    esObjeto(j) &&
    typeof j.conectado === "boolean" &&
    typeof j.vinculado === "boolean" &&
    typeof j.puede_enviar === "boolean" &&
    typeof j.demo === "boolean"
  );
}

export function esRespuestaHilos(j: unknown): j is RespuestaHilos {
  return esObjeto(j) && Array.isArray(j.hilos) && typeof j.demo === "boolean";
}

export function esRespuestaHilo(j: unknown): j is RespuestaHilo {
  if (!esObjeto(j) || !esObjeto(j.hilo)) return false;
  return Array.isArray((j.hilo as { mensajes?: unknown }).mensajes);
}

export function esOk(j: unknown): boolean {
  return esObjeto(j) && j.ok === true;
}
