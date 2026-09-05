// Verificación del servicio de agenda (Fase 11.3) contra la base REAL.
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx --import dotenv/config \
//     scripts/verificar-agenda-servicio.ts
//
// ⚠️ SIN `--conditions=react-server`, a diferencia de los otros verificadores.
// Ese flag es lo que deja pasar `server-only` en un script, pero también hace
// que `react` resuelva al build de servidor (sin `createContext`), y este
// script necesita cargar `@clerk/nextjs/server` de verdad para pedirle el
// token de Google — y Clerk arrastra `next/navigation`, que revienta con ese
// React. Así que acá se neutraliza `server-only` a mano (abajo) y todo lo
// demás se importa EN DIFERIDO, porque un `import` estático se hoistea por
// encima del stub.
//
// Ejercita `src/lib/agenda/servicio.ts` de punta a punta con UN evento de
// prueba del abogado de VERIFICAR_EMAIL (default: el admin): lo crea para
// mañana a las 10:00 hora argentina, lo busca por similitud y por texto, lo
// edita, lo borra y comprueba que no quedó. El borrado va en un `finally`:
// aunque un chequeo tire, el evento de prueba no sobrevive a la corrida.
//
// Cero tokens de Anthropic. Sí puede tocar el Google Calendar del abogado (si
// tiene el scope concedido, el evento se crea y se borra ahí también): es a
// propósito, porque lo que se quiere saber es si el push anda.

import { createRequire } from "node:module";
import type { EventoAgenda } from "@/lib/agenda/types";

// `server-only` tira al evaluarse fuera de un React Server Component. tsx
// transpila los módulos del repo a CommonJS, así que basta con dejarle una
// entrada vacía en `require.cache` ANTES de cargar nada que lo importe.
{
  const req = createRequire(process.cwd() + "/package.json");
  const ruta = req.resolve("server-only");
  req.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: {} } as never;
}

const TITULO = "[prueba servicio] reunión";
const TITULO_EDITADO = "[prueba servicio] reunión editada";
// Un UUID válido que no es de nadie: para probar los rechazos por causa ajena
// y por evento inexistente sin depender de datos de otro abogado.
const UUID_AJENO = "00000000-0000-4000-8000-000000000000";

let fallos = 0;

function ok(msg: string) {
  console.log(`  ✅ ${msg}`);
}
function mal(msg: string) {
  fallos++;
  console.log(`  ❌ ${msg}`);
}
function info(msg: string) {
  console.log(`     ${msg}`);
}
function titulo(t: string) {
  console.log(`\n=== ${t} ===`);
}

// Qué dice la Backend API de Clerk sobre el token de Google, SIN pasar por el
// servicio. Sirve para contrastar: si acá hay token con scope de calendario y
// el servicio dijo `sin_google`, el problema es `clerkClient()` fuera de Next,
// no la cuenta del abogado.
async function tokenSegunClerk(
  clerkUserId: string,
): Promise<{ hayToken: boolean; scopes: string[] }> {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) return { hayToken: false, scopes: [] };
  try {
    const r = await fetch(
      `https://api.clerk.com/v1/users/${clerkUserId}/oauth_access_tokens/google`,
      { headers: { Authorization: `Bearer ${key}` } },
    );
    if (!r.ok) return { hayToken: false, scopes: [] };
    const body = (await r.json()) as unknown;
    const lista = Array.isArray(body)
      ? body
      : ((body as { data?: unknown[] }).data ?? []);
    const entry = lista[0] as { token?: string; scopes?: string[] } | undefined;
    return { hayToken: !!entry?.token, scopes: entry?.scopes ?? [] };
  } catch {
    return { hayToken: false, scopes: [] };
  }
}

