// Verificación del servicio de escritura de la ficha y las partes
// (`src/lib/casos/escritura.ts` + `src/lib/casos/propiedad.ts`) contra la base
// REAL. Fase 11.3.
//
// Corre así (el combo --conditions + dotenv es el de siempre para scripts que
// tocan módulos con `server-only`):
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server \
//     --import dotenv/config scripts/verificar-casos-escritura.ts
//
// Todo lo que hace está SCOPEADO A UN SOLO ABOGADO: por default el de
// VERIFICAR_EMAIL (o el admin). El script entra con `service_role`, que
// bypassa RLS, así que sin ese filtro escribiría en expedientes de los otros
// dos abogados. De las causas ajenas sólo se lee el `id`, y sólo para probar
// que el servicio las trata como inexistentes.
//
// ESCRIBE, pero alta+baja de prueba nada más: una parte "[prueba] …" que se
// borra al final, y `secretaria` de UNA causa propia que se restaura a su
// valor original en un `finally`. Esas dos escrituras sobre `casos` mueven
// `actualizado_en` (el trigger lo pisa en cada UPDATE, no hay forma de
// evitarlo), así que se elige la causa que YA está al tope por esa columna:
// bumpearla no reordena el Inicio ni el buscador.
//
// No toca el modelo: cero tokens, cero costo.

import "server-only";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@/lib/supabase/server";
import { COLS_CASO_LISTA } from "@/lib/casos/columnas";
import {
  agregarParte,
  editarFicha,
  editarParte,
  eliminarParte,
  leerFicha,
  leerParte,
  listarPartes,
  type CasoFicha,
} from "@/lib/casos/escritura";
import { casoEsDelUsuario } from "@/lib/casos/propiedad";
import { casoEsDelUsuario as casoEsDelUsuarioAgenda } from "@/lib/agenda/queries";
import { casoEsDelUsuario as casoEsDelUsuarioMapa } from "@/lib/mapa-procesal/queries";

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

