// Verificación del dominio ESCRITOS de LEXIE (11.6) contra la base real:
// `generar_escrito_causa` (pre-vuelo gratis + generación sólo por el botón) y
// `actualizar_perfil_profesional` (completar vacíos directo, pisar con
// confirmación, guard de dato dictado, cuarentena).
//
// CERO tokens por default. Todo lo que corre sin --con-escrito es gratis:
// los pre-vuelos y los rechazos no llaman al modelo, y se cuentan las filas
// de `escritos_generados` y `ejecuciones` antes y después para afirmarlo.
// Lo único que ESCRIBE es el perfil profesional de Mateo, sobre dos campos,
// y se restaura el original en `finally` (los valores originales se imprimen
// antes de tocarlos, por si el proceso muere a mitad de camino).
//
// Con --con-escrito se ejecuta la pendiente REAL con `ejecutarPendiente`
// (~USD 0,09, 40-90 s), se afirma que quedó el escrito con su fila de
// `ejecuciones` tipo generar_escrito, y se borra todo en `finally`.
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server \
//     --import dotenv/config scripts/verificar-lexie-escritos.ts [--con-escrito]

import { createServerClient } from "../src/lib/supabase/server";
import { CATALOGO_ESTUDIO } from "../src/lib/escritos/catalogo-estudio";
import { COLS_CASO_LISTA } from "../src/lib/casos/columnas";
import { nombreCaso } from "../src/lib/casos/nombre";
import type { CasoNombrable } from "../src/lib/types";
import {
  DOMINIO_ESCRITOS,
  ESCRITOS_TOOL_NAMES,
  ejecutarToolEscritosLexie,
  MANUAL_ESCRITOS,
  PROMPT_ESCRITOS,
} from "../src/lib/agent/escritos-tools";
import { NOTA_CUARENTENA, type ContextoLexie } from "../src/lib/agent/lexie-tools";
import type { CtxEjecucion } from "../src/lib/agent/lexie-dominio";
import {
  actualizarPerfilProfesional,
  getPerfilProfesional,
} from "../src/lib/escritos/queries";
import type { AccionLexie } from "../src/lib/lexie/acciones";

const CON_ESCRITO = process.argv.includes("--con-escrito");
const EMAIL = "mateomorbi19@gmail.com";
// Con forma de UUID válida (esUuid) pero que no existe en la base.
const UUID_INEXISTENTE = "11111111-1111-4111-8111-111111111111";

const fallas: string[] = [];
const ok = (t: string) => console.log(`  ok   ${t}`);
const mal = (t: string) => {
  console.log(`  MAL  ${t}`);
  fallas.push(t);
};
const aviso = (t: string) => console.log(`  --   ${t}`);

const supabase = createServerClient();

