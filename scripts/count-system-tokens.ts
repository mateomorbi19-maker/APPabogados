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
import type { gmail_v1 } from "@googleapis/gmail";
import { LEXIE_SYSTEM_PROMPT } from "../src/lib/agent/lexie-prompt";
import { lexieTools, type ContextoLexie } from "../src/lib/agent/lexie-tools";
import { DOMINIOS_LEXIE } from "../src/lib/lexie/ejecutar-accion";

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

  // LEXIE con manos (Fase 11): el prefijo cacheado incluye el system (con los
  // tramos de los cuatro dominios) y TODAS las tools declarables. Se mide con
  // Gmail presente, que es el caso mayor; sin scope, las 6 tools de correo no
  // se declaran y el prefijo baja.
  const ctxLexie: ContextoLexie = {
    usuarioId: "x",
    nombre: "x",
    clerkUserId: "x",
    gmail: {} as gmail_v1.Gmail,
    mensajesAbogado: [],
    casoIdEnPantalla: null,
    accionesPendientes: new Map(),
    clavesConsumidas: new Set(),
    correoLeido: false,
    hilosLeidos: new Set(),
  };
  const toolsLexie = [
    ...lexieTools,
    ...repositorioTools,
    buscarDocumentosTool,
    ...DOMINIOS_LEXIE.flatMap((d) =>
      d
        .familias(ctxLexie)
        .filter((f) => f.habilitada !== false)
        .flatMap((f) => f.tools),
    ),
  ];
  const lexie = await client.messages.countTokens({
    model: MODEL_ID,
    system: LEXIE_SYSTEM_PROMPT,
    tools: toolsLexie,
    messages: [{ role: "user", content: "x" }],
  });
  const lexieSoloSystem = await client.messages.countTokens({
    model: MODEL_ID,
    system: LEXIE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: "x" }],
  });

  console.log(JSON.stringify({
    modelo: MODEL_ID,
    lexie_fase11: {
      system: lexieSoloSystem,
      system_y_tools: lexie,
      cantidad_tools: toolsLexie.length,
    },
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