async function main() {
  const supabase = createServerClient();

  // ---------------------------------------------------------------
  titulo("0. De qué abogado son las causas que se van a tocar");

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
    info("Pasá VERIFICAR_EMAIL=tu@email para verificar sobre tus causas.");
    return;
  }
  const yo = yoRaw as { id: string; nombre: string; email: string };
  ok(`Verificando sobre las causas de ${yo.nombre} (${yo.email})`);

  // La causa propia más reciente por `actualizado_en`: es la que ya está al
  // tope de las listas, así que las escrituras de prueba no la reordenan.
  const { data: propiaRaw, error: propiaErr } = await supabase
    .from("casos")
    .select(COLS_CASO_LISTA)
    .eq("usuario_id", yo.id)
    .order("actualizado_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (propiaErr || !propiaRaw) {
    mal(`No hay ninguna causa de ${yo.nombre} para probar: ${propiaErr?.message ?? "0 filas"}`);
    return;
  }
  const propiaId = (propiaRaw as { id: string }).id;
  info(`Causa propia de prueba: ${propiaId}`);

  // Una causa ajena, sólo el id. Si no hay ninguna en la base, un UUID
  // inexistente cumple el mismo papel para el servicio.
  const { data: ajenaRaw } = await supabase
    .from("casos")
    .select("id")
    .neq("usuario_id", yo.id)
    .limit(1)
    .maybeSingle();
  const ajenaId = ajenaRaw ? (ajenaRaw as { id: string }).id : randomUUID();
  info(
    ajenaRaw
      ? `Causa ajena para probar el aislamiento: ${ajenaId}`
      : `No hay causas de otros abogados: se usa un UUID inexistente (${ajenaId})`,
  );

  // ---------------------------------------------------------------
  titulo("1. casoEsDelUsuario: una sola implementación");

  esperar(
    casoEsDelUsuarioAgenda === casoEsDelUsuario &&
      casoEsDelUsuarioMapa === casoEsDelUsuario,
    "agenda/queries y mapa-procesal/queries re-exportan la misma función de casos/propiedad",
    "Las re-exportaciones no apuntan a la función de casos/propiedad",
  );
  esperar(
    await casoEsDelUsuario(propiaId, yo.id),
    "La causa propia es del usuario",
    "casoEsDelUsuario devolvió false para una causa propia",
  );
  esperar(
    !(await casoEsDelUsuario(ajenaId, yo.id)),
    "La causa ajena NO es del usuario",
    "casoEsDelUsuario devolvió true para una causa ajena",
  );

  // ---------------------------------------------------------------
  titulo("2. leerFicha");

  const ficha = await leerFicha(propiaId, yo.id);
  if (!ficha) {
    mal("leerFicha devolvió null para la causa propia");
    return;
  }
  ok(`leerFicha trae la causa propia (${ficha.estado_seguimiento}, fuero ${ficha.fuero ?? "sin definir"})`);
  esperar(
    (await leerFicha(ajenaId, yo.id)) === null,
    "leerFicha de una causa ajena → null",
    "leerFicha DEVOLVIÓ una causa ajena",
  );

  // ---------------------------------------------------------------
  titulo("3. editarFicha: body vacío y sin cambios no escriben");

  const vacio = await editarFicha(propiaId, yo.id, {});
  esperar(
    !vacio.ok && vacio.motivo === "body_vacio",
    "{} → body_vacio",
    `{} → ${JSON.stringify(vacio)}`,
  );

  // Se repiten valores actuales de tres tipos distintos: texto (o null),
  // array (delitos) y el fuero. Ninguno tiene que producir un UPDATE.
  const mismo = await editarFicha(propiaId, yo.id, {
    secretaria: ficha.secretaria,
    delitos: ficha.delitos,
    fuero: ficha.fuero,
    titulo: ficha.titulo,
  });
  esperar(
    !mismo.ok && mismo.motivo === "sin_cambios",
    "Mismos valores actuales → sin_cambios",
    `Mismos valores → ${JSON.stringify(mismo)}`,
  );
  const releida = await leerFicha(propiaId, yo.id);
  esperar(
    releida?.actualizado_en === ficha.actualizado_en,
    `actualizado_en no se movió (${ficha.actualizado_en})`,
    `actualizado_en CAMBIÓ sin cambios: ${ficha.actualizado_en} → ${releida?.actualizado_en}`,
  );

  const ajena = await editarFicha(ajenaId, yo.id, { secretaria: "x" });
  esperar(
    !ajena.ok && ajena.motivo === "no_existe",
    "Editar una causa ajena → no_existe (sin escribir)",
    `Editar una causa ajena → ${JSON.stringify(ajena)}`,
  );

  // ---------------------------------------------------------------
  titulo("4. editarFicha: un cambio real, y se restaura");

  const secretariaOriginal = ficha.secretaria;
  const valorPrueba = `${PREFIJO_PRUEBA} Secretaría de verificación`;
  let fichaTrasCambio: CasoFicha | null = null;
  try {
    const cambio = await editarFicha(propiaId, yo.id, {
      secretaria: valorPrueba,
    });
    if (!cambio.ok) {
      mal(`El cambio real fue rechazado: ${JSON.stringify(cambio)}`);
    } else {
      esperar(
        cambio.cambios.length === 1 && cambio.cambios[0] === "secretaria",
        `cambios = ${JSON.stringify(cambio.cambios)}`,
        `cambios inesperados: ${JSON.stringify(cambio.cambios)}`,
      );
      esperar(
        cambio.antes.secretaria === secretariaOriginal,
        `antes.secretaria = ${JSON.stringify(secretariaOriginal)}`,
        `antes.secretaria = ${JSON.stringify(cambio.antes.secretaria)}, se esperaba ${JSON.stringify(secretariaOriginal)}`,
      );
      esperar(
        cambio.despues.secretaria === valorPrueba,
        `despues.secretaria = ${JSON.stringify(valorPrueba)}`,
        `despues.secretaria = ${JSON.stringify(cambio.despues.secretaria)}`,
      );
      esperar(
        cambio.despues.actualizado_en !== cambio.antes.actualizado_en,
        "actualizado_en se movió con el cambio real (el trigger sigue vivo)",
        "actualizado_en NO se movió con un UPDATE real: ¿el trigger casos_set_actualizado_en desapareció?",
      );
      // El resto de la fila no se tocó.
      const intactas = (
        ["caratula", "expediente_numero", "organismo", "juez", "fiscalia", "titulo", "fuero"] as const
      ).every((c) => cambio.antes[c] === cambio.despues[c]);
      esperar(intactas, "Las demás columnas quedaron iguales", "Cambió una columna que no estaba en el patch");
      fichaTrasCambio = cambio.despues;
    }
  } finally {
    // Restaurar el valor original (o null). Es un cambio real, así que tiene
    // que salir `ok` con cambios=["secretaria"].
    const vuelta = await editarFicha(propiaId, yo.id, {
      secretaria: secretariaOriginal,
    });
    if (vuelta.ok && vuelta.despues.secretaria === secretariaOriginal) {
      ok(`secretaria restaurada a ${JSON.stringify(secretariaOriginal)}`);
    } else if (!vuelta.ok && vuelta.motivo === "sin_cambios" && !fichaTrasCambio) {
      info("No hubo cambio que restaurar");
    } else {
      mal(`No se pudo restaurar secretaria: ${JSON.stringify(vuelta)}`);
      info(`Restaurala a mano: casos.id = ${propiaId}, secretaria = ${JSON.stringify(secretariaOriginal)}`);
    }
  }

  // ---------------------------------------------------------------
  titulo("5. editarFicha: fuero congelado con el mapa armado");

  const { count: nodos } = await supabase
    .from("mapa_procesal_nodos")
    .select("id", { count: "exact", head: true })
    .eq("caso_id", propiaId);
  const mapaArmado = (nodos ?? 0) > 0;

  if (!mapaArmado) {
    info("La causa de prueba no tiene mapa: no se toca su fuero (la regla no aplica sin nodos).");
  } else {
    const otroFuero = ficha.fuero === "pba" ? "nacion" : "pba";
    const antesFuero = await leerFicha(propiaId, yo.id);
    const congelado = await editarFicha(propiaId, yo.id, { fuero: otroFuero });
    esperar(
      !congelado.ok && congelado.motivo === "fuero_congelado" && Boolean(congelado.detalle),
      `Cambiar ${ficha.fuero ?? "null"} → ${otroFuero} con ${nodos} nodos → fuero_congelado (con detalle)`,
      `Cambiar el fuero con mapa armado → ${JSON.stringify(congelado)}`,
    );
    // El rechazo llega ANTES del UPDATE: la fila no se tocó.
    const despuesFuero = await leerFicha(propiaId, yo.id);
    esperar(
      despuesFuero?.fuero === antesFuero?.fuero &&
        despuesFuero?.actualizado_en === antesFuero?.actualizado_en,
      "El rechazo no escribió nada (fuero y actualizado_en intactos)",
      "El rechazo por fuero congelado ESCRIBIÓ algo",
    );
    // Con `mapaArmado: false` explícito el servicio le cree al caller y no
    // consulta: acá NO se prueba porque escribiría el fuero de una causa real.
    const conOpts = await editarFicha(propiaId, yo.id, { fuero: otroFuero }, { mapaArmado: true });
    esperar(
      !conOpts.ok && conOpts.motivo === "fuero_congelado",
      "opts.mapaArmado=true también congela (sin consultar los nodos)",
      `opts.mapaArmado=true → ${JSON.stringify(conOpts)}`,
    );
  }

  // ---------------------------------------------------------------
  titulo("6. Partes: alta, duplicado, edición, baja");

  const nombreUno = `${PREFIJO_PRUEBA} Testigo Uno`;
  const nombreDos = `${PREFIJO_PRUEBA} Testigo Dos`;
  let parteId: string | null = null;

  try {
    const ajenaAlta = await agregarParte(ajenaId, yo.id, {
      nombre: nombreUno,
      rol: "testigo",
      es_cliente: false,
    });
    esperar(
      !ajenaAlta.ok && ajenaAlta.motivo === "caso_ajeno",
      "agregarParte en una causa ajena → caso_ajeno",
      `agregarParte en una causa ajena → ${JSON.stringify(ajenaAlta)}`,
    );

    const alta = await agregarParte(propiaId, yo.id, {
      nombre: nombreUno,
      rol: "testigo",
      es_cliente: false,
    });
    if (!alta.ok) {
      mal(`agregarParte falló: ${JSON.stringify(alta)}`);
      return;
    }
    parteId = alta.parte.id;
    ok(`agregarParte «${nombreUno}» → ok (id ${parteId})`);
    esperar(
      alta.parte.caso_id === propiaId && alta.parte.rol === "testigo" && alta.parte.situacion_libertad === null,
      "La parte quedó en la causa correcta, con rol testigo y sin situación",
      `La parte salió distinta: ${JSON.stringify(alta.parte)}`,
    );

    const listado = await listarPartes(propiaId);
    esperar(
      listado.some((p) => p.id === parteId),
      `listarPartes la incluye (${listado.length} partes en la causa)`,
      "listarPartes no trae la parte recién creada",
    );

    esperar(
      (await leerParte(propiaId, parteId))?.id === parteId,
      "leerParte la encuentra con su caso",
      "leerParte no encontró la parte recién creada",
    );
    esperar(
      (await leerParte(ajenaId, parteId)) === null,
      "leerParte con otro caso_id → null (el doble filtro funciona)",
      "leerParte DEVOLVIÓ la parte con un caso_id que no es el suyo",
    );

    // Duplicado: distinto casing, tildes de más, espacios repetidos.
    const dup = await agregarParte(propiaId, yo.id, {
      nombre: `  ${PREFIJO_PRUEBA}   TESTÍGO   uno `,
      rol: "imputado",
      es_cliente: true,
    });
    esperar(
      !dup.ok && dup.motivo === "duplicada" && dup.parte_existente?.id === parteId,
      "Repetir el nombre (otro casing, tildes, espacios) → duplicada con la parte existente",
      `Repetir el nombre → ${JSON.stringify(dup)}`,
    );

    // Edición sin cambios: ni patch vacío ni el mismo nombre escriben.
    const sinPatch = await editarParte(propiaId, yo.id, parteId, {});
    esperar(
      !sinPatch.ok && sinPatch.motivo === "sin_cambios",
      "editarParte con {} → sin_cambios",
      `editarParte con {} → ${JSON.stringify(sinPatch)}`,
    );
    const mismoNombre = await editarParte(propiaId, yo.id, parteId, { nombre: nombreUno });
    esperar(
      !mismoNombre.ok && mismoNombre.motivo === "sin_cambios",
      "editarParte con el mismo nombre → sin_cambios",
      `editarParte con el mismo nombre → ${JSON.stringify(mismoNombre)}`,
    );

    const edicion = await editarParte(propiaId, yo.id, parteId, {
      nombre: nombreDos,
      situacion_libertad: "libre",
    });
    if (!edicion.ok) {
      mal(`editarParte falló: ${JSON.stringify(edicion)}`);
    } else {
      esperar(
        edicion.antes.nombre === nombreUno && edicion.antes.situacion_libertad === null,
        `antes: «${edicion.antes.nombre}», sin situación`,
        `antes inesperado: ${JSON.stringify(edicion.antes)}`,
      );
      esperar(
        edicion.despues.nombre === nombreDos && edicion.despues.situacion_libertad === "libre",
        `despues: «${edicion.despues.nombre}», ${edicion.despues.situacion_libertad}`,
        `despues inesperado: ${JSON.stringify(edicion.despues)}`,
      );
      esperar(
        edicion.despues.rol === edicion.antes.rol && edicion.despues.es_cliente === edicion.antes.es_cliente,
        "rol y es_cliente quedaron como estaban",
        "Cambió rol o es_cliente sin estar en el patch",
      );
    }

    const ajenaEdicion = await editarParte(ajenaId, yo.id, parteId, { nombre: "x" });
    esperar(
      !ajenaEdicion.ok && ajenaEdicion.motivo === "caso_ajeno",
      "editarParte por una causa ajena → caso_ajeno",
      `editarParte por una causa ajena → ${JSON.stringify(ajenaEdicion)}`,
    );
    const inexistente = await editarParte(propiaId, yo.id, randomUUID(), { nombre: "x" });
    esperar(
      !inexistente.ok && inexistente.motivo === "no_existe",
      "editarParte de una parte inexistente → no_existe",
      `editarParte de una parte inexistente → ${JSON.stringify(inexistente)}`,
    );
    const ajenaBaja = await eliminarParte(ajenaId, yo.id, parteId);
    esperar(
      !ajenaBaja.ok && ajenaBaja.motivo === "caso_ajeno",
      "eliminarParte por una causa ajena → caso_ajeno (la parte sigue)",
      `eliminarParte por una causa ajena → ${JSON.stringify(ajenaBaja)}`,
    );

    const baja = await eliminarParte(propiaId, yo.id, parteId);
    esperar(
      baja.ok && baja.eliminada.id === parteId && baja.eliminada.nombre === nombreDos,
      `eliminarParte → ok, devuelve la fila borrada («${baja.ok ? baja.eliminada.nombre : "?"}»)`,
      `eliminarParte → ${JSON.stringify(baja)}`,
    );
    const otraVez = await eliminarParte(propiaId, yo.id, parteId);
    esperar(
      !otraVez.ok && otraVez.motivo === "no_existe",
      "eliminarParte de nuevo → no_existe",
      `eliminarParte de nuevo → ${JSON.stringify(otraVez)}`,
    );
    if (baja.ok) parteId = null;
  } finally {
    // Red de seguridad: cualquier parte "[prueba] …" que haya quedado en la
    // causa (por un fallo a mitad de camino) se borra. Un testigo inventado no
    // queda en un rincón: sale en la ficha, en el buscador y en el contexto
    // que leen el chat y LEXIE.
    const restos = (await listarPartes(propiaId)).filter((p) =>
      p.nombre.startsWith(PREFIJO_PRUEBA),
    );
    for (const p of restos) {
      const r = await eliminarParte(propiaId, yo.id, p.id);
      if (r.ok) info(`Limpieza: borrada la parte de prueba «${p.nombre}»`);
      else {
        mal(`No se pudo borrar la parte de prueba «${p.nombre}»`);
        info(`Borrala a mano: partes_caso.id = ${p.id}`);
      }
    }
    if (restos.length === 0) ok("No quedó ninguna parte de prueba en la causa");
  }

  console.log("");
}

// El código de salida se setea en `finally` y se deja que el proceso termine
// solo (ver la nota en verificar-ficha-causa.ts: un `process.exit()` a mitad
// del flujo hace abortar a libuv en Windows y tapa el error real).
main()
  .catch((e) => {
    console.error("\n❌ El verificador se cayó:", e);
    fallos++;
  })
  .finally(() => {
    console.log("=== Resultado ===");
    if (fallos === 0) {
      console.log("  Todo en orden. El servicio de escritura de la ficha y las partes responde como se espera.\n");
    } else {
      console.log(`  ${fallos} verificación(es) fallaron.\n`);
    }
    process.exitCode = fallos > 0 ? 1 : 0;
  });
