import "server-only";
import { buscarDocumentosTool, ejecutarToolBuscar } from "@/lib/agent/tools";
import { correrLoop, MotorError, type FamiliaTools } from "@/lib/agent/motor";
import {
  AgentError,
  type Busqueda,
  type RunAgentUsage,
} from "@/lib/agent/run-agent";
import {
  ejecutarToolRepositorio,
  repositorioTools,
  type ConsultaRepositorio,
} from "@/lib/agent/repositorio-tools";
import { ESCRITO_SYSTEM_PROMPT } from "./prompt";

// El agente que redacta un escrito. Cuarto consumidor del motor genérico.
//
// Presupuestos chicos a propósito: el escrito ya viene con su esqueleto (el
// modelo) y con su base normativa orientativa; las búsquedas son para
// VERIFICAR artículos y para encontrar UN precedente que respalde la tesis,
// no para investigar el caso desde cero. Cuatro búsquedas normativas y tres
// consultas al repositorio alcanzan; un escrito que necesita más es un caso
// para el chat de la causa, no para el redactor.
const CAP_NORMATIVA = 4;
const CAP_REPOSITORIO = 3;

export type RunEscritoInput = {
  mensaje: string;
  modelId: string;
  maxTokens?: number;
};

export type RunEscritoResult = {
  contenido: string;
  usage: RunAgentUsage;
  costo_usd: number;
  iterations: number;
  busquedas: Busqueda[];
  consultas_repositorio: ConsultaRepositorio[];
  degraded_response: boolean;
};

// El modelo tiene la orden de devolver SOLO el escrito, pero un modelo que
// obedece el 99% de las veces sigue envolviendo la salida en ``` el 1%
// restante. Se limpia acá, defensivamente, igual que parse.ts con el JSON.
function limpiarSalida(raw: string): string {
  let t = raw.trim();
  const fence = t.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) t = fence[1].trim();
  return t;
}

export async function runEscrito(
  input: RunEscritoInput,
): Promise<RunEscritoResult> {
  const busquedas: Busqueda[] = [];
  const consultasRepositorio: ConsultaRepositorio[] = [];

  const familias: FamiliaTools<null>[] = [
    {
      nombre: "normativa",
      tools: [buscarDocumentosTool],
      cap: CAP_NORMATIVA,
      paralelizable: true,
      mensajeCapAgotado: `Alcanzaste el límite de ${CAP_NORMATIVA} búsquedas normativas para este escrito. Redactalo con lo que ya verificaste; lo que no pudiste verificar va con la marca [VERIFICAR: ...].`,
      avisoCapAgotado: `Alcanzaste el límite de búsquedas normativas (${CAP_NORMATIVA}) para este escrito.`,
      ejecutar: async (tu) => {
        const args = (tu.input ?? {}) as { query?: unknown };
        const query = typeof args.query === "string" ? args.query : "";
        // Slot reservado antes del await para conservar el orden en que el
        // modelo pidió las búsquedas (ver la nota del motor).
        const idx = busquedas.length;
        busquedas.push({ query, chunks_devueltos: 0, similarity_top: null });
        try {
          const r = await ejecutarToolBuscar(query);
          busquedas[idx] = {
            query,
            chunks_devueltos: r.chunks_devueltos,
            similarity_top: r.similarity_top,
          };
          return { contentJSON: r.contentJSON };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { contentJSON: `Error: ${msg}`, isError: true };
        }
      },
    },
    {
      nombre: "repositorio",
      tools: repositorioTools,
      cap: CAP_REPOSITORIO,
      paralelizable: true,
      mensajeCapAgotado: `Alcanzaste el límite de ${CAP_REPOSITORIO} consultas al repositorio para este escrito. Redactalo con los precedentes que ya tenés, o sin jurisprudencia si ninguno aplica.`,
      avisoCapAgotado: `Alcanzaste el límite de consultas al repositorio (${CAP_REPOSITORIO}) para este escrito.`,
      ejecutar: async (tu) => {
        try {
          const r = await ejecutarToolRepositorio(tu.name, tu.input);
          if (r.consulta) consultasRepositorio.push(r.consulta);
          return { contentJSON: r.contentJSON };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[run-escrito] ${tu.name} falló:`, msg);
          return {
            contentJSON: `Error consultando el repositorio: ${msg}. Redactá el escrito sin jurisprudencia del repositorio.`,
            isError: true,
          };
        }
      },
    },
  ];

  let res;
  try {
    res = await correrLoop<null>({
      systemPrompt: ESCRITO_SYSTEM_PROMPT,
      messages: [{ role: "user", content: input.mensaje }],
      modelId: input.modelId,
      // Un escrito largo (casación, REF) puede pasar las 3.000 palabras.
      maxTokens: input.maxTokens ?? 8000,
      // 4 + 3 = 7 de presupuesto, techo de 8 vueltas: el modelo agrupa varias
      // tool calls por iteración y la última sale siempre sin tools.
      maxIterations: 8,
      familias,
      contexto: null,
    });
  } catch (e) {
    if (e instanceof MotorError) {
      throw new AgentError(
        e.message,
        e.code,
        e.partialUsage,
        e.partialCostoUsd,
        [...busquedas],
        e.partialIterations,
      );
    }
    throw e;
  }

  return {
    contenido: limpiarSalida(res.rawText),
    usage: res.usage,
    costo_usd: res.costo_usd,
    iterations: res.iterations,
    busquedas,
    consultas_repositorio: consultasRepositorio,
    degraded_response: res.sintesisForzada,
  };
}
