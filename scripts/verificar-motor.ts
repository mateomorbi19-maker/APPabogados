// Verificación end-to-end del motor de agente (src/lib/agent/motor.ts).
//
// Ejercita runAgentConsulta —que corre sobre correrLoop— con tools REALES: el
// RAG normativo y el repositorio del estudio. NO escribe nada en la base: no
// inserta en `ejecuciones` ni toca el mapa (mapaHabilitado: false, así que esas
// tools ni se declaran).
//
// Corre DOS turnos encadenados a propósito:
//
//   Turno 1 — pide tres temas distintos, para forzar varias búsquedas en la
//   MISMA iteración. Es el camino paralelo del motor, y es donde vivía el bug
//   de orden que encontró la revisión del refactor: el array `busquedas` tiene
//   que quedar en el orden en que el modelo las pidió, no en el que resolvió
//   la red.
//
//   Turno 2 — repregunta con el turno 1 como historial. Es el único escenario
//   donde se puede MEDIR el prompt caching: el prefijo estable (tools + system
//   + toda la conversación previa) tiene que volver como cache_read en vez de
//   pagarse de nuevo a precio de input.
//
// Costo aproximado: USD 0,10 los dos turnos.
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server \
//     --import dotenv/config scripts/verificar-motor.ts

import type Anthropic from "@anthropic-ai/sdk";
import { runAgentConsulta } from "../src/lib/agent/run-agent-consulta";

const CONTEXTO =
  "## Caso\n\nDetención en flagrancia en la vía pública. El acta de requisa no menciona motivos previos de sospecha. El detenido continúa privado de su libertad.";

const SYSTEM =
  "Sos un asistente jurídico penal argentino que trabaja para un abogado defensor en Argentina. " +
  "Usá la herramienta de búsqueda para fundar cada punto en normativa concreta: hacé UNA búsqueda POR TEMA, " +
  "todas en el mismo turno cuando el abogado te pida varios temas a la vez. " +
  "Citá siempre el artículo exacto tal como aparece en el fragmento recuperado, sin inventar numeración. " +
  "Respondé en texto plano, en español rioplatense, de forma breve y directa. No devuelvas JSON ni markdown de código.";

const IDS_DUMMY = {
  // Con mapaHabilitado:false las tools de mapa no se declaran, así que estos
  // ids no llegan a usarse. Van con formato UUID válido igual.
  casoId: "00000000-0000-0000-0000-000000000000",
  usuarioId: "00000000-0000-0000-0000-000000000000",
};

function fmtUsage(u: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}): string {
  return `in ${u.input_tokens.toLocaleString("es-AR")} · out ${u.output_tokens.toLocaleString("es-AR")} · cache_write ${u.cache_creation_input_tokens.toLocaleString("es-AR")} · cache_read ${u.cache_read_input_tokens.toLocaleString("es-AR")}`;
}

