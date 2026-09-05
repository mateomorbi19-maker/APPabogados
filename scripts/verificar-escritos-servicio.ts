// Verificación del servicio de generación de escritos (11.3) contra la base
// real: `prevueloEscrito` y `generarEscritoParaCaso` en src/lib/escritos/
// generar-escrito.ts, que comparten la ruta POST /api/casos/[id]/escritos y
// la tool de LEXIE.
//
// CERO tokens por default. Todo lo que se prueba sin --con-escrito es gratis y
// NO escribe nada en la base: el pre-vuelo con causa ajena, con modelo
// inexistente y con causa propia + modelo 2; y los guards del camino pago
// (que rechazan ANTES de llamar al modelo). Se cuentan las filas de
// `escritos_generados` y `ejecuciones` antes y después para afirmarlo.
//
// Con --con-escrito se corre UNA generación real (~USD 0,09) sobre la causa
// más reciente de Mateo, se afirma que quedó el escrito con su fila de
// `ejecuciones` tipo generar_escrito, y se BORRA todo lo creado en `finally`.
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server \
//     --import dotenv/config scripts/verificar-escritos-servicio.ts [--con-escrito]

import { createServerClient } from "../src/lib/supabase/server";
import { CATALOGO_ESTUDIO } from "../src/lib/escritos/catalogo-estudio";
import {
  capitalizarSuma,
  COSTO_ESTIMADO_ESCRITO_USD,
  DURACION_ESTIMADA_ESCRITO_S,
  generarEscritoParaCaso,
  mensajeDeErrorDeApi,
  prevueloEscrito,
} from "../src/lib/escritos/generar-escrito";
import { COLS_CASO_LISTA } from "../src/lib/casos/columnas";
import { nombreCaso } from "../src/lib/casos/nombre";
import type { CasoNombrable } from "../src/lib/types";

const CON_ESCRITO = process.argv.includes("--con-escrito");
const EMAIL = "mateomorbi19@gmail.com";
const UUID_INEXISTENTE = "00000000-0000-0000-0000-000000000000";

const fallas: string[] = [];
const ok = (t: string) => console.log(`  ok   ${t}`);
const mal = (t: string) => {
  console.log(`  MAL  ${t}`);
  fallas.push(t);
};
const aviso = (t: string) => console.log(`  --   ${t}`);

const supabase = createServerClient();

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

