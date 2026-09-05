// Cuánto pesa cada pieza del prefijo cacheado de LEXIE (system + tools), con
// count_tokens (gratis). Sirve para decidir qué recortar: el prefijo se escribe
// al caché en la primera request de cada hilo (o cuando el caché venció) y se
// lee a 0,1x en las siguientes, así que cada token de descripción se paga en
// todas las aperturas de todos los abogados.
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx --conditions=react-server \
//     --import dotenv/config scripts/medir-prefijo-lexie.ts

import type Anthropic from "@anthropic-ai/sdk";
import type { gmail_v1 } from "@googleapis/gmail";
import { getAnthropic, MODEL_ID } from "../src/lib/anthropic";
import { LEXIE_SYSTEM_PROMPT } from "../src/lib/agent/lexie-prompt";
import { LEXIE_MANUAL_APP } from "../src/lib/agent/lexie-manual";
import { lexieTools, type ContextoLexie } from "../src/lib/agent/lexie-tools";
import { repositorioTools } from "../src/lib/agent/repositorio-tools";
import { buscarDocumentosTool } from "../src/lib/agent/tools";
import { DOMINIOS_LEXIE } from "../src/lib/lexie/ejecutar-accion";

async function main() {
  const client = getAnthropic();
  const contar = async (system: string, tools: Anthropic.Tool[]) =>
    (
      await client.messages.countTokens({
        model: MODEL_ID,
        system,
        tools,
        messages: [{ role: "user", content: "x" }],
      })
    ).input_tokens;

  const ctx: ContextoLexie = {
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

  const base = await contar("x", []);
  console.log(`base (mensaje 'x'):              ${base}`);
  console.log(`system completo:                 ${(await contar(LEXIE_SYSTEM_PROMPT, [])) - base}`);
  console.log(`  manual de la app:              ${(await contar(LEXIE_MANUAL_APP, [])) - base}`);
  for (const d of DOMINIOS_LEXIE) {
    const p = d.prompt.trim().length > 0 ? (await contar(d.prompt, [])) - base : 0;
    const m = d.manual.trim().length > 0 ? (await contar(d.manual, [])) - base : 0;
    console.log(`  prompt ${d.nombre.padEnd(9)}               ${p}  (manual ${m})`);
  }
  console.log("");
  const basicas: Array<[string, Anthropic.Tool[]]> = [
    ["lexie (agenda/casos/leer)", lexieTools],
    ["repositorio", repositorioTools],
    ["normativa", [buscarDocumentosTool]],
  ];
  for (const [nombre, tools] of basicas) {
    console.log(`tools ${nombre.padEnd(28)} ${(await contar("x", tools)) - base}`);
  }
  for (const d of DOMINIOS_LEXIE) {
    for (const f of d.familias(ctx)) {
      const t = (await contar("x", f.tools)) - base;
      console.log(`tools ${f.nombre.padEnd(28)} ${String(t).padStart(5)}  (${f.tools.length}: ${f.tools.map((x) => x.name).join(", ")})`);
      for (const tool of f.tools) {
        console.log(`      ${tool.name.padEnd(28)} ${(await contar("x", [tool])) - base}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
