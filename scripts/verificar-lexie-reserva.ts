// Verifica contra la base real la RESERVA atómica de una acción pendiente
// (Fase 11): el UPDATE condicional con `@>` sobre metadata.acciones.
//
// Escribe y borra una conversación de prueba ARCHIVADA del usuario de prueba:
// no interfiere con su hilo activo. Cero tokens.
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server \
//     --import dotenv/config scripts/verificar-lexie-reserva.ts

import { createServerClient } from "../src/lib/supabase/server";
import {
  actualizarMensajeAgente,
  insertarParBoton,
  reservarPendiente,
  getMensajes,
  sembrarPendientes,
} from "../src/lib/lexie/queries";
import type { AccionLexie } from "../src/lib/lexie/acciones";

const fallas: string[] = [];
const ok = (t: string) => console.log(`  ok   ${t}`);
const mal = (t: string) => {
  console.log(`  MAL  ${t}`);
  fallas.push(t);
};

async function main() {
  const supabase = createServerClient();
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("id")
    .eq("email", "mateomorbi19@gmail.com")
    .maybeSingle();
  if (!usuario) throw new Error("sin usuario de prueba");

  const { data: conv, error: errConv } = await supabase
    .from("conversaciones_lexie")
    .insert({ usuario_id: usuario.id, archivada: true, titulo: "[prueba reserva]" })
    .select("id")
    .single();
  if (errConv || !conv) throw new Error(`conv: ${errConv?.message}`);
  const convId = conv.id as string;

  try {
    const p1: AccionLexie = {
      tool: "correo_enviar",
      estado: "pendiente",
      clave: "correo_enviar:aaaaaaaaaaaaaaaa",
      resumen: "Enviar correo de prueba",
      seccion: "bandeja",
      vista_previa: { para: "x@y.com" },
      payload: { para: ["x@y.com"], asunto: "a", cuerpo: "b" },
    };
    const p2: AccionLexie = { ...p1, clave: "correo_enviar:bbbbbbbbbbbbbbbb", resumen: "Otra pendiente" };
    const { data: msg, error: errMsg } = await supabase
      .from("mensajes_lexie")
      .insert({
        conversacion_id: convId,
        tipo: "agente",
        contenido: "¿confirmás?",
        metadata: { acciones: [p1, p2], hilos_leidos: ["t1"] },
      })
      .select("id")
      .single();
    if (errMsg || !msg) throw new Error(`msg: ${errMsg?.message}`);
    const msgId = msg.id as string;

    const r1 = await reservarPendiente(msgId, p1.clave!, "en_curso");
    if (r1 && r1.estado === "en_curso") ok("primera reserva → en_curso");
    else mal(`primera reserva devolvió ${JSON.stringify(r1)}`);

    const r2 = await reservarPendiente(msgId, p1.clave!, "en_curso");
    if (r2 === null) ok("segunda reserva de la misma clave → null (sin doble ejecución)");
    else mal("la segunda reserva TAMBIÉN pasó: doble ejecución posible");

    const r3 = await reservarPendiente(msgId, "correo_enviar:zzzzzzzzzzzzzzzz", "en_curso");
    if (r3 === null) ok("clave inexistente → null");
    else mal("clave inexistente fue reservada");

    // Carrera real: dos reservas concurrentes sobre p2, exactamente una gana.
    const [c1, c2] = await Promise.all([
      reservarPendiente(msgId, p2.clave!, "en_curso"),
      reservarPendiente(msgId, p2.clave!, "descartada"),
    ]);
    const ganadores = [c1, c2].filter(Boolean).length;
    if (ganadores === 1) ok("dos reservas concurrentes: exactamente una gana");
    else mal(`dos reservas concurrentes: ganaron ${ganadores}`);

    // El par del botón copia las pendientes vivas, y la siembra las ve.
    const historialAntes = await getMensajes(convId);
    const vivasAntes = sembrarPendientes(historialAntes);
    const par = await insertarParBoton({
      conversacionId: convId,
      textoUsuario: "Confirmé: prueba",
      textoAgente: "Ejecutando…",
      acciones: [{ ...p1, estado: "en_curso" }, ...vivasAntes.filter((a) => a.clave !== p1.clave)],
      hilosLeidos: ["t1"],
    });
    await actualizarMensajeAgente(par.idAgente, "Hecho: prueba", {
      ...p1,
      payload: undefined,
      estado: "ok",
      confirmado_por: "click",
    });
    const historial = await getMensajes(convId);
    const ultimo = historial[historial.length - 1];
    const acc = (ultimo.metadata as { acciones: AccionLexie[] }).acciones;
    if (ultimo.contenido === "Hecho: prueba" && acc[0].estado === "ok" && acc[0].payload === undefined) {
      ok("el par del botón queda con la acción resuelta y sin payload");
    } else {
      mal(`par del botón inesperado: ${JSON.stringify(ultimo)}`);
    }
    const hilos = (ultimo.metadata as { hilos_leidos: string[] }).hilos_leidos;
    if (Array.isArray(hilos) && hilos[0] === "t1") ok("el par del botón conserva hilos_leidos");
    else mal("el par del botón perdió hilos_leidos");
  } finally {
    await supabase.from("conversaciones_lexie").delete().eq("id", convId);
    console.log("  (conversación de prueba borrada)");
  }

  console.log("\n=== VEREDICTO ===");
  if (fallas.length === 0) console.log("OK — la reserva atómica funciona contra la base real.");
  else {
    console.log(`${fallas.length} FALLA(S):`);
    fallas.forEach((f) => console.log("  - " + f));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exitCode = 1;
});
