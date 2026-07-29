import "server-only";
import type { Readable } from "node:stream";
import { auth, drive as makeDrive, type drive_v3 } from "@googleapis/drive";
import { getTokenConScope, SCOPES_DRIVE } from "@/lib/google/token";

// Paquete individual `@googleapis/drive` a propósito: el meta-paquete
// `googleapis` arrastra los tipos de TODAS las APIs de Google y revienta el
// heap del type-check de `next build` (mismo motivo que en
// src/lib/agenda/google-calendar.ts y src/lib/gmail/client.ts).

export type ErrorDescarga =
  | "sin_token" // no hay cuenta de Google vinculada, o falta el scope de Drive
  | "token_invalido" // el permiso de Google venció o lo revocaron: hay que re-loguear
  | "sin_permiso" // 403: la cuenta no tiene acceso a ESE archivo
  | "no_encontrado" // 404: el archivo se movió o se borró de la carpeta
  | "error_drive"; // cualquier otra falla de la API (red, 5xx, cuota)

export type ResultadoDescarga =
  | {
      ok: true;
      stream: ReadableStream<Uint8Array>;
      mimeType: string;
      /** null cuando Drive no informa tamaño (docs nativos de Google). */
      sizeBytes: number | null;
      nombre: string;
    }
  | { ok: false; error: ErrorDescarga };

function driveDesdeToken(accessToken: string): drive_v3.Drive {
  const oauth2Client = new auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return makeDrive({ version: "v3", auth: oauth2Client });
}

/** Status HTTP que devolvió Google, si el error lo trae. */
function statusDeError(e: unknown): number | null {
  if (typeof e !== "object" || e === null) return null;
  const conResponse = e as { response?: { status?: unknown }; status?: unknown };
  const anidado = conResponse.response?.status;
  if (typeof anidado === "number") return anidado;
  return typeof conResponse.status === "number" ? conResponse.status : null;
}

/** Mensaje de la API de Google, en minúsculas. "" si el error no lo trae. */
function mensajeDeError(e: unknown): string {
  if (typeof e !== "object" || e === null) return "";
  const m = (e as { message?: unknown }).message;
  return typeof m === "string" ? m.toLowerCase() : "";
}

/**
 * 401 y 403 NO son lo mismo y la UI ofrece acciones distintas: el 401 (token
 * vencido o revocado) se arregla volviendo a loguearse, el 403 sobre un archivo
 * puntual no. El caso borde es el consentimiento granular de Google: si el
 * usuario revoca sólo el scope de Drive, el grant sigue vivo (Clerk sigue
 * reportando el scope, así que `getTokenConScope` no lo detecta) y Drive
 * responde 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT para siempre. Ese también se
 * arregla re-logueando, así que va con el 401.
 */
function clasificar(e: unknown): ErrorDescarga {
  const status = statusDeError(e);
  if (status === 404) return "no_encontrado";
  if (status === 401) return "token_invalido";
  if (status === 403) {
    const msg = mensajeDeError(e);
    return msg.includes("insufficient authentication scopes") ||
      msg.includes("access_token_scope_insufficient")
      ? "token_invalido"
      : "sin_permiso";
  }
  return "error_drive";
}

/**
 * Adapta el stream de Node que devuelve googleapis al ReadableStream web que
 * espera `Response`. Se escribe a mano en vez de usar `Readable.toWeb` porque
 * los tipos de node:stream/web y los del DOM no son el mismo `ReadableStream` y
 * el puente pedía un cast a `any`.
 *
 * Con contrapresión: si el consumidor se atrasa (el navegador descargando un
 * PDF grande por una conexión lenta) se pausa la lectura desde Drive en vez de
 * acumular el archivo entero en memoria del server.
 */
function aStreamWeb(node: Readable): ReadableStream<Uint8Array> {
  let cerrado = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      node.on("data", (chunk: Buffer | string) => {
        if (cerrado) return;
        // Copia deliberada: los Buffer chicos de Node salen de un pool que se
        // reutiliza, y el chunk se consume de forma asincrónica más adelante.
        const bytes =
          typeof chunk === "string"
            ? new TextEncoder().encode(chunk)
            : new Uint8Array(chunk);
        controller.enqueue(bytes);
        if ((controller.desiredSize ?? 1) <= 0) node.pause();
      });
      node.on("end", () => {
        if (cerrado) return;
        cerrado = true;
        controller.close();
      });
      node.on("error", (e: Error) => {
        if (cerrado) return;
        cerrado = true;
        controller.error(e);
      });
    },
    pull() {
      node.resume();
    },
    cancel() {
      cerrado = true;
      node.destroy();
    },
  });
}

/**
 * Binario de un archivo de Drive, en streaming. Nunca tira: todos los caminos
 * de falla vuelven como error tipado para que la ruta pueda ofrecer "Abrir en
 * Drive" en vez de un 500.
 *
 * Son dos llamadas a Google: metadata (nombre/tamaño/mime reales) y media. El
 * costo extra vale porque sin la primera no se puede mandar `Content-Length` ni
 * un `Content-Disposition` con el nombre correcto.
 */
export async function descargarDocumento(
  clerkUserId: string,
  driveId: string,
): Promise<ResultadoDescarga> {
  const token = await getTokenConScope(clerkUserId, SCOPES_DRIVE);
  if (!token) return { ok: false, error: "sin_token" };

  const drive = driveDesdeToken(token);

  let meta: drive_v3.Schema$File;
  try {
    const res = await drive.files.get({
      fileId: driveId,
      fields: "id, name, mimeType, size",
      supportsAllDrives: true,
    });
    meta = res.data;
  } catch (e) {
    console.error("[repositorio/drive] metadata:", driveId, e);
    return { ok: false, error: clasificar(e) };
  }

  try {
    const res = await drive.files.get(
      { fileId: driveId, alt: "media", supportsAllDrives: true },
      { responseType: "stream" },
    );
    const size = typeof meta.size === "string" ? Number(meta.size) : null;
    return {
      ok: true,
      stream: aStreamWeb(res.data),
      mimeType: meta.mimeType ?? "application/octet-stream",
      sizeBytes: size !== null && Number.isFinite(size) ? size : null,
      nombre: meta.name ?? driveId,
    };
  } catch (e) {
    console.error("[repositorio/drive] media:", driveId, e);
    return { ok: false, error: clasificar(e) };
  }
}
