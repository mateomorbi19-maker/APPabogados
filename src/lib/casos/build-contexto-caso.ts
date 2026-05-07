import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import type { Adjunto } from "@/lib/casos/adjuntos";
import { CATEGORIA_LABEL } from "@/lib/casos/categorias";

// Construye el contexto que se le pasa al agente cuando el abogado hace
// una consulta sobre un caso ya en marcha. Lo arma como markdown
// estructurado para que el modelo pueda parsear las secciones con
// claridad.
//
// Decisiones:
// - Las respuestas de consultas previas del agente se incluyen
//   RESUMIDAS (solo tesis + acciones), no completas, para no inflar
//   el contexto.
// - Los adjuntos del historial se listan como referencias (filename +
//   descripción + fecha del evento). Su contenido NO se baja del
//   bucket: solo los adjuntos NUEVOS de esta consulta van como
//   contenido nativo al modelo.
// - Si > 15 eventos, los incluimos a todos igual (TODO v2: resumen
//   del LLM para los más viejos cuando empiece a importar el costo).

export type AdjuntoHistorico = {
  storage_path: string;
  filename: string;
  mime_type: string;
  descripcion: string | null;
  evento_fecha: string;
};

export type ContextoCasoResult = {
  contextoMarkdown: string;
  adjuntosHistoricos: AdjuntoHistorico[];
};

type EjecucionLite = {
  metadata: Record<string, unknown> | null;
} | null;

type EventoLite = {
  id: string;
  tipo: string;
  categoria: string | null;
  descripcion: string;
  ocurrido_en: string;
  estado: string;
  adjuntos: Adjunto[] | null;
};

type CasoLite = {
  id: string;
  caso_descripcion: string;
  contexto: Record<string, unknown> | null;
  rol: string;
  ejecucion_origen_id: string | null;
  estrategia_seleccionada_idx: number;
  estrategia_seleccionada_rol: string;
  estrategia_snapshot: Record<string, unknown>;
};

const FECHA_AR = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Buenos_Aires",
});

function fmtFechaAR(iso: string): string {
  return FECHA_AR.format(new Date(iso));
}