async function main() {
  // ============ 0. Helpers puros ============
  console.log("\n=== 0. Helpers puros ===");
  // Saca el punto final: es el comportamiento que la ruta tuvo siempre.
  const cap = capitalizarSuma("SOLICITA EXCARCELACIÓN. OFRECE CAUCIÓN.");
  if (cap === "Solicita excarcelación. Ofrece caución") ok(`capitalizarSuma → «${cap}»`);
  else mal(`capitalizarSuma → «${cap}»`);
  if (mensajeDeErrorDeApi("API_ERROR", "Your credit balance is too low").includes("crédito")) {
    ok("mensajeDeErrorDeApi traduce el saldo cero");
  } else {
    mal("mensajeDeErrorDeApi no reconoce el saldo cero");
  }
  if (mensajeDeErrorDeApi("MAX_ITERATIONS", "x").includes("demasiado larga")) {
    ok("mensajeDeErrorDeApi distingue el corte por iteraciones");
  } else {
    mal("mensajeDeErrorDeApi con MAX_ITERATIONS");
  }
  if (COSTO_ESTIMADO_ESCRITO_USD === 0.09 && DURACION_ESTIMADA_ESCRITO_S === "40-90") {
    ok("estimaciones: USD 0,09 · 40-90 s (las medidas en CLAUDE.md)");
  } else {
    mal(`estimaciones raras: ${COSTO_ESTIMADO_ESCRITO_USD} / ${DURACION_ESTIMADA_ESCRITO_S}`);
  }

  // ============ 1. Datos de prueba ============
  console.log("\n=== 1. Usuario, causa propia, causa ajena, modelo 2 ===");
  const { data: usuario, error: usuarioErr } = await supabase
    .from("usuarios")
    .select("id, nombre")
    .eq("email", EMAIL)
    .maybeSingle();
  if (usuarioErr || !usuario) {
    mal(`no encontré al usuario ${EMAIL}: ${usuarioErr?.message ?? "sin fila"}`);
    return;
  }
  const usuarioId = usuario.id as string;
  ok(`usuario ${usuario.nombre} (${usuarioId})`);

  const { data: propias } = await supabase
    .from("casos")
    .select(COLS_CASO_LISTA)
    .eq("usuario_id", usuarioId)
    .order("actualizado_en", { ascending: false })
    .limit(1);
  const propia = propias?.[0] ?? null;
  if (!propia) {
    mal("Mateo no tiene causas");
    return;
  }
  const casoId = propia.id as string;
  ok(`causa propia: «${nombreCaso(propia as CasoNombrable)}» (${casoId}) rol=${propia.rol}`);

  const { data: ajenas } = await supabase
    .from("casos")
    .select("id, usuario_id")
    .neq("usuario_id", usuarioId)
    .limit(1);
  const casoAjenoId = (ajenas?.[0]?.id as string | undefined) ?? null;
  if (casoAjenoId) ok(`causa ajena real: ${casoAjenoId}`);
  else aviso("no hay causas de otros abogados en la base; se prueba sólo con un UUID inexistente");

  const modelo2 = CATALOGO_ESTUDIO.find((m) => m.numero === 2);
  if (!modelo2) {
    mal("el catálogo no tiene el modelo 2");
    return;
  }
  ok(`modelo 2: «${modelo2.titulo}» (slug ${modelo2.id})`);

  const escritosAntes = await contar("escritos_generados", usuarioId);
  const ejecucionesAntes = await contar("ejecuciones", usuarioId);
  aviso(`antes: ${escritosAntes} escritos, ${ejecucionesAntes} ejecuciones del usuario`);

  // ============ 2. (a) Pre-vuelo con causa ajena ============
  console.log("\n=== 2. (a) prevueloEscrito con causa ajena ===");
  for (const [etiqueta, id] of [
    ["UUID inexistente", UUID_INEXISTENTE],
    ...(casoAjenoId ? [["causa de otro abogado", casoAjenoId]] : []),
  ] as [string, string][]) {
    const r = await prevueloEscrito({ casoId: id, usuarioId, modeloId: modelo2.id });
    if (!r.ok && r.motivo === "caso_ajeno") ok(`${etiqueta} → caso_ajeno`);
    else mal(`${etiqueta} → ${JSON.stringify(r).slice(0, 120)}`);
  }

  // ============ 3. (b) Pre-vuelo con modelo inexistente ============
  console.log("\n=== 3. (b) prevueloEscrito con modelo inexistente ===");
  for (const [etiqueta, id] of [
    ["slug que no está en el catálogo", "no-existe-este-modelo"],
    ["UUID que no está en modelos_escrito", UUID_INEXISTENTE],
    ["id con forma inválida", "Modelo Inválido!!"],
  ] as [string, string][]) {
    const r = await prevueloEscrito({ casoId, usuarioId, modeloId: id });
    if (!r.ok && r.motivo === "modelo_inexistente") ok(`${etiqueta} → modelo_inexistente`);
    else mal(`${etiqueta} → ${JSON.stringify(r).slice(0, 120)}`);
  }

  // ============ 4. (c) Pre-vuelo con causa propia + modelo 2 ============
  console.log("\n=== 4. (c) prevueloEscrito con causa propia + modelo 2 ===");
  const pv = await prevueloEscrito({
    casoId,
    usuarioId,
    modeloId: modelo2.id,
    instrucciones: "  Es una prueba.  ",
  });
  if (!pv.ok) {
    mal(`pre-vuelo falló: ${pv.motivo} ${pv.detalle ?? ""}`);
  } else {
    ok(`ok: modelo #${pv.modelo.numero} «${pv.modelo.titulo}» (${pv.modelo.origen}) para «${pv.caso.nombre}»`);
    console.log("       datos_usados:", JSON.stringify(pv.datos_usados, null, 2).replace(/\n/g, "\n       "));
    console.log("       faltantes:", JSON.stringify(pv.faltantes));
    console.log("       perfil_incompleto:", JSON.stringify(pv.perfil_incompleto));
    if (pv.modelo.numero === 2 && pv.modelo.id === modelo2.id) ok("modelo resuelto por slug, con número");
    else mal("el modelo devuelto no es el 2");
    if (pv.caso.id === casoId) ok("caso.id es el pedido");
    else mal("caso.id distinto");
    if (pv.instrucciones === "Es una prueba.") ok("instrucciones normalizadas (trim)");
    else mal(`instrucciones: ${JSON.stringify(pv.instrucciones)}`);
    if (typeof pv.datos_usados["Fecha"] === "string" && pv.datos_usados["Fecha"].length > 0) {
      ok(`Fecha calculada en es-AR: ${pv.datos_usados["Fecha"]}`);
    } else {
      mal("falta la Fecha en datos_usados");
    }
    const solapados = pv.faltantes.filter((f) => f in pv.datos_usados);
    if (solapados.length === 0) ok("faltantes y datos_usados no se solapan");
    else mal(`solapados: ${solapados.join(", ")}`);
    const perfilRaro = pv.perfil_incompleto.filter(
      (k) => !["nombre_completo", "matricula", "domicilio_constituido", "domicilio_electronico"].includes(k),
    );
    if (perfilRaro.length === 0) ok("perfil_incompleto sólo con los cuatro campos del perfil");
    else mal(`perfil_incompleto con claves raras: ${perfilRaro.join(", ")}`);
    if (pv.costo_estimado_usd === 0.09 && pv.duracion_estimada_s === "40-90") ok("costo y duración estimados");
    else mal(`estimaciones: ${pv.costo_estimado_usd} / ${pv.duracion_estimada_s}`);
  }
  const pvSin = await prevueloEscrito({ casoId, usuarioId, modeloId: modelo2.id, instrucciones: "   " });
  if (pvSin.ok && pvSin.instrucciones === null) ok("instrucciones vacías → null");
  else mal(`instrucciones vacías → ${JSON.stringify(pvSin.ok ? pvSin.instrucciones : pvSin)}`);

  // ============ 5. Guards del camino pago (rechazan antes de gastar) ============
  console.log("\n=== 5. generarEscritoParaCaso: los guards, sin llamar al modelo ===");
  const gAjeno = await generarEscritoParaCaso({ casoId: UUID_INEXISTENTE, usuarioId, modeloId: modelo2.id });
  if (!gAjeno.ok && gAjeno.motivo === "caso_ajeno") ok("causa ajena → caso_ajeno");
  else mal(`causa ajena → ${JSON.stringify(gAjeno).slice(0, 120)}`);
  const gModelo = await generarEscritoParaCaso({ casoId, usuarioId, modeloId: "no-existe-este-modelo" });
  if (!gModelo.ok && gModelo.motivo === "modelo_inexistente") ok("modelo inexistente → modelo_inexistente");
  else mal(`modelo inexistente → ${JSON.stringify(gModelo).slice(0, 120)}`);

  const escritosDespues = await contar("escritos_generados", usuarioId);
  const ejecucionesDespues = await contar("ejecuciones", usuarioId);
  if (escritosDespues === escritosAntes && ejecucionesDespues === ejecucionesAntes) {
    ok(`nada escrito en la base: ${escritosDespues} escritos, ${ejecucionesDespues} ejecuciones (igual que antes)`);
  } else {
    mal(`la base cambió: escritos ${escritosAntes}→${escritosDespues}, ejecuciones ${ejecucionesAntes}→${ejecucionesDespues}`);
  }

  // ============ 6. (d) Generación real (paga), sólo con --con-escrito ============
  console.log("\n=== 6. (d) generarEscritoParaCaso real (paga) ===");
  if (!CON_ESCRITO) {
    aviso("saltado: correr con --con-escrito para gastar ~USD 0,09 en una generación real");
  } else {
    // Se limpia por marca de tiempo y no sólo por id: si la redacción falla a
    // mitad de camino queda una fila de `ejecuciones` con los tokens parciales
    // y sin escrito, y el resultado no trae su id.
    const inicioIso = new Date().toISOString();
    const t0 = Date.now();
    try {
      const g = await generarEscritoParaCaso({
        casoId,
        usuarioId,
        modeloId: modelo2.id,
        instrucciones: "Es una prueba del sistema: redactalo completo pero breve.",
      });
      const seg = ((Date.now() - t0) / 1000).toFixed(1);
      if (!g.ok) {
        mal(`falló (${g.motivo}${g.motivo === "error" ? ` / ${g.etapa} / ${g.code ?? "sin code"}` : ""}): ${g.motivo === "error" ? g.mensaje : ""} ${g.detalle ?? ""}`);
      } else {
        ok(`generado en ${seg}s: «${g.escrito.titulo}» (${g.escrito.id}), USD ${g.metadata.costo_usd.toFixed(4)}, ${g.metadata.busquedas} búsquedas, ${g.metadata.consultas_repositorio} consultas al repositorio`);
        if (g.escrito.ejecucion_id && g.ejecucion_id === g.escrito.ejecucion_id) ok(`escrito.ejecucion_id = ${g.escrito.ejecucion_id}`);
        else mal(`ejecucion_id: escrito=${g.escrito.ejecucion_id} resultado=${g.ejecucion_id}`);
        if (g.escrito.estado === "borrador" && g.escrito.caso_id === casoId) ok("estado borrador, en la causa pedida");
        else mal(`estado=${g.escrito.estado} caso_id=${g.escrito.caso_id}`);
        if (typeof g.marcas_pendientes === "number" && g.marcas_pendientes >= 0) ok(`marcas_pendientes = ${g.marcas_pendientes}`);
        else mal(`marcas_pendientes = ${String(g.marcas_pendientes)}`);
        if (g.extracto.length > 0 && g.extracto.length <= 300 && !g.extracto.startsWith("# ")) {
          ok(`extracto de ${g.extracto.length} caracteres, sin la suma: «${g.extracto.slice(0, 80).replace(/\n/g, " ")}…»`);
        } else {
          mal(`extracto raro (${g.extracto.length} chars): ${g.extracto.slice(0, 80)}`);
        }
        if (g.escrito.ejecucion_id) {
          const { data: ejec } = await supabase
            .from("ejecuciones")
            .select("id, tipo, modelo, input_tokens, output_tokens, costo_usd, metadata")
            .eq("id", g.escrito.ejecucion_id)
            .eq("usuario_id", usuarioId)
            .maybeSingle();
          if (ejec?.tipo === "generar_escrito") {
            ok(`ejecución tipo generar_escrito: ${ejec.modelo}, ${ejec.input_tokens} in / ${ejec.output_tokens} out, USD ${Number(ejec.costo_usd).toFixed(4)}`);
          } else {
            mal(`la ejecución no es generar_escrito: ${JSON.stringify(ejec)}`);
          }
          const meta = (ejec?.metadata ?? {}) as Record<string, unknown>;
          if (meta.caso_id === casoId && meta.modelo_escrito_id === modelo2.id && meta.nivel === "medio") {
            ok("metadata con caso_id, modelo_escrito_id y nivel medio (default)");
          } else {
            mal(`metadata: ${JSON.stringify(meta).slice(0, 160)}`);
          }
        }
      }
    } finally {
      // Primero el escrito (su ejecucion_id es FK ON DELETE SET NULL, pero no
      // hace falta depender de eso), después la ejecución.
      const { count: escritosBorrados, error: e1 } = await supabase
        .from("escritos_generados")
        .delete({ count: "exact" })
        .eq("caso_id", casoId)
        .eq("usuario_id", usuarioId)
        .gte("creado_en", inicioIso);
      const { count: ejecucionesBorradas, error: e2 } = await supabase
        .from("ejecuciones")
        .delete({ count: "exact" })
        .eq("usuario_id", usuarioId)
        .eq("tipo", "generar_escrito")
        .gte("ejecutado_en", inicioIso);
      if (e1 || e2) {
        mal(`limpieza falló: ${e1?.message ?? ""} ${e2?.message ?? ""}`);
      } else {
        aviso(`limpieza: ${escritosBorrados ?? 0} escrito(s) y ${ejecucionesBorradas ?? 0} ejecución(es) de prueba borrados`);
      }
      const escritosFinal = await contar("escritos_generados", usuarioId);
      const ejecucionesFinal = await contar("ejecuciones", usuarioId);
      if (escritosFinal === escritosAntes && ejecucionesFinal === ejecucionesAntes) {
        ok(`la base quedó como antes: ${escritosFinal} escritos, ${ejecucionesFinal} ejecuciones`);
      } else {
        mal(`la base NO quedó como antes: escritos ${escritosAntes}→${escritosFinal}, ejecuciones ${ejecucionesAntes}→${ejecucionesFinal}`);
      }
    }
  }

  console.log(fallas.length === 0 ? "\nTODO OK" : `\n${fallas.length} FALLAS:\n- ${fallas.join("\n- ")}`);
  process.exit(fallas.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
