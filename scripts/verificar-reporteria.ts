// Verificación de la Fase 12 (reportería al cliente).
//
// Tres modos:
//   --puro        SOLO las funciones puras (plantillas, render, datos,
//                 sugerencia). No toca la base ni el modelo y no necesita
//                 .env.local. Es lo que corrió Claude Code al escribir la fase.
//   --sin-modelo  Lo puro + la migración sondeada por PostgREST + el pre-vuelo
//                 sobre una causa real. Gratis, de sólo lectura.
//   (nada)        Todo lo anterior + UNA generación real (~USD 0,02) que NO se
//                 persiste (corre runReporte a secas).
//
//   npx tsx scripts/verificar-reporteria.ts --puro
//   DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server \
//     --import dotenv/config scripts/verificar-reporteria.ts [--sin-modelo]

import { PLANTILLAS, camposAplicables, plantillaPorId, variantePorId } from "../src/lib/reporteria/plantillas";
import { condicionesDe, renderizarAsunto, renderizarReporte, variablesDe } from "../src/lib/reporteria/render";
import { armarDatosReporte, nombreDePila, fechaColoquial, mesAño } from "../src/lib/reporteria/datos";
import { sugerirPlantilla } from "../src/lib/reporteria/sugerir";
import { contarMarcasReporte, marcasReporte } from "../src/lib/reporteria/types";
import type { Caso, EventoCaso, ParteCaso } from "../src/lib/types";

const PURO = process.argv.includes("--puro");
const SIN_MODELO = process.argv.includes("--sin-modelo");
const fallas: string[] = [];
const ok = (t: string) => console.log(`  ok   ${t}`);
const mal = (t: string) => {
  console.log(`  MAL  ${t}`);
  fallas.push(t);
};
const aviso = (t: string) => console.log(`  --   ${t}`);

// ————————————————————————————————————————————————————————————————
// Datos de prueba
// ————————————————————————————————————————————————————————————————

const AHORA = new Date("2026-09-15T15:00:00-03:00");

const CASO: Caso = {
  id: "11111111-1111-4111-8111-111111111111",
  usuario_id: "22222222-2222-4222-8222-222222222222",
  titulo: "El 3 de julio de 2026, cerca de las 04:15",
  caso_descripcion: "relato",
  contexto: null,
  rol: "defensor",
  ejecucion_origen_id: null,
  estrategia_seleccionada_rol: "defensor",
  estrategia_seleccionada_idx: 0,
  estrategia_snapshot: {} as Caso["estrategia_snapshot"],
  creado_en: "2026-07-03T10:00:00Z",
  actualizado_en: "2026-09-10T10:00:00Z",
  fuero: "nacion",
  caratula: "Pérez, Juan s/ robo",
  expediente_numero: "12345/2026",
  organismo: "Juzgado Nacional en lo Criminal y Correccional N° 12",
  secretaria: null,
  juez: "Dr. Martínez",
  fiscalia: null,
  delitos: ["Robo simple"],
  estado_seguimiento: "activa",
};

const PARTES: ParteCaso[] = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    caso_id: CASO.id,
    nombre: "Pérez, Juan Carlos",
    rol: "imputado",
    es_cliente: true,
    situacion_libertad: "libre",
    documento: "DNI 30.123.456",
    telefono: "+54 9 11 5555-5555",
    email: "juan@example.com",
    creado_en: "2026-07-03T10:00:00Z",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    caso_id: CASO.id,
    nombre: "Gómez, Marta",
    rol: "victima",
    es_cliente: false,
    situacion_libertad: null,
    documento: null,
    telefono: null,
    email: null,
    creado_en: "2026-07-03T10:00:00Z",
  },
];

function evento(descripcion: string, categoria: EventoCaso["categoria"], iso: string, estado: EventoCaso["estado"] = "sucedido"): EventoCaso {
  return {
    id: `ev-${iso}`,
    tipo: "manual",
    categoria,
    descripcion,
    ocurrido_en: iso,
    estado,
    creado_en: iso,
    adjuntos: [],
  };
}

const PERFIL = {
  nombre_completo: "Dr. Mateo Morbiducci",
  matricula: null,
  domicilio_constituido: null,
  domicilio_electronico: null,
};