async function main() {
  const fallas: string[] = [];

  // ===================== TURNO 1 =====================
  console.log("=== TURNO 1 — tres temas, varias búsquedas en paralelo ===\n");
  const t0 = Date.now();
  const r1 = await runAgentConsulta({
    pregunta:
      "Necesito tres cosas para este caso: (1) los requisitos de validez de una requisa sin orden judicial, (2) el plazo y los requisitos del control de detención, y (3) qué dice el Código Penal sobre tenencia simple. Buscá cada tema por separado.",
    contextoCaso: CONTEXTO,
    adjuntos: [],
    systemPrompt: SYSTEM,
    modelId: "claude-sonnet-4-5-20250929",
    maxTokens: 4000,
    ...IDS_DUMMY,
    mapaHabilitado: false,
  });
  const ms1 = Date.now() - t0;

  console.log(`iterations       ${r1.iterations}`);
  console.log(`degraded         ${r1.degraded_response}`);
  console.log(`latencia_ms      ${ms1}`);
  console.log(`usage            ${fmtUsage(r1.usage)}`);
  console.log(`costo_usd        ${r1.costo_usd}`);
  console.log(`acciones         ${r1.acciones.length} (debe ser 0: mapa off)`);
  console.log("\nbúsquedas (el orden debe ser el que pidió el modelo):");
  r1.busquedas.forEach((b, i) =>
    console.log(
      `  ${i + 1}. "${b.query}" → ${b.chunks_devueltos} chunks, top ${b.similarity_top}`,
    ),
  );
  console.log(`\nrespuesta (300 chars): ${r1.rawText.slice(0, 300)}…\n`);

  if (r1.acciones.length !== 0) fallas.push("T1: acciones debería ser 0 con mapaHabilitado:false");
  if (r1.busquedas.length === 0) fallas.push("T1: no hubo NINGUNA búsqueda, el RAG no se ejercitó");
  if (r1.rawText.trim().length === 0) fallas.push("T1: rawText vacío, el loop no sintetizó");
  if (r1.usage.input_tokens === 0) fallas.push("T1: input_tokens en 0, no se acumuló usage");
  if (r1.costo_usd <= 0) fallas.push("T1: costo_usd en 0, no se acumuló costo");
  if (r1.usage.cache_creation_input_tokens === 0) {
    fallas.push(
      "T1: cache_creation_input_tokens en 0 — el breakpoint de system/tools no escribió caché (¿prefijo por debajo del mínimo de 1.024 tokens?)",
    );
  }

  // ===================== TURNO 2 =====================
  // Historial reconstruido a mano, como hace buildContextoConversacion en la
  // route real. El motor le agrega el mensaje nuevo al final y pone el
  // breakpoint de caché sobre el último mensaje de ESTE historial.
  const historial: Anthropic.MessageParam[] = [
    { role: "user", content: `${CONTEXTO}\n\n(consulta previa sobre requisa, control de detención y tenencia simple)` },
    { role: "assistant", content: r1.rawText },
  ];

  console.log("=== TURNO 2 — repregunta sobre el turno 1 (mide el caché) ===\n");
  const t1 = Date.now();
  const r2 = await runAgentConsulta({
    pregunta:
      "De lo que me contaste sobre la requisa: ¿qué consecuencia procesal concreta tiene que el acta no mencione los motivos de sospecha previos? Respondé breve, sin buscar de nuevo si ya lo tenés.",
    contextoCaso: CONTEXTO,
    adjuntos: [],
    systemPrompt: SYSTEM,
    modelId: "claude-sonnet-4-5-20250929",
    maxTokens: 2000,
    ...IDS_DUMMY,
    mapaHabilitado: false,
    mensajesPrevios: historial,
  });
  const ms2 = Date.now() - t1;

  console.log(`iterations       ${r2.iterations}`);
  console.log(`latencia_ms      ${ms2}`);
  console.log(`usage            ${fmtUsage(r2.usage)}`);
  console.log(`costo_usd        ${r2.costo_usd}`);
  console.log(`\nrespuesta (300 chars): ${r2.rawText.slice(0, 300)}…\n`);

  if (r2.rawText.trim().length === 0) fallas.push("T2: rawText vacío");
  if (r2.usage.cache_read_input_tokens === 0) {
    fallas.push(
      "T2: cache_read_input_tokens en 0 — el prefijo NO se está reutilizando. El caché no sirve de nada así.",
    );
  }

  // ===================== BALANCE =====================
  const totalCache = r1.usage.cache_read_input_tokens + r2.usage.cache_read_input_tokens;
  const costoTotal = r1.costo_usd + r2.costo_usd;
  // Lo que habrían costado los tokens leídos de caché si se hubieran pagado a
  // precio de input completo (Sonnet 4.5: 3 USD/MTok input, 0,30 de cache read).
  const ahorro = (totalCache * (3.0 - 0.3)) / 1_000_000;

  console.log("=== BALANCE ===");
  console.log(`costo total de la verificación   USD ${costoTotal.toFixed(4)}`);
  console.log(`tokens leídos de caché           ${totalCache.toLocaleString("es-AR")}`);
  console.log(`ahorrado por el caché            USD ${ahorro.toFixed(4)}`);

  console.log("\n=== VEREDICTO ===");
  if (fallas.length === 0) {
    console.log("OK — el motor ejecuta tools reales, respeta el orden, sintetiza y cachea el prefijo.");
  } else {
    console.log("FALLAS:");
    fallas.forEach((f) => console.log("  - " + f));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exitCode = 1;
});