async function main() {
  // Imports en diferido: ver la nota del encabezado sobre `server-only`.
  const [{ createServerClient }, { deleteEvento, getEventoById }, servicio, tz] =
    await Promise.all([
      import("@/lib/supabase/server"),
      import("@/lib/agenda/queries"),
      import("@/lib/agenda/servicio"),
      import("@/lib/agenda/tz-ar"),
    ]);
  const {
    buscarEventos,
    crearEventoConSync,
    editarEventoConSync,
    eliminarEventoConSync,
    ErrorServicioAgenda,
    existeEventoSimilar,
  } = servicio;
  const { ahoraPartesAR, partesAIsoAR, sumarDias } = tz;

  const supabase = createServerClient();

  // ---------------------------------------------------------------
  titulo("0. El abogado de la prueba");

  const EMAIL = (process.env.VERIFICAR_EMAIL ?? "mateomorbi19@gmail.com")
    .trim()
    .toLowerCase();

  const { data: yo, error: yoErr } = await supabase
    .from("usuarios")
    .select("id, nombre, email, clerk_user_id")
    .eq("email", EMAIL)
    .maybeSingle();

  if (yoErr || !yo) {
    mal(`No hay ningún usuario con email ${EMAIL}`);
    return;
  }
  const usuario = yo as {
    id: string;
    nombre: string;
    email: string;
    clerk_user_id: string | null;
  };
  if (!usuario.clerk_user_id) {
    mal(`${usuario.nombre} no tiene clerk_user_id: nunca entró a la app`);
    return;
  }
  ok(`${usuario.nombre} (${usuario.email}) — clerk ${usuario.clerk_user_id}`);

  const clerk = await tokenSegunClerk(usuario.clerk_user_id);
  const scopeCalendar = clerk.scopes.some((s) =>
    s.startsWith("https://www.googleapis.com/auth/calendar"),
  );
  info(
    clerk.hayToken
      ? `Clerk tiene token de Google; scope de calendario: ${scopeCalendar ? "SÍ" : "NO"}`
      : "Clerk NO tiene token de Google para este usuario",
  );
  const motivoEsperado = !clerk.hayToken
    ? "sin_google"
    : !scopeCalendar
      ? "sin_scope_calendar"
      : "ok";
  info(`google.motivo esperado en el push: ${motivoEsperado}`);

  // Mañana 10:00 hora argentina, independientemente de la TZ de esta máquina.
  const manana = { ...sumarDias(ahoraPartesAR(), 1), h: 10, mi: 0 };
  const fechaInicio = partesAIsoAR(manana);
  info(`Fecha del evento de prueba: ${fechaInicio}`);

  let creado: EventoAgenda | null = null;
  let borrado = false;

  try {
    // ---------------------------------------------------------------
    titulo("1. crearEventoConSync");

    const r1 = await crearEventoConSync(usuario.id, usuario.clerk_user_id, {
      titulo: TITULO,
      descripcion: "Evento de prueba del verificador del servicio de agenda",
      tipo: "reunion_cliente",
      clase: "evento",
      prioridad: "media",
      fecha_inicio: fechaInicio,
      fecha_fin: null,
      todo_el_dia: false,
      caso_id: null,
      notas: null,
    });
    creado = r1.evento;
    ok(`Creado ${creado.id} — "${creado.titulo}" @ ${creado.fecha_inicio}`);
    info(
      `google: synced=${r1.google.synced} motivo=${r1.google.motivo}` +
        (r1.google.detalle ? ` — ${r1.google.detalle}` : ""),
    );
    if (r1.google.motivo === motivoEsperado) {
      ok(`google.motivo coincide con lo que dice Clerk (${motivoEsperado})`);
    } else if (r1.google.motivo === "error") {
      // Puede ser un rechazo real de Google (token vencido, calendario
      // inexistente): se informa, no es un fallo del servicio.
      info("Google rechazó el push; el servicio lo reportó sin tirar, que es el contrato.");
    } else {
      mal(
        `google.motivo=${r1.google.motivo} pero según Clerk se esperaba ${motivoEsperado}`,
      );
    }
    if (r1.google.synced && !creado.google_calendar_event_id) {
      mal("synced=true pero el evento devuelto no trae google_calendar_event_id");
    }

    // Una causa ajena tiene que rebotar ANTES de escribir nada.
    try {
      await crearEventoConSync(usuario.id, usuario.clerk_user_id, {
        titulo: "[prueba servicio] no debería existir",
        tipo: "otro",
        clase: "tarea",
        prioridad: "baja",
        fecha_inicio: fechaInicio,
        todo_el_dia: true,
        caso_id: UUID_AJENO,
      });
      mal("crear con caso ajeno NO rebotó (quedó un evento de más; se limpia abajo)");
    } catch (e) {
      if (e instanceof ErrorServicioAgenda && e.codigo === "caso_ajeno") {
        ok("crear con caso ajeno rebota con ErrorServicioAgenda(caso_ajeno)");
      } else {
        mal(`crear con caso ajeno tiró otra cosa: ${String(e)}`);
      }
    }

    // ---------------------------------------------------------------
    titulo("2. existeEventoSimilar");

    const s1 = await existeEventoSimilar(usuario.id, {
      titulo: "[PRUEBA SERVICIO] REUNION", // mayúsculas y sin tilde a propósito
      fechaInicioIso: fechaInicio,
    });
    if (s1?.id === creado.id) ok("Lo encuentra con el título normalizado");
    else mal(`No lo encontró por título normalizado (devolvió ${s1?.id ?? "null"})`);

    const s2 = await existeEventoSimilar(usuario.id, {
      titulo: "[prueba servicio] audiencia",
      fechaInicioIso: fechaInicio,
    });
    if (s2 === null) ok("No confunde con otro título");
    else mal(`Devolvió ${s2.id} para un título distinto`);

    const s3 = await existeEventoSimilar(usuario.id, {
      titulo: TITULO,
      fechaInicioIso: partesAIsoAR({ ...manana, h: 11 }),
    });
    if (s3 === null) ok("Misma fecha pero otra hora: no es similar");
    else mal(`Devolvió ${s3.id} para otra hora`);

    const s4 = await existeEventoSimilar(usuario.id, {
      titulo: TITULO,
      fechaInicioIso: fechaInicio,
      casoId: UUID_AJENO,
    });
    if (s4 === null) ok("Mismo título y hora pero con causa: no es similar");
    else mal(`Devolvió ${s4.id} pese a tener causa`);

    const s5 = await existeEventoSimilar(usuario.id, {
      titulo: TITULO,
      fechaInicioIso: partesAIsoAR({ ...manana, h: 0, mi: 0 }),
      todoElDia: true,
    });
    if (s5?.id === creado.id) ok("Un pedido de todo el día en ese mismo día lo encuentra");
    else mal("Un pedido de todo el día no lo encontró");

    // ---------------------------------------------------------------
    titulo("3. editarEventoConSync");

    const e0 = await editarEventoConSync(creado.id, usuario.id, usuario.clerk_user_id, {});
    if (!e0.ok && e0.motivo === "sin_cambios") ok("Sin cambios → sin_cambios");
    else mal(`Sin cambios devolvió ${JSON.stringify(e0)}`);

    const e1 = await editarEventoConSync(UUID_AJENO, usuario.id, usuario.clerk_user_id, {
      titulo: "x",
    });
    if (!e1.ok && e1.motivo === "no_existe") ok("Evento inexistente → no_existe");
    else mal(`Evento inexistente devolvió ${JSON.stringify(e1)}`);

    const e2 = await editarEventoConSync(creado.id, usuario.id, usuario.clerk_user_id, {
      caso_id: UUID_AJENO,
    });
    if (!e2.ok && e2.motivo === "caso_ajeno") ok("Causa ajena → caso_ajeno");
    else mal(`Causa ajena devolvió ${JSON.stringify(e2)}`);

    const e3 = await editarEventoConSync(creado.id, usuario.id, usuario.clerk_user_id, {
      titulo: TITULO_EDITADO,
    });
    if (!e3.ok) {
      mal(`La edición real rebotó: ${e3.motivo}`);
    } else {
      ok(`antes="${e3.antes.titulo}" → despues="${e3.despues.titulo}"`);
      if (e3.antes.titulo !== TITULO) mal("`antes` no trae el título original");
      if (e3.despues.titulo !== TITULO_EDITADO) mal("`despues` no trae el título nuevo");
      if (e3.antes.id !== creado.id || e3.despues.id !== creado.id) mal("antes/despues no son el mismo evento");
      info(
        `google: synced=${e3.google.synced} motivo=${e3.google.motivo}` +
          (e3.google.detalle ? ` — ${e3.google.detalle}` : ""),
      );
      const esperadoEdit = creado.google_calendar_event_id ? motivoEsperado : "no_aplica";
      if (e3.google.motivo === esperadoEdit) ok(`google.motivo de la edición: ${esperadoEdit}`);
      else if (e3.google.motivo === "error") info("Google rechazó el update; reportado sin tirar.");
      else mal(`google.motivo de la edición=${e3.google.motivo}, esperado ${esperadoEdit}`);
      creado = e3.despues;
    }

    // ---------------------------------------------------------------
    titulo("4. buscarEventos");

    const b1 = await buscarEventos(usuario.id, { texto: "PRUEBA servicio editada" });
    if (b1.some((ev) => ev.id === creado?.id)) ok(`Por texto lo encuentra (${b1.length} resultado/s)`);
    else mal("Por texto no lo encontró");

    const b2 = await buscarEventos(usuario.id, { texto: "zzz-no-existe-zzz" });
    if (b2.length === 0) ok("Un texto que no está no devuelve nada");
    else mal(`Devolvió ${b2.length} resultados para un texto inexistente`);

    const b3 = await buscarEventos(usuario.id, {
      texto: "prueba servicio",
      desde: partesAIsoAR({ ...manana, h: 0, mi: 0 }),
      hasta: partesAIsoAR({ ...manana, h: 23, mi: 59 }),
    });
    if (b3.some((ev) => ev.id === creado?.id)) ok("Con rango explícito del día también");
    else mal("Con rango explícito no lo encontró");

    const b4 = await buscarEventos(usuario.id, { texto: "prueba servicio", casoId: UUID_AJENO });
    if (!b4.some((ev) => ev.id === creado?.id)) ok("Filtrado por otra causa lo excluye");
    else mal("Filtrado por otra causa lo siguió devolviendo");

    // ---------------------------------------------------------------
    titulo("5. eliminarEventoConSync (borrar_local)");

    const d0 = await eliminarEventoConSync(UUID_AJENO, usuario.id, usuario.clerk_user_id, {
      siGoogleFalla: "borrar_local",
    });
    if (!d0.ok && d0.motivo === "no_existe") ok("Evento inexistente → no_existe");
    else mal(`Evento inexistente devolvió ${JSON.stringify(d0)}`);

    const d1 = await eliminarEventoConSync(creado.id, usuario.id, usuario.clerk_user_id, {
      siGoogleFalla: "borrar_local",
    });
    if (!d1.ok) {
      mal(`El borrado rebotó: ${d1.motivo}${d1.detalle ? ` — ${d1.detalle}` : ""}`);
    } else {
      borrado = true;
      ok(`Eliminado ${d1.eliminado.id} ("${d1.eliminado.titulo}")`);
      info(
        `google: synced=${d1.google.synced} motivo=${d1.google.motivo}` +
          (d1.google.detalle ? ` — ${d1.google.detalle}` : ""),
      );
      const esperadoDel = creado.google_calendar_event_id ? motivoEsperado : "no_aplica";
      if (d1.google.motivo === esperadoDel) ok(`google.motivo del borrado: ${esperadoDel}`);
      else if (d1.google.motivo === "error") info("Google no pudo borrar; con borrar_local igual se fue de la app.");
      else mal(`google.motivo del borrado=${d1.google.motivo}, esperado ${esperadoDel}`);
    }

    // ---------------------------------------------------------------
    titulo("6. Ya no está");

    const despues = await getEventoById(creado.id, usuario.id);
    if (despues === null) ok("getEventoById devuelve null");
    else {
      mal("El evento sigue en la base");
      borrado = false;
    }
  } finally {
    // Limpieza defensiva: si algo tiró antes del paso 5, el evento de prueba
    // no puede quedar en la agenda del abogado (ni en su Google).
    if (creado && !borrado) {
      try {
        const r = await eliminarEventoConSync(creado.id, usuario.id, usuario.clerk_user_id, {
          siGoogleFalla: "borrar_local",
        });
        info(`Limpieza: ${r.ok ? "evento de prueba borrado" : `no se pudo borrar (${r.motivo})`}`);
      } catch (e) {
        info(`Limpieza por el servicio falló (${String(e)}); borrando directo de la base`);
        await deleteEvento(creado.id, usuario.id).catch(() => null);
      }
    }
    // Y cualquier resto de una corrida anterior o del chequeo de causa ajena.
    const { data: restos } = await supabase
      .from("eventos_agenda")
      .select("id")
      .eq("usuario_id", usuario.id)
      .like("titulo", "[prueba servicio]%");
    for (const r of (restos ?? []) as { id: string }[]) {
      await deleteEvento(r.id, usuario.id).catch(() => null);
      info(`Limpieza: resto ${r.id} borrado`);
    }
  }

  console.log("");
}

// El código de salida se setea en `finally` y se deja que el proceso termine
// solo: `process.exit()` en medio del flujo aborta libuv en Windows y tapa el
// error real (mismo criterio que verificar-ficha-causa.ts).
main()
  .catch((e) => {
    console.error("\n❌ El verificador se cayó:", e);
    fallos++;
  })
  .finally(() => {
    console.log("=== Resultado ===");
    if (fallos === 0) {
      console.log("  Todo en orden. El servicio de agenda está listo para LEXIE.\n");
    } else {
      console.log(`  ${fallos} verificación(es) fallaron.\n`);
    }
    process.exitCode = fallos > 0 ? 1 : 0;
  });