// ————————————————————————————————————————————————————————————————
// 1. Plantillas: consistencia entre texto y definición
// ————————————————————————————————————————————————————————————————

function verificarPlantillas() {
  console.log("\n=== 1. Plantillas ===");
  if (PLANTILLAS.length === 6) ok("6 plantillas");
  else mal(`${PLANTILLAS.length} plantillas`);
  for (const p of PLANTILLAS) {
    const enTexto = new Set(variablesDe(p.texto));
    const declaradas = new Set(p.variables.map((v) => v.clave));
    const sinDeclarar = [...enTexto].filter((v) => !declaradas.has(v));
    const sinUsar = [...declaradas].filter((v) => !enTexto.has(v));
    if (sinDeclarar.length === 0) ok(`${p.codigo}: todas las variables del texto están declaradas`);
    else mal(`${p.codigo}: variables sin declarar: ${sinDeclarar.join(", ")}`);
    if (sinUsar.length === 0) ok(`${p.codigo}: todas las declaradas se usan`);
    else mal(`${p.codigo}: declaradas sin usar: ${sinUsar.join(", ")}`);

    const tags = new Set(condicionesDe(p.texto));
    const decl = new Set(p.condiciones.map((c) => c.tag));
    const tagsSin = [...tags].filter((t) => !decl.has(t));
    if (tagsSin.length === 0) ok(`${p.codigo}: condiciones declaradas (${tags.size})`);
    else mal(`${p.codigo}: condiciones sin declarar: ${tagsSin.join(", ")}`);
    // Cada {{#TAG}} tiene su {{/TAG}}.
    for (const t of tags) {
      if (!p.texto.includes(`{{/${t}}}`)) mal(`${p.codigo}: {{#${t}}} sin cierre`);
    }
    // Los campos de criterio alimentan una variable o una condición.
    for (const c of p.campos_criterio) {
      const esVar = declaradas.has(c.clave);
      const esTag = decl.has(c.clave);
      if (!esVar && !esTag) mal(`${p.codigo}: campo ${c.clave} no alimenta nada`);
      if (c.tipo === "checkbox" && !esTag) mal(`${p.codigo}: checkbox ${c.clave} sin condición`);
      if (c.solo_variantes) {
        for (const v of c.solo_variantes) {
          if (!p.variantes.some((x) => x.id === v)) mal(`${p.codigo}: campo ${c.clave} nombra variante inexistente ${v}`);
        }
      }
    }
    for (const v of p.variantes) {
      for (const t of v.condiciones) if (!decl.has(t)) mal(`${p.codigo}/${v.id}: enciende tag inexistente ${t}`);
    }
    if (renderizarAsunto(p, { MES_AÑO: "Septiembre 2026" }).length > 0) ok(`${p.codigo}: asunto renderiza`);
  }
}

// ————————————————————————————————————————————————————————————————
// 2. Datos + sugerencia
// ————————————————————————————————————————————————————————————————

