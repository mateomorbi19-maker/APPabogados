import "server-only";
import { normalizar } from "@/lib/casos/buscar";
import {
  casoEsDelUsuario,
  createEvento,
  deleteEvento,
  getEventoById,
  getEventosByUser,
  setGoogleUpdated,
  updateEvento,
  updateGoogleEventId,
  type ActualizarEventoData,
} from "./queries";
import {
  ahoraPartesAR,
  isoAPartesAR,
  partesAIsoAR,
  sumarDias,
  type PartesFecha,
} from "./tz-ar";
import type {
  EventoAgenda,
  EventoAgendaInsert,
  EventoAgendaUpdate,
} from "./types";

// Servicio de agenda: la orquestación "local + Google" que hasta la Fase 11
// vivía inline en los handlers de /api/agenda/eventos. Se extrajo para que
// las tools de LEXIE y las rutas HTTP ejecuten EXACTAMENTE el mismo código —
// si LEXIE crea un evento, tiene que pushearlo a Google, normalizar la tarea y
// validar la causa igual que el formulario, no con una copia que diverja.
//
// Reglas que valen para todo el módulo:
//   - `usuarioId` y `clerkUserId` vienen del contexto del servidor, nunca de
//     un input del modelo. El `.eq("usuario_id", …)` está DENTRO de cada
//     UPDATE/DELETE (en queries.ts); acá además se valida la causa asociada.
//   - El CRUD local manda. Google es best-effort: nada de lo que falle contra
//     Google tira, se informa en `google.motivo` y el caller decide.
//   - Las funciones NO saben de HTTP: devuelven resultados discriminados y las
//     rutas los traducen a los códigos que ya tenían.

// === Resultado del lado Google ===

export type MotivoGoogle =
  | "ok"
  // No corresponde tocar Google: es una tarea (las tareas son locales) o el
  // evento nunca se sincronizó (sin google_calendar_event_id).
  | "no_aplica"
  // El usuario no tiene Google vinculado en Clerk (o la Backend API falló).
  | "sin_google"
  // Hay Google, pero sin el scope de calendario (inició sesión antes de que
  // se agregara el scope). Se distingue de `sin_google` porque el remedio es
  // otro: volver a entrar con Google, no vincular una cuenta.
  | "sin_scope_calendar"
  | "error";

export type ResultadoGoogle = {
  synced: boolean;
  motivo: MotivoGoogle;
  detalle?: string;
};

// === Errores ===

// Qué paso del servicio falló. Existe para que las rutas sigan respondiendo
// el mismo texto que antes de la extracción ("Error validando caso" vs "Error
// creando evento") y para que LEXIE pueda decir qué fue lo que no anduvo.
export type PasoServicioAgenda =
  | "caso_ajeno"
  | "validar_caso"
  | "crear"
  | "leer"
  | "actualizar"
  | "eliminar";

export class ErrorServicioAgenda extends Error {
  readonly codigo: PasoServicioAgenda;

  constructor(codigo: PasoServicioAgenda, causa?: unknown) {
    super(
      codigo === "caso_ajeno"
        ? "El caso no existe o no es del usuario"
        : causa instanceof Error
          ? causa.message
          : String(causa ?? codigo),
    );
    this.name = "ErrorServicioAgenda";
    this.codigo = codigo;
  }
}

// Envuelve una query para etiquetar de qué paso vino el fallo.
async function paso<T>(
  codigo: Exclude<PasoServicioAgenda, "caso_ajeno">,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new ErrorServicioAgenda(codigo, e);
  }
}

// === Cliente de Google, cargado en diferido ===

// `google-calendar.ts` y `google/token.ts` importan `@clerk/nextjs/server`,
// que a su vez arrastra `next/navigation` y necesita el React de cliente. Eso
// hace que cualquier módulo que los importe estáticamente NO PUEDA CARGARSE
// en los scripts de verificación (`tsx --conditions=react-server`, que es el
// único modo en que `server-only` deja pasar). Las tools de LEXIE van a
// importar este servicio, y `verificar-lexie.ts` corre así.
//
// Por eso Google se carga recién cuando hace falta hablarle. En el server de
// Next el `import()` es un chunk más; en un script sin runtime de Next, si la
// carga falla se degrada a `sin_google` con el error en el log — coherente con
// "Google es best-effort" — en vez de reventar después de haber escrito en la
// base.
type ModulosGoogle = {
  token: typeof import("@/lib/google/token");
  calendar: typeof import("./google-calendar");
};

