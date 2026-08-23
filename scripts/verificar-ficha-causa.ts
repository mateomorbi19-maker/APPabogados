// Verificación de la Fase 9 (ficha de causa) contra la base REAL.
//
// Corre así (el combo --conditions + dotenv es el de siempre para scripts que
// tocan módulos con `server-only`):
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server \
//     --import dotenv/config scripts/verificar-ficha-causa.ts
//
// Todo lo que hace está SCOPEADO A UN SOLO ABOGADO: por default el de
// VERIFICAR_EMAIL (o el admin), nunca "todas las causas de la base". El script
// entra con `service_role`, que bypassa RLS, así que sin ese filtro leería —y
// el bloque 6 ESCRIBIRÍA— en expedientes penales de los otros dos abogados.
//
// SOLO LECTURA salvo el bloque final, que crea y borra una parte de prueba en
// una causa propia para probar el camino de escritura de `partes_caso`. Se
// saltea con --sin-escritura.
//
// No toca el modelo: cero tokens, cero costo.
//
// Existe porque la migración 20260822120000 la corre una persona a mano en el
// SQL Editor, y hasta que eso pase el código nuevo referencia columnas que la
// base no tiene: eso es un 42703 que PostgREST traduce a 500 en TODOS los reads
// del caso. Este script contesta "¿ya está?" en una corrida, en vez de
// descubrirlo abriendo la app.

import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import { COLS_CASO, COLS_PARTE } from "@/lib/casos/columnas";
import { nombreCaso, sinCaratula } from "@/lib/casos/nombre";
import { etapaActual } from "@/lib/mapa-procesal/etapa-actual";
import { getNodosDelCaso } from "@/lib/mapa-procesal/queries";
import type { Caso } from "@/lib/types";

const SIN_ESCRITURA = process.argv.includes("--sin-escritura");

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

