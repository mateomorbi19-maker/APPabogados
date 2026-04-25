import { config } from "dotenv";
config({ path: ".env.local" });

import { getAnthropic, MODEL_ID } from "../src/lib/anthropic";
import { SYSTEM_PROMPT } from "../src/lib/agent/prompts";
import { buscarDocumentosTool } from "../src/lib/agent/tools";

async function main() {
  const client = getAnthropic();

  const soloSystem = await client.messages.countTokens({
    model: MODEL_ID,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: "x" }],
  });

  const conTools = await client.messages.countTokens({
    model: MODEL_ID,
    system: SYSTEM_PROMPT,
    tools: [buscarDocumentosTool],
    messages: [{ role: "user", content: "x" }],
  });

  console.log(JSON.stringify({
    modelo: MODEL_ID,
    minimo_cache_sonnet_45: 1024,
    solo_system: soloSystem,
    con_tools: conTools,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
