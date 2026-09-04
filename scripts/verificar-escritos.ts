// Verificación de la Fase 10 (escritos) contra el código y la base real.
//
// Casi todo es GRATIS: el catálogo, el filtro, los datos del encabezado y el
// render del PDF son funciones puras; la migración se sondea con SELECTs.
// La única llamada paga es UNA redacción completa al final (~USD 0,05-0,10,
// con búsquedas normativas y del repositorio), y se saltea con --sin-modelo.
//
// NO escribe nada en la base: la redacción de prueba corre `runEscrito` a
// secas (no persiste el escrito ni la ejecución; eso lo hace la ruta).
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server \
//     --import dotenv/config scripts/verificar-escritos.ts [--sin-modelo]

import { writeFileSync } from "node:fs";
import path from "node:path";
import { createServerClient } from "../src/lib/supabase/server";
import { CATALOGO_ESTUDIO } from "../src/lib/escritos/catalogo-estudio";
import { filtrarModelos } from "../src/lib/escritos/filtrar";
import { armarDatosEscrito, serializarDatosEscrito } from "../src/lib/escritos/datos-causa";
import { armarMensajeEscrito } from "../src/lib/escritos/prompt";
import { renderEscritoPdf, nombreArchivoPdf } from "../src/lib/escritos/render-pdf";
import { runEscrito } from "../src/lib/escritos/run-escrito";
import { contarPendientes, esModeloDelEstudio, esUuid } from "../src/lib/escritos/types";
import { getPerfilProfesional, listarModelos, obtenerModelo } from "../src/lib/escritos/queries";
import { ejecutarToolEscritos } from "../src/lib/agent/escritos-tools";
import { buildContextoCaso } from "../src/lib/casos/build-contexto-caso";
import { nombreCaso } from "../src/lib/casos/nombre";
import { COLS_CASO, COLS_PARTE } from "../src/lib/casos/columnas";
import { MODELO_POR_NIVEL } from "../src/lib/agent/modelos";
import type { Caso, ParteCaso } from "../src/lib/types";

const SIN_MODELO = process.argv.includes("--sin-modelo");
const fallas: string[] = [];
const ok = (t: string) => console.log(`  ok   ${t}`);
const mal = (t: string) => {
  console.log(`  MAL  ${t}`);
  fallas.push(t);
};
const aviso = (t: string) => console.log(`  --   ${t}`);

