// Verificación de LEXIE contra la base real.
//
// Casi todo lo que hace es GRATIS: el saludo y los rangos de fecha son
// funciones puras, y el contexto y el guard de ownership solo tocan Supabase.
// La única llamada paga es UN turno del agente al final (~USD 0,04), y se
// puede saltear con --sin-modelo.
//
// NO escribe nada: no inserta en `ejecuciones` ni en las tablas de LEXIE (que
// además no necesita — runLexie no las toca; las usa la ruta).
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server \
//     --import dotenv/config scripts/verificar-lexie.ts [--sin-modelo]

import { createServerClient } from "../src/lib/supabase/server";
import { cargarDatosLexie, construirContextoModelo } from "../src/lib/lexie/contexto";
import { construirSaludo, franjaHoraria } from "../src/lib/lexie/saludo";
import {
  dictadoPorElAbogado,
  ejecutarToolLexie,
  rangoAFechas,
  type ContextoLexie,
} from "../src/lib/agent/lexie-tools";
import {
  claveAccion,
  emitirPendiente,
  resolverConfirmacion,
} from "../src/lib/lexie/confirmacion";
import {
  jsonCanonico,
  notaAccionesParaModelo,
  pendientesVivas,
  type AccionLexie,
} from "../src/lib/lexie/acciones";
import {
  reconstruirHistorial,
  sembrarPendientes,
  mensajesDelAbogado,
  type MensajeLexie,
} from "../src/lib/lexie/queries";
import { describirUbicacion, lineaDeUbicacion } from "../src/lib/lexie/ubicacion";
import { resolverNombreEntidad } from "../src/lib/lexie/resolver-ubicacion";
import { runLexie } from "../src/lib/agent/run-lexie";
import { LEXIE_SYSTEM_PROMPT } from "../src/lib/agent/lexie-prompt";
import type { ResumenInicio } from "../src/lib/inicio/resumen";

const SIN_MODELO = process.argv.includes("--sin-modelo");
const fallas: string[] = [];
const ok = (t: string) => console.log(`  ok   ${t}`);
const mal = (t: string) => {
  console.log(`  MAL  ${t}`);
  fallas.push(t);
};

/** Contexto de tools mínimo para las pruebas: sin Gmail, sin pendientes. */
function ctxDe(usuarioId: string, nombre: string, over: Partial<ContextoLexie> = {}): ContextoLexie {
  return {
    usuarioId,
    nombre,
    clerkUserId: "user_test",
    gmail: null,
    mensajesAbogado: [],
    casoIdEnPantalla: null,
    accionesPendientes: new Map(),
    clavesConsumidas: new Set(),
    correoLeido: false,
    hilosLeidos: new Set(),
    ...over,
  };
}

function resumenFalso(over: Partial<ResumenInicio> = {}): ResumenInicio {
  return {
    linea: "",
    enVentana: [],
    vencimientos: 0,
    audiencias: 0,
    proximoVencimiento: undefined,
    urgente: false,
    porRol: [],
    ...over,
  };
}