function verificarDatosYSugerencia() {
  console.log("\n=== 2. Datos y sugerencia ===");
  if (nombreDePila("Pérez, Juan Carlos") === "Juan") ok("nombre de pila con coma");
  else mal(`nombreDePila coma → ${nombreDePila("Pérez, Juan Carlos")}`);
  if (nombreDePila("Juan Pérez") === "Juan") ok("nombre de pila sin coma");
  else mal("nombreDePila sin coma");
  if (mesAño(AHORA) === "Septiembre 2026") ok(`mesAño → ${mesAño(AHORA)}`);
  else mal(`mesAño → ${mesAño(AHORA)}`);
  const fc = fechaColoquial("2026-09-08T13:00:00-03:00", AHORA);
  if (/^el martes 8 de septiembre$/.test(fc)) ok(`fechaColoquial → «${fc}»`);
  else mal(`fechaColoquial → «${fc}»`);

  // Sin eventos ni agenda → P01, sin próximo paso.
  const base = armarDatosReporte({
    caso: CASO,
    partes: PARTES,
    parteId: PARTES[0].id,
    eventos: [],
    agenda: [],
    etapa: { etapa: 2, label: "Investigación", nodoTitulo: "Instrucción (Sumario)" },
    perfil: PERFIL,
    nombreUsuario: "Mateo",
    ahora: AHORA,
  });
  if (base.valores.NOMBRE_CLIENTE === "Juan") ok("NOMBRE_CLIENTE del destinatario");
  else mal(`NOMBRE_CLIENTE → ${base.valores.NOMBRE_CLIENTE}`);
  if (base.clientes.length === 1) ok("sólo las partes marcadas como cliente");
  else mal(`clientes → ${base.clientes.length}`);
  if (base.valores.ETAPA_PROCESAL_COLOQUIAL === "la etapa de investigación") ok("etapa traducida");
  else mal(`etapa → ${base.valores.ETAPA_PROCESAL_COLOQUIAL}`);
  if (base.valores.ULTIMO_MOVIMIENTO === null) ok("sin movimientos → ULTIMO_MOVIMIENTO null (no se inventa)");
  else mal("ULTIMO_MOVIMIENTO inventado");
  if (base.valores.RESUMEN_MOVIMIENTOS_MES?.startsWith("Este mes no hubo movimientos")) ok("resumen del mes sin movimientos: frase acordada");
  else mal("resumen del mes vacío mal");
  const s0 = sugerirPlantilla(base, AHORA);
  if (s0.plantilla === "P01") ok(`sin hitos → ${s0.plantilla}`);
  else mal(`sin hitos → ${s0.plantilla}`);

  // Resolución reciente → P02; sentencia → P04; recurso → P05; debate → P03.
  const conProc = armarDatosReporte({
    caso: CASO,
    partes: PARTES,
    parteId: PARTES[0].id,
    eventos: [
      evento("Escrito de excarcelación presentado", "escrito_presentado", "2026-08-01T12:00:00-03:00"),
      evento("El juzgado dictó el procesamiento sin prisión preventiva", "resolucion_recibida", "2026-09-10T12:00:00-03:00"),
      evento("Audiencia fijada", "audiencia", "2026-10-20T10:00:00-03:00", "pendiente"),
    ],
    agenda: [],
    etapa: { etapa: 2, label: "Investigación", nodoTitulo: "x" },
    perfil: PERFIL,
    nombreUsuario: "Mateo",
    ahora: AHORA,
  });
  if (conProc.ultimo_movimiento?.descripcion.includes("procesamiento")) ok("último movimiento = el sucedido más reciente (ignora pendientes futuros)");
  else mal(`último movimiento → ${conProc.ultimo_movimiento?.descripcion}`);
  if (conProc.movimientos_mes.length === 1) ok("movimientos del mes: sólo los últimos 30 días");
  else mal(`movimientos del mes → ${conProc.movimientos_mes.length}`);
  if (sugerirPlantilla(conProc, AHORA).plantilla === "P02") ok("procesamiento reciente → P02");
  else mal(`procesamiento → ${sugerirPlantilla(conProc, AHORA).plantilla}`);

  const conSentencia = armarDatosReporte({
    ...entrada(),
    eventos: [evento("Sentencia condenatoria a 3 años", "resolucion_recibida", "2026-09-12T12:00:00-03:00")],
  });
  if (sugerirPlantilla(conSentencia, AHORA).plantilla === "P04") ok("sentencia → P04");
  else mal("sentencia → " + sugerirPlantilla(conSentencia, AHORA).plantilla);

  const conRecurso = armarDatosReporte({
    ...entrada(),
    eventos: [evento("Presentación de escrito: Recurso de apelación", "escrito_presentado", "2026-09-12T12:00:00-03:00")],
  });
  if (sugerirPlantilla(conRecurso, AHORA).plantilla === "P05") ok("recurso presentado → P05");
  else mal("recurso → " + sugerirPlantilla(conRecurso, AHORA).plantilla);

  const conDebate = armarDatosReporte({
    ...entrada(),
    eventos: [evento("Sentencia condenatoria", "resolucion_recibida", "2026-09-12T12:00:00-03:00")],
    agenda: [
      { id: "a1", titulo: "Audiencia de debate oral", tipo: "audiencia", fecha_inicio: "2026-09-25T09:30:00-03:00", todo_el_dia: false },
      { id: "a2", titulo: "Reunión preparatoria con Juan", tipo: "reunion_cliente", fecha_inicio: "2026-09-22T17:00:00-03:00", todo_el_dia: false },
    ],
  });
  const sd = sugerirPlantilla(conDebate, AHORA);
  if (sd.plantilla === "P03") ok(`debate a ${conDebate.dias_hasta_debate} días → P03 (gana a la sentencia)`);
  else mal(`debate → ${sd.plantilla}`);
  if (conDebate.valores.FECHA_DEBATE === "viernes 25 de septiembre" && conDebate.valores.HORA_INICIO === "09:30") ok("FECHA_DEBATE y HORA_INICIO desde la agenda");
  else mal(`debate → ${conDebate.valores.FECHA_DEBATE} ${conDebate.valores.HORA_INICIO}`);
  if (conDebate.valores.FECHA_REUNION_PREPARATORIA?.includes("22 de septiembre")) ok("reunión preparatoria desde la agenda");
  else mal(`reunión → ${conDebate.valores.FECHA_REUNION_PREPARATORIA}`);

  const viejo = armarDatosReporte({
    ...entrada(),
    eventos: [evento("Procesamiento", "resolucion_recibida", "2026-06-01T12:00:00-03:00")],
  });
  if (sugerirPlantilla(viejo, AHORA).plantilla === "P01") ok("resolución de hace 3 meses ya no sugiere P02");
  else mal("resolución vieja → " + sugerirPlantilla(viejo, AHORA).plantilla);

  function entrada() {
    return {
      caso: CASO,
      partes: PARTES,
      parteId: PARTES[0].id,
      eventos: [] as EventoCaso[],
      agenda: [],
      etapa: { etapa: 2 as const, label: "Investigación", nodoTitulo: "x" },
      perfil: PERFIL,
      nombreUsuario: "Mateo",
      ahora: AHORA,
    };
  }
  return { base, conProc, conDebate };
}