async function main() {
  // ============ 1. Catálogo (puro) ============
  console.log("\n=== 1. Catálogo del estudio ===");
  if (CATALOGO_ESTUDIO.length === 50) ok("50 modelos");
  else mal(`${CATALOGO_ESTUDIO.length} modelos, esperaba 50`);
  const ids = new Set(CATALOGO_ESTUDIO.map((m) => m.id));
  if (ids.size === 50) ok("slugs únicos");
  else mal("slugs duplicados");
  const rotos = CATALOGO_ESTUDIO.filter(
    (m) => !m.suma || m.cuerpo.length < 50 || !esModeloDelEstudio(m.id) || esUuid(m.id),
  );
  if (rotos.length === 0) ok("todos con suma, cuerpo y slug válido");
  else mal(`modelos rotos: ${rotos.map((m) => m.numero).join(", ")}`);
  const numeros = CATALOGO_ESTUDIO.map((m) => m.numero).sort((a, b) => (a ?? 0) - (b ?? 0));
  if (numeros[0] === 1 && numeros[49] === 50) ok("numerados 1..50");
  else mal(`numeración rara: ${numeros[0]}..${numeros[49]}`);

  // ============ 2. Filtro (puro) ============
  console.log("\n=== 2. Búsqueda en el catálogo ===");
  const casos: Array<[string, number]> = [
    ["excarcelacion", 8],
    ["nulidad allanamiento", 24],
    ["apelación", 44],
    ["probation", 35],
    ["habeas", 32],
  ];
  for (const [q, esperado] of casos) {
    const r = filtrarModelos(CATALOGO_ESTUDIO, { q });
    if (r[0]?.numero === esperado) ok(`"${q}" → #${esperado} ${r[0].titulo}`);
    else mal(`"${q}" → primero #${r[0]?.numero ?? "-"} (esperaba #${esperado})`);
  }
  const querella = filtrarModelos(CATALOGO_ESTUDIO, { rol: "querellante" });
  if (querella.some((m) => m.numero === 3) && !querella.some((m) => m.numero === 8)) {
    ok(`filtro por querella: ${querella.length} modelos, incluye denuncia y excluye excarcelación`);
  } else {
    mal("filtro por querella no separa bien");
  }

  // ============ 3. Migración (SELECTs) ============
  console.log("\n=== 3. Migración 20260904120000 en la base ===");
  const supabase = createServerClient();
  let migracionOk = true;
  for (const [tabla, cols] of [
    ["modelos_escrito", "id, origen, categoria, archivado"],
    ["escritos_generados", "id, caso_id, estado, presentado_en"],
    ["usuarios", "nombre_completo, matricula, domicilio_constituido, domicilio_electronico"],
    ["partes_caso", "documento"],
  ] as const) {
    const { error } = await supabase.from(tabla).select(cols).limit(1);
    if (error) {
      migracionOk = false;
      mal(`${tabla}(${cols}): ${error.message}`);
    } else {
      ok(`${tabla}: ${cols}`);
    }
  }
  const { data: tipos } = await supabase
    .from("ejecuciones")
    .select("tipo")
    .eq("tipo", "generar_escrito")
    .limit(1);
  aviso(
    `ejecuciones con tipo generar_escrito: ${tipos?.length ?? 0} (el CHECK sólo se prueba insertando; ver MIGRATION_LOG)`,
  );
  if (!migracionOk) {
    aviso("La migración no está aplicada: correr supabase/migrations/20260904120000_escritos.sql en el SQL Editor.");
  }

  // ============ 4. Un caso real: datos del encabezado ============
  console.log("\n=== 4. Datos del encabezado con una causa real ===");
  const { data: usuarios } = await supabase
    .from("usuarios")
    .select("id, nombre")
    .eq("nombre", "Mateo")
    .maybeSingle();
  if (!usuarios) {
    mal("no encontré al usuario Mateo");
    return;
  }
  const usuarioId = usuarios.id as string;

  const { data: casosRaw } = await supabase
    .from("casos")
    .select(COLS_CASO)
    .eq("usuario_id", usuarioId)
    .order("actualizado_en", { ascending: false })
    .limit(1);
  const caso = (casosRaw?.[0] ?? null) as Caso | null;
  if (!caso) {
    mal("Mateo no tiene causas");
    return;
  }
  ok(`causa: «${nombreCaso(caso)}» (${caso.id}) rol=${caso.rol}`);

  let partes: ParteCaso[] = [];
  if (migracionOk) {
    const { data } = await supabase.from("partes_caso").select(COLS_PARTE).eq("caso_id", caso.id);
    partes = (data ?? []) as ParteCaso[];
  }
  const perfil = migracionOk
    ? await getPerfilProfesional(usuarioId)
    : { nombre_completo: null, matricula: null, domicilio_constituido: null, domicilio_electronico: null };
  const datos = armarDatosEscrito(caso, partes, perfil);
  ok(`${datos.datos.length} datos, ${datos.faltantes.length} faltantes: ${datos.faltantes.map((d) => d.clave).join(", ") || "ninguno"}`);
  if (datos.datos.find((d) => d.clave === "FECHA")?.valor) ok("FECHA calculada en es-AR");
  else mal("FECHA vacía");
  const bloque = serializarDatosEscrito(datos, nombreCaso(caso));
  if (bloque.includes("## Datos del expediente")) ok("bloque serializado para el prompt");
  else mal("serialización rara");

  // ============ 5. Tools de LEXIE ============
  console.log("\n=== 5. Tools de LEXIE sobre el catálogo ===");
  if (migracionOk) {
    const lista = await listarModelos(usuarioId);
    ok(`listarModelos: ${lista.length} (50 del estudio + ${lista.length - 50} propios)`);
    const r = await ejecutarToolEscritos(
      "buscar_modelos_escrito",
      { consulta: "prisión domiciliaria", rol: "defensor" },
      { usuarioId },
    );
    const parsed = JSON.parse(r.contentJSON) as { modelos: { numero: number | null }[] };
    if (parsed.modelos[0]?.numero === 10) ok("buscar_modelos_escrito → #10 Prisión domiciliaria");
    else mal(`buscar_modelos_escrito devolvió #${parsed.modelos[0]?.numero}`);
    const r2 = await ejecutarToolEscritos("leer_modelo_escrito", { modelo_id: "excarcelacion" }, { usuarioId });
    if (r2.contentJSON.includes("cuerpo_tipo")) ok("leer_modelo_escrito → cuerpo del modelo");
    else mal("leer_modelo_escrito sin cuerpo");
    const r3 = await ejecutarToolEscritos(
      "leer_modelo_escrito",
      { modelo_id: "00000000-0000-0000-0000-000000000000" },
      { usuarioId },
    );
    if (r3.contentJSON.includes("No existe")) ok("UUID ajeno/inexistente → no existe (sin filtrar nada)");
    else mal("UUID inexistente devolvió algo");
    const m = await obtenerModelo("excarcelacion", usuarioId);
    if (m?.numero === 8) ok("obtenerModelo por slug");
    else mal("obtenerModelo por slug falló");
  } else {
    aviso("saltado: la migración no está aplicada (listarModelos lee modelos_escrito)");
  }

  // ============ 6. PDF (puro) ============
  console.log("\n=== 6. Render del PDF ===");
  const muestra = [
    "# SOLICITA EXCARCELACIÓN.",
    "",
    "Señor Juez:",
    "",
    "Dr. Prueba, abogado, T° 1 F° 2, en mi carácter de defensor de [COMPLETAR: imputado], a V.S. digo:",
    "",
    "## I. OBJETO",
    "",
    "Que vengo a solicitar la excarcelación de mi asistido. **(i)** Primer punto. **(ii)** Segundo punto → con flecha.",
    "",
    "## VI. PETITORIO",
    "",
    "1. Se tenga por presentado.",
    "2. Se haga lugar.",
    "",
    "Proveer de conformidad,",
    "SERÁ JUSTICIA.",
    "",
    "Dr. Prueba",
    "T° 1 F° 2",
  ].join("\n");
  const bytes = await renderEscritoPdf({ contenido: muestra, titulo: "Prueba", autor: "Prueba" });
  const cabecera = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  if (cabecera === "%PDF-") ok(`PDF válido, ${bytes.byteLength} bytes`);
  else mal(`el render no devolvió un PDF (${cabecera})`);
  if (contarPendientes(muestra) === 1) ok("contarPendientes = 1");
  else mal(`contarPendientes = ${contarPendientes(muestra)}`);
  if (nombreArchivoPdf("Solicita excarcelación", "12.345/2026") === "Solicita excarcelacion - 12 345 2026.pdf") {
    ok("nombre de archivo saneado");
  } else {
    mal(`nombre de archivo: ${nombreArchivoPdf("Solicita excarcelación", "12.345/2026")}`);
  }

  // ============ 7. Redacción real (paga) ============
  console.log("\n=== 7. Redacción con el modelo (paga) ===");
  if (SIN_MODELO) {
    aviso("saltado por --sin-modelo");
  } else {
    const modelo = CATALOGO_ESTUDIO.find((m) => m.numero === (caso.rol === "querellante" ? 4 : 2))!;
    const { contextoMarkdown } = await buildContextoCaso(caso.id, { incluirMapa: true });
    const mensaje = armarMensajeEscrito({
      modelo,
      datos,
      nombreCausa: nombreCaso(caso),
      instrucciones: "Es una prueba del sistema: redactalo completo pero breve.",
      contextoCaso: contextoMarkdown,
    });
    aviso(`modelo #${modelo.numero} «${modelo.titulo}», mensaje de ${mensaje.length} caracteres`);
    const t0 = Date.now();
    const res = await runEscrito({ mensaje, modelId: MODELO_POR_NIVEL.medio.modelId });
    const seg = ((Date.now() - t0) / 1000).toFixed(1);
    ok(`respondió en ${seg}s, USD ${res.costo_usd.toFixed(4)}, ${res.iterations} vueltas, ${res.busquedas.length} búsquedas, ${res.consultas_repositorio.length} consultas al repositorio`);
    if (res.contenido.startsWith("# ")) ok(`arranca con la suma: ${res.contenido.split("\n")[0]}`);
    else mal(`no arranca con "# ": ${res.contenido.slice(0, 80)}`);
    if (/## .*OBJETO/i.test(res.contenido) && /## .*PETITORIO/i.test(res.contenido)) ok("tiene OBJETO y PETITORIO");
    else mal("faltan secciones");
    if (/SERÁ JUSTICIA/i.test(res.contenido)) ok("cierra con SERÁ JUSTICIA");
    else mal("no cierra con SERÁ JUSTICIA");
    aviso(`${contarPendientes(res.contenido)} marcas [COMPLETAR], ${res.contenido.length} caracteres`);
    const pdf = await renderEscritoPdf({ contenido: res.contenido, titulo: modelo.titulo, autor: null });
    const salida = path.join(process.cwd(), "escrito-prueba.pdf");
    writeFileSync(salida, pdf);
    aviso(`PDF de prueba: ${salida} (${pdf.byteLength} bytes; borrarlo después)`);
    console.log("\n--- texto ---\n" + res.contenido + "\n--- fin ---");
  }

  console.log(fallas.length === 0 ? "\nTODO OK" : `\n${fallas.length} FALLAS:\n- ${fallas.join("\n- ")}`);
  process.exit(fallas.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
