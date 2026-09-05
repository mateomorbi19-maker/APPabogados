// Verificación de las tools de AGENDA de LEXIE (sub-paso 11.4) contra la base
// real. CERO tokens: no llama al modelo. Escribe en la base sólo altas de
// prueba del usuario mateomorbi19@gmail.com, tituladas "[prueba lexie] …", y
// las borra en el `finally` (también las que haya dejado una corrida anterior
// cortada a la mitad).
//
// Bajo `--conditions=react-server` el cliente de Google no carga (arrastra
// Clerk), así que el push devuelve `sin_google` y el pull previo a crear se
// saltea con un warn: los dos son resultados ESPERADOS acá, no fallas.
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server \
//     --import dotenv/config scripts/verificar-lexie-agenda.ts

import { createServerClient } from "../src/lib/supabase/server";
import {
  cuandoLegible,
  ejecutarToolLexie,
  NOTA_CUARENTENA,
  type ContextoLexie,
} from "../src/lib/agent/lexie-tools";
import {
  AGENDA_TOOL_NAMES,
  armarFechasEvento,
  DOMINIO_AGENDA,
  ejecutarToolAgenda,
} from "../src/lib/agent/agenda-tools";
import type { CtxEjecucion } from "../src/lib/agent/lexie-dominio";
import { LEXIE_SYSTEM_PROMPT } from "../src/lib/agent/lexie-prompt";
import { getEventoById } from "../src/lib/agenda/queries";
import { ahoraPartesAR, isoAPartesAR, sumarDias, type PartesFecha } from "../src/lib/agenda/tz-ar";
import type { AccionLexie } from "../src/lib/lexie/acciones";

const PREFIJO = "[prueba lexie]";
const fallas: string[] = [];
const ok = (t: string) => console.log(`  ok   ${t}`);
const mal = (t: string) => {
  console.log(`  MAL  ${t}`);
  fallas.push(t);
};
const p2 = (n: number) => String(n).padStart(2, "0");
const fechaDe = (p: PartesFecha) => `${p.y}-${p2(p.mo + 1)}-${p2(p.d)}`;
const CUANDO_RE = /^(dom|lun|mar|mié|jue|vie|sáb) \d{2}\/\d{2}\/\d{4}( \d{2}:\d{2}| \(todo el día\))/;

type Json = Record<string, unknown>;
const parse = (s: string): Json => JSON.parse(s) as Json;

/** Contexto de tools mínimo, como `ctxDe` de verificar-lexie.ts. */
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

async function borrarPruebas(usuarioId: string): Promise<number> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("eventos_agenda")
    .delete()
    .eq("usuario_id", usuarioId)
    .like("titulo", `${PREFIJO}%`)
    .select("id");
  if (error) throw new Error(`borrarPruebas: ${error.message}`);
  return data?.length ?? 0;
}