async function main() {
  const supabase = createServerClient();

  // ---------------------------------------------------------------
  titulo("0. De qué abogado son las causas que se van a mirar");

  // El script no tiene sesión de Clerk, así que el usuario se elige por env.
  // Sin esto, `casos[0]` del bloque 6 era la primera fila de un SELECT sin
  // filtro ni orden: podía ser de cualquiera de los tres.
  const EMAIL = (process.env.VERIFICAR_EMAIL ?? "mateomorbi19@gmail.com")
    .trim()
    .toLowerCase();

  const { data: yo, error: yoErr } = await supabase
    .from("usuarios")
    .select("id, nombre, email")
    .eq("email", EMAIL)
    .maybeSingle();

  if (yoErr || !yo) {
    mal(`No hay ningún usuario con email ${EMAIL}`);
    info("Pasá VERIFICAR_EMAIL=tu@email para verificar sobre tus causas.");
    return;
  }
  const usuario = yo as { id: string; nombre: string; email: string };
  ok(`Verificando sobre las causas de ${usuario.nombre} (${usuario.email})`);

  // ---------------------------------------------------------------
  titulo("1. La migración 20260822120000");

  const { data: casosData, error: casosErr } = await supabase
    .from("casos")
    .select(COLS_CASO)
    .eq("usuario_id", usuario.id)
    .order("creado_en", { ascending: true })
    .limit(50);

  if (casosErr) {
    mal(`El SELECT de casos con las columnas de la ficha falla: ${casosErr.message}`);
    info("La migración NO está aplicada. Corré supabase/migrations/20260822120000_ficha_de_causa.sql");
    info("en el SQL Editor de Supabase y volvé a correr este script.");
    return;
  }
  ok("`casos` tiene las 8 columnas de la ficha");

  const { error: partesErr } = await supabase
    .from("partes_caso")
    .select(COLS_PARTE)
    .limit(1);
  if (partesErr) {
    mal(`La tabla partes_caso no responde: ${partesErr.message}`);
    return;
  }
  ok("`partes_caso` existe y responde");

  const casos = (casosData ?? []) as unknown as Caso[];
  info(`${casos.length} causas leídas`);

  // ---------------------------------------------------------------
  titulo("2. Estado de carga de la ficha");

  const sinEstado = casos.filter((c) => !c.estado_seguimiento);
  if (sinEstado.length > 0) {
    mal(`${sinEstado.length} causas sin estado_seguimiento (la columna es NOT NULL DEFAULT 'activa')`);
  } else {
    ok("Todas las causas tienen estado_seguimiento");
  }

  const conCaratula = casos.filter((c) => !sinCaratula(c)).length;
  info(`Carátula cargada: ${conCaratula}/${casos.length}`);
  info(`Expediente cargado: ${casos.filter((c) => c.expediente_numero).length}/${casos.length}`);
  info(`Organismo cargado: ${casos.filter((c) => c.organismo).length}/${casos.length}`);
  info(`Fuero definido: ${casos.filter((c) => c.fuero).length}/${casos.length}`);

  if (conCaratula === 0 && casos.length > 0) {
    info("Ninguna causa tiene carátula todavía: es lo esperado recién aplicada la migración.");
    info("El UI las muestra en cursiva con el título de trabajo, y la ficha ofrece cargarlas.");
  }

  // ---------------------------------------------------------------
  titulo("3. nombreCaso(): la carátula manda, el título es el fallback");

  let nombresOk = true;
  for (const c of casos) {
    const esperado = c.caratula?.trim() ? c.caratula.trim() : c.titulo;
    if (nombreCaso(c) !== esperado) {
      mal(`nombreCaso() devolvió algo inesperado para ${c.id}`);
      nombresOk = false;
    }
    if (nombreCaso(c).trim() === "") {
      mal(`La causa ${c.id} se quedó sin nombre visible`);
      nombresOk = false;
    }
  }
  if (nombresOk) ok("Todas las causas resuelven a un nombre no vacío");

  const provisorios = casos.filter(sinCaratula);
  if (provisorios.length > 0) {
    info(`${provisorios.length} se siguen llamando por su título automático. Ejemplos:`);
    for (const c of provisorios.slice(0, 3)) {
      info(`   · "${nombreCaso(c).slice(0, 70)}"`);
    }
  }

  // ---------------------------------------------------------------
  titulo("4. Etapa procesal derivada del mapa");

  for (const c of casos.slice(0, 10)) {
    const nodos = await getNodosDelCaso(c.id);
    const etapa = etapaActual(nodos);
    const nombre = nombreCaso(c).slice(0, 40);
    if (nodos.length === 0) {
      info(`· ${nombre} → sin mapa (el UI muestra "Sin mapa · Iniciar")`);
    } else if (!etapa) {
      info(`· ${nombre} → mapa con ${nodos.length} nodos, ninguno marcado como ocurrido`);
    } else {
      info(`· ${nombre} → ${etapa.label} (por "${etapa.nodoTitulo}")`);
    }
  }
  ok("La etapa se deriva sin excepciones");

  // ---------------------------------------------------------------
  titulo("5. Aislamiento: partes_caso cerrada a los roles públicos");

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!anonKey || !url) {
    info("Sin anon key en el entorno: no se pudo probar. (No es un fallo del código.)");
  } else {
    const res = await fetch(`${url}/rest/v1/partes_caso?select=nombre&limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (res.ok) {
      mal(
        `partes_caso se LEE con la anon key (HTTP ${res.status}). Falta el REVOKE de la migración.`,
      );
      info("Son nombres reales de clientes e imputados y la anon key viaja en el bundle.");
    } else {
      ok(`partes_caso rechaza la anon key (HTTP ${res.status})`);
    }
  }

  // ---------------------------------------------------------------
  titulo("6. Escritura de partes_caso");

  if (SIN_ESCRITURA) {
    info("Salteado por --sin-escritura");
  } else if (casos.length === 0) {
    info("No hay causas para probar la escritura");
  } else {
    const casoPrueba = casos[0];
    const { data: creada, error: crearErr } = await supabase
      .from("partes_caso")
      .insert({
        caso_id: casoPrueba.id,
        nombre: "PRUEBA verificar-ficha-causa (borrar si quedó)",
        rol: "imputado",
        es_cliente: false,
        situacion_libertad: "prision_preventiva",
      })
      .select(COLS_PARTE)
      .single();

    if (crearErr || !creada) {
      mal(`No se pudo insertar una parte: ${crearErr?.message}`);
    } else {
      const idPrueba = (creada as { id: string }).id;
      ok("INSERT en partes_caso");

      // El borrado va en `finally`: si el chequeo del CHECK tira, la fila de
      // prueba tiene que desaparecer igual. Un "imputado en prisión preventiva"
      // huérfano no queda en un rincón — sale en la ficha, en el buscador como
      // parte, y en el contexto que lee el agente del chat.
      try {
        const { error: rolMalErr } = await supabase
          .from("partes_caso")
          .update({ rol: "escribano" })
          .eq("id", idPrueba);
        if (rolMalErr)
          ok("El CHECK de `rol` rechaza un valor fuera del vocabulario");
        else mal("El CHECK de `rol` aceptó 'escribano': el constraint no se aplicó");
      } finally {
        const { error: borrarErr } = await supabase
          .from("partes_caso")
          .delete()
          .eq("id", idPrueba);
        if (borrarErr) {
          mal(`No se pudo borrar la parte de prueba: ${borrarErr.message}`);
          info(`Borrala a mano: partes_caso.id = ${idPrueba}`);
        } else {
          ok("DELETE en partes_caso (la fila de prueba quedó limpia)");
        }
      }
    }
  }

  console.log("");
}

// El código de salida se setea en `finally` y se deja que el proceso termine
// solo, por dos motivos:
//
//   1. `main()` corta temprano cuando la migración no está aplicada, así que un
//      `process.exit(1)` al final del cuerpo NUNCA se ejecutaría en el caso más
//      importante: el verificador saldría 0 informando que falló.
//   2. `process.exit()` en medio del flujo hace que libuv en Windows aborte con
//      "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)", y ese crash
//      tapa el mensaje de error real.
main()
  .catch((e) => {
    console.error("\n❌ El verificador se cayó:", e);
    fallos++;
  })
  .finally(() => {
    console.log("=== Resultado ===");
    if (fallos === 0) {
      console.log("  Todo en orden. La ficha de causa está lista para usar.\n");
    } else {
      console.log(`  ${fallos} verificación(es) fallaron.\n`);
    }
    process.exitCode = fallos > 0 ? 1 : 0;
  });
