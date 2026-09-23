// Diagnóstico de «LEXIE dice que lo hizo, pero no lo hizo».
//
// Read-only: no escribe una sola fila y no llama al modelo (cero tokens).
//
// Contesta UNA pregunta, que es la que separa las dos causas posibles de ese
// síntoma:
//
//   (a) el modelo NUNCA llamó la tool y narró el resultado igual. Puede
//       hacerlo: el system prompt le dicta la redacción exacta («queda para el
//       martes 10/09 a las 10:00», «sincronizado con tu Google Calendar»,
//       «lo ves en Agenda»), así que la prosa no prueba nada; o
//   (b) la tool SÍ se ejecutó y falló, tiró una excepción que el motor
//       convirtió en tool_result de error, o cayó en uno de los caminos que no
//       emiten acción (causa ajena, evento inexistente).
//
// La evidencia está en `ejecuciones.metadata`: la ruta persiste ahí
// `herramientas_usadas` (las tools REALMENTE despachadas por el motor) y
// `acciones` (lo que armó el SERVIDOR desde esas tool calls; el modelo nunca
// las emite). Si un turno que pedía agendar no tiene ninguna tool de escritura,
// es (a) y no hay nada roto en la app. Si la tiene, es (b) y el error sale acá.
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server \
//     --import dotenv/config scripts/diagnostico-lexie.ts [--usuario gonzalo] [--n 8] [--horas 48]

import { createServerClient } from "../src/lib/supabase/server";
import { DOMINIOS_LEXIE } from "../src/lib/lexie/ejecutar-accion";
import type { ContextoLexie } from "../src/lib/agent/lexie-tools";
import { accionLexieSchema } from "../src/lib/schemas";

// --- args -------------------------------------------------------------------

const argv = process.argv.slice(2);
const arg = (n: string, def: string) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const FILTRO = arg("--usuario", "").toLowerCase();
const N = Number(arg("--n", "8"));
const HORAS = Number(arg("--horas", "48"));

const supabase = createServerClient();

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const corto = (s: unknown, n = 90) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// --- qué tool pertenece a qué familia, y cuáles ESCRIBEN --------------------
//
// Se deriva de los dominios y no de una lista a mano: si mañana un dominio suma
// una tool, este diagnóstico la clasifica solo.

const ctxFalso = {
  usuarioId: "-",
  nombre: "-",
  clerkUserId: "-",
  gmail: null,
  mensajesAbogado: [],
  casoIdEnPantalla: null,
  accionesPendientes: new Map(),
  clavesConsumidas: new Set(),
  correoLeido: false,
  hilosLeidos: new Set(),
} as unknown as ContextoLexie;

const familiaDeTool = new Map<string, string>();
for (const d of DOMINIOS_LEXIE) {
  for (const f of d.familias(ctxFalso)) {
    for (const t of f.tools) familiaDeTool.set(t.name, f.nombre);
  }
}

/** Escriben todas las familias de dominio que no son de lectura pura. */
const esEscritura = (tool: string): boolean => {
  const f = familiaDeTool.get(tool);
  return !!f && !f.endsWith("_lectura");
};

// --- 1. usuarios ------------------------------------------------------------

type Usuario = {
  id: string;
  nombre: string;
  email: string;
  clerk_user_id: string | null;
  role: string;
};

async function usuarios(): Promise<Usuario[]> {
  const { data, error } = await supabase
    .from("usuarios")
    .select("id, nombre, email, clerk_user_id, role")
    .order("nombre");
  if (error) throw new Error(`usuarios: ${error.message}`);
  return (data ?? []) as Usuario[];
}

// --- 2. la conversación abierta --------------------------------------------

async function conversacion(u: Usuario) {
  const { data: convs, error } = await supabase
    .from("conversaciones_lexie")
    .select("id, titulo, creado_en, actualizado_en")
    .eq("usuario_id", u.id)
    .eq("archivada", false)
    .order("actualizado_en", { ascending: false });
  if (error) throw new Error(`conversaciones_lexie: ${error.message}`);

  if (!convs || convs.length === 0) {
    console.log("\n  Conversación activa: ninguna (el próximo GET abre una).");
    return;
  }
  if (convs.length > 1) {
    console.log(`\n  !! ${convs.length} conversaciones activas (debería haber una sola).`);
  }
  const conv = convs[0];
  const { count } = await supabase
    .from("mensajes_lexie")
    .select("id", { count: "exact", head: true })
    .eq("conversacion_id", conv.id);
  console.log(
    `\n  Conversación activa: ${count ?? "?"} mensajes · abierta ${fmt(
      conv.creado_en as string,
    )} · último movimiento ${fmt(conv.actualizado_en as string)}`,
  );
}

// --- 3. los últimos turnos de LEXIE ----------------------------------------