// ————————————————————————————————————————————————————————————————
// 3. Render
// ————————————————————————————————————————————————————————————————

function verificarRender(datos: ReturnType<typeof verificarDatosYSugerencia>) {
  console.log("\n=== 3. Render determinístico ===");
  const P01 = plantillaPorId("P01")!;
  const P02 = plantillaPorId("P02")!;
  const P04 = plantillaPorId("P04")!;
  const P06 = plantillaPorId("P06")!;

  // P01 sin criterio: hay marcas para lo que falta, no se inventa nada.
  const r1 = renderizarReporte({
    plantilla: P01,
    variante: null,
    rolEstudio: "defensor",
    valoresSistema: datos.base.valores,
    criterio: {},
  });
  if (r1.texto.includes("Hola Juan,")) ok("P01: saluda por el nombre de pila");
  else mal("P01: sin nombre");
  if (r1.texto.includes("[FALTA: último movimiento]")) ok("P01: último movimiento faltante marcado");
  else mal(`P01: no marcó el último movimiento\n${r1.texto}`);
  if (r1.texto.includes("[FALTA: ritmo de la causa]")) ok("P01: ritmo (criterio requerido) marcado");
  else mal("P01: ritmo sin marcar");
  if (!r1.texto.includes("Lo que sigue es")) ok("P01: sin próximo paso → bloque omitido");
  else mal("P01: bloque de próximo paso apareció sin dato");
  if (r1.texto.includes("Por tu parte no hay nada que hacer")) ok("P01: sin acción del cliente → bloque «nada que hacer»");
  else mal("P01: bloque CLIENTE_SIN_ACCION no apareció");
  if (!r1.texto.includes("{{")) ok("P01: sin variables sin resolver");
  else mal("P01: quedaron {{}}");
  if (!/\(\s*\)/.test(r1.texto) && !/\.\s*\./.test(r1.texto)) ok("P01: sin restos de puntuación");
  else mal(`P01: restos de puntuación\n${r1.texto}`);

  // P01 con criterio completo.
  const r1b = renderizarReporte({
    plantilla: P01,
    variante: null,
    rolEstudio: "defensor",
    valoresSistema: datos.conProc.valores,
    criterio: {
      RITMO_COLOQUIAL: "lento",
      PROXIMO_PASO_COLOQUIAL: "la audiencia de excarcelación",
      FECHA_O_PLAZO_ESTIMADO: "las próximas dos semanas",
      ACCION_CLIENTE: "nos mandes el recibo de sueldo",
    },
  });
  if (r1b.texto.includes("más lento de lo esperado (es habitual)")) ok("P01: opción → texto de la opción");
  else mal("P01: opción no mapeada");
  if (r1b.texto.includes("Lo que sigue es la audiencia de excarcelación, que está estimado para las próximas dos semanas.")) ok("P01: bloque de próximo paso con criterio");
  else mal(`P01: próximo paso\n${r1b.texto}`);
  if (r1b.texto.includes("necesitamos que nos mandes el recibo de sueldo") && !r1b.texto.includes("no hay nada que hacer")) ok("P01: CLIENTE_DEBE_ACTUAR excluye CLIENTE_SIN_ACCION");
  else mal("P01: condiciones de acción del cliente");
  if (contarMarcasReporte(r1b.texto) === 0) ok("P01 completo: cero marcas");
  else mal(`P01 completo: marcas ${marcasReporte(r1b.texto).join(", ")}`);

  // P02 procesamiento sin SE_RECURRE: no promete recurso.
  const proc = variantePorId(P02, "procesamiento")!;
  const r2 = renderizarReporte({
    plantilla: P02,
    variante: proc,
    rolEstudio: "defensor",
    valoresSistema: datos.conProc.valores,
    criterio: { RESPUESTA_ESTRATEGICA: "vamos a pelear el procesamiento", PROXIMO_PASO: "que el fiscal decida", PLAZO_ESTIMADO: "en semanas" },
  });
  if (r2.texto.includes("resolvió procesarte") && r2.condiciones.DESFAVORABLE && !r2.condiciones.FAVORABLE) ok("P02 procesamiento: desfavorable con texto de la variante");
  else mal("P02 procesamiento: condiciones/valores");
  if (!r2.texto.includes("Vamos a apelar")) ok("P02: sin SE_RECURRE no promete recurso");
  else mal("P02: prometió recurso sin decisión");
  if (r2.texto.includes("Dr. Martínez")) ok("P02: juez desde la ficha");
  else mal("P02: juez");
  const r2b = renderizarReporte({
    plantilla: P02,
    variante: proc,
    rolEstudio: "defensor",
    valoresSistema: datos.conProc.valores,
    criterio: { RESPUESTA_ESTRATEGICA: "x", SE_RECURRE: true, ARGUMENTO_RECURSO: "la prueba es nula", PROXIMO_PASO: "y", PLAZO_ESTIMADO: "z" },
  });
  if (r2b.texto.includes("Vamos a apelar porque la prueba es nula.")) ok("P02: SE_RECURRE anidado dentro de DESFAVORABLE");
  else mal(`P02: anidado\n${r2b.texto}`);
  // Querella: el mismo procesamiento es favorable y nombra al imputado.
  const r2q = renderizarReporte({
    plantilla: P02,
    variante: proc,
    rolEstudio: "querellante",
    valoresSistema: { ...datos.conProc.valores, NOMBRE_IMPUTADO: "Carlos López" },
    criterio: { PROXIMO_PASO: "y", PLAZO_ESTIMADO: "z" },
  });
  if (r2q.condiciones.FAVORABLE && r2q.texto.includes("procesar a Carlos López")) ok("P02 querella: favorable y con el imputado nombrado");
  else mal(`P02 querella\n${r2q.texto}`);

  // Sin IA: prisión preventiva → cabecera + [REDACTAR] + cierre, sin cuerpo.
  const pp = variantePorId(P02, "prision_preventiva")!;
  const r3 = renderizarReporte({
    plantilla: P02,
    variante: pp,
    rolEstudio: "defensor",
    valoresSistema: datos.conProc.valores,
    criterio: {},
  });
  if (r3.sin_ia && r3.texto.includes("[REDACTAR:") && r3.texto.includes("prisión preventiva") && !r3.texto.includes("no te preocupés")) ok("P02 prisión preventiva: sin IA, cuerpo a redactar");
  else mal(`P02 preventiva\n${r3.texto}`);
  const cond = variantePorId(P04, "condenatoria")!;
  const r4 = renderizarReporte({
    plantilla: P04,
    variante: cond,
    rolEstudio: "defensor",
    valoresSistema: datos.base.valores,
    criterio: {},
  });
  if (r4.sin_ia && contarMarcasReporte(r4.texto) >= 1 && r4.texto.includes("Dr. Mateo Morbiducci")) ok("P04 condena: sin IA, firma del perfil");
  else mal(`P04 condena\n${r4.texto}`);

  // P06: sistema completo salvo próximos pasos.
  const r6 = renderizarReporte({
    plantilla: P06,
    variante: null,
    rolEstudio: "defensor",
    valoresSistema: datos.conDebate.valores,
    criterio: {},
  });
  if (r6.texto.includes("Septiembre 2026") && r6.texto.includes("BraCar Asociados")) ok("P06: mes y estudio");
  else mal("P06: mes/estudio");
  // El próximo evento de la agenda es la reunión del 22, antes que el debate del 25.
  if (r6.texto.includes("Reunión preparatoria con Juan") && r6.texto.includes("Está previsto para el martes 22 de septiembre a las 17:00."))
    ok("P06: próximos pasos propuestos desde el primer evento de la agenda");
  else mal(`P06: próximos\n${r6.texto}`);
  if (r6.texto.includes("N° 12. La fiscalía")) ok("P06: la explicación de la etapa arranca en mayúscula");
  else mal("P06: explicación sin mayúscula");
  if (r6.texto.includes("por robo simple")) ok("P06: carátula coloquial desde los delitos");
  else mal("P06: carátula coloquial");

  // camposAplicables respeta solo_variantes y solo_si.
  const c1 = camposAplicables(P02, "procesamiento", {}).map((c) => c.clave);
  if (c1.includes("SE_RECURRE") && !c1.includes("ARGUMENTO_RECURSO") && !c1.includes("RAZON_FAVORABLE")) ok("camposAplicables: solo_si oculta el argumento hasta marcar SE_RECURRE");
  else mal(`camposAplicables → ${c1.join(", ")}`);
  const c2 = camposAplicables(P02, "procesamiento", { SE_RECURRE: true }).map((c) => c.clave);
  if (c2.includes("ARGUMENTO_RECURSO")) ok("camposAplicables: con SE_RECURRE aparece el argumento");
  else mal("camposAplicables: SE_RECURRE");
}