/** Contexto de tools mínimo: sin Gmail, sin pendientes (igual que verificar-lexie.ts). */
function ctxDe(
  usuarioId: string,
  nombre: string,
  over: Partial<ContextoLexie> = {},
): ContextoLexie {
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

function ctxEjecucionDe(usuarioId: string, nombre: string): CtxEjecucion {
  return { usuarioId, nombre, clerkUserId: "user_test", gmail: async () => null };
}

type Parsed = Record<string, unknown>;
function parse(json: string): Parsed {
  try {
    return JSON.parse(json) as Parsed;
  } catch {
    return { __raw: json };
  }
}

async function contar(
  tabla: "escritos_generados" | "ejecuciones",
  usuarioId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from(tabla)
    .select("id", { count: "exact", head: true })
    .eq("usuario_id", usuarioId);
  if (error) throw new Error(`contar ${tabla}: ${error.message}`);
  return count ?? 0;
}

const CAMPOS_PERFIL = [
  "nombre_completo",
  "matricula",
  "domicilio_constituido",
  "domicilio_electronico",
] as const;
type CampoPerfil = (typeof CAMPOS_PERFIL)[number];

async function main() {
  // ============ 0. Familias, caps y prompt (puro) ============
  console.log("\n=== 0. Familias del dominio y prompt ===");
  const familias = DOMINIO_ESCRITOS.familias(ctxDe("x", "x"));
  const porNombre = Object.fromEntries(familias.map((f) => [f.nombre, f]));
  const lectura = porNombre["escritos"];
  const escritura = porNombre["escritos_escritura"];
  const generacion = porNombre["escritos_generacion"];
  if (familias.length === 3 && lectura && escritura && generacion) ok("tres familias: escritos, escritos_escritura, escritos_generacion");
  else mal(`familias: ${familias.map((f) => f.nombre).join(", ")}`);
  if (lectura?.cap === 4 && lectura.paralelizable) ok("escritos: cap 4, paralela");
  else mal(`escritos: cap ${lectura?.cap} paralelizable ${lectura?.paralelizable}`);
  const toolsEscritura = escritura?.tools.map((t) => t.name) ?? [];
  if (
    escritura?.cap === 2 &&
    !escritura.paralelizable &&
    toolsEscritura.includes(ESCRITOS_TOOL_NAMES.guardar) &&
    toolsEscritura.includes(ESCRITOS_TOOL_NAMES.perfil)
  ) {
    ok("escritos_escritura: cap 2, en serie, con guardar_modelo_escrito y actualizar_perfil_profesional");
  } else {
    mal(`escritos_escritura: cap ${escritura?.cap} paralelizable ${escritura?.paralelizable} tools ${toolsEscritura.join(", ")}`);
  }
  const toolsGeneracion = generacion?.tools.map((t) => t.name) ?? [];
  if (generacion?.cap === 1 && !generacion.paralelizable && toolsGeneracion.join() === ESCRITOS_TOOL_NAMES.generar) {
    ok("escritos_generacion: cap 1, en serie, sólo generar_escrito_causa");
  } else {
    mal(`escritos_generacion: cap ${generacion?.cap} paralelizable ${generacion?.paralelizable} tools ${toolsGeneracion.join(", ")}`);
  }
  if (PROMPT_ESCRITOS.includes("generar_escrito_causa") && PROMPT_ESCRITOS.includes("actualizar_perfil_profesional")) {
    ok("el prompt nombra las dos tools nuevas");
  } else {
    mal("el prompt no nombra las tools nuevas");
  }
  if (!/Vos NO gener|no pod[eé]s generarlo/i.test(PROMPT_ESCRITOS)) ok("el prompt ya no dice que LEXIE no genera");
  else mal("el prompt sigue diciendo que LEXIE no genera el escrito");
  if (MANUAL_ESCRITOS.includes("Escritos") && MANUAL_ESCRITOS.includes("Presentado")) ok("el manual dice dónde queda el escrito y que presentar sigue siendo manual");
  else mal("el manual de escritos está incompleto");
  const ajena = await DOMINIO_ESCRITOS.ejecutarPendiente(
    { tool: "agenda_crear_evento", estado: "pendiente", resumen: "x", clave: "k" },
    ctxEjecucionDe("x", "x"),
  );
  if (ajena === null) ok("ejecutarPendiente devuelve null para una tool de otro dominio");
  else mal("ejecutarPendiente aceptó una tool ajena");

  // ============ 1. Datos de prueba ============
  console.log("\n=== 1. Usuario, causa propia, causa ajena, modelo 2 ===");
  const { data: usuario, error: usuarioErr } = await supabase
    .from("usuarios")
    .select("id, nombre")
    .eq("email", EMAIL)
    .maybeSingle();
  if (usuarioErr || !usuario) {
    mal(`no encontré al usuario ${EMAIL}: ${usuarioErr?.message ?? "sin fila"}`);
    return resultado();
  }
  const usuarioId = usuario.id as string;
  const nombre = usuario.nombre as string;
  ok(`usuario ${nombre} (${usuarioId})`);

  const { data: propias } = await supabase
    .from("casos")
    .select(COLS_CASO_LISTA)
    .eq("usuario_id", usuarioId)
    .order("actualizado_en", { ascending: false })
    .limit(1);
  const propia = propias?.[0] ?? null;
  if (!propia) {
    mal("Mateo no tiene causas");
    return resultado();
  }
  const casoId = propia.id as string;
  const nombreCausa = nombreCaso(propia as CasoNombrable);
  ok(`causa propia: «${nombreCausa}» (${casoId})`);

  const { data: ajenas } = await supabase
    .from("casos")
    .select("id, titulo, caratula")
    .neq("usuario_id", usuarioId)
    .limit(1);
  const ajeno = ajenas?.[0] ?? null;
  if (ajeno) ok(`causa ajena real: ${ajeno.id}`);
  else aviso("no hay causas de otros abogados; se prueba sólo con un UUID inexistente");

  const modelo2 = CATALOGO_ESTUDIO.find((m) => m.numero === 2);
  if (!modelo2) {
    mal("el catálogo no tiene el modelo 2");
    return resultado();
  }
  ok(`modelo 2: «${modelo2.titulo}» (slug ${modelo2.id})`);

  const escritosAntes = await contar("escritos_generados", usuarioId);
  const ejecucionesAntes = await contar("ejecuciones", usuarioId);
  aviso(`antes: ${escritosAntes} escritos, ${ejecucionesAntes} ejecuciones del usuario`);

  const T = ESCRITOS_TOOL_NAMES;

  // ============ 2. generar_escrito_causa: propiedad e input ============
  console.log("\n=== 2. generar_escrito_causa: propiedad e input inválido ===");
  for (const [etiqueta, id] of [
    ["UUID inexistente", UUID_INEXISTENTE],
    ...(ajeno ? [["causa de otro abogado", ajeno.id as string]] : []),
  ] as [string, string][]) {
    const r = await ejecutarToolEscritosLexie(T.generar, { caso_id: id, modelo_id: modelo2.id }, ctxDe(usuarioId, nombre));
    const p = parse(r.contentJSON);
    const nombreAjeno = ajeno ? ((ajeno.caratula as string | null) ?? (ajeno.titulo as string)) : null;
    const revela = nombreAjeno && nombreAjeno.length > 5 ? r.contentJSON.includes(nombreAjeno) : false;
    if (p.ok === false && r.accion?.estado === "rechazada" && !revela && !r.contentJSON.includes("requiere_confirmacion")) {
      ok(`${etiqueta} → ok:false sin revelar nada (acción rechazada)`);
    } else {
      mal(`${etiqueta} → ${r.contentJSON.slice(0, 160)}`);
    }
  }
  {
    const r = await ejecutarToolEscritosLexie(T.generar, { caso_id: "no-es-uuid", modelo_id: modelo2.id }, ctxDe(usuarioId, nombre));
    if (r.isError && parse(r.contentJSON).ok === false) ok("caso_id con forma inválida → input inválido (no llega a la base)");
    else mal(`caso_id inválido → ${r.contentJSON.slice(0, 120)}`);
    const r2 = await ejecutarToolEscritosLexie(T.generar, { caso_id: casoId, modelo_id: "no-existe-este-modelo" }, ctxDe(usuarioId, nombre));
    if (parse(r2.contentJSON).ok === false && r2.accion?.estado === "rechazada" && r2.contentJSON.includes("No existe un modelo")) {
      ok("modelo inexistente → rechazo relatado");
    } else {
      mal(`modelo inexistente → ${r2.contentJSON.slice(0, 160)}`);
    }
    const r3 = await ejecutarToolEscritosLexie(T.generar, { caso_id: casoId }, ctxDe(usuarioId, nombre));
    if (r3.isError && r3.contentJSON.includes("modelo_id")) ok("sin modelo_id → error");
    else mal(`sin modelo_id → ${r3.contentJSON.slice(0, 120)}`);
    const r4 = await ejecutarToolEscritosLexie(T.generar, { modelo_id: modelo2.id }, ctxDe(usuarioId, nombre));
    if (r4.isError && r4.contentJSON.includes("caso_id")) ok("sin caso_id y sin causa en pantalla → error");
    else mal(`sin caso_id → ${r4.contentJSON.slice(0, 120)}`);
    const r5 = await ejecutarToolEscritosLexie(
      T.generar,
      { modelo_id: modelo2.id },
      ctxDe(usuarioId, nombre, { casoIdEnPantalla: casoId }),
    );
    if (r5.accion?.estado === "pendiente" && r5.accion.payload?.caso_id === casoId) ok("sin caso_id pero parado en la causa → usa la de pantalla");
    else mal(`caso en pantalla → ${r5.contentJSON.slice(0, 120)}`);
    const r6 = await ejecutarToolEscritosLexie(
      T.generar,
      { caso_id: casoId, modelo_id: modelo2.id, instrucciones: "x".repeat(4001) },
      ctxDe(usuarioId, nombre),
    );
    if (r6.isError && r6.contentJSON.includes("instrucciones")) ok("instrucciones de más de 4000 caracteres → error");
    else mal(`instrucciones largas → ${r6.contentJSON.slice(0, 120)}`);
  }

  // ============ 3. Pre-vuelo → pendiente ============
  console.log("\n=== 3. Pre-vuelo: pendiente con vista previa y payload ===");
  const perfilAlPrevuelo = await getPerfilProfesional(usuarioId);
  const incompletos = CAMPOS_PERFIL.filter((k) => !perfilAlPrevuelo[k]?.trim());
  const pv = await ejecutarToolEscritosLexie(
    T.generar,
    { caso_id: casoId, modelo_id: modelo2.id, instrucciones: "  Es una prueba.  " },
    ctxDe(usuarioId, nombre),
  );
  const pvJson = parse(pv.contentJSON);
  const pendiente = pv.accion;
  if (pvJson.requiere_confirmacion === true && typeof pvJson.clave === "string" && !pv.isError) {
    ok(`tool_result con requiere_confirmacion y clave ${pvJson.clave}`);
  } else {
    mal(`pre-vuelo → ${pv.contentJSON.slice(0, 200)}`);
  }
  if (pendiente?.estado === "pendiente" && pendiente.clave === pvJson.clave && pendiente.seccion === "escritos") {
    ok(`acción pendiente, sección escritos: «${pendiente.resumen}»`);
  } else {
    mal(`acción: ${JSON.stringify(pendiente).slice(0, 200)}`);
  }
  const vista = (pendiente?.vista_previa ?? {}) as Record<string, unknown>;
  console.log("       vista_previa:", JSON.stringify(vista, null, 2).replace(/\n/g, "\n       "));
  if (typeof vista.modelo === "string" && vista.modelo.startsWith("N° 2")) ok("vista_previa.modelo con número y título");
  else mal(`vista_previa.modelo = ${String(vista.modelo)}`);
  if (vista.causa === nombreCausa) ok("vista_previa.causa es el nombre de la causa");
  else mal(`vista_previa.causa = ${String(vista.causa)}`);
  if (typeof vista.faltantes === "string" && (vista.faltantes.includes("[COMPLETAR") || vista.faltantes.startsWith("Ninguno"))) {
    ok("vista_previa.faltantes aclara que salen como [COMPLETAR]");
  } else {
    mal(`vista_previa.faltantes = ${String(vista.faltantes)}`);
  }
  if (vista.datos_del_expediente && typeof vista.datos_del_expediente === "object") ok("vista_previa.datos_del_expediente por etiqueta");
  else mal(`vista_previa.datos_del_expediente = ${String(vista.datos_del_expediente)}`);
  if (incompletos.length > 0) {
    if (typeof vista.perfil_profesional_incompleto === "string" && vista.perfil_profesional_incompleto.includes("actualizar_perfil_profesional")) {
      ok(`perfil incompleto (${incompletos.join(", ")}) → la vista lo dice y sugiere actualizar_perfil_profesional`);
    } else {
      mal(`perfil incompleto pero la vista no lo dice: ${String(vista.perfil_profesional_incompleto)}`);
    }
  } else if (vista.perfil_profesional_incompleto === undefined) {
    ok("perfil completo → la vista no trae perfil_profesional_incompleto");
  } else {
    mal("perfil completo pero la vista dice que falta algo");
  }
  if (vista.instrucciones === "Es una prueba.") ok("vista_previa.instrucciones exactas (normalizadas)");
  else mal(`vista_previa.instrucciones = ${String(vista.instrucciones)}`);
  if (vista.costo_estimado === "USD 0,09" && vista.duracion_estimada === "40-90 segundos") ok("costo y duración estimados en es-AR");
  else mal(`costo/duración: ${String(vista.costo_estimado)} / ${String(vista.duracion_estimada)}`);
  const payload = pendiente?.payload ?? {};
  if (payload.caso_id === casoId && payload.modelo_id === modelo2.id && payload.instrucciones === "Es una prueba.") {
    ok("accion.payload = { caso_id, modelo_id, instrucciones }");
  } else {
    mal(`payload: ${JSON.stringify(payload)}`);
  }
  {
    const escritosAhora = await contar("escritos_generados", usuarioId);
    const ejecucionesAhora = await contar("ejecuciones", usuarioId);
    if (escritosAhora === escritosAntes && ejecucionesAhora === ejecucionesAntes) ok("el pre-vuelo no insertó nada en escritos_generados ni en ejecuciones");
    else mal(`la base cambió con el pre-vuelo: escritos ${escritosAntes}→${escritosAhora}, ejecuciones ${ejecucionesAntes}→${ejecucionesAhora}`);
  }
  // Cuarentena: no cambia nada, ya es confirmable.
  const pvQ = await ejecutarToolEscritosLexie(
    T.generar,
    { caso_id: casoId, modelo_id: modelo2.id, instrucciones: "Es una prueba." },
    ctxDe(usuarioId, nombre, { correoLeido: true }),
  );
  if (pvQ.accion?.estado === "pendiente" && pvQ.accion.clave === pendiente?.clave) ok("bajo cuarentena: misma pendiente, misma clave (el contenido es el mismo)");
  else mal(`cuarentena → ${pvQ.contentJSON.slice(0, 120)}`);

  // ============ 4. Confirmación por texto ============
  console.log("\n=== 4. Confirmación por texto: sin siembra → rechazo; con siembra → «usá el botón» ===");
  if (!pendiente?.clave) {
    mal("no hay pendiente para probar la confirmación");
  } else {
    const sinSiembra = ctxDe(usuarioId, nombre);
    const r1 = await ejecutarToolEscritosLexie(
      T.generar,
      { caso_id: casoId, modelo_id: modelo2.id, instrucciones: "Es una prueba.", confirmar: true },
      sinSiembra,
    );
    if (parse(r1.contentJSON).ok === false && r1.accion?.estado === "rechazada" && r1.contentJSON.includes("sin que")) ok("confirmar:true sin siembra → rechazo");
    else mal(`confirmar sin siembra → ${r1.contentJSON.slice(0, 160)}`);
    const r2 = await ejecutarToolEscritosLexie(T.generar, { clave: "generar_escrito_causa:inventada", confirmar: true }, sinSiembra);
    if (parse(r2.contentJSON).ok === false && r2.accion?.estado === "rechazada" && !r2.isError) ok("clave inventada (sin modelo_id ni caso_id) → rechazo, no error de schema");
    else mal(`clave inventada → ${r2.contentJSON.slice(0, 160)}`);

    const conSiembra = ctxDe(usuarioId, nombre, {
      accionesPendientes: new Map([[pendiente.clave, pendiente]]),
    });
    const r3 = await ejecutarToolEscritosLexie(T.generar, { clave: pendiente.clave, confirmar: true }, conSiembra);
    const j3 = parse(r3.contentJSON);
    if (j3.ok === false && typeof j3.motivo === "string" && j3.motivo.includes("botón")) ok(`con siembra → «${j3.motivo}»`);
    else mal(`con siembra → ${r3.contentJSON.slice(0, 160)}`);
    if (!conSiembra.clavesConsumidas.has(pendiente.clave)) ok("la clave NO se consumió");
    else mal("la clave se consumió: la tarjeta quedaría muerta");
    if (
      r3.accion?.estado === "pendiente" &&
      r3.accion.clave === pendiente.clave &&
      JSON.stringify(r3.accion.payload) === JSON.stringify(pendiente.payload)
    ) {
      ok("la pendiente se re-emite tal cual (misma clave, mismo payload): la tarjeta sigue activa en el turno nuevo");
    } else {
      mal(`acción tras confirmar por texto: ${JSON.stringify(r3.accion).slice(0, 200)}`);
    }
    // También con confirmar:true y el mismo contenido, sin clave.
    const r4 = await ejecutarToolEscritosLexie(
      T.generar,
      { caso_id: casoId, modelo_id: modelo2.id, instrucciones: "Es una prueba.", confirmar: true },
      conSiembra,
    );
    if (parse(r4.contentJSON).ok === false && r4.accion?.estado === "pendiente" && !conSiembra.clavesConsumidas.has(pendiente.clave)) {
      ok("confirmar:true con el mismo contenido → también «usá el botón», sin consumir");
    } else {
      mal(`confirmar por contenido → ${r4.contentJSON.slice(0, 160)}`);
    }
    const escritosAhora = await contar("escritos_generados", usuarioId);
    const ejecucionesAhora = await contar("ejecuciones", usuarioId);
    if (escritosAhora === escritosAntes && ejecucionesAhora === ejecucionesAntes) ok("nada generado por texto: la base no cambió");
    else mal(`la base cambió al confirmar por texto: escritos ${escritosAntes}→${escritosAhora}, ejecuciones ${ejecucionesAntes}→${ejecucionesAhora}`);
  }

  // ============ 5. ejecutarPendiente: los guards, sin gastar ============
  console.log("\n=== 5. ejecutarPendiente de generar: guards gratis ===");
  {
    const base: AccionLexie = { tool: T.generar, estado: "pendiente", resumen: "Generar escrito", clave: "k", seccion: "escritos" };
    const sinPayload = await DOMINIO_ESCRITOS.ejecutarPendiente({ ...base, payload: {} }, ctxEjecucionDe(usuarioId, nombre));
    if (sinPayload?.estado === "error" && sinPayload.error?.includes("caso_id")) ok("pendiente sin payload → error, sin gastar");
    else mal(`sin payload → ${JSON.stringify(sinPayload).slice(0, 160)}`);
    const modeloMalo = await DOMINIO_ESCRITOS.ejecutarPendiente(
      { ...base, payload: { caso_id: casoId, modelo_id: "no-existe-este-modelo", instrucciones: null } },
      ctxEjecucionDe(usuarioId, nombre),
    );
    if (modeloMalo?.estado === "error" && modeloMalo.error?.includes("modelo")) ok(`modelo borrado entre medio → error: «${modeloMalo.error}»`);
    else mal(`modelo borrado → ${JSON.stringify(modeloMalo).slice(0, 160)}`);
    const casoMalo = await DOMINIO_ESCRITOS.ejecutarPendiente(
      { ...base, payload: { caso_id: UUID_INEXISTENTE, modelo_id: modelo2.id, instrucciones: null } },
      ctxEjecucionDe(usuarioId, nombre),
    );
    if (casoMalo?.estado === "error" && casoMalo.error?.includes("causa")) ok(`causa ajena en el payload → error: «${casoMalo.error}»`);
    else mal(`causa ajena → ${JSON.stringify(casoMalo).slice(0, 160)}`);
    const escritosAhora = await contar("escritos_generados", usuarioId);
    const ejecucionesAhora = await contar("ejecuciones", usuarioId);
    if (escritosAhora === escritosAntes && ejecucionesAhora === ejecucionesAntes) ok("los guards no gastaron ni escribieron");
    else mal(`la base cambió con los guards: escritos ${escritosAntes}→${escritosAhora}, ejecuciones ${ejecucionesAntes}→${ejecucionesAhora}`);
  }

  // ============ 6. actualizar_perfil_profesional ============
  console.log("\n=== 6. actualizar_perfil_profesional ===");
  const original = await getPerfilProfesional(usuarioId);
  aviso(`perfil original (por si hay que restaurarlo a mano): ${JSON.stringify(original)}`);
  // Dos campos para jugar. Se prefieren los que ya están vacíos; si no hay
  // dos, se vacían temporalmente y `finally` restaura el original entero.
  const vacios = CAMPOS_PERFIL.filter((k) => !original[k]?.trim());
  const campoA: CampoPerfil = vacios[0] ?? "domicilio_electronico";
  const campoB: CampoPerfil = vacios.find((k) => k !== campoA) ?? (campoA === "domicilio_constituido" ? "domicilio_electronico" : "domicilio_constituido");
  const valorA1 = campoA === "matricula" ? "T° 99 F° 999 C.P.A.C.F." : campoA === "nombre_completo" ? "Dr. Prueba LEXIE" : "Calle Falsa 123, piso 4, CABA (prueba LEXIE)";
  const valorA2 = campoA === "matricula" ? "T° 98 F° 998 C.P.A.C.F." : campoA === "nombre_completo" ? "Dr. Prueba LEXIE Segundo" : "Avenida Siempreviva 742, CABA (prueba LEXIE)";
  const valorB1 = campoB === "matricula" ? "T° 77 F° 777 C.P.A.C.F." : campoB === "nombre_completo" ? "Dra. Prueba LEXIE" : "Pasaje Ficticio 55, La Plata (prueba LEXIE)";
  const noDictada = "T° 12 F° 345 C.P.A.C.F.";
  try {
    if (original[campoA] || original[campoB]) {
      await actualizarPerfilProfesional(usuarioId, { [campoA]: null, [campoB]: null });
      aviso(`se vaciaron temporalmente ${campoA} y ${campoB}`);
    }

    // (a) input inválido
    const r0 = await ejecutarToolEscritosLexie(T.perfil, {}, ctxDe(usuarioId, nombre));
    if (r0.isError && r0.contentJSON.includes("al menos uno")) ok("sin campos → error");
    else mal(`sin campos → ${r0.contentJSON.slice(0, 120)}`);

    // (b) matrícula NO dictada → descartada, perfil intacto
    const perfilAntes1 = await getPerfilProfesional(usuarioId);
    const r1 = await ejecutarToolEscritosLexie(T.perfil, { matricula: noDictada }, ctxDe(usuarioId, nombre, { mensajesAbogado: ["Cargame la matrícula"] }));
    const j1 = parse(r1.contentJSON);
    const perfilTras1 = await getPerfilProfesional(usuarioId);
    if (
      j1.ok === false &&
      Array.isArray(j1.descartados) &&
      j1.descartados.includes("matricula") &&
      r1.accion?.estado === "rechazada" &&
      JSON.stringify(perfilTras1) === JSON.stringify(perfilAntes1)
    ) {
      ok("matrícula NO dictada → descartada con aviso, acción rechazada, perfil intacto");
    } else {
      mal(`no dictada → ${r1.contentJSON.slice(0, 200)} / perfil ${JSON.stringify(perfilTras1)}`);
    }

    // (c) dictado sobre campo vacío → ok directo; con uno no dictado mezclado
    const ctxDict = ctxDe(usuarioId, nombre, { mensajesAbogado: [`Cargame ${campoA}: ${valorA1}. Y la matrícula después te la paso.`] });
    const r2 = await ejecutarToolEscritosLexie(
      T.perfil,
      { [campoA]: valorA1, ...(campoA !== "matricula" ? { matricula: noDictada } : {}) },
      ctxDict,
    );
    const j2 = parse(r2.contentJSON);
    const perfilTras2 = await getPerfilProfesional(usuarioId);
    if (j2.ok === true && r2.accion?.estado === "ok" && perfilTras2[campoA] === valorA1) {
      ok(`${campoA} dictado sobre vacío → ok directo: «${r2.accion.resumen}»`);
    } else {
      mal(`dictado sobre vacío → ${r2.contentJSON.slice(0, 200)}`);
    }
    if (campoA !== "matricula") {
      if (Array.isArray(j2.descartados) && j2.descartados.includes("matricula") && perfilTras2.matricula === null) ok("la matrícula no dictada del mismo llamado se descartó con aviso");
      else mal(`mezcla dictado/no dictado → descartados ${JSON.stringify(j2.descartados)}, matricula=${perfilTras2.matricula}`);
    }
    const antes2 = (r2.accion?.antes ?? {}) as Record<string, unknown>;
    const vista2 = (r2.accion?.vista_previa ?? {}) as Record<string, unknown>;
    const etiquetaA = Object.keys(vista2)[0];
    if (antes2[campoA] === null && typeof vista2[etiquetaA] === "string" && (vista2[etiquetaA] as string).startsWith("(vacío) → ")) {
      ok(`antes/después: ${etiquetaA}: ${String(vista2[etiquetaA])}`);
    } else {
      mal(`antes/después raros: antes=${JSON.stringify(antes2)} vista=${JSON.stringify(vista2)}`);
    }
    if (r2.accion?.seccion === "escritos" && r2.accion.datos?.href === undefined) ok("sección escritos, sin href específico");
    else mal(`sección/href: ${r2.accion?.seccion} / ${String(r2.accion?.datos?.href)}`);

    // (d) mismo valor otra vez → sin cambios, sin acción
    const r3 = await ejecutarToolEscritosLexie(T.perfil, { [campoA]: valorA1 }, ctxDict);
    if (parse(r3.contentJSON).ok === true && r3.contentJSON.includes("sin_cambios") && !r3.accion) ok("mismo valor → sin cambios y sin acción");
    else mal(`mismo valor → ${r3.contentJSON.slice(0, 160)}`);

    // (e) pisar un valor cargado → pendiente con diff
    const ctxPisa = ctxDe(usuarioId, nombre, { mensajesAbogado: [`Corregí ${campoA}: ahora es ${valorA2}`] });
    const r4 = await ejecutarToolEscritosLexie(T.perfil, { [campoA]: valorA2 }, ctxPisa);
    const j4 = parse(r4.contentJSON);
    const pendPerfil = r4.accion;
    const vista4 = (pendPerfil?.vista_previa ?? {}) as Record<string, unknown>;
    if (
      j4.requiere_confirmacion === true &&
      pendPerfil?.estado === "pendiente" &&
      pendPerfil.payload?.[campoA] === valorA2 &&
      (pendPerfil.antes as Record<string, unknown> | undefined)?.[campoA] === valorA1 &&
      String(vista4[etiquetaA]) === `${valorA1} → ${valorA2}` &&
      (await getPerfilProfesional(usuarioId))[campoA] === valorA1
    ) {
      ok(`pisar un valor cargado → pendiente con diff «${String(vista4[etiquetaA])}», perfil sin tocar`);
    } else {
      mal(`pisar → ${r4.contentJSON.slice(0, 200)} / accion ${JSON.stringify(pendPerfil).slice(0, 200)}`);
    }

    // (f) confirmar por texto con siembra → ejecuta y consume la clave
    if (pendPerfil?.clave) {
      const ctxConf = ctxDe(usuarioId, nombre, { accionesPendientes: new Map([[pendPerfil.clave, pendPerfil]]) });
      const r5 = await ejecutarToolEscritosLexie(T.perfil, { clave: pendPerfil.clave, confirmar: true }, ctxConf);
      const perfilTras5 = await getPerfilProfesional(usuarioId);
      if (
        parse(r5.contentJSON).ok === true &&
        r5.accion?.estado === "ok" &&
        r5.accion.confirmado_por === "texto" &&
        ctxConf.clavesConsumidas.has(pendPerfil.clave) &&
        perfilTras5[campoA] === valorA2
      ) {
        ok("confirmar por texto con siembra → ejecutado, clave consumida, perfil pisado");
      } else {
        mal(`confirmar perfil → ${r5.contentJSON.slice(0, 160)} / ${perfilTras5[campoA]}`);
      }
      const r6 = await ejecutarToolEscritosLexie(T.perfil, { clave: pendPerfil.clave, confirmar: true }, ctxConf);
      if (parse(r6.contentJSON).ok === false && r6.accion?.estado === "rechazada") ok("la misma clave otra vez → rechazo (ya consumida)");
      else mal(`clave consumida → ${r6.contentJSON.slice(0, 120)}`);
    }
    const r7 = await ejecutarToolEscritosLexie(T.perfil, { [campoA]: valorA1, confirmar: true }, ctxDe(usuarioId, nombre, { mensajesAbogado: [valorA1] }));
    if (parse(r7.contentJSON).ok === false && r7.accion?.estado === "rechazada") ok("confirmar:true sin siembra → rechazo");
    else mal(`confirmar sin siembra → ${r7.contentJSON.slice(0, 120)}`);

    // (g) ejecutarPendiente con `antes` alterado → rechazada
    const r8 = await ejecutarToolEscritosLexie(T.perfil, { [campoA]: valorA1 }, ctxDe(usuarioId, nombre, { mensajesAbogado: [valorA1] }));
    if (r8.accion?.estado === "pendiente") {
      const alterada: AccionLexie = { ...r8.accion, antes: { [campoA]: "otro valor que ya no está" } };
      const e1 = await DOMINIO_ESCRITOS.ejecutarPendiente(alterada, ctxEjecucionDe(usuarioId, nombre));
      if (e1?.estado === "rechazada" && e1.motivo?.includes("Cambió") && (await getPerfilProfesional(usuarioId))[campoA] === valorA2) {
        ok("ejecutarPendiente con antes alterado → rechazada, perfil sin tocar");
      } else {
        mal(`antes alterado → ${JSON.stringify(e1).slice(0, 200)}`);
      }
      // Y con el `antes` real → ok (camino del botón).
      const e2 = await DOMINIO_ESCRITOS.ejecutarPendiente(r8.accion, ctxEjecucionDe(usuarioId, nombre));
      if (e2?.estado === "ok" && e2.payload === undefined && (await getPerfilProfesional(usuarioId))[campoA] === valorA1) {
        ok(`ejecutarPendiente por el botón → ok: «${e2.resumen}»`);
      } else {
        mal(`botón → ${JSON.stringify(e2).slice(0, 200)}`);
      }
    } else {
      mal(`no pude emitir la pendiente para (g): ${r8.contentJSON.slice(0, 120)}`);
    }

    // (h) cuarentena: completar un vacío se vuelve pendiente
    const r9 = await ejecutarToolEscritosLexie(
      T.perfil,
      { [campoB]: valorB1 },
      ctxDe(usuarioId, nombre, { mensajesAbogado: [`${campoB}: ${valorB1}`], correoLeido: true }),
    );
    if (
      parse(r9.contentJSON).requiere_confirmacion === true &&
      r9.accion?.estado === "pendiente" &&
      r9.contentJSON.includes(NOTA_CUARENTENA.slice(0, 40)) &&
      (await getPerfilProfesional(usuarioId))[campoB] === null
    ) {
      ok(`cuarentena: completar ${campoB} vacío → pendiente con la nota, perfil sin tocar`);
    } else {
      mal(`cuarentena → ${r9.contentJSON.slice(0, 200)}`);
    }
  } finally {
    await actualizarPerfilProfesional(usuarioId, {
      nombre_completo: original.nombre_completo,
      matricula: original.matricula,
      domicilio_constituido: original.domicilio_constituido,
      domicilio_electronico: original.domicilio_electronico,
    });
    const restaurado = await getPerfilProfesional(usuarioId);
    if (JSON.stringify(restaurado) === JSON.stringify(original)) ok("perfil restaurado al original");
    else mal(`el perfil NO quedó como estaba: ${JSON.stringify(restaurado)} vs ${JSON.stringify(original)}`);
  }

  // ============ 7. Generación real (paga), sólo con --con-escrito ============
  console.log("\n=== 7. ejecutarPendiente real: generar el escrito (paga) ===");
  if (!CON_ESCRITO || !pendiente?.clave) {
    aviso("saltado: correr con --con-escrito para ejecutar la pendiente real (~USD 0,09, 40-90 s)");
  } else {
    const inicioIso = new Date().toISOString();
    const t0 = Date.now();
    try {
      const res = await DOMINIO_ESCRITOS.ejecutarPendiente(pendiente, ctxEjecucionDe(usuarioId, nombre));
      const seg = ((Date.now() - t0) / 1000).toFixed(1);
      if (!res) {
        mal("ejecutarPendiente devolvió null para generar_escrito_causa");
      } else if (res.estado !== "ok") {
        mal(`ejecutarPendiente → ${res.estado}: ${res.error ?? res.motivo ?? ""}`);
      } else {
        const datos = (res.datos ?? {}) as Record<string, unknown>;
        ok(`generado en ${seg}s: «${res.resumen}»`);
        if (typeof datos.escrito_id === "string" && datos.href === `/dashboard/mis-casos/${casoId}?escrito=${datos.escrito_id}`) ok(`href con ?escrito=: ${String(datos.href)}`);
        else mal(`datos: ${JSON.stringify(datos)}`);
        if (res.payload === undefined) ok("la acción resuelta no arrastra el payload");
        else mal("la acción resuelta conserva el payload");
        const vp = (res.vista_previa ?? {}) as Record<string, unknown>;
        if (typeof vp.titulo === "string" && typeof vp.marcas_pendientes === "number" && typeof vp.extracto === "string" && vp.extracto.length <= 300) {
          ok(`vista_previa: título, ${String(vp.marcas_pendientes)} marcas, extracto de ${(vp.extracto as string).length} chars (sin el texto entero)`);
        } else {
          mal(`vista_previa: ${JSON.stringify(vp).slice(0, 200)}`);
        }
        if (typeof datos.ejecucion_id === "string") {
          const { data: ejec } = await supabase
            .from("ejecuciones")
            .select("id, tipo, costo_usd")
            .eq("id", datos.ejecucion_id)
            .eq("usuario_id", usuarioId)
            .maybeSingle();
          if (ejec?.tipo === "generar_escrito") ok(`fila ejecuciones tipo generar_escrito, USD ${Number(ejec.costo_usd).toFixed(4)}`);
          else mal(`ejecución: ${JSON.stringify(ejec)}`);
        } else {
          mal("sin ejecucion_id en datos");
        }
      }
    } finally {
      const { count: e1, error: err1 } = await supabase
        .from("escritos_generados")
        .delete({ count: "exact" })
        .eq("caso_id", casoId)
        .eq("usuario_id", usuarioId)
        .gte("creado_en", inicioIso);
      const { count: e2, error: err2 } = await supabase
        .from("ejecuciones")
        .delete({ count: "exact" })
        .eq("usuario_id", usuarioId)
        .eq("tipo", "generar_escrito")
        .gte("ejecutado_en", inicioIso);
      if (err1 || err2) mal(`limpieza falló: ${err1?.message ?? ""} ${err2?.message ?? ""}`);
      else aviso(`limpieza: ${e1 ?? 0} escrito(s) y ${e2 ?? 0} ejecución(es) de prueba borrados`);
      const escritosFinal = await contar("escritos_generados", usuarioId);
      const ejecucionesFinal = await contar("ejecuciones", usuarioId);
      if (escritosFinal === escritosAntes && ejecucionesFinal === ejecucionesAntes) ok("la base quedó como antes");
      else mal(`la base NO quedó como antes: escritos ${escritosAntes}→${escritosFinal}, ejecuciones ${ejecucionesAntes}→${ejecucionesFinal}`);
    }
  }

  resultado();
}

function resultado() {
  console.log("\n=== VEREDICTO ===");
  if (fallas.length === 0) {
    console.log("OK — LEXIE pre-vuela gratis, genera sólo por el botón y carga el perfil sólo con lo dictado.");
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