// Render de un valor jsonb arbitrario como texto plano para el prompt.
// El contexto del formulario dinámico es Record<string, string|number|boolean|null>.
function fmtValorContexto(v: unknown): string {
  if (v === null || v === undefined) return "(sin dato)";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function bullets(arr: unknown[] | undefined, prefijo = "  - "): string {
  if (!arr || arr.length === 0) return `${prefijo}(sin datos)`;
  return arr
    .map((x) => `${prefijo}${typeof x === "string" ? x : JSON.stringify(x)}`)
    .join("\n");
}

export async function buildContextoCaso(
  casoId: string,
): Promise<ContextoCasoResult> {
  const supabase = createServerClient();

  // Cargamos caso + ejecución origen + eventos en queries paralelas.
  // El caso lo tomamos primero para conseguir el ejecucion_origen_id.
  const { data: casoRaw, error: casoErr } = await supabase
    .from("casos")
    .select(
      "id, caso_descripcion, contexto, rol, ejecucion_origen_id, estrategia_seleccionada_idx, estrategia_seleccionada_rol, estrategia_snapshot",
    )
    .eq("id", casoId)
    .maybeSingle();

  if (casoErr || !casoRaw) {
    throw new Error(
      `buildContextoCaso: error cargando caso ${casoId}: ${casoErr?.message ?? "no encontrado"}`,
    );
  }
  const caso = casoRaw as CasoLite;

  // Ejecución original: traemos solo metadata para evitar joins más
  // complejos; las otras 2 estrategias quedan en metadata.resultado.
  let ejecucionOrigen: EjecucionLite = null;
  if (caso.ejecucion_origen_id) {
    const { data: ejecRaw } = await supabase
      .from("ejecuciones")
      .select("metadata")
      .eq("id", caso.ejecucion_origen_id)
      .maybeSingle();
    ejecucionOrigen = ejecRaw as EjecucionLite;
  }

  // Eventos cronológicos del timeline (manuales + sistema). El chat
  // con el agente vive en tablas dedicadas (PR4 sub-PR2) — NO se
  // incluyen sus mensajes en este contexto markdown porque viajan
  // como `messages[]` históricos al SDK por separado.
  const { data: eventosRaw, error: evErr } = await supabase
    .from("eventos_caso")
    .select("id, tipo, categoria, descripcion, ocurrido_en, estado, adjuntos")
    .eq("caso_id", casoId)
    .order("ocurrido_en", { ascending: true });
  if (evErr) {
    throw new Error(
      `buildContextoCaso: error cargando eventos: ${evErr.message}`,
    );
  }
  const eventos = (eventosRaw ?? []) as EventoLite[];

  // Recolectar adjuntos históricos (de eventos manuales y consultas
  // previas) para que la función llamadora sepa qué hay disponible.
  // No incluimos los del evento de consulta actual porque ese se crea
  // DESPUÉS del build.
  const adjuntosHistoricos: AdjuntoHistorico[] = [];
  for (const ev of eventos) {
    if (!ev.adjuntos || !Array.isArray(ev.adjuntos)) continue;
    for (const a of ev.adjuntos) {
      adjuntosHistoricos.push({
        storage_path: a.storage_path,
        filename: a.filename,
        mime_type: a.mime_type,
        descripcion: a.descripcion?.trim() || null,
        evento_fecha: ev.ocurrido_en,
      });
    }
  }

  // === Armado del markdown ===
  const lineas: string[] = [];

  lineas.push("# CONTEXTO DEL CASO");
  lineas.push("");

  // 1. Caso original
  lineas.push("## Caso original");
  const casoTexto =
    ejecucionOrigen?.metadata && typeof ejecucionOrigen.metadata === "object"
      ? (ejecucionOrigen.metadata as { caso?: unknown }).caso
      : null;
  lineas.push(
    typeof casoTexto === "string" && casoTexto.length > 0
      ? casoTexto
      : caso.caso_descripcion,
  );
  lineas.push("");

  // 2. Contexto del formulario dinámico
  lineas.push("## Contexto del formulario dinámico");
  if (caso.contexto && Object.keys(caso.contexto).length > 0) {
    for (const [k, v] of Object.entries(caso.contexto)) {
      lineas.push(`- ${k}: ${fmtValorContexto(v)}`);
    }
  } else {
    lineas.push("(sin contexto adicional registrado al crear el caso)");
  }
  lineas.push("");

  // 3. Estrategia elegida
  const e = caso.estrategia_snapshot as {
    nombre?: string;
    tesis_central?: string;
    fundamento_legal?: string[];
    fortalezas?: string[];
    riesgos?: string[];
    pasos_procesales?: string[];
    doctrina_aplicable?: string;
  };
  const numEstr = caso.estrategia_seleccionada_idx + 1;
  lineas.push(
    `## Estrategia elegida por el abogado (Estrategia ${numEstr} - ${caso.estrategia_seleccionada_rol})`,
  );
  if (typeof e.nombre === "string" && e.nombre)
    lineas.push(`Nombre: ${e.nombre}`);
  if (typeof e.tesis_central === "string" && e.tesis_central)
    lineas.push(`Tesis central: ${e.tesis_central}`);
  if (e.fundamento_legal && e.fundamento_legal.length > 0) {
    lineas.push("Fundamento legal:");
    lineas.push(bullets(e.fundamento_legal));
  }
  if (typeof e.doctrina_aplicable === "string" && e.doctrina_aplicable) {
    lineas.push(`Doctrina aplicable: ${e.doctrina_aplicable}`);
  }
  if (e.fortalezas && e.fortalezas.length > 0) {
    lineas.push("Fortalezas:");
    lineas.push(bullets(e.fortalezas));
  }
  if (e.riesgos && e.riesgos.length > 0) {
    lineas.push("Riesgos:");
    lineas.push(bullets(e.riesgos));
  }
  if (e.pasos_procesales && e.pasos_procesales.length > 0) {
    lineas.push("Pasos procesales planteados originalmente:");
    lineas.push(bullets(e.pasos_procesales));
  }
  lineas.push("");

  // 4. Historial de eventos
  lineas.push("## Historial de eventos del caso (cronológico)");
  if (eventos.length === 0) {
    lineas.push("(sin eventos registrados todavía)");
  } else {
    for (const ev of eventos) {
      const fecha = fmtFechaAR(ev.ocurrido_en);
      const cat = ev.categoria
        ? CATEGORIA_LABEL[ev.categoria as keyof typeof CATEGORIA_LABEL] ??
          ev.categoria
        : ev.tipo === "sistema"
          ? "Sistema"
          : "Sin categoría";
      const estadoSuffix =
        ev.estado === "pendiente" ? " (pendiente)" : "";

      lineas.push(`### ${fecha} — ${cat}${estadoSuffix}`);
      lineas.push(ev.descripcion);
      if (ev.adjuntos && ev.adjuntos.length > 0) {
        lineas.push("Adjuntos asociados:");
        for (const a of ev.adjuntos) {
          const desc = a.descripcion?.trim()
            ? ` (${a.descripcion.trim()})`
            : "";
          lineas.push(`  - ${a.filename}${desc}`);
        }
      }
      lineas.push("");
    }
  }

  return {
    contextoMarkdown: lineas.join("\n"),
    adjuntosHistoricos,
  };
}