async function cargarGoogle(): Promise<ModulosGoogle | null> {
  try {
    const [token, calendar] = await Promise.all([
      import("@/lib/google/token"),
      import("./google-calendar"),
    ]);
    return { token, calendar };
  } catch (e) {
    console.error("[agenda/servicio] no se pudo cargar el cliente de Google:", e);
    return null;
  }
}

// Mismo criterio de prefijo que `getGoogleAccessToken` de google-calendar.ts
// (cubre `calendar` y `calendar.events`). No se reusa esa función porque
// colapsa "sin Google" y "sin scope" en un mismo null, y acá hace falta
// distinguirlos.
const SCOPES_CALENDAR = ["https://www.googleapis.com/auth/calendar"] as const;

type TokenCalendar =
  | { token: string; calendar: ModulosGoogle["calendar"] }
  | { token: null; motivo: "sin_google" | "sin_scope_calendar" };

async function tokenCalendar(clerkUserId: string): Promise<TokenCalendar> {
  const g = await cargarGoogle();
  if (!g) return { token: null, motivo: "sin_google" };
  const t = await g.token.getTokenGoogle(clerkUserId);
  if (!t) return { token: null, motivo: "sin_google" };
  if (!g.token.tieneScope(t.scopes, SCOPES_CALENDAR)) {
    return { token: null, motivo: "sin_scope_calendar" };
  }
  return { token: t.token, calendar: g.calendar };
}

// === Validación de la causa asociada ===

// Un `caso_id` que venga del formulario o del modelo tiene que ser del
// abogado. Se valida acá y no sólo en la ruta porque LEXIE llama al servicio
// directo, y abajo no hay red: el server entra con service_role.
async function exigirCasoPropio(
  casoId: string,
  usuarioId: string,
): Promise<void> {
  const pertenece = await paso("validar_caso", () =>
    casoEsDelUsuario(casoId, usuarioId),
  );
  if (!pertenece) throw new ErrorServicioAgenda("caso_ajeno");
}

// === Crear ===

export type ResultadoCrearEvento = {
  evento: EventoAgenda;
  google: ResultadoGoogle;
};

/**
 * Crea el evento y lo pushea a Google (sólo si es un EVENTO: las tareas son
 * locales). Tira `ErrorServicioAgenda` con `codigo: "caso_ajeno"` si la causa
 * no es del usuario, o con el paso que falló ante un error de la base.
 */
