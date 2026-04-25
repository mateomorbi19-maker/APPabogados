import { runAgent } from "../src/lib/agent/run-agent";
import { SYSTEM_PROMPT, armarPrompt } from "../src/lib/agent/prompts";
import { parseWithRecovery } from "../src/lib/agent/parse";

async function main() {
  const caso =
    "Mi cliente fue detenido en flagrancia con 5g de cocaína en CABA";
  const rol = "defensor" as const;
  const contexto = {
    jurisdiccion: "CABA",
    primer_proceso: "Sí",
    hay_detenidos: "Sí",
    etapa_procesal: "Detención inicial",
  };

  const userPrompt = armarPrompt(caso, rol, contexto);
  const t0 = Date.now();
  const result = await runAgent({
    userPrompt,
    systemPrompt: SYSTEM_PROMPT,
  });
  const ms = Date.now() - t0;

  console.log("=== iterations ===");
  console.log(result.iterations);

  console.log("\n=== busquedas ===");
  console.log(result.busquedas);

  console.log("\n=== usage ===");
  console.log(JSON.stringify(result.usage, null, 2));

  console.log("\n=== latencia_ms ===");
  console.log(ms);

  console.log("\n=== rawText (primeros 500 chars) ===");
  console.log(result.rawText.slice(0, 500));

  console.log("\n=== parseWithRecovery ===");
  const parsed = parseWithRecovery(result.rawText);
  if (parsed.ok) {
    console.log(`ok: true`);
    console.log(`parseo_intento: ${parsed.parseo_intento}`);
    console.log(`keys: ${Object.keys(parsed.resultado).join(", ")}`);
  } else {
    console.log(`ok: false`);
    console.log(`error: ${parsed.error}`);
    console.log(`raw_response (primeros 500): ${parsed.raw_response.slice(0, 500)}`);
  }

  console.log("\n=== assertions ===");
  const checks = {
    "iterations >= 1": result.iterations >= 1,
    "busquedas.length >= 1": result.busquedas.length >= 1,
    "usage.input_tokens > 0": result.usage.input_tokens > 0,
    "usage.output_tokens > 0": result.usage.output_tokens > 0,
    "rawText no vacío": result.rawText.length > 0,
  };
  for (const [k, v] of Object.entries(checks)) {
    console.log(`${v ? "✓" : "✗"} ${k}`);
  }
  const allOk = Object.values(checks).every(Boolean);
  if (!allOk) {
    console.error("\nFALLÓ alguna assertion");
    process.exit(1);
  }
  console.log("\nOK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
