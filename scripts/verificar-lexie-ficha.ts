// Verificación del dominio FICHA de LEXIE (`src/lib/agent/ficha-tools.ts`)
// contra la base REAL. Fase 11.5.
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server \
//     --import dotenv/config scripts/verificar-lexie-ficha.ts
//
// Cero tokens: no llama al modelo. Ejecuta las tools con un `ContextoLexie`
// armado a mano (mismo `ctxDe` que scripts/verificar-lexie.ts) y el ejecutor
// de pendientes con un `CtxEjecucion` sin Gmail.
//
// Todo está SCOPEADO A UN SOLO ABOGADO (VERIFICAR_EMAIL, default el admin).
// El script entra con `service_role`, que bypassa RLS: de las causas ajenas
// se lee sólo el `id`, y sólo para probar que las tools las tratan como
// inexistentes.
//
// ESCRIBE, pero alta+baja de prueba nada más: partes "[prueba] …" que se
// borran al final, un delito "[prueba] …" que se quita, y `secretaria` de UNA
// causa propia que vuelve a su valor original en un `finally`. Como en
// verificar-casos-escritura.ts, se elige la causa que YA está al tope por
// `actualizado_en`, así los UPDATE de prueba no la reordenan.

import "server-only";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@/lib/supabase/server";
import { COLS_CASO_LISTA } from "@/lib/casos/columnas";
import {
  editarFicha,
  eliminarParte,
  leerFicha,
  leerParte,
  listarPartes,
  MENSAJE_FUERO_CONGELADO,
} from "@/lib/casos/escritura";
import {
  DOMINIO_FICHA,
  ejecutarToolFicha,
  FICHA_TOOL_NAMES as T,
} from "@/lib/agent/ficha-tools";
import type { ContextoLexie } from "@/lib/agent/lexie-tools";
import type { CtxEjecucion } from "@/lib/agent/lexie-dominio";
import type { AccionLexie } from "@/lib/lexie/acciones";

const PREFIJO_PRUEBA = "[prueba]";

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
function esperar(cond: boolean, siOk: string, siMal: string) {
  if (cond) ok(siOk);
  else mal(siMal);
}

type Json = Record<string, unknown>;
function parsear(s: string): Json {
  try {
    return JSON.parse(s) as Json;
  } catch {
    return { _crudo: s };
  }
}

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

/** Contexto con la pendiente sembrada, como hace la ruta en el turno N+1. */
function conSiembra(
  usuarioId: string,
  nombre: string,
  pendiente: AccionLexie,
  over: Partial<ContextoLexie> = {},
): ContextoLexie {
  return ctxDe(usuarioId, nombre, {
    accionesPendientes: new Map([[pendiente.clave as string, pendiente]]),
    ...over,
  });
}

function mismoArray(a: string[] | null, b: string[] | null): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