async function ejecucionesLexie(u: Usuario) {
  const { data, error } = await supabase
    .from("ejecuciones")
    .select("id, modelo, latencia_ms, ejecutado_en, metadata")
    .eq("usuario_id", u.id)
    .eq("tipo", "lexie")
    .order("ejecutado_en", { ascending: false })
    .limit(N);
  if (error) throw new Error(`ejecuciones: ${error.message}`);

  console.log(`\n  Últimos ${N} turnos de LEXIE`);
  if (!data || data.length === 0) {
    console.log("    (ninguno: este abogado nunca completó un turno de LEXIE)");
    return;
  }

  for (const e of data) {
    const m = (e.metadata ?? {}) as Record<string, unknown>;
    const tools = Array.isArray(m.herramientas_usadas)
      ? (m.herramientas_usadas as string[])
      : [];
    const acciones = Array.isArray(m.acciones) ? (m.acciones as unknown[]) : [];
    const escrituras = tools.filter(esEscritura);

    console.log(
      `\n    ${fmt(e.ejecutado_en as string)}  ${e.modelo}  ${e.latencia_ms ?? "—"} ms`,
    );
    console.log(`      pregunta : ${corto(m.pregunta, 110)}`);
    if (m.error_code) {
      console.log(`      ERROR    : ${m.error_code} — ${corto(m.error_message, 110)}`);
    }
    console.log(`      tools    : ${tools.length > 0 ? tools.join(", ") : "(NINGUNA)"}`);
    console.log(`      acciones : ${acciones.length > 0 ? acciones.length : "(NINGUNA)"}`);

    for (const a of acciones) {
      // Se valida con el MISMO schema que usa la ventana: una acción que no
      // parsea no pinta tarjeta, y eso también explicaría «no pasó nada».
      const p = accionLexieSchema.safeParse(a);
      if (!p.success) {
        console.log(
          `        !! acción que la tarjeta descarta por inválida: ${corto(JSON.stringify(a), 110)}`,
        );
        continue;
      }
      const v = p.data as {
        tool: string;
        estado: string;
        resumen: string;
        error?: string;
        motivo?: string;
      };
      const cola = v.error
        ? ` · error: ${corto(v.error, 70)}`
        : v.motivo
          ? ` · ${corto(v.motivo, 70)}`
          : "";
      console.log(`        [${v.estado}] ${v.tool} — ${corto(v.resumen, 70)}${cola}`);
    }

    if (escrituras.length === 0 && acciones.length === 0) {
      console.log(
        "      >> No llamó ninguna tool de escritura y no dejó acciones: si en este turno dijo que hizo algo, LO INVENTÓ.",
      );
    } else if (escrituras.length > 0 && acciones.length === 0) {
      console.log(
        "      >> Llamó una tool de escritura pero no quedó acción: tiró excepción (mirá los logs del server) o cayó en un camino sin acción (causa o evento ajeno).",
      );
    }
  }
}

// --- 4. lo que efectivamente quedó en la base -------------------------------

async function eventosRecientes(u: Usuario) {
  const desde = new Date(Date.now() - HORAS * 3600_000).toISOString();
  const { data, error } = await supabase
    .from("eventos_agenda")
    .select(
      "id, titulo, clase, tipo, fecha_inicio, caso_id, google_calendar_event_id, created_at",
    )
    .eq("usuario_id", u.id)
    .gte("created_at", desde)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`eventos_agenda: ${error.message}`);

  console.log(`\n  Eventos y tareas creados en las últimas ${HORAS} h`);
  if (!data || data.length === 0) {
    console.log("    (ninguno)");
    return;
  }
  for (const ev of data) {
    console.log(
      `    ${fmt(ev.created_at as string)}  ${ev.clase}/${ev.tipo}  «${corto(ev.titulo, 50)}»` +
        `  inicio ${fmt(ev.fecha_inicio as string)}` +
        `  causa ${ev.caso_id ? "sí" : "NO"}` +
        `  google ${ev.google_calendar_event_id ? "sí" : "NO"}`,
    );
  }
}

// --- main -------------------------------------------------------------------

async function main() {
  console.log("Diagnóstico de LEXIE (read-only)\n");

  const todos = await usuarios();
  console.log("Usuarios en la whitelist:");
  for (const u of todos) {
    console.log(
      `  ${u.nombre.padEnd(10)} ${u.email.padEnd(38)} role=${u.role.padEnd(5)} ` +
        `clerk_user_id=${u.clerk_user_id ? "seteado" : "NULL (nunca entró, o el lazy-sync no corrió)"}`,
    );
  }

  const objetivo = FILTRO
    ? todos.filter(
        (u) =>
          u.nombre.toLowerCase().includes(FILTRO) ||
          u.email.toLowerCase().includes(FILTRO),
      )
    : todos;
  if (objetivo.length === 0) {
    console.log(`\nNingún usuario matchea «${FILTRO}».`);
    return;
  }

  for (const u of objetivo) {
    console.log(`\n${"=".repeat(78)}\n${u.nombre} <${u.email}>`);
    await conversacion(u);
    await ejecucionesLexie(u);
    await eventosRecientes(u);
  }

  console.log(
    "\nCómo leerlo, en el turno donde LEXIE dijo «listo, agendé»:\n" +
      "  · tools sin ninguna de escritura → el modelo lo inventó. No hay bug de la app: es prompt/modelo.\n" +
      "  · agenda_crear_evento + acción [ok] → el evento existe; el problema está en la vista (filtros de la Agenda o refresco).\n" +
      "  · agenda_crear_evento sin acción, o acción [error] → falló el servidor, y el motivo está arriba.\n",
  );
}

main().catch((e) => {
  console.error("\nDiagnóstico cortado:", e instanceof Error ? e.message : e);
  process.exit(1);
});