async function main() {
  // ============ 1. Saludo (puro, gratis) ============
  console.log("\n=== 1. Protocolo de saludo ===");
  const franjas: Array<[number, string]> = [
    [6, "manana"],
    [11, "manana"],
    [12, "tarde"],
    [18, "tarde"],
    [19, "noche"],
    [3, "noche"],
  ];
  for (const [h, esperada] of franjas) {
    if (franjaHoraria(h) === esperada) ok(`${h}:00 → ${esperada}`);
    else mal(`${h}:00 dio ${franjaHoraria(h)}, esperaba ${esperada}`);
  }

  // Prioridad 1: urgencia gana sobre todo.
  const enDosHoras = new Date(Date.now() + 2 * 3_600_000).toISOString();
  const conUrgencia = construirSaludo({
    nombre: "Mateo",
    hora: 15,
    resumen: resumenFalso({
      urgente: true,
      enVentana: [
        { id: "1", titulo: "Audiencia Pérez", tipo: "audiencia", fecha_inicio: enDosHoras, todo_el_dia: false },
      ],
    }),
  });
  if (conUrgencia.urgente && conUrgencia.rapport.includes("Audiencia Pérez")) {
    ok(`urgencia priorizada: "${conUrgencia.encabezado} ${conUrgencia.rapport}"`);
  } else {
    mal(`urgencia no priorizada: ${JSON.stringify(conUrgencia)}`);
  }

  // Prioridad 3: sin nada, rapport humano.
  const vacio = construirSaludo({ nombre: "Mateo", hora: 21, resumen: resumenFalso() });
  if (!vacio.urgente && vacio.encabezado.startsWith("Buenas noches")) {
    ok(`sin agenda: "${vacio.encabezado} ${vacio.rapport} ${vacio.cierre}"`);
  } else {
    mal(`saludo vacío inesperado: ${JSON.stringify(vacio)}`);
  }

  // ============ 2. Rangos de fecha (puro, gratis) ============
  console.log("\n=== 2. Rangos de agenda en hora argentina ===");
  for (const r of ["hoy", "manana", "proximos_7_dias", "esta_semana_laboral"] as const) {
    const { desde, hasta, etiqueta } = rangoAFechas(r);
    const bien = desde < hasta && desde.endsWith("-03:00") && hasta.endsWith("-03:00");
    if (bien) ok(`${r} (${etiqueta}): ${desde} → ${hasta}`);
    else mal(`${r} devolvió un rango inválido: ${desde} → ${hasta}`);
  }

  // ============ 3. Usuario real ============
  const supabase = createServerClient();
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("id, nombre")
    .eq("email", "mateomorbi19@gmail.com")
    .maybeSingle();
  if (!usuario) {
    mal("no encontré al usuario de prueba en la base");
    return resultado();
  }
  const usuarioId = usuario.id as string;
  const nombre = usuario.nombre as string;

  // ============ 4. Contexto (base, gratis) ============
  console.log("\n=== 3. Contexto que ve el modelo ===");
  const datos = await cargarDatosLexie(usuarioId, nombre);
  const contexto = construirContextoModelo(datos);
  console.log(`  ${datos.casos.length} causas · ${datos.resumen.enVentana.length} eventos en 7 días`);
  console.log(`  saludo real: "${datos.saludo.encabezado} ${datos.saludo.rapport}"`);
  if (contexto.includes("## Causas") || contexto.includes("## Causas de")) ok("el contexto trae la sección de causas");
  else mal("el contexto NO trae causas");
  if (contexto.includes("Ahora mismo en Argentina son las")) ok("el contexto trae fecha y hora");
  else mal("el contexto NO trae fecha/hora");
  console.log(`  tamaño del contexto: ~${Math.round(contexto.length / 4)} tokens`);

  // ============ 5. EL GUARD DE OWNERSHIP (gratis, y es el importante) ============
  console.log("\n=== 4. Aislamiento entre abogados ===");
  const { data: ajeno } = await supabase
    .from("casos")
    .select("id, usuario_id")
    .neq("usuario_id", usuarioId)
    .limit(1)
    .maybeSingle();

  if (ajeno) {
    const r = await ejecutarToolLexie(
      "leer_caso",
      { caso_id: ajeno.id },
      ctxDe(usuarioId, nombre),
    );
    // El caso existe, pero es de OTRO abogado: la tool tiene que negarlo.
    if (r.contentJSON.includes('"ok":false')) {
      ok(`leer_caso rechazó una causa de otro usuario (${(ajeno.id as string).slice(0, 8)}…)`);
    } else {
      mal("FUGA: leer_caso devolvió el expediente de OTRO abogado");
    }
  } else {
    console.log("  (no hay causas de otros usuarios para probar la fuga)");
  }

  const inventado = await ejecutarToolLexie(
    "leer_caso",
    { caso_id: "11111111-2222-3333-4444-555555555555" },
    ctxDe(usuarioId, nombre),
  );
  if (inventado.contentJSON.includes('"ok":false')) ok("leer_caso rechaza un id inventado");
  else mal("leer_caso aceptó un id inventado");

  // Que el camino feliz siga funcionando (si el usuario tiene causas).
  if (datos.casos.length > 0) {
    const propio = await ejecutarToolLexie(
      "leer_caso",
      { caso_id: datos.casos[0].id },
      ctxDe(usuarioId, nombre),
    );
    if (propio.contentJSON.length > 200 && !propio.contentJSON.includes('"ok":false')) {
      ok(`leer_caso abre una causa propia (${propio.contentJSON.length} chars)`);
    } else {
      mal("leer_caso NO pudo abrir una causa propia");
    }
  }

  // ============ 6. mi_agenda (base, gratis) ============
  const agenda = await ejecutarToolLexie("mi_agenda", { rango: "proximos_7_dias" }, ctxDe(usuarioId, nombre));
  const parsed = JSON.parse(agenda.contentJSON);
  if (typeof parsed.cantidad === "number" && parsed.aviso) {
    ok(`mi_agenda devolvió ${parsed.cantidad} eventos y el aviso de agenda parcial`);
  } else {
    mal("mi_agenda no devolvió el shape esperado");
  }

  // ============ 7. Conciencia de pantalla (puro + base, gratis) ============
  console.log("\n=== 5. En qué pantalla está el abogado ===");
  const unCaso = datos.casos[0]?.id ?? "00000000-0000-0000-0000-000000000000";
  const rutas: Array<[string, string | null]> = [
    ["/", "Inicio"],
    ["/analisis", "Nuevo análisis"],
    ["/dashboard/mis-casos", "Mis casos"],
    [`/dashboard/mis-casos/${unCaso}`, "Mis casos"],
    ["/dashboard/agenda", "Agenda"],
    ["/dashboard/bandeja", "Bandeja de entrada"],
    ["/dashboard/repositorio", "Repositorio"],
    ["/consumo", "Mi consumo"],
    ["/admin", "Admin"],
    // Las tres inmersivas: no están en el menú, así que son las que un mapa
    // basado solo en NAV_ITEMS se perdería.
    [`/dashboard/chat/${unCaso}`, "Chat de la causa"],
    [`/dashboard/mapa-procesal/${unCaso}`, "Mapa procesal"],
    [`/dashboard/simulador/${unCaso}`, "Simulador"],
    // Y las que NO tienen que resolver a nada.
    ["/sign-in", null],
    ["/una/ruta/que/no/existe", null],
  ];
  for (const [ruta, esperada] of rutas) {
    const u = describirUbicacion(ruta);
    const dio = u?.seccion ?? null;
    if (dio === esperada) ok(`${ruta} → ${esperada ?? "(sin ubicación)"}`);
    else mal(`${ruta} dio ${dio ?? "null"}, esperaba ${esperada ?? "null"}`);
  }

  // El guard de propiedad de la línea de pantalla: un pathname con la causa de
  // OTRO abogado no puede devolver su carátula.
  if (ajeno) {
    const u = describirUbicacion(`/dashboard/mis-casos/${ajeno.id}`);
    const nombre = u ? await resolverNombreEntidad(u, usuarioId) : "(sin ubicación)";
    if (nombre === null) ok("la pantalla de una causa ajena no revela su nombre");
    else mal(`FUGA: la línea de pantalla devolvió "${nombre}" de otro abogado`);
  }

  if (datos.casos.length > 0) {
    const u = describirUbicacion(`/dashboard/mis-casos/${datos.casos[0].id}`);
    const nombre = u ? await resolverNombreEntidad(u, usuarioId) : null;
    if (nombre) {
      ok(`la pantalla de una causa propia se nombra: ${lineaDeUbicacion(u!, nombre)}`);
    } else {
      mal("no pude nombrar una causa propia desde su pathname");
    }
  }

  // ============ 7b. Protocolo de confirmación (puro, gratis) ============
  console.log("\n=== 5b. Protocolo de confirmación de acciones ===");
  {
    const payload = { para: ["b@x.com", "a@x.com"], asunto: "Hola", cuerpo: "Texto" };
    const k1 = claveAccion("correo_enviar", payload);
    const k2 = claveAccion("correo_enviar", { cuerpo: "Texto", asunto: "Hola", para: ["b@x.com", "a@x.com"] });
    const k3 = claveAccion("correo_enviar", { ...payload, cuerpo: "Texto." });
    if (k1 === k2) ok(`la clave es canónica (orden de claves irrelevante): ${k1}`);
    else mal("la clave cambia con el orden de las claves del payload");
    if (k1 !== k3) ok("cambiar una coma cambia la clave");
    else mal("una coma no cambia la clave");
    if (jsonCanonico({ b: 1, a: undefined }) === '{"b":1}') ok("jsonCanonico descarta undefined");
    else mal("jsonCanonico no descarta undefined");

    const { accion: pend } = emitirPendiente({
      tool: "correo_enviar",
      clave: k1,
      resumen: "Enviar correo a a@x.com",
      seccion: "bandeja",
      vista_previa: { para: "a@x.com" },
      payload,
    });
    const sinSiembra = ctxDe(usuarioId, nombre);
    const r0 = resolverConfirmacion(sinSiembra, "correo_enviar", payload, {});
    if (r0.modo === "emitir" && r0.clave === k1) ok("primer llamado → emitir con la clave del contenido");
    else mal("primer llamado no emitió");
    const r1 = resolverConfirmacion(sinSiembra, "correo_enviar", payload, { confirmar: true });
    if (r1.modo === "rechazar") ok("confirmar:true sin siembra → rechazo");
    else mal("confirmar:true sin siembra NO se rechazó");
    const r1b = resolverConfirmacion(sinSiembra, "correo_enviar", payload, { clave: k1 });
    if (r1b.modo === "rechazar") ok("clave sin siembra → rechazo");
    else mal("clave sin siembra NO se rechazó");

    const conSiembra = ctxDe(usuarioId, nombre, { accionesPendientes: new Map([[k1, pend]]) });
    const r2 = resolverConfirmacion(conSiembra, "correo_enviar", payload, { confirmar: true });
    if (r2.modo === "ejecutar" && r2.pendiente.clave === k1) ok("con siembra y mismo contenido → ejecutar el payload persistido");
    else mal("con siembra no ejecutó");
    const r3 = resolverConfirmacion(conSiembra, "correo_enviar", { ...payload, cuerpo: "Otro" }, { confirmar: true });
    if (r3.modo === "rechazar") ok("contenido distinto al sembrado → rechazo");
    else mal("contenido distinto NO se rechazó");
    const r4 = resolverConfirmacion(conSiembra, "correo_enviar", { ...payload, cuerpo: "Otro" }, { clave: k1 });
    if (r4.modo === "ejecutar" && r4.pendiente.payload?.cuerpo === "Texto") ok("con clave, se ejecuta lo PERSISTIDO aunque el input nuevo difiera");
    else mal("con clave no se ejecutó lo persistido");
    const r5 = resolverConfirmacion(conSiembra, "agenda_eliminar_evento", payload, { clave: k1 });
    if (r5.modo === "rechazar") ok("una clave de otra tool no sirve");
    else mal("una clave de otra tool fue aceptada");
    conSiembra.clavesConsumidas.add(k1);
    const r6 = resolverConfirmacion(conSiembra, "correo_enviar", payload, { clave: k1 });
    if (r6.modo === "rechazar") ok("clave ya consumida → rechazo");
    else mal("clave consumida fue aceptada");

    // Siembra desde el historial: sólo el ÚLTIMO mensaje del agente, y sólo
    // las pendientes.
    const msg = (tipo: "usuario" | "agente", contenido: string, metadata: Record<string, unknown> = {}): MensajeLexie => ({
      id: contenido, conversacion_id: "c", tipo, contenido, metadata, creado_en: new Date().toISOString(),
    });
    const hechaVieja: AccionLexie = { tool: "agenda_crear_evento", estado: "ok", resumen: "Evento creado" };
    const historial = [
      msg("usuario", "agendá"),
      msg("agente", "listo", { acciones: [hechaVieja, { ...pend, clave: "vieja" }] }),
      msg("usuario", "mandá el mail"),
      msg("agente", "¿confirmás?", { acciones: [pend, hechaVieja], hilos_leidos: ["t1"] }),
      msg("usuario", "Confirmé: x", { origen: "boton" }),
      msg("agente", "Hecho", { origen: "boton", acciones: [{ ...pend, estado: "ok" }, { ...pend, clave: "k9" }] }),
    ];
    const sembradas = sembrarPendientes(historial);
    if (sembradas.length === 1 && sembradas[0].clave === "k9") ok("se siembran sólo las pendientes vivas del último mensaje del agente");
    else mal(`siembra incorrecta: ${JSON.stringify(sembradas.map((a) => a.clave))}`);
    const abogado = mensajesDelAbogado(historial);
    if (abogado.length === 2 && !abogado.includes("Confirmé: x")) ok("los mensajes del botón no cuentan como texto del abogado");
    else mal(`mensajesDelAbogado devolvió ${JSON.stringify(abogado)}`);
    const rec = reconstruirHistorial(historial);
    const conNota = rec.mensajes.filter((m) => m.role === "assistant" && String(m.content).includes("NOTA DEL SISTEMA"));
    if (conNota.length === 3) ok("reconstruirHistorial pega la nota de acciones a los mensajes del agente");
    else mal(`la nota de acciones apareció en ${conNota.length} mensajes, esperaba 3`);
    const nota = notaAccionesParaModelo([pend]) ?? "";
    if (nota.includes(k1) && nota.includes("confirmar: true")) ok("la nota le dice al modelo la clave para confirmar");
    else mal("la nota no trae la clave");
    if (pendientesVivas([pend, hechaVieja]).length === 1) ok("pendientesVivas filtra las hechas");
    else mal("pendientesVivas no filtra");

    // Guard de "dato dictado".
    const c = ctxDe(usuarioId, nombre, { mensajesAbogado: ["Cargale el DNI 30.123.456 a Pérez y la matrícula T° 12 F° 345 CPACF"] });
    if (dictadoPorElAbogado(c, "30123456")) ok("un DNI dictado con puntos se reconoce por sus dígitos");
    else mal("no reconoció el DNI dictado");
    if (dictadoPorElAbogado(c, "Tº 12 Fº 345 CPACF")) ok("la matrícula se reconoce normalizada");
    else mal("no reconoció la matrícula dictada");
    if (!dictadoPorElAbogado(c, "27999888")) ok("un DNI que el abogado no dijo se rechaza");
    else mal("aceptó un DNI no dictado");
  }

  // ============ 8. Un turno real (PAGO) ============
  if (SIN_MODELO) {
    console.log("\n=== 6. Turno del agente: SALTEADO (--sin-modelo) ===");
    return resultado();
  }

  console.log("\n=== 6. Un turno real del agente ===");
  const t0 = Date.now();
  const res = await runLexie({
    pregunta:
      "¿Qué tengo en la agenda esta semana? Y decime en una línea de qué se trata mi causa más reciente.",
    contextoInicial: contexto,
    systemPrompt: LEXIE_SYSTEM_PROMPT,
    modelId: "claude-sonnet-4-5-20250929",
    usuarioId,
    nombre,
    clerkUserId: "user_test",
    gmail: null,
    mensajesAbogado: ["¿Qué tengo en la agenda esta semana?"],
    casoIdEnPantalla: null,
    accionesPendientes: [],
    hilosLeidosPrevios: [],
  });
  const ms = Date.now() - t0;

  console.log(`  iterations        ${res.iterations}`);
  console.log(`  latencia_ms       ${ms}`);
  console.log(`  herramientas      ${res.herramientas_usadas.join(", ") || "(ninguna)"}`);
  console.log(`  usage             in ${res.usage.input_tokens} · out ${res.usage.output_tokens} · cache_w ${res.usage.cache_creation_input_tokens} · cache_r ${res.usage.cache_read_input_tokens}`);
  console.log(`  costo_usd         ${res.costo_usd}`);
  console.log(`\n  --- respuesta ---\n${res.rawText.split("\n").map((l) => "  " + l).join("\n")}\n`);

  if (res.rawText.trim().length > 0) ok("el agente sintetizó una respuesta");
  else mal("respuesta vacía");
  if (res.costo_usd > 0) ok("se contabilizó costo");
  else mal("costo en 0");
  if (res.usage.cache_creation_input_tokens > 0 || res.usage.cache_read_input_tokens > 0) {
    ok("el prompt caching está activo");
  } else {
    mal("no hubo actividad de caché: el prefijo se está pagando entero");
  }

  resultado();
}

function resultado() {
  console.log("\n=== VEREDICTO ===");
  if (fallas.length === 0) {
    console.log("OK — LEXIE responde, respeta el aislamiento entre abogados y cachea el prefijo.");
  } else {
    console.log(`${fallas.length} FALLA(S):`);
    fallas.forEach((f) => console.log("  - " + f));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exitCode = 1;
});