async function main() {
  const supabase = createServerClient();

  // ---------------------------------------------------------------
  titulo("0. Abogado y causas de prueba");

  const EMAIL = (process.env.VERIFICAR_EMAIL ?? "mateomorbi19@gmail.com")
    .trim()
    .toLowerCase();
  const { data: yoRaw, error: yoErr } = await supabase
    .from("usuarios")
    .select("id, nombre, email")
    .eq("email", EMAIL)
    .maybeSingle();
  if (yoErr || !yoRaw) {
    mal(`No hay ningún usuario con email ${EMAIL}`);
    return;
  }
  const yo = yoRaw as { id: string; nombre: string; email: string };
  ok(`Verificando sobre las causas de ${yo.nombre} (${yo.email})`);

  const { data: propiaRaw, error: propiaErr } = await supabase
    .from("casos")
    .select(COLS_CASO_LISTA)
    .eq("usuario_id", yo.id)
    .order("actualizado_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (propiaErr || !propiaRaw) {
    mal(`No hay ninguna causa de ${yo.nombre}: ${propiaErr?.message ?? "0 filas"}`);
    return;
  }
  const casoId = (propiaRaw as { id: string }).id;
  info(`Causa propia de prueba: ${casoId}`);

  const { data: ajenaRaw } = await supabase
    .from("casos")
    .select("id")
    .neq("usuario_id", yo.id)
    .limit(1)
    .maybeSingle();
  const ajenaId = ajenaRaw ? (ajenaRaw as { id: string }).id : randomUUID();
  info(ajenaRaw ? `Causa ajena: ${ajenaId}` : `Sin causas ajenas: se usa un UUID inexistente (${ajenaId})`);

  const ctx = () => ctxDe(yo.id, yo.nombre);
  const ctxEj = ctxEjecucionDe(yo.id, yo.nombre);

  const fichaInicial = await leerFicha(casoId, yo.id);
  if (!fichaInicial) {
    mal("leerFicha devolvió null para la causa propia");
    return;
  }
  const secretariaOriginal = fichaInicial.secretaria;
  const delitosOriginales = fichaInicial.delitos;
  const fueroOriginal = fichaInicial.fuero;

  // ---------------------------------------------------------------
  titulo("1. ver_ficha_caso");

  const ajena = await ejecutarToolFicha(T.ver, { caso_id: ajenaId }, ctx());
  const ajenaJ = parsear(ajena.contentJSON);
  esperar(
    ajenaJ.ok === false && !("partes" in ajenaJ) && !("ficha" in ajenaJ),
    "Causa ajena → ok:false sin revelar nada",
    `Causa ajena → ${ajena.contentJSON.slice(0, 200)}`,
  );

  const propia = await ejecutarToolFicha(T.ver, { caso_id: casoId }, ctx());
  const propiaJ = parsear(propia.contentJSON);
  esperar(
    propiaJ.ok === true &&
      Array.isArray(propiaJ.vacios) &&
      Array.isArray(propiaJ.partes) &&
      Array.isArray(propiaJ.escritos) &&
      typeof propiaJ.mapa_armado === "boolean" &&
      typeof propiaJ.nombre === "string" &&
      typeof (propiaJ.ficha as Json | undefined)?.caratula !== "undefined",
    `Causa propia → shape completo (${(propiaJ.vacios as string[]).length} vacíos, ${(propiaJ.partes as unknown[]).length} partes, ${(propiaJ.escritos as unknown[]).length} escritos, mapa_armado=${String(propiaJ.mapa_armado)})`,
    `Causa propia → shape inesperado: ${propia.contentJSON.slice(0, 300)}`,
  );
  const partesVer = (propiaJ.partes ?? []) as Json[];
  esperar(
    partesVer.every(
      (p) =>
        typeof p.parte_id === "string" &&
        typeof p.documento_cargado === "boolean" &&
        !("documento" in p),
    ) && !propia.contentJSON.includes('"documento":'),
    "Las partes traen parte_id y documento_cargado, nunca el DNI",
    "Alguna parte trae el valor del DNI o le falta parte_id/documento_cargado",
  );
  esperar(
    propia.contentJSON.length < 4000,
    `Compacta (${propia.contentJSON.length} chars)`,
    `Demasiado larga: ${propia.contentJSON.length} chars`,
  );

  const pantalla = await ejecutarToolFicha(T.ver, {}, ctxDe(yo.id, yo.nombre, { casoIdEnPantalla: casoId }));
  const pantallaJ = parsear(pantalla.contentJSON);
  esperar(
    pantallaJ.ok === true && pantallaJ.caso_id === casoId && typeof pantallaJ.nota_caso === "string",
    "Sin caso_id y con causa en pantalla → usa esa causa y lo dice",
    `Sin caso_id con pantalla → ${pantalla.contentJSON.slice(0, 200)}`,
  );
  const sinNada = await ejecutarToolFicha(T.ver, {}, ctx());
  esperar(
    parsear(sinNada.contentJSON).ok === false,
    "Sin caso_id y sin pantalla → ok:false",
    `Sin caso_id ni pantalla → ${sinNada.contentJSON.slice(0, 200)}`,
  );
  const invalido = await ejecutarToolFicha(T.ver, { caso_id: "no-es-uuid" }, ctx());
  esperar(invalido.isError === true, "caso_id inválido → isError", "caso_id inválido no dio isError");

  // ---------------------------------------------------------------
  titulo("2. ficha_editar: input inválido y causa ajena");

  const conTitulo = await ejecutarToolFicha(
    T.editar,
    { caso_id: casoId, campos: { titulo: "x" } },
    ctx(),
  );
  esperar(
    conTitulo.isError === true && conTitulo.contentJSON.includes("titulo"),
    "campos.titulo → rechazado como input inválido (strict)",
    `campos.titulo → ${conTitulo.contentJSON.slice(0, 200)}`,
  );
  const ajenaEdit = await ejecutarToolFicha(
    T.editar,
    { caso_id: ajenaId, campos: { secretaria: "x" } },
    ctx(),
  );
  esperar(
    parsear(ajenaEdit.contentJSON).ok === false && !ajenaEdit.accion,
    "Causa ajena → ok:false, sin escribir",
    `Causa ajena → ${ajenaEdit.contentJSON.slice(0, 200)}`,
  );

  // ---------------------------------------------------------------
  titulo("3. ficha_editar: vacío directo, sin cambios, sobrescritura con confirmación");

  const V1 = `${PREFIJO_PRUEBA} Secretaría uno`;
  const V2 = `${PREFIJO_PRUEBA} Secretaría dos`;
  const V3 = `${PREFIJO_PRUEBA} Secretaría tres`;

  try {
    if (secretariaOriginal !== null) {
      const vaciar = await editarFicha(casoId, yo.id, { secretaria: null });
      info(
        vaciar.ok
          ? `secretaria tenía valor (${JSON.stringify(secretariaOriginal)}): se vació para la prueba, se restaura al final`
          : `No se pudo vaciar secretaria: ${JSON.stringify(vaciar)}`,
      );
    }
    const antesDirecto = await leerFicha(casoId, yo.id);

    // (a) completar un vacío → directo
    const directo = await ejecutarToolFicha(
      T.editar,
      { caso_id: casoId, campos: { secretaria: V1 } },
      ctx(),
    );
    const directoJ = parsear(directo.contentJSON);
    esperar(
      directoJ.ok === true &&
        Array.isArray(directoJ.aplicados) &&
        (directoJ.aplicados as string[]).includes("secretaria") &&
        directo.accion?.estado === "ok" &&
        directo.accion.datos?.href === `/dashboard/mis-casos/${casoId}` &&
        directo.accion.seccion === "causa" &&
        (directo.accion.antes as Json | undefined)?.secretaria === null,
      "Completar secretaria vacía → ok directo, acción ok con href y antes=null",
      `Completar vacío → ${directo.contentJSON.slice(0, 300)} / accion ${JSON.stringify(directo.accion)}`,
    );
    const trasDirecto = await leerFicha(casoId, yo.id);
    esperar(
      trasDirecto?.secretaria === V1 && trasDirecto.actualizado_en !== antesDirecto?.actualizado_en,
      "En la base quedó V1 y actualizado_en se movió",
      `Base: secretaria=${JSON.stringify(trasDirecto?.secretaria)}, actualizado_en ${antesDirecto?.actualizado_en} → ${trasDirecto?.actualizado_en}`,
    );

    // (b) misma llamada → sin cambios, sin acción
    const repetido = await ejecutarToolFicha(
      T.editar,
      { caso_id: casoId, campos: { secretaria: V1 } },
      ctx(),
    );
    const repetidoJ = parsear(repetido.contentJSON);
    esperar(
      repetidoJ.ok === false &&
        String(repetidoJ.motivo).startsWith("Nada cambia") &&
        !repetido.accion,
      "Misma llamada → «Nada cambia», sin acción",
      `Misma llamada → ${repetido.contentJSON.slice(0, 200)}`,
    );
    const trasRepetido = await leerFicha(casoId, yo.id);
    esperar(
      trasRepetido?.actualizado_en === trasDirecto?.actualizado_en,
      "actualizado_en no se movió",
      "actualizado_en se movió sin cambios",
    );

    // (c) sobrescribir → pendiente con diff
    const sobre = await ejecutarToolFicha(
      T.editar,
      { caso_id: casoId, campos: { secretaria: V2 } },
      ctx(),
    );
    const sobreJ = parsear(sobre.contentJSON);
    const pend = sobre.accion;
    esperar(
      sobreJ.requiere_confirmacion === true &&
        typeof sobreJ.clave === "string" &&
        Array.isArray(sobreJ.aplicados) &&
        (sobreJ.aplicados as string[]).length === 0 &&
        pend?.estado === "pendiente" &&
        typeof pend.clave === "string" &&
        (pend.payload as Json | undefined)?.caso_id === casoId &&
        ((pend.payload as Json).patch as Json).secretaria === V2 &&
        (pend.antes as Json | undefined)?.secretaria === V1 &&
        String((pend.vista_previa as Json)["Secretaría"]).includes("→"),
      `Sobrescribir → pendiente con diff («${String((pend?.vista_previa as Json | undefined)?.["Secretaría"])}»)`,
      `Sobrescribir → ${sobre.contentJSON.slice(0, 300)} / accion ${JSON.stringify(pend)}`,
    );
    esperar(
      (await leerFicha(casoId, yo.id))?.secretaria === V1,
      "La pendiente no escribió nada (sigue V1)",
      "La pendiente ESCRIBIÓ",
    );
    if (!pend || !pend.clave) throw new Error("sin pendiente para seguir");

    // (d) confirmar:true sin siembra → rechazo
    const sinSiembra = await ejecutarToolFicha(
      T.editar,
      { caso_id: casoId, campos: { secretaria: V2 }, confirmar: true },
      ctx(),
    );
    esperar(
      parsear(sinSiembra.contentJSON).ok === false &&
        sinSiembra.accion?.estado === "rechazada" &&
        (await leerFicha(casoId, yo.id))?.secretaria === V1,
      "confirmar:true sin siembra → rechazado, sin escribir",
      `confirmar sin siembra → ${sinSiembra.contentJSON.slice(0, 200)}`,
    );
    const claveInventada = await ejecutarToolFicha(
      T.editar,
      { clave: "ficha_editar:0000000000000000", confirmar: true },
      ctx(),
    );
    esperar(
      parsear(claveInventada.contentJSON).ok === false && claveInventada.accion?.estado === "rechazada",
      "Clave inventada → rechazada",
      `Clave inventada → ${claveInventada.contentJSON.slice(0, 200)}`,
    );

    // (e) con siembra, por clave → ejecuta
    const ctxSembrado = conSiembra(yo.id, yo.nombre, pend);
    const confirmado = await ejecutarToolFicha(
      T.editar,
      { clave: pend.clave, confirmar: true },
      ctxSembrado,
    );
    const confirmadoJ = parsear(confirmado.contentJSON);
    esperar(
      confirmadoJ.ok === true &&
        confirmado.accion?.estado === "ok" &&
        confirmado.accion.confirmado_por === "texto" &&
        confirmado.accion.payload === undefined &&
        ctxSembrado.clavesConsumidas.has(pend.clave) &&
        (await leerFicha(casoId, yo.id))?.secretaria === V2,
      "Con siembra + {clave, confirmar:true} → ejecuta, clave consumida, base en V2",
      `Con siembra → ${confirmado.contentJSON.slice(0, 200)} / accion ${JSON.stringify(confirmado.accion)}`,
    );

    // (f) la misma clave otra vez en el mismo turno → ya consumida
    const otraVez = await ejecutarToolFicha(
      T.editar,
      { clave: pend.clave, confirmar: true },
      ctxSembrado,
    );
    esperar(
      parsear(otraVez.contentJSON).ok === false && otraVez.accion?.estado === "rechazada",
      "Repetir la clave en el mismo turno → rechazada (consumida)",
      `Repetir clave → ${otraVez.contentJSON.slice(0, 200)}`,
    );

    // (g) ejecutarPendiente con `antes` alterado → rechazada
    const alterada: AccionLexie = { ...pend, antes: { secretaria: "otro valor que nunca estuvo" } };
    const rechazo = await DOMINIO_FICHA.ejecutarPendiente(alterada, ctxEj);
    esperar(
      rechazo?.estado === "rechazada" && String(rechazo.motivo).startsWith("Cambió desde"),
      `ejecutarPendiente con antes alterado → rechazada («${rechazo?.motivo}»)`,
      `ejecutarPendiente con antes alterado → ${JSON.stringify(rechazo)}`,
    );
    // Y la pendiente REAL ya consumida: la base tiene V2, antes decía V1.
    const vieja = await DOMINIO_FICHA.ejecutarPendiente(pend, ctxEj);
    esperar(
      vieja?.estado === "rechazada",
      "La pendiente original, ya aplicada, también se rechaza (la base cambió)",
      `Pendiente original → ${JSON.stringify(vieja)}`,
    );

    // (h) confirmar:true SIN clave pero con el mismo contenido y siembra → ejecuta
    const sobre3 = await ejecutarToolFicha(
      T.editar,
      { caso_id: casoId, campos: { secretaria: V3 } },
      ctx(),
    );
    const pend3 = sobre3.accion;
    if (pend3?.estado === "pendiente") {
      const ctxS3 = conSiembra(yo.id, yo.nombre, pend3);
      const porContenido = await ejecutarToolFicha(
        T.editar,
        { caso_id: casoId, campos: { secretaria: V3 }, confirmar: true },
        ctxS3,
      );
      esperar(
        parsear(porContenido.contentJSON).ok === true &&
          (await leerFicha(casoId, yo.id))?.secretaria === V3,
        "confirmar:true sin clave, mismo contenido y siembra → ejecuta (base en V3)",
        `confirmar por contenido → ${porContenido.contentJSON.slice(0, 200)}`,
      );
    } else {
      mal(`No se pudo emitir la pendiente para V3: ${sobre3.contentJSON.slice(0, 200)}`);
    }

    // (i) ejecutarPendiente por el camino del BOTÓN con una pendiente fresca
    const sobre4 = await ejecutarToolFicha(
      T.editar,
      { caso_id: casoId, campos: { secretaria: V1 } },
      ctx(),
    );
    if (sobre4.accion?.estado === "pendiente") {
      const boton = await DOMINIO_FICHA.ejecutarPendiente(sobre4.accion, ctxEj);
      esperar(
        boton?.estado === "ok" &&
          boton.datos?.href === `/dashboard/mis-casos/${casoId}` &&
          boton.payload === undefined &&
          (await leerFicha(casoId, yo.id))?.secretaria === V1,
        "ejecutarPendiente (botón) con la pendiente real → ok, sin payload, base en V1",
        `Botón → ${JSON.stringify(boton)}`,
      );
    } else {
      mal(`No se pudo emitir la pendiente para el botón: ${sobre4.contentJSON.slice(0, 200)}`);
    }
  } finally {
    const vuelta = await editarFicha(casoId, yo.id, { secretaria: secretariaOriginal });
    if (vuelta.ok && vuelta.despues.secretaria === secretariaOriginal) {
      ok(`secretaria restaurada a ${JSON.stringify(secretariaOriginal)}`);
    } else if (!vuelta.ok && vuelta.motivo === "sin_cambios") {
      ok(`secretaria ya estaba en ${JSON.stringify(secretariaOriginal)}`);
    } else {
      mal(`No se pudo restaurar secretaria: ${JSON.stringify(vuelta)}`);
      info(`Restaurala a mano: casos.id = ${casoId}, secretaria = ${JSON.stringify(secretariaOriginal)}`);
    }
  }

  // ---------------------------------------------------------------
  titulo("4. ficha_editar: fuero");

  const { count: nodos } = await supabase
    .from("mapa_procesal_nodos")
    .select("id", { count: "exact", head: true })
    .eq("caso_id", casoId);
  const mapaArmado = (nodos ?? 0) > 0;
  const otroFuero = fueroOriginal === "pba" ? "nacion" : "pba";
  const fueroR = await ejecutarToolFicha(
    T.editar,
    { caso_id: casoId, campos: { fuero: otroFuero } },
    ctx(),
  );
  const fueroJ = parsear(fueroR.contentJSON);
  if (mapaArmado) {
    esperar(
      fueroJ.ok === false &&
        fueroJ.motivo === MENSAJE_FUERO_CONGELADO &&
        fueroR.accion?.estado === "rechazada" &&
        fueroR.accion.motivo === MENSAJE_FUERO_CONGELADO,
      `Con ${nodos} nodos, cambiar el fuero → rechazo relatado con MENSAJE_FUERO_CONGELADO`,
      `Fuero con mapa armado → ${fueroR.contentJSON.slice(0, 300)}`,
    );
  } else {
    esperar(
      fueroJ.requiere_confirmacion === true && fueroR.accion?.estado === "pendiente",
      "Sin mapa, cambiar el fuero → pendiente (siempre confirmable)",
      `Fuero sin mapa → ${fueroR.contentJSON.slice(0, 300)}`,
    );
    info("(no se confirma: cambiaría el fuero de una causa real)");
  }
  esperar(
    (await leerFicha(casoId, yo.id))?.fuero === fueroOriginal,
    `El fuero sigue en ${JSON.stringify(fueroOriginal)}`,
    "El fuero CAMBIÓ",
  );
  const mismoFuero = fueroOriginal
    ? await ejecutarToolFicha(T.editar, { caso_id: casoId, campos: { fuero: fueroOriginal } }, ctx())
    : null;
  if (mismoFuero) {
    esperar(
      parsear(mismoFuero.contentJSON).ok === false && !mismoFuero.accion,
      "Mismo fuero → «Nada cambia»",
      `Mismo fuero → ${mismoFuero.contentJSON.slice(0, 200)}`,
    );
  }

  // ---------------------------------------------------------------
  titulo("5. ficha_editar: delitos se agregan y se quitan, nunca se reemplazan");

  const delitoPrueba = `${PREFIJO_PRUEBA} Delito Lexie`;
  try {
    const agregar = await ejecutarToolFicha(
      T.editar,
      { caso_id: casoId, campos: { delitos_agregar: [delitoPrueba] } },
      ctx(),
    );
    const agregarJ = parsear(agregar.contentJSON);
    const trasAgregar = await leerFicha(casoId, yo.id);
    esperar(
      agregarJ.ok === true &&
        agregar.accion?.estado === "ok" &&
        mismoArray(trasAgregar?.delitos ?? null, [...(delitosOriginales ?? []), delitoPrueba]),
      `delitos_agregar → directo; quedaron ${JSON.stringify(trasAgregar?.delitos)} (los ${(delitosOriginales ?? []).length} originales intactos)`,
      `delitos_agregar → ${agregar.contentJSON.slice(0, 300)} / base ${JSON.stringify(trasAgregar?.delitos)}`,
    );

    const repetirDelito = await ejecutarToolFicha(
      T.editar,
      { caso_id: casoId, campos: { delitos_agregar: [`${PREFIJO_PRUEBA} DELITO   léxie`] } },
      ctx(),
    );
    esperar(
      parsear(repetirDelito.contentJSON).ok === false && !repetirDelito.accion,
      "Agregar el mismo delito con otro casing/tildes → «Nada cambia»",
      `Repetir delito → ${repetirDelito.contentJSON.slice(0, 200)}`,
    );

    const quitar = await ejecutarToolFicha(
      T.editar,
      { caso_id: casoId, campos: { delitos_quitar: [`${PREFIJO_PRUEBA} delito LEXIE`] } },
      ctx(),
    );
    const pendQ = quitar.accion;
    const patchQ = (pendQ?.payload as Json | undefined)?.patch as Json | undefined;
    esperar(
      pendQ?.estado === "pendiente" &&
        mismoArray((patchQ?.delitos as string[] | null | undefined) ?? null, delitosOriginales) &&
        mismoArray((await leerFicha(casoId, yo.id))?.delitos ?? null, [...(delitosOriginales ?? []), delitoPrueba]),
      "delitos_quitar → pendiente con la lista final, sin escribir",
      `delitos_quitar → ${quitar.contentJSON.slice(0, 300)} / accion ${JSON.stringify(pendQ)}`,
    );
    if (pendQ?.estado === "pendiente") {
      const ejecutado = await DOMINIO_FICHA.ejecutarPendiente(pendQ, ctxEj);
      esperar(
        ejecutado?.estado === "ok" &&
          mismoArray((await leerFicha(casoId, yo.id))?.delitos ?? null, delitosOriginales),
        "ejecutarPendiente quita el delito y deja los originales",
        `ejecutarPendiente → ${JSON.stringify(ejecutado)} / base ${JSON.stringify((await leerFicha(casoId, yo.id))?.delitos)}`,
      );
    }
    const noExiste = await ejecutarToolFicha(
      T.editar,
      { caso_id: casoId, campos: { delitos_quitar: ["[prueba] esto no está"] } },
      ctx(),
    );
    const noExisteJ = parsear(noExiste.contentJSON);
    esperar(
      noExisteJ.ok === false && Array.isArray(noExisteJ.delitos_no_encontrados),
      "Quitar un delito que no está → «Nada cambia» con delitos_no_encontrados",
      `Quitar inexistente → ${noExiste.contentJSON.slice(0, 200)}`,
    );
  } finally {
    const actual = await leerFicha(casoId, yo.id);
    if (!mismoArray(actual?.delitos ?? null, delitosOriginales)) {
      const vuelta = await editarFicha(casoId, yo.id, { delitos: delitosOriginales ?? null });
      if (vuelta.ok) ok(`delitos restaurados a ${JSON.stringify(delitosOriginales)}`);
      else {
        mal(`No se pudieron restaurar los delitos: ${JSON.stringify(vuelta)}`);
        info(`Restauralos a mano: casos.id = ${casoId}, delitos = ${JSON.stringify(delitosOriginales)}`);
      }
    } else {
      ok("Los delitos quedaron como estaban");
    }
  }

  // ---------------------------------------------------------------
  titulo("6. Partes: DNI dictado o no, duplicada, edición, eliminación, cuarentena");

  const nombreTestigo = `${PREFIJO_PRUEBA} Testigo Lexie`;
  const nombreImputado = `${PREFIJO_PRUEBA} Imputado Lexie`;
  const nombreCuarentena = `${PREFIJO_PRUEBA} Cuarentena Lexie`;
  const DNI_A = "30123456";
  const DNI_B = "40111222";
  const mensajeConDni = `Cargá a ${nombreImputado} como imputado, DNI 30.123.456. Después corregile el DNI a 40.111.222.`;

  try {
    // Ajena e inválida
    const ajenaParte = await ejecutarToolFicha(
      T.parteAgregar,
      { caso_id: ajenaId, nombre: nombreTestigo, rol: "testigo" },
      ctx(),
    );
    esperar(
      parsear(ajenaParte.contentJSON).ok === false && !ajenaParte.accion,
      "parte_agregar en causa ajena → ok:false, sin escribir",
      `parte_agregar ajena → ${ajenaParte.contentJSON.slice(0, 200)}`,
    );
    const rolMalo = await ejecutarToolFicha(
      T.parteAgregar,
      { caso_id: casoId, nombre: nombreTestigo, rol: "abogado" },
      ctx(),
    );
    esperar(rolMalo.isError === true, "rol inválido → isError", `rol inválido → ${rolMalo.contentJSON.slice(0, 200)}`);

    // (a) DNI NO dictado → se carga sin documento y avisa
    const sinDictado = await ejecutarToolFicha(
      T.parteAgregar,
      { caso_id: casoId, nombre: nombreTestigo, rol: "testigo", documento: DNI_A },
      ctxDe(yo.id, yo.nombre, { mensajesAbogado: [`cargá a ${nombreTestigo} como testigo`] }),
    );
    const sinDictadoJ = parsear(sinDictado.contentJSON);
    const parte1 = (sinDictadoJ.parte as Json | undefined)?.parte_id as string | undefined;
    esperar(
      sinDictadoJ.ok === true &&
        typeof parte1 === "string" &&
        (sinDictadoJ.parte as Json).documento_cargado === false &&
        typeof sinDictadoJ.aviso_dni === "string" &&
        sinDictado.accion?.estado === "ok" &&
        sinDictado.accion.datos?.parte_id === parte1 &&
        (await leerParte(casoId, parte1 ?? ""))?.documento === null,
      "DNI no dictado → persona creada SIN documento y con aviso",
      `DNI no dictado → ${sinDictado.contentJSON.slice(0, 300)}`,
    );

    // (b) DNI dictado → se carga
    const ctxDictado = ctxDe(yo.id, yo.nombre, { mensajesAbogado: [mensajeConDni] });
    const conDictado = await ejecutarToolFicha(
      T.parteAgregar,
      {
        caso_id: casoId,
        nombre: nombreImputado,
        rol: "imputado",
        es_cliente: true,
        situacion_libertad: "detenido",
        documento: DNI_A,
      },
      ctxDictado,
    );
    const conDictadoJ = parsear(conDictado.contentJSON);
    const parte2 = (conDictadoJ.parte as Json | undefined)?.parte_id as string | undefined;
    const fila2 = parte2 ? await leerParte(casoId, parte2) : null;
    esperar(
      conDictadoJ.ok === true &&
        conDictadoJ.aviso_dni === undefined &&
        fila2?.documento === DNI_A &&
        fila2.es_cliente === true &&
        fila2.situacion_libertad === "detenido" &&
        !conDictado.contentJSON.includes(DNI_A),
      "DNI dictado (con puntos en el mensaje) → cargado; el tool_result no repite el número",
      `DNI dictado → ${conDictado.contentJSON.slice(0, 300)} / fila ${JSON.stringify(fila2)}`,
    );

    // (c) duplicada
    const dup = await ejecutarToolFicha(
      T.parteAgregar,
      { caso_id: casoId, nombre: `  ${PREFIJO_PRUEBA}   TESTÍGO   lexie `, rol: "otro" },
      ctx(),
    );
    const dupJ = parsear(dup.contentJSON);
    esperar(
      dupJ.ok === false &&
        String(dupJ.motivo).startsWith("Ya hay") &&
        (dupJ.parte_existente as Json | undefined)?.parte_id === parte1 &&
        dup.accion?.estado === "rechazada",
      "Mismo nombre con otro casing → duplicada con el parte_id existente, acción rechazada",
      `Duplicada → ${dup.contentJSON.slice(0, 300)}`,
    );

    // (d) parte_editar directo
    const edicion = await ejecutarToolFicha(
      T.parteEditar,
      { caso_id: casoId, parte_id: parte1, cambios: { nombre: `${nombreTestigo} Dos`, situacion_libertad: "libre" } },
      ctx(),
    );
    const edicionJ = parsear(edicion.contentJSON);
    esperar(
      edicionJ.ok === true &&
        edicion.accion?.estado === "ok" &&
        (edicion.accion.antes as Json | undefined)?.nombre === nombreTestigo &&
        (await leerParte(casoId, parte1 ?? ""))?.nombre === `${nombreTestigo} Dos`,
      "parte_editar nombre + situación → directo, con antes",
      `parte_editar → ${edicion.contentJSON.slice(0, 300)} / accion ${JSON.stringify(edicion.accion)}`,
    );
    const inexistente = await ejecutarToolFicha(
      T.parteEditar,
      { caso_id: casoId, parte_id: randomUUID(), cambios: { nombre: "x" } },
      ctx(),
    );
    esperar(
      parsear(inexistente.contentJSON).ok === false && !inexistente.accion,
      "parte_id inexistente → ok:false",
      `parte_id inexistente → ${inexistente.contentJSON.slice(0, 200)}`,
    );

    // (e) parte_editar pisando un DNI cargado → pendiente
    const pisa = await ejecutarToolFicha(
      T.parteEditar,
      { caso_id: casoId, parte_id: parte2, cambios: { documento: DNI_B } },
      ctxDictado,
    );
    const pendDni = pisa.accion;
    esperar(
      parsear(pisa.contentJSON).requiere_confirmacion === true &&
        pendDni?.estado === "pendiente" &&
        ((pendDni.payload as Json).cambios as Json).documento === DNI_B &&
        (pendDni.antes as Json).documento === DNI_A &&
        (await leerParte(casoId, parte2 ?? ""))?.documento === DNI_A,
      "Pisar un DNI cargado → pendiente con el diff, sin escribir",
      `Pisar DNI → ${pisa.contentJSON.slice(0, 300)} / accion ${JSON.stringify(pendDni)}`,
    );
    if (pendDni?.estado === "pendiente") {
      const ejec = await DOMINIO_FICHA.ejecutarPendiente(pendDni, ctxEj);
      esperar(
        ejec?.estado === "ok" && (await leerParte(casoId, parte2 ?? ""))?.documento === DNI_B,
        "ejecutarPendiente → DNI cambiado",
        `ejecutarPendiente DNI → ${JSON.stringify(ejec)}`,
      );
      const otraVez = await DOMINIO_FICHA.ejecutarPendiente(pendDni, ctxEj);
      esperar(
        otraVez?.estado === "rechazada" && String(otraVez.motivo).startsWith("Cambió desde"),
        "La misma pendiente otra vez → rechazada (el DNI ya no es el que vio)",
        `Pendiente repetida → ${JSON.stringify(otraVez)}`,
      );
    }
    const dniNoDictado = await ejecutarToolFicha(
      T.parteEditar,
      { caso_id: casoId, parte_id: parte2, cambios: { documento: "99999999" } },
      ctx(),
    );
    const dniNoDictadoJ = parsear(dniNoDictado.contentJSON);
    esperar(
      dniNoDictadoJ.ok === false &&
        typeof dniNoDictadoJ.aviso_dni === "string" &&
        (await leerParte(casoId, parte2 ?? ""))?.documento === DNI_B,
      "parte_editar con DNI no dictado → nada que cambiar, con aviso, sin escribir",
      `DNI no dictado en edición → ${dniNoDictado.contentJSON.slice(0, 300)}`,
    );

    // (f) parte_eliminar → siempre pendiente → ejecutar
    const elim = await ejecutarToolFicha(
      T.parteEliminar,
      { caso_id: casoId, parte_id: parte1 },
      ctx(),
    );
    const pendElim = elim.accion;
    esperar(
      parsear(elim.contentJSON).requiere_confirmacion === true &&
        pendElim?.estado === "pendiente" &&
        (pendElim.payload as Json).parte_id === parte1 &&
        (pendElim.antes as Json).nombre === `${nombreTestigo} Dos` &&
        !elim.contentJSON.includes('"documento"') &&
        (await leerParte(casoId, parte1 ?? "")) !== null,
      "parte_eliminar → pendiente con la fila en antes, sin borrar",
      `parte_eliminar → ${elim.contentJSON.slice(0, 300)} / accion ${JSON.stringify(pendElim)}`,
    );
    if (pendElim?.estado === "pendiente") {
      const borrada = await DOMINIO_FICHA.ejecutarPendiente(pendElim, ctxEj);
      esperar(
        borrada?.estado === "ok" &&
          borrada.datos?.parte_id === parte1 &&
          (await leerParte(casoId, parte1 ?? "")) === null,
        "ejecutarPendiente → persona quitada",
        `ejecutarPendiente eliminar → ${JSON.stringify(borrada)}`,
      );
      const yaNo = await DOMINIO_FICHA.ejecutarPendiente(pendElim, ctxEj);
      esperar(
        yaNo?.estado === "rechazada" && String(yaNo.motivo).includes("ya no está"),
        "La misma pendiente otra vez → rechazada «ya no está»",
        `Eliminar repetido → ${JSON.stringify(yaNo)}`,
      );
    }

    // (g) cuarentena: una directa devuelve pendiente, y se confirma por clave
    const ctxQ = ctxDe(yo.id, yo.nombre, { correoLeido: true });
    const enCuar = await ejecutarToolFicha(
      T.parteAgregar,
      { caso_id: casoId, nombre: nombreCuarentena, rol: "testigo" },
      ctxQ,
    );
    const pendCuar = enCuar.accion;
    const existeCuar = (await listarPartes(casoId)).some((p) => p.nombre === nombreCuarentena);
    esperar(
      parsear(enCuar.contentJSON).requiere_confirmacion === true &&
        pendCuar?.estado === "pendiente" &&
        enCuar.contentJSON.includes("leíste correo") &&
        !existeCuar,
      "Cuarentena (correoLeido) → parte_agregar devuelve pendiente y no crea nada",
      `Cuarentena → ${enCuar.contentJSON.slice(0, 300)} / creada=${existeCuar}`,
    );
    if (pendCuar?.estado === "pendiente" && pendCuar.clave) {
      const ctxS = conSiembra(yo.id, yo.nombre, pendCuar);
      const conf = await ejecutarToolFicha(T.parteAgregar, { clave: pendCuar.clave, confirmar: true }, ctxS);
      const creada = (await listarPartes(casoId)).find((p) => p.nombre === nombreCuarentena);
      esperar(
        parsear(conf.contentJSON).ok === true &&
          conf.accion?.estado === "ok" &&
          ctxS.clavesConsumidas.has(pendCuar.clave) &&
          creada !== undefined &&
          conf.accion.datos?.parte_id === creada.id,
        "Confirmar por clave la pendiente de cuarentena → la persona se crea",
        `Confirmar cuarentena → ${conf.contentJSON.slice(0, 300)} / accion ${JSON.stringify(conf.accion)}`,
      );
    }
  } finally {
    const restos = (await listarPartes(casoId)).filter((p) => p.nombre.startsWith(PREFIJO_PRUEBA));
    for (const p of restos) {
      const r = await eliminarParte(casoId, yo.id, p.id);
      if (r.ok) info(`Limpieza: borrada la parte de prueba «${p.nombre}»`);
      else {
        mal(`No se pudo borrar la parte de prueba «${p.nombre}»`);
        info(`Borrala a mano: partes_caso.id = ${p.id}`);
      }
    }
    const quedan = (await listarPartes(casoId)).filter((p) => p.nombre.startsWith(PREFIJO_PRUEBA));
    esperar(quedan.length === 0, "No quedó ninguna parte de prueba en la causa", `Quedaron ${quedan.length} partes de prueba`);
  }

  // ---------------------------------------------------------------
  titulo("7. El dominio, como lo ve run-lexie");

  const familias = DOMINIO_FICHA.familias(ctx());
  const porNombre = Object.fromEntries(familias.map((f) => [f.nombre, f]));
  esperar(
    porNombre.ficha_lectura?.cap === 4 &&
      porNombre.ficha_lectura.paralelizable === true &&
      porNombre.ficha_escritura?.cap === 4 &&
      porNombre.ficha_escritura.paralelizable === false &&
      porNombre.ficha_eliminacion?.cap === 1 &&
      porNombre.ficha_eliminacion.paralelizable === false,
    "Familias: ficha_lectura (4, paralela), ficha_escritura (4, serie), ficha_eliminacion (1, serie)",
    `Familias inesperadas: ${JSON.stringify(familias.map((f) => [f.nombre, f.cap, f.paralelizable]))}`,
  );
  const nombres = familias.flatMap((f) => f.tools.map((t) => t.name));
  esperar(
    ["ver_ficha_caso", "ficha_editar", "parte_agregar", "parte_editar", "parte_eliminar"].every((n) =>
      nombres.includes(n),
    ),
    `Tools declaradas: ${nombres.join(", ")}`,
    `Faltan tools: ${nombres.join(", ")}`,
  );
  esperar(
    DOMINIO_FICHA.prompt.length > 500 && DOMINIO_FICHA.manual.length > 50,
    `Prompt (${DOMINIO_FICHA.prompt.length} chars) y manual (${DOMINIO_FICHA.manual.length} chars) presentes`,
    "Prompt o manual vacíos",
  );
  const desconocida = await ejecutarToolFicha("otra_tool", {}, ctx());
  esperar(desconocida.isError === true, "Tool desconocida → isError", "Tool desconocida no dio isError");
  esperar(
    (await DOMINIO_FICHA.ejecutarPendiente(
      { tool: "correo_enviar", estado: "pendiente", resumen: "x", clave: "correo_enviar:x" },
      ctxEj,
    )) === null,
    "ejecutarPendiente de otra tool → null",
    "ejecutarPendiente de otra tool no devolvió null",
  );

  console.log("");
}

main()
  .catch((e) => {
    console.error("\n❌ El verificador se cayó:", e);
    fallos++;
  })
  .finally(() => {
    console.log("=== Resultado ===");
    if (fallos === 0) {
      console.log("  Todo en orden. Las tools de ficha y partes de LEXIE responden como se espera.\n");
    } else {
      console.log(`  ${fallos} verificación(es) fallaron.\n`);
    }
    process.exitCode = fallos > 0 ? 1 : 0;
  });