async function main() {
  // ============ 1. Lo puro (gratis, sin base) ============
  console.log("\n=== 1. Fechas de pared → ISO con -03:00 ===");
  const manana = sumarDias(ahoraPartesAR(), 1);
  const pasado = sumarDias(ahoraPartesAR(), 2);
  const fechaManana = fechaDe(manana);

  const f1 = armarFechasEvento({ clase: "evento", fecha: fechaManana, hora: "10:00" });
  if (
    !("error" in f1) &&
    f1.fecha_inicio === `${fechaManana}T10:00:00-03:00` &&
    f1.fecha_fin === `${fechaManana}T11:00:00-03:00` &&
    f1.todo_el_dia === false
  ) {
    ok(`evento 10:00 → ${f1.fecha_inicio} / ${f1.fecha_fin}`);
  } else {
    mal(`evento 10:00 armó ${JSON.stringify(f1)}`);
  }
  const f2 = armarFechasEvento({ clase: "evento", fecha: fechaManana, hora: "22:30", duracion_min: 120 });
  if (!("error" in f2) && f2.fecha_fin === `${fechaDe(pasado)}T00:30:00-03:00`) {
    ok(`la duración cruza medianoche sin perder el día: ${f2.fecha_fin}`);
  } else {
    mal(`22:30 + 120 min armó ${JSON.stringify(f2)}`);
  }
  const f3 = armarFechasEvento({ clase: "tarea", fecha: fechaManana, hora: "10:00" });
  if (!("error" in f3) && f3.todo_el_dia && f3.fecha_fin === null && f3.fecha_inicio === `${fechaManana}T00:00:00-03:00`) {
    ok("una tarea ignora la hora: todo el día, sin fin, a las 00:00 AR");
  } else {
    mal(`tarea armó ${JSON.stringify(f3)}`);
  }
  if ("error" in armarFechasEvento({ clase: "evento", fecha: "2026-02-30", hora: "10:00" })) ok("el 30/02 se rechaza");
  else mal("aceptó el 30 de febrero");
  if ("error" in armarFechasEvento({ clase: "evento", fecha: fechaManana })) ok("un evento sin hora ni todo_el_dia se rechaza");
  else mal("aceptó un evento sin hora");

  const legible = cuandoLegible({ fecha_inicio: "2026-09-10T01:00:00Z", fecha_fin: null, todo_el_dia: false });
  if (legible === "mié 09/09/2026 22:00") ok(`cuandoLegible convierte a hora argentina: 01:00Z → ${legible}`);
  else mal(`cuandoLegible dio "${legible}", esperaba "mié 09/09/2026 22:00"`);

  console.log("\n=== 2. El dominio y el prompt ===");
  const familias = DOMINIO_AGENDA.familias(ctxDe("x", "x"));
  const porNombre = Object.fromEntries(familias.map((f) => [f.nombre, f]));
  const esperadas: Array<[string, number, boolean, string[]]> = [
    ["agenda_lectura", 4, true, [AGENDA_TOOL_NAMES.buscar]],
    ["agenda_escritura", 3, false, [AGENDA_TOOL_NAMES.crear, AGENDA_TOOL_NAMES.editar]],
    ["agenda_eliminacion", 1, false, [AGENDA_TOOL_NAMES.eliminar]],
  ];
  for (const [nombre, cap, paralela, tools] of esperadas) {
    const f = porNombre[nombre];
    const bien =
      f && f.cap === cap && f.paralelizable === paralela &&
      tools.every((t) => f.tools.some((x) => x.name === t)) && f.tools.length === tools.length;
    if (bien) ok(`${nombre}: cap ${cap}, ${paralela ? "paralela" : "en serie"}, ${tools.join(" + ")}`);
    else mal(`familia ${nombre} mal declarada: ${JSON.stringify(f && { cap: f.cap, paralelizable: f.paralelizable, tools: f.tools.map((t) => t.name) })}`);
  }
  if (LEXIE_SYSTEM_PROMPT.includes("AGENDA: BUSCAR, DESAMBIGUAR, MUTAR, RELATAR")) ok("el system prompt trae el tramo de agenda");
  else mal("el system prompt NO trae PROMPT_AGENDA");
  if (LEXIE_SYSTEM_PROMPT.includes("AGENDA (dónde se ve lo que hiciste)")) ok("el manual trae el tramo de agenda");
  else mal("el manual NO trae MANUAL_AGENDA");

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
  const ctxEj: CtxEjecucion = { usuarioId, nombre, clerkUserId: "user_test", gmail: async () => null };

  const previas = await borrarPruebas(usuarioId);
  if (previas > 0) console.log(`  (borré ${previas} evento(s) de prueba de una corrida anterior)`);

  try {
    // ============ 4. Crear directo ============
    console.log("\n=== 3. Crear: directo, con -03:00 y hora argentina ===");
    const tituloReunion = `${PREFIJO} reunión`;
    const inputCrear = { titulo: tituloReunion, clase: "evento", tipo: "reunion_cliente", fecha: fechaManana, hora: "10:00" };
    const c1 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.crear, inputCrear, ctxDe(usuarioId, nombre));
    const j1 = parse(c1.contentJSON);
    const eventoId = j1.evento_id as string | undefined;
    if (j1.ok === true && eventoId && c1.accion?.estado === "ok") {
      ok(`creado directo: ${j1.cuando} · google_motivo=${j1.google_motivo}`);
    } else {
      mal(`crear directo falló: ${c1.contentJSON}`);
    }
    if (c1.accion?.seccion === "agenda" && c1.accion.datos?.href === "/dashboard/agenda" && c1.accion.datos?.evento_id === eventoId) {
      ok("la acción lleva seccion agenda, href /dashboard/agenda y evento_id");
    } else {
      mal(`la acción no tiene el shape esperado: ${JSON.stringify(c1.accion)}`);
    }
    if (["ok", "sin_google", "sin_scope_calendar", "error"].includes(String(j1.google_motivo)) && typeof j1.google_synced === "boolean") {
      ok("google_synced/google_motivo vienen en el tool_result (sin_google es esperado bajo react-server)");
    } else {
      mal(`google_motivo inesperado: ${j1.google_motivo}`);
    }
    const fila = eventoId ? await getEventoById(eventoId, usuarioId) : null;
    if (fila) {
      const p = isoAPartesAR(fila.fecha_inicio);
      const pf = fila.fecha_fin ? isoAPartesAR(fila.fecha_fin) : null;
      if (p.h === 10 && p.mi === 0 && fechaDe(p) === fechaManana && pf?.h === 11) ok(`en la base son las 10:00–11:00 AR del ${fechaManana}`);
      else mal(`en la base quedó ${fila.fecha_inicio} → ${fila.fecha_fin}`);
      if (String(j1.cuando).endsWith("10:00–11:00") && CUANDO_RE.test(String(j1.cuando))) ok(`cuando legible: "${j1.cuando}"`);
      else mal(`cuando ilegible: "${j1.cuando}"`);
    } else {
      mal("el evento creado no se lee de la base");
    }

    // ============ 5. mi_agenda ============
    console.log("\n=== 4. mi_agenda: evento_id, cuando legible, sincronizado_google ===");
    const ag = parse((await ejecutarToolLexie("mi_agenda", { rango: "manana" }, ctxDe(usuarioId, nombre))).contentJSON);
    const filas = (ag.eventos ?? []) as Json[];
    const mia = filas.find((e) => e.evento_id === eventoId);
    if (mia) {
      ok(`mi_agenda trae el evento con evento_id (${filas.length} evento(s) mañana)`);
      if (CUANDO_RE.test(String(mia.cuando)) && String(mia.cuando).includes("10:00")) ok(`cuando en hora argentina con día de semana: "${mia.cuando}"`);
      else mal(`cuando de mi_agenda: "${mia.cuando}"`);
      if (typeof mia.sincronizado_google === "boolean" && mia.clase === "evento") ok("sincronizado_google booleano y clase presentes");
      else mal(`fila sin sincronizado_google/clase: ${JSON.stringify(mia)}`);
    } else {
      mal("mi_agenda (mañana) no trae el evento recién creado");
    }
    if (typeof ag.aviso === "string" && ag.aviso.length > 0) ok("conserva el aviso de agenda parcial");
    else mal("perdió AVISO_AGENDA_PARCIAL");

    // ============ 6. Dedupe ============
    console.log("\n=== 5. Dedupe: la misma de nuevo queda pendiente ===");
    const c2 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.crear, inputCrear, ctxDe(usuarioId, nombre));
    const j2 = parse(c2.contentJSON);
    const pendDup = c2.accion;
    if (j2.requiere_confirmacion === true && pendDup?.estado === "pendiente" && pendDup.clave && pendDup.payload) {
      ok(`duplicado → pendiente (clave ${pendDup.clave})`);
    } else {
      mal(`duplicado no quedó pendiente: ${c2.contentJSON}`);
    }
    if ((j2.evento_existente as Json | undefined)?.evento_id === eventoId && (pendDup?.payload as Json | undefined)?.forzar_duplicado === true) {
      ok("el tool_result trae el evento existente y el payload marca forzar_duplicado");
    } else {
      mal(`sin evento_existente/forzar_duplicado: ${c2.contentJSON}`);
    }
    const nDespues = (await ejecutarToolLexie("mi_agenda", { rango: "manana" }, ctxDe(usuarioId, nombre))).contentJSON;
    if ((parse(nDespues).eventos as Json[]).filter((e) => e.titulo === tituloReunion).length === 1) ok("no se creó un segundo evento");
    else mal("el dedupe dejó pasar un duplicado");

    // ============ 7. Buscar ============
    console.log("\n=== 6. agenda_buscar_evento ===");
    const b1 = parse((await ejecutarToolAgenda(AGENDA_TOOL_NAMES.buscar, { texto: "prueba lexie reunion" }, ctxDe(usuarioId, nombre))).contentJSON);
    const cand = (b1.candidatos as Json[]).find((c) => c.evento_id === eventoId);
    if (cand && CUANDO_RE.test(String(cand.cuando)) && typeof cand.sincronizado_google === "boolean") ok(`lo encuentra por texto sin tildes: "${cand.cuando}"`);
    else mal(`buscar por texto no lo encontró: ${JSON.stringify(b1)}`);
    const b2 = parse((await ejecutarToolAgenda(AGENDA_TOOL_NAMES.buscar, { texto: PREFIJO, rango: "manana" }, ctxDe(usuarioId, nombre))).contentJSON);
    if ((b2.candidatos as Json[]).some((c) => c.evento_id === eventoId) && b2.rango === "mañana") ok("lo encuentra con rango");
    else mal(`buscar con rango: ${JSON.stringify(b2)}`);
    const b3 = parse((await ejecutarToolAgenda(AGENDA_TOOL_NAMES.buscar, { texto: "zzz-no-existe-zzz" }, ctxDe(usuarioId, nombre))).contentJSON);
    if (b3.total === 0 && String(b3.nota).includes("sólo ves lo cargado")) ok("sin resultados avisa que la agenda es parcial");
    else mal(`sin resultados: ${JSON.stringify(b3)}`);
    const b4 = parse((await ejecutarToolAgenda(AGENDA_TOOL_NAMES.buscar, { rango: "hoy", texto: "x".repeat(200) }, ctxDe(usuarioId, nombre))).contentJSON);
    if (b4.ok === false) ok("texto de 200 caracteres se rechaza");
    else mal("aceptó texto > 120");

    // ============ 8. Editar ============
    console.log("\n=== 7. Editar: antes/después, conserva hora y duración ===");
    const tituloEditado = `${PREFIJO} reunión (editada)`;
    const e1 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.editar, { evento_id: eventoId, cambios: { titulo: tituloEditado } }, ctxDe(usuarioId, nombre));
    const je1 = parse(e1.contentJSON);
    if (je1.ok === true && (je1.antes as Json).titulo === tituloReunion && (je1.despues as Json).titulo === tituloEditado && e1.accion?.estado === "ok") {
      ok(`título editado: "${(je1.cambios as Json).titulo}"`);
    } else {
      mal(`editar título: ${e1.contentJSON}`);
    }
    if (e1.accion?.antes?.titulo === tituloReunion && CUANDO_RE.test(String((je1.antes as Json).cuando))) ok("la acción guarda el antes crudo y el cuando legible");
    else mal(`accion.antes: ${JSON.stringify(e1.accion?.antes)}`);

    const e2 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.editar, { evento_id: eventoId, cambios: { fecha: fechaDe(pasado) } }, ctxDe(usuarioId, nombre));
    const je2 = parse(e2.contentJSON);
    const filaMovida = await getEventoById(eventoId!, usuarioId);
    if (je2.ok === true && filaMovida && fechaDe(isoAPartesAR(filaMovida.fecha_inicio)) === fechaDe(pasado) && String((je2.despues as Json).cuando).endsWith("10:00–11:00")) {
      ok(`sólo cambió la fecha: conserva 10:00–11:00 → "${(je2.despues as Json).cuando}"`);
    } else {
      mal(`mover de día: ${e2.contentJSON}`);
    }
    const e3 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.editar, { evento_id: eventoId, cambios: { hora: "15:30", duracion_min: 30 } }, ctxDe(usuarioId, nombre));
    if (String((parse(e3.contentJSON).despues as Json).cuando).endsWith("15:30–16:00")) ok("hora + duración nuevas, mismo día");
    else mal(`hora+duración: ${e3.contentJSON}`);
    const e4 = parse((await ejecutarToolAgenda(AGENDA_TOOL_NAMES.editar, { evento_id: eventoId, cambios: {} }, ctxDe(usuarioId, nombre))).contentJSON);
    if (e4.ok === false && String(e4.motivo).includes("ningún cambio")) ok("cambios vacíos → ok:false");
    else mal(`cambios vacíos: ${JSON.stringify(e4)}`);
    const e5 = parse((await ejecutarToolAgenda(AGENDA_TOOL_NAMES.editar, { evento_id: eventoId, cambios: { completado: true } }, ctxDe(usuarioId, nombre))).contentJSON);
    if (e5.ok === true && (e5.despues as Json).completado === true) ok("marcar completado (la alternativa suave a eliminar)");
    else mal(`completado: ${JSON.stringify(e5)}`);

    // ============ 9. Aislamiento ============
    console.log("\n=== 8. Aislamiento entre abogados ===");
    const { data: ajeno } = await supabase
      .from("eventos_agenda")
      .select("id, titulo")
      .neq("usuario_id", usuarioId)
      .limit(1)
      .maybeSingle();
    if (ajeno) {
      const rA = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.editar, { evento_id: ajeno.id, cambios: { titulo: "hackeado" } }, ctxDe(usuarioId, nombre));
      const jA = parse(rA.contentJSON);
      if (jA.ok === false && !rA.contentJSON.includes(String(ajeno.titulo))) ok(`editar un evento de OTRO abogado → "${jA.motivo}"`);
      else mal(`FUGA: editar id ajeno devolvió ${rA.contentJSON}`);
      const rB = parse((await ejecutarToolAgenda(AGENDA_TOOL_NAMES.eliminar, { evento_id: ajeno.id }, ctxDe(usuarioId, nombre))).contentJSON);
      if (rB.ok === false && rB.requiere_confirmacion !== true) ok("eliminar un evento ajeno no llega a la vista previa");
      else mal(`FUGA: eliminar id ajeno devolvió ${JSON.stringify(rB)}`);
      const sigue = await supabase.from("eventos_agenda").select("titulo").eq("id", ajeno.id).maybeSingle();
      if (sigue.data?.titulo === ajeno.titulo) ok("el evento ajeno sigue intacto");
      else mal("el evento ajeno CAMBIÓ");
    } else {
      console.log("  (no hay eventos de otros usuarios para probar la fuga)");
    }
    const { data: casoAjeno } = await supabase.from("casos").select("id").neq("usuario_id", usuarioId).limit(1).maybeSingle();
    if (casoAjeno) {
      const rC = parse((await ejecutarToolAgenda(AGENDA_TOOL_NAMES.crear, { ...inputCrear, titulo: `${PREFIJO} ajena`, caso_id: casoAjeno.id }, ctxDe(usuarioId, nombre))).contentJSON);
      if (rC.ok === false && String(rC.motivo).includes("No existe ninguna causa")) ok("crear con caso_id de otro abogado → no existe");
      else mal(`FUGA: caso ajeno aceptado: ${JSON.stringify(rC)}`);
      const rD = parse((await ejecutarToolAgenda(AGENDA_TOOL_NAMES.buscar, { caso_id: casoAjeno.id }, ctxDe(usuarioId, nombre))).contentJSON);
      if (rD.ok === false) ok("buscar por caso_id ajeno → no existe");
      else mal(`FUGA: buscar por caso ajeno devolvió ${JSON.stringify(rD)}`);
    }
    const rI = parse((await ejecutarToolAgenda(AGENDA_TOOL_NAMES.editar, { evento_id: "11111111-2222-3333-4444-555555555555", cambios: { titulo: "x" } }, ctxDe(usuarioId, nombre))).contentJSON);
    if (rI.ok === false) ok("un evento_id inventado → no existe");
    else mal("aceptó un id inventado");

    // ============ 10. Eliminar: el protocolo entero ============
    console.log("\n=== 9. Eliminar: pendiente → rechazo sin siembra → ejecución con siembra ===");
    const d1 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.eliminar, { evento_id: eventoId }, ctxDe(usuarioId, nombre));
    const jd1 = parse(d1.contentJSON);
    const pendElim = d1.accion as AccionLexie;
    if (jd1.requiere_confirmacion === true && pendElim?.estado === "pendiente" && pendElim.clave && (pendElim.payload as Json).evento_id === eventoId) {
      ok(`sin confirmar → pendiente con payload {evento_id} (clave ${pendElim.clave})`);
    } else {
      mal(`eliminar sin confirmar: ${d1.contentJSON}`);
    }
    const vp = (jd1.vista_previa ?? {}) as Json;
    if (vp.titulo === tituloEditado && CUANDO_RE.test(String(vp.cuando)) && typeof vp.google === "string" && pendElim?.antes?.titulo === tituloEditado) {
      ok(`vista previa: "${vp.titulo}" · ${vp.cuando} · ${vp.google}`);
    } else {
      mal(`vista previa incompleta: ${JSON.stringify(vp)} / antes ${JSON.stringify(pendElim?.antes)}`);
    }
    if (String(jd1.sugerencia).includes("completado")) ok("la nota ofrece marcar completado como alternativa");
    else mal("la nota no menciona la alternativa de completar");

    const d2 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.eliminar, { evento_id: eventoId, confirmar: true }, ctxDe(usuarioId, nombre));
    const jd2 = parse(d2.contentJSON);
    if (jd2.ok === false && jd2.requiere_confirmacion !== true && d2.accion?.estado === "rechazada") ok("confirmar:true sin siembra → rechazo");
    else mal(`confirmar sin siembra: ${d2.contentJSON}`);
    const d2b = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.eliminar, { clave: "agenda_eliminar_evento:inventada", confirmar: true }, ctxDe(usuarioId, nombre));
    if (parse(d2b.contentJSON).ok === false && d2b.accion?.estado === "rechazada") ok("una clave inventada → rechazo");
    else mal(`clave inventada: ${d2b.contentJSON}`);
    if (await getEventoById(eventoId!, usuarioId)) ok("el evento sigue existiendo");
    else mal("el evento se borró SIN confirmación válida");

    // ejecutarPendiente con `antes` alterado: cambió desde que lo vio.
    const alterada: AccionLexie = { ...pendElim, antes: { ...pendElim.antes, titulo: "otro título" } };
    const rAlt = await DOMINIO_AGENDA.ejecutarPendiente(alterada, ctxEj);
    if (rAlt?.estado === "rechazada" && String(rAlt.motivo).includes("Cambió desde que lo viste")) ok(`antes alterado → rechazada: "${rAlt.motivo}"`);
    else mal(`antes alterado: ${JSON.stringify(rAlt)}`);
    if (await getEventoById(eventoId!, usuarioId)) ok("y el evento sigue ahí");
    else mal("el evento se borró con el antes alterado");

    // Con siembra, por TEXTO: la tool ejecuta el payload persistido.
    const ctxSembrado = ctxDe(usuarioId, nombre, { accionesPendientes: new Map([[pendElim.clave!, pendElim]]) });
    const d3 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.eliminar, { clave: pendElim.clave, confirmar: true }, ctxSembrado);
    const jd3 = parse(d3.contentJSON);
    if (jd3.ok === true && d3.accion?.estado === "ok" && d3.accion.confirmado_por === "texto" && d3.accion.payload === undefined) {
      ok(`con siembra → ejecutada: "${d3.accion.resumen}"`);
    } else {
      mal(`con siembra: ${d3.contentJSON} / ${JSON.stringify(d3.accion)}`);
    }
    if (ctxSembrado.clavesConsumidas.has(pendElim.clave!)) ok("la clave quedó consumida");
    else mal("la clave NO quedó consumida");
    if ((await getEventoById(eventoId!, usuarioId)) === null) ok("el evento ya no está en la base");
    else mal("el evento sigue después de confirmar");
    const d4 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.eliminar, { clave: pendElim.clave, confirmar: true }, ctxSembrado);
    if (parse(d4.contentJSON).ok === false && d4.accion?.estado === "rechazada") ok("repetir la misma clave en el mismo turno → rechazo");
    else mal(`clave repetida: ${d4.contentJSON}`);
    const d5 = await DOMINIO_AGENDA.ejecutarPendiente(pendElim, ctxEj);
    if (d5?.estado === "rechazada" && String(d5.motivo).includes("ya no está")) ok("ejecutar la pendiente de un evento borrado → rechazada «ya no está»");
    else mal(`pendiente sobre borrado: ${JSON.stringify(d5)}`);

    // ============ 11. Cuarentena ============
    console.log("\n=== 10. Cuarentena de correo: lo directo queda pendiente ===");
    const ctxQ = ctxDe(usuarioId, nombre, { correoLeido: true });
    const q1 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.crear, { titulo: `${PREFIJO} tarea`, clase: "tarea", tipo: "tramite_administrativo", fecha: fechaManana }, ctxQ);
    const jq1 = parse(q1.contentJSON);
    if (jq1.requiere_confirmacion === true && q1.accion?.estado === "pendiente" && String(jq1.sugerencia).includes(NOTA_CUARENTENA.slice(0, 40))) {
      ok("crear en cuarentena → pendiente con la nota de cuarentena");
    } else {
      mal(`crear en cuarentena: ${q1.contentJSON}`);
    }
    if ((await ejecutarToolAgenda(AGENDA_TOOL_NAMES.buscar, { texto: `${PREFIJO} tarea` }, ctxQ)).contentJSON.includes('"total":0')) ok("y no se creó nada");
    else mal("la cuarentena dejó crear");
    const rq = await DOMINIO_AGENDA.ejecutarPendiente(q1.accion as AccionLexie, ctxEj);
    const tareaId = rq?.datos?.evento_id as string | undefined;
    const tarea = tareaId ? await getEventoById(tareaId, usuarioId) : null;
    if (rq?.estado === "ok" && tarea?.todo_el_dia === true && tarea.clase === "tarea" && rq.datos?.google_synced === false) {
      ok(`ejecutar la pendiente crea la tarea: "${rq.resumen}" (sin Google, es tarea)`);
    } else {
      mal(`ejecutarPendiente(crear): ${JSON.stringify(rq)}`);
    }
    const q2 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.editar, { evento_id: tareaId, cambios: { titulo: `${PREFIJO} tarea 2` } }, ctxQ);
    if (parse(q2.contentJSON).requiere_confirmacion === true && q2.accion?.estado === "pendiente" && q2.accion.antes?.titulo === `${PREFIJO} tarea`) {
      ok("editar en cuarentena → pendiente con antes");
    } else {
      mal(`editar en cuarentena: ${q2.contentJSON}`);
    }
    const rq2 = await DOMINIO_AGENDA.ejecutarPendiente(q2.accion as AccionLexie, ctxEj);
    if (rq2?.estado === "ok" && (await getEventoById(tareaId!, usuarioId))?.titulo === `${PREFIJO} tarea 2`) ok("ejecutar la pendiente de edición aplica el patch persistido");
    else mal(`ejecutarPendiente(editar): ${JSON.stringify(rq2)}`);
    const rq3 = await DOMINIO_AGENDA.ejecutarPendiente(q2.accion as AccionLexie, ctxEj);
    if (rq3?.estado === "rechazada") ok("volver a ejecutar la misma edición → rechazada (el título ya cambió)");
    else mal(`re-ejecutar edición: ${JSON.stringify(rq3)}`);

    // ============ 12. Dedupe confirmado ============
    console.log("\n=== 11. Crear por duplicado confirmado ===");
    const rDup = await DOMINIO_AGENDA.ejecutarPendiente(pendDup as AccionLexie, ctxEj);
    if (rDup?.estado === "ok" && rDup.datos?.evento_id && rDup.datos.href === "/dashboard/agenda") ok(`la pendiente por duplicado crea al confirmar: "${rDup.resumen}"`);
    else mal(`ejecutarPendiente(dedupe): ${JSON.stringify(rDup)}`);

    // ============ 13. Vencimiento ============
    console.log("\n=== 12. Vencimiento sólo con fecha dictada ===");
    const venc = { titulo: `${PREFIJO} vence apelación`, clase: "evento", tipo: "vencimiento_procesal", fecha: fechaDe(pasado), todo_el_dia: true };
    const v1 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.crear, venc, ctxDe(usuarioId, nombre, { mensajesAbogado: ["cargame el vencimiento de la apelación, me notificaron el martes"] }));
    const jv1 = parse(v1.contentJSON);
    if (jv1.ok === false && String(jv1.motivo).includes("no calcula plazos") && v1.accion?.estado === "rechazada") ok("fecha no dictada → rechazo «LEXIE no calcula plazos»");
    else mal(`vencimiento sin fecha dictada: ${v1.contentJSON}`);
    const dictado = `vence el ${pasado.d}/${pasado.mo + 1}`;
    const v2 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.crear, venc, ctxDe(usuarioId, nombre, { mensajesAbogado: [dictado] }));
    if (parse(v2.contentJSON).ok === true) ok(`fecha dictada («${dictado}») → creado`);
    else mal(`vencimiento con fecha dictada: ${v2.contentJSON}`);
    const v3 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.crear, { ...venc, titulo: `${PREFIJO} vence casación` }, ctxDe(usuarioId, nombre, { mensajesAbogado: ["la casación vence pasado mañana"] }));
    if (parse(v3.contentJSON).ok === true) ok("«pasado mañana» cuenta como dictado si coincide con el día");
    else mal(`pasado mañana: ${v3.contentJSON}`);

    // ============ 14. Input inválido ============
    console.log("\n=== 13. Input inválido ===");
    const i1 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.crear, { ...inputCrear, hora: "25:00" }, ctxDe(usuarioId, nombre));
    if (i1.isError && parse(i1.contentJSON).ok === false) ok("hora 25:00 → isError");
    else mal(`hora inválida: ${i1.contentJSON}`);
    const i2 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.crear, { ...inputCrear, hora: undefined }, ctxDe(usuarioId, nombre));
    if (i2.isError && String(parse(i2.contentJSON).motivo).includes("necesita hora")) ok("evento sin hora → pide la hora");
    else mal(`evento sin hora: ${i2.contentJSON}`);
    const i3 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.crear, { ...inputCrear, tipo: "cumpleanos" }, ctxDe(usuarioId, nombre));
    if (i3.isError) ok("tipo fuera del enum → isError");
    else mal(`tipo inválido: ${i3.contentJSON}`);
    const i4 = await ejecutarToolAgenda(AGENDA_TOOL_NAMES.editar, { evento_id: "no-es-uuid" }, ctxDe(usuarioId, nombre));
    if (i4.isError) ok("evento_id que no es UUID → isError");
    else mal(`evento_id inválido: ${i4.contentJSON}`);
  } finally {
    const borrados = await borrarPruebas(usuarioId);
    console.log(`\n  limpieza: ${borrados} evento(s) "${PREFIJO} …" borrado(s)`);
    const { count } = await supabase
      .from("eventos_agenda")
      .select("id", { count: "exact", head: true })
      .eq("usuario_id", usuarioId)
      .like("titulo", `${PREFIJO}%`);
    if ((count ?? 0) === 0) ok("no quedó ningún evento de prueba");
    else mal(`quedaron ${count} eventos de prueba`);
  }

  resultado();
}

function resultado() {
  console.log("\n=== VEREDICTO ===");
  if (fallas.length === 0) {
    console.log("OK — las tools de agenda crean con -03:00, dedupean, editan por id, eliminan sólo confirmadas y respetan el aislamiento.");
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
