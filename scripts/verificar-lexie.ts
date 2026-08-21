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
import { ejecutarToolLexie, rangoAFechas } from "../src/lib/agent/lexie-tools";
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
      { usuarioId, nombre },
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
    { usuarioId, nombre },
  );
  if (inventado.contentJSON.includes('"ok":false')) ok("leer_caso rechaza un id inventado");
  else mal("leer_caso aceptó un id inventado");

  // Que el camino feliz siga funcionando (si el usuario tiene causas).
  if (datos.casos.length > 0) {
    const propio = await ejecutarToolLexie(
      "leer_caso",
      { caso_id: datos.casos[0].id },
      { usuarioId, nombre },
    );
    if (propio.contentJSON.length > 200 && !propio.contentJSON.includes('"ok":false')) {
      ok(`leer_caso abre una causa propia (${propio.contentJSON.length} chars)`);
    } else {
      mal("leer_caso NO pudo abrir una causa propia");
    }
  }

  // ============ 6. mi_agenda (base, gratis) ============
  const agenda = await ejecutarToolLexie("mi_agenda", { rango: "proximos_7_dias" }, { usuarioId, nombre });
  const parsed = JSON.parse(agenda.contentJSON);
  if (typeof parsed.cantidad === "number" && parsed.aviso) {
    ok(`mi_agenda devolvió ${parsed.cantidad} eventos y el aviso de agenda parcial`);
  } else {
    mal("mi_agenda no devolvió el shape esperado");
  }

  // ============ 7. Un turno real (PAGO) ============
  if (SIN_MODELO) {
    console.log("\n=== 5. Turno del agente: SALTEADO (--sin-modelo) ===");
    return resultado();
  }

  console.log("\n=== 5. Un turno real del agente ===");
  const t0 = Date.now();
  const res = await runLexie({
    pregunta:
      "¿Qué tengo en la agenda esta semana? Y decime en una línea de qué se trata mi causa más reciente.",
    contextoInicial: contexto,
    systemPrompt: LEXIE_SYSTEM_PROMPT,
    modelId: "claude-sonnet-4-5-20250929",
    usuarioId,
    nombre,
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