// ————————————————————————————————————————————————————————————————
// 4 y 5: contra la base (sólo sin --puro)
// ————————————————————————————————————————————————————————————————

async function verificarBase() {
  console.log("\n=== 4. Migración 20260915120000 en la base ===");
  const { createServerClient } = await import("../src/lib/supabase/server");
  const supabase = createServerClient();
  let migracionOk = true;
  for (const [tabla, cols] of [
    ["reportes_cliente", "id, caso_id, estado, plantilla, enviado_en"],
    ["partes_caso", "telefono, email"],
  ] as const) {
    const { error } = await supabase.from(tabla).select(cols).limit(1);
    if (error) {
      migracionOk = false;
      mal(`${tabla}(${cols}): ${error.message}`);
    } else ok(`${tabla}: ${cols}`);
  }
  if (!migracionOk) {
    aviso("La migración no está aplicada: correr supabase/migrations/20260915120000_reporteria_cliente.sql en el SQL Editor.");
  }

  console.log("\n=== 5. Pre-vuelo sobre una causa real (gratis) ===");
  const { data: u } = await supabase.from("usuarios").select("id, nombre").eq("nombre", "Mateo").maybeSingle();
  if (!u) {
    mal("no encontré al usuario Mateo");
    return null;
  }
  const { data: casos } = await supabase
    .from("casos")
    .select("id, titulo, caratula")
    .eq("usuario_id", u.id as string)
    .order("actualizado_en", { ascending: false })
    .limit(1);
  const caso = casos?.[0];
  if (!caso) {
    aviso("Mateo no tiene causas: se saltea el pre-vuelo");
    return null;
  }
  const { prevueloReporte } = await import("../src/lib/reporteria/generar-reporte");
  const pv = await prevueloReporte({ casoId: caso.id as string, usuarioId: u.id as string });
  if (!pv.ok) {
    aviso(`pre-vuelo: ${pv.motivo} (${pv.detalle ?? ""})`);
    return null;
  }
  ok(`causa «${pv.caso.nombre}»: sugiere ${pv.sugerencia.plantilla} — ${pv.sugerencia.motivo}`);
  ok(`clientes marcados: ${pv.datos.clientes.length}; etapa: ${pv.datos.etapa?.label ?? "sin mapa"}; próximos: ${pv.datos.proximos.length}`);
  for (const p of PLANTILLAS) {
    aviso(`${p.codigo} faltantes: ${pv.faltantes_por_plantilla[p.id].join(", ") || "ninguno"}`);
  }
  // Aislamiento: un caso ajeno se contesta como inexistente.
  const ajeno = await prevueloReporte({ casoId: caso.id as string, usuarioId: "00000000-0000-4000-8000-000000000000" });
  if (!ajeno.ok && ajeno.motivo === "caso_ajeno") ok("aislamiento: usuario ajeno → caso_ajeno");
  else mal("aislamiento: un usuario ajeno pudo preparar el reporte");
  return { pv, casoId: caso.id as string, usuarioId: u.id as string };
}