export async function crearEventoConSync(
  usuarioId: string,
  clerkUserId: string,
  data: EventoAgendaInsert,
): Promise<ResultadoCrearEvento> {
  if (data.caso_id) await exigirCasoPropio(data.caso_id, usuarioId);

  // Una tarea es un to-do por fecha: sin hora (todo_el_dia) y sin fin. Se
  // normaliza server-side para no depender sólo de que el form mande bien.
  const esTarea = data.clase === "tarea";

  let evento = await paso("crear", () =>
    createEvento({
      usuario_id: usuarioId,
      titulo: data.titulo,
      descripcion: data.descripcion ?? null,
      tipo: data.tipo,
      clase: data.clase,
      prioridad: data.prioridad,
      fecha_inicio: data.fecha_inicio,
      fecha_fin: esTarea ? null : (data.fecha_fin ?? null),
      todo_el_dia: esTarea ? true : data.todo_el_dia,
      caso_id: data.caso_id ?? null,
      notas: esTarea ? null : (data.notas ?? null),
    }),
  );

  if (esTarea) return { evento, google: { synced: false, motivo: "no_aplica" } };

  // Push best-effort. Cualquier fallo se informa y se sigue: el evento ya
  // está creado en Supabase.
  const tk = await tokenCalendar(clerkUserId);
  if (tk.token === null) return { evento, google: { synced: false, motivo: tk.motivo } };

  try {
    const r = await tk.calendar.pushEventToGoogle(tk.token, evento);
    if (!r.id) {
      return {
        evento,
        google: {
          synced: false,
          motivo: "error",
          detalle: r.error ?? "Google no devolvió el id del evento",
        },
      };
    }
    // Se guarda también r.updated: el control de conflicto del pull lo usa
    // para no re-aplicar este cambio cuando vuelva desde Google.
    await updateGoogleEventId(evento.id, usuarioId, r.id, r.updated);
    evento = {
      ...evento,
      google_calendar_event_id: r.id,
      google_updated: r.updated,
    };
    return { evento, google: { synced: true, motivo: "ok" } };
  } catch (e) {
    // Típicamente: el evento se creó en Google pero no se pudo guardar el id
    // local. Queda como pendiente y el próximo sync lo reintenta.
    console.error("[agenda/servicio] push google (no bloqueante):", e);
    return {
      evento,
      google: {
        synced: false,
        motivo: "error",
        detalle: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

// === Editar ===

export type ResultadoEditarEvento =
  | {
      ok: true;
      antes: EventoAgenda;
      despues: EventoAgenda;
      google: ResultadoGoogle;
    }
  | {
      ok: false;
      motivo: "no_existe" | "caso_ajeno" | "sin_cambios";
    };

/**
 * Edición parcial. Lee primero la fila (valida propiedad y trae el ANTES),
 * re-normaliza si es una tarea y actualiza con el filtro de usuario dentro
 * del UPDATE. Si el evento ya estaba en Google, refleja el cambio ahí.
 *
 * Tira `ErrorServicioAgenda` sólo ante errores de la base; los rechazos
 * esperables (no existe, causa ajena, nada para cambiar) vuelven en `ok: false`.
 */
export async function editarEventoConSync(
  eventoId: string,
  usuarioId: string,
  clerkUserId: string,
  cambios: EventoAgendaUpdate,
): Promise<ResultadoEditarEvento> {
  // Sólo las keys efectivamente presentes entran al patch (evita pisar
  // columnas con undefined/null no enviados). `clase` es inmutable tras la
  // creación: no se copia a propósito.
  const patch: ActualizarEventoData = {};
  if (cambios.titulo !== undefined) patch.titulo = cambios.titulo;
  if (cambios.descripcion !== undefined) patch.descripcion = cambios.descripcion ?? null;
  if (cambios.tipo !== undefined) patch.tipo = cambios.tipo;
  if (cambios.prioridad !== undefined) patch.prioridad = cambios.prioridad;
  if (cambios.fecha_inicio !== undefined) patch.fecha_inicio = cambios.fecha_inicio;
  if (cambios.fecha_fin !== undefined) patch.fecha_fin = cambios.fecha_fin ?? null;
  if (cambios.todo_el_dia !== undefined) patch.todo_el_dia = cambios.todo_el_dia;
  if (cambios.caso_id !== undefined) patch.caso_id = cambios.caso_id ?? null;
  if (cambios.notas !== undefined) patch.notas = cambios.notas ?? null;
  if (cambios.completado !== undefined) patch.completado = cambios.completado;

  if (Object.keys(patch).length === 0) return { ok: false, motivo: "sin_cambios" };

  // Si se asocia/reasocia a una causa (no-null), tiene que ser del usuario.
  const casoNuevo = patch.caso_id;
  if (casoNuevo) {
    const pertenece = await paso("validar_caso", () =>
      casoEsDelUsuario(casoNuevo, usuarioId),
    );
    if (!pertenece) return { ok: false, motivo: "caso_ajeno" };
  }

  const antes = await paso("leer", () => getEventoById(eventoId, usuarioId));
  if (!antes) return { ok: false, motivo: "no_existe" };

  // Una tarea sigue siendo un to-do sin hora y sin fin aunque el patch diga
  // otra cosa: se re-normaliza con la clase LEÍDA de la fila (el input no
  // trae clase, y si la trajera no habría que creerle).
  if (antes.clase === "tarea") {
    if (patch.fecha_fin !== undefined) patch.fecha_fin = null;
    if (patch.todo_el_dia !== undefined) patch.todo_el_dia = true;
    if (patch.notas !== undefined) patch.notas = null;
  }

  let despues = await paso("actualizar", () =>
    updateEvento(eventoId, usuarioId, patch),
  );
  // Se borró entre la lectura y el UPDATE.
  if (!despues) return { ok: false, motivo: "no_existe" };

  if (!despues.google_calendar_event_id) {
    return { ok: true, antes, despues, google: { synced: false, motivo: "no_aplica" } };
  }

  const tk = await tokenCalendar(clerkUserId);
  if (tk.token === null) {
    return { ok: true, antes, despues, google: { synced: false, motivo: tk.motivo } };
  }

  try {
    const r = await tk.calendar.updateEventInGoogle(
      tk.token,
      despues.google_calendar_event_id,
      despues,
    );
    if (!r.ok) {
      return {
        ok: true,
        antes,
        despues,
        google: {
          synced: false,
          motivo: "error",
          detalle: "Google no aceptó la actualización (ver el log del servidor)",
        },
      };
    }
    // Se guarda el nuevo `updated` para que el pull no re-aplique este cambio
    // (que originó la propia app) cuando vuelva desde Google.
    if (r.updated) {
      await setGoogleUpdated(despues.id, usuarioId, r.updated);
      despues = { ...despues, google_updated: r.updated };
    }
    return { ok: true, antes, despues, google: { synced: true, motivo: "ok" } };
  } catch (e) {
    console.error("[agenda/servicio] update google (no bloqueante):", e);
    return {
      ok: true,
      antes,
      despues,
      google: {
        synced: false,
        motivo: "error",
        detalle: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

// === Eliminar ===

export type OpcionesEliminarEvento = {
  // Qué hacer si el evento está en Google y Google NO lo pudo borrar:
  //   - "borrar_local": se borra igual en la app (lo que siempre hizo la ruta
  //     DELETE; el evento huérfano queda en Google hasta que alguien lo saque).
  //   - "abortar": no se toca la base. Es la opción para LEXIE, que no tiene
  //     cómo avisarle al abogado que quedó un evento fantasma en el celular.
  // Un 404/410 de Google NO es un fallo: el evento ya no estaba.
  siGoogleFalla: "borrar_local" | "abortar";
};

export type ResultadoEliminarEvento =
  | { ok: true; eliminado: EventoAgenda; google: ResultadoGoogle }
  | {
      ok: false;
      motivo: "no_existe" | "google_fallo";
      evento?: EventoAgenda;
      detalle?: string;
    };

/**
 * Borra el evento. Google PRIMERO (si estaba sincronizado y hay token) y la
 * base después: así, con `abortar`, un fallo de Google deja todo como estaba.
 */
export async function eliminarEventoConSync(
  eventoId: string,
  usuarioId: string,
  clerkUserId: string,
  opts: OpcionesEliminarEvento,
): Promise<ResultadoEliminarEvento> {
  const evento = await paso("leer", () => getEventoById(eventoId, usuarioId));
  if (!evento) return { ok: false, motivo: "no_existe" };

  let google: ResultadoGoogle = { synced: false, motivo: "no_aplica" };

  if (evento.google_calendar_event_id) {
    const tk = await tokenCalendar(clerkUserId);
    if (tk.token === null) {
      google = { synced: false, motivo: tk.motivo };
    } else {
      const r = await tk.calendar.deleteEventFromGoogle(
        tk.token,
        evento.google_calendar_event_id,
      );
      if (r === "ok") {
        google = { synced: true, motivo: "ok" };
      } else if (r === "no_existia") {
        google = {
          synced: true,
          motivo: "ok",
          detalle: "Ya no existía en Google (borrado desde otro dispositivo)",
        };
      } else {
        const detalle = "Google no pudo borrar el evento (ver el log del servidor)";
        if (opts.siGoogleFalla === "abortar") {
          return { ok: false, motivo: "google_fallo", evento, detalle };
        }
        google = { synced: false, motivo: "error", detalle };
      }
    }
  }

  const eliminado = await paso("eliminar", () =>
    deleteEvento(eventoId, usuarioId),
  );
  // Se borró entre la lectura y el DELETE.
  if (!eliminado) return { ok: false, motivo: "no_existe" };

  // `deleteEvento` devuelve la fila sin el join; el nombre de la causa ya lo
  // teníamos de la lectura inicial.
  return {
    ok: true,
    eliminado: { ...eliminado, nombre_caso: evento.nombre_caso ?? null },
    google,
  };
}

// === Dedupe para LEXIE ===

function inicioDelDia(p: PartesFecha): PartesFecha {
  return { ...p, h: 0, mi: 0 };
}
function finDelDia(p: PartesFecha): PartesFecha {
  return { ...p, h: 23, mi: 59 };
}

function tituloNormalizado(s: string): string {
  return normalizar(s).trim().replace(/\s+/g, " ");
}

export type CriterioEventoSimilar = {
  titulo: string;
  fechaInicioIso: string;
  casoId?: string | null;
  // Si el evento que se quiere crear es de todo el día, la hora del ISO no
  // significa nada y no se compara.
  todoElDia?: boolean;
};

/**
 * ¿Ya existe un evento "igual"? Mismo título normalizado (minúsculas, sin
 * tildes, espacios colapsados), mismo día del abogado en hora argentina,
 * misma causa (o ambos sin causa) y, si los dos tienen hora, la misma hora.
 *
 * Es el dedupe de LEXIE: "agendame la audiencia de Pérez el lunes a las 10"
 * dicho dos veces en el mismo hilo no tiene que crear dos audiencias.
 */
export async function existeEventoSimilar(
  usuarioId: string,
  criterio: CriterioEventoSimilar,
): Promise<EventoAgenda | null> {
  const partes = isoAPartesAR(criterio.fechaInicioIso);
  const candidatos = await getEventosByUser(usuarioId, {
    desde: partesAIsoAR(inicioDelDia(partes)),
    hasta: partesAIsoAR(finDelDia(partes)),
  });

  const titulo = tituloNormalizado(criterio.titulo);
  const casoId = criterio.casoId ?? null;

  for (const ev of candidatos) {
    if (tituloNormalizado(ev.titulo) !== titulo) continue;
    if ((ev.caso_id ?? null) !== casoId) continue;
    if (!criterio.todoElDia && !ev.todo_el_dia) {
      const p = isoAPartesAR(ev.fecha_inicio);
      if (p.h !== partes.h || p.mi !== partes.mi) continue;
    }
    return ev;
  }
  return null;
}

// === Búsqueda para LEXIE ===

const RADIO_BUSQUEDA_DIAS = 60;

export type FiltrosBuscarEventos = {
  texto?: string | null;
  desde?: string | null; // ISO; filtra fecha_inicio >= desde
  hasta?: string | null; // ISO; filtra fecha_inicio <= hasta
  casoId?: string | null;
};

/**
 * Lista eventos del abogado con match en memoria sobre título y descripción
 * (normalizados; cada palabra del texto tiene que aparecer). Sin rango, mira
 * ±60 días alrededor de hoy en hora argentina: lo que LEXIE necesita para
 * "movéme la reunión con Pérez" sin que el abogado diga la fecha.
 */
export async function buscarEventos(
  usuarioId: string,
  filtros: FiltrosBuscarEventos = {},
): Promise<EventoAgenda[]> {
  const hoy = inicioDelDia(ahoraPartesAR());
  const desde =
    filtros.desde ?? partesAIsoAR(sumarDias(hoy, -RADIO_BUSQUEDA_DIAS));
  const hasta =
    filtros.hasta ?? partesAIsoAR(finDelDia(sumarDias(hoy, RADIO_BUSQUEDA_DIAS)));

  const eventos = await getEventosByUser(usuarioId, {
    desde,
    hasta,
    caso_id: filtros.casoId ?? null,
  });

  const palabras = normalizar(filtros.texto ?? "")
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (palabras.length === 0) return eventos;

  return eventos.filter((ev) => {
    const texto = normalizar(`${ev.titulo} ${ev.descripcion ?? ""}`);
    return palabras.every((w) => texto.includes(w));
  });
}
