import { config } from "dotenv";
config({ path: ".env.local" });

import { getAnthropic, MODEL_ID } from "../src/lib/anthropic";
import {
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_CONSULTA,
  systemPromptAnalisis,
} from "../src/lib/agent/prompts";
import { buscarDocumentosTool } from "../src/lib/agent/tools";
import { repositorioTools } from "../src/lib/agent/repositorio-tools";

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

  // El análisis con el Repositorio autorizado y el chat cargan bastante más
  // system + tool descriptions. Se miden aparte para poder decidir el prompt
  // caching con el número real de cada camino, no con el del más chico.
  const analisisConRepositorio = await client.messages.countTokens({
    model: MODEL_ID,
    system: systemPromptAnalisis(true),
    tools: [buscarDocumentosTool, ...repositorioTools],
    messages: [{ role: "user", content: "x" }],
  });

  const chat = await client.messages.countTokens({
    model: MODEL_ID,
    system: SYSTEM_PROMPT_CONSULTA,
    tools: [buscarDocumentosTool, ...repositorioTools],
    messages: [{ role: "user", content: "x" }],
  });

  console.log(JSON.stringify({
    modelo: MODEL_ID,
    minimo_cache_sonnet_45: 1024,
    solo_system: soloSystem,
    con_tools: conTools,
    analisis_con_repositorio: analisisConRepositorio,
    chat_consulta: chat,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