async function verificarModelo(ctx: { pv: { datos: import("../src/lib/reporteria/datos").DatosReporte } }) {
  console.log("\n=== 6. Una redacción real (paga, no se persiste) ===");
  const { runReporte } = await import("../src/lib/reporteria/run-reporte");
  const { armarMensajeReporte } = await import("../src/lib/reporteria/prompt");
  const { MODELO_POR_NIVEL } = await import("../src/lib/agent/modelos");
  const P01 = plantillaPorId("P01")!;
  const datos = ctx.pv.datos;
  const valores = { ...datos.valores, NOMBRE_CLIENTE: datos.valores.NOMBRE_CLIENTE ?? "Juan" };
  const r = renderizarReporte({
    plantilla: P01,
    variante: null,
    rolEstudio: "defensor",
    valoresSistema: valores,
    criterio: { RITMO_COLOQUIAL: "normal" },
  });
  const mensaje = armarMensajeReporte({
    plantilla: P01,
    variante: null,
    canal: "whatsapp",
    borrador: r.texto,
    datos,
    notasAbogado: { "Ritmo de la causa": "con normalidad" },
    asuntoSugerido: null,
  });
  const t0 = Date.now();
  const res = await runReporte({ mensaje, modelId: MODELO_POR_NIVEL.medio.modelId });
  ok(`${Date.now() - t0} ms, USD ${res.costo_usd}, ${res.usage.input_tokens + res.usage.cache_creation_input_tokens + res.usage.cache_read_input_tokens} in / ${res.usage.output_tokens} out`);
  const marcasBorrador = marcasReporte(r.texto);
  const marcasSalida = new Set(marcasReporte(res.contenido));
  const perdidas = marcasBorrador.filter((m) => !marcasSalida.has(m));
  if (perdidas.length === 0) ok(`conservó las ${marcasBorrador.length} marcas del borrador`);
  else mal(`perdió marcas: ${perdidas.join(", ")}`);
  console.log("\n--- borrador ---\n" + r.texto + "\n--- salida ---\n" + res.contenido + "\n");
}

async function main() {
  verificarPlantillas();
  const datos = verificarDatosYSugerencia();
  verificarRender(datos);
  if (!PURO) {
    const ctx = await verificarBase();
    if (ctx && !SIN_MODELO) await verificarModelo(ctx);
  } else {
    aviso("--puro: sin base ni modelo");
  }
  console.log(fallas.length === 0 ? "\nTODO OK" : `\n${fallas.length} FALLAS:\n- ${fallas.join("\n- ")}`);
  process.exit(fallas.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
