import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import { nombreCaso, sinCaratula } from "@/lib/casos/nombre";
import { getEventosByUser } from "@/lib/agenda/queries";
import { construirResumen, type ResumenInicio, type CasoResumen } from "@/lib/inicio/resumen";
import { construirSaludo, type Saludo } from "@/lib/lexie/saludo";
import { ahoraPartesAR } from "@/lib/agenda/tz-ar";
import { etiquetaDia, claveDia, fmtHora } from "@/lib/agenda/fechas";

// Contexto de LEXIE: lo que la asistente sabe del abogado ANTES de que él
// escriba nada.
//
// Este módulo alimenta dos cosas distintas con una sola carga de datos:
//   - el SALUDO que se renderiza al abrir el panel (sin tocar el modelo), y
//   - el CONTEXTO que se le inyecta al modelo en el primer mensaje del hilo.

/** Cuántas causas entran en el contexto del modelo. */
const MAX_CASOS_EN_CONTEXTO = 40;

export type CasoLexie = {
  id: string;
  titulo: string;
  caratula: string | null;
  expediente_numero: string | null;
  organismo: string | null;
  fuero: string | null;
  estado_seguimiento: string;
  delitos: string[] | null;
  rol: string;
  actualizado_en: string;
  caso_descripcion: string | null;
};

/**
 * Cuánto del relato entra en el contexto por causa.
 *
 * Existe porque las carátulas reales son malas: varias son literalmente la
 * primera línea del relato ("El 3 de julio de 2026, cerca de las 04:15"),
 * porque el sugeridor de títulos cae a eso cuando el modelo no propone nada
 * mejor. Con solo el título, LEXIE no puede contestar "¿de qué se trata la
 * causa X?" sin abrir el expediente entero.
 *
 * 160 caracteres alcanzan para reconocer una causa y cuestan ~40 tokens. Por
 * ocho causas son ~320 tokens que además viajan dentro del prefijo cacheado,
 * o sea que se pagan una vez por conversación. Abrir un expediente con
 * `leer_caso` cuesta ~2.300.
 */
const CHARS_RELATO = 160;

export type DatosLexie = {
  nombre: string;
  /** Hora de pared argentina, 0-23. */
  hora: number;
  casos: CasoLexie[];
  resumen: ResumenInicio;
  saludo: Saludo;
};

export async function cargarDatosLexie(
  usuarioId: string,
  nombre: string,
): Promise<DatosLexie> {
  const supabase = createServerClient();

  const [casosRes, eventos] = await Promise.all([
    supabase
      .from("casos")
      .select(
        "id, titulo, caratula, expediente_numero, organismo, fuero, estado_seguimiento, delitos, rol, actualizado_en, caso_descripcion",
      )
      .eq("usuario_id", usuarioId)
      .order("actualizado_en", { ascending: false }),
    // Un fallo de agenda NO puede dejar sin saludo al abogado: degrada a lista
    // vacía y el resumen dice "sin vencimientos", que es lo mismo que vería si
    // realmente no tuviera ninguno. El error queda en logs.
    getEventosByUser(usuarioId, { desde: new Date().toISOString() }).catch((e) => {
      console.error("[lexie] error cargando eventos:", e);
      return [];
    }),
  ]);

  const casos: CasoLexie[] = (casosRes.data ?? []) as CasoLexie[];
  const resumen = construirResumen({
    // El saludo nombra causas en voz alta ("mañana tenés la audiencia de
    // Ferreyra"), así que ve el nombre YA RESUELTO, no el título automático.
    casos: casos.map((c) => ({
      id: c.id,
      titulo: nombreCaso(c),
      sin_caratula: sinCaratula(c),
      rol: c.rol,
      actualizado_en: c.actualizado_en,
    })) satisfies CasoResumen[],
    eventos: eventos.map((e) => ({
      id: e.id,
      titulo: e.titulo,
      tipo: e.tipo,
      fecha_inicio: e.fecha_inicio,
      todo_el_dia: e.todo_el_dia,
    })),
  });

  const hora = ahoraPartesAR().h;

  return {
    nombre,
    hora,
    casos,
    resumen,
    saludo: construirSaludo({ nombre, hora, resumen }),
  };
}

/**
 * El bloque de contexto que ve el modelo en el PRIMER mensaje del hilo.
 *
 * Va en el mensaje y no en el system prompt a propósito: el system es lo que se
 * cachea a través de todas las conversaciones de todos los usuarios, y esto
 * cambia por usuario y por día. Metido acá, queda dentro del prefijo cacheado
 * del hilo (el motor pone un breakpoint al final del historial), así que se
 * paga una vez por conversación en vez de una vez por turno.
 *
 * La lista de causas va COMPLETA en vez de detrás de una tool. Con decenas de
 * causas son unos cientos de tokens, y evita el viaje de ida y vuelta más común
 * de todos: el abogado nombra una causa y LEXIE tiene que salir a buscar su id
 * antes de poder decir nada.
 */
export function construirContextoModelo(datos: DatosLexie): string {
  const p = ahoraPartesAR();
  const fechaLegible = new Date(Date.UTC(p.y, p.mo, p.d, 12)).toLocaleDateString(
    "es-AR",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" },
  );

  const partes: string[] = [];

  partes.push(
    `## Con quién estás hablando\n\n` +
      `${datos.nombre}, abogado penalista. Ahora mismo en Argentina son las ` +
      `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")} del ${fechaLegible}.`,
  );

  // — Causas —
  if (datos.casos.length === 0) {
    partes.push(
      `## Causas\n\n${datos.nombre} todavía no tiene ninguna causa cargada en la app.`,
    );
  } else {
    const visibles = datos.casos.slice(0, MAX_CASOS_EN_CONTEXTO);
    const filas = visibles.map(filaDeCausa).join("\n");
    const extra =
      datos.casos.length > visibles.length
        ? `\n\n(Hay ${datos.casos.length - visibles.length} causas más, ordenadas por antigüedad. Para encontrarlas usá \`buscar_mis_casos\`.)`
        : "";
    // La advertencia sobre las carátulas se emite SOLO si queda alguna sin
    // cargar, y dice cuántas. Dejarla fija haría que LEXIE siga desconfiando de
    // un dato que ya es confiable: le diría al abogado "no me fío de este
    // nombre" sobre una carátula que él mismo acaba de tipear.
    const sinFicha = visibles.filter(sinCaratula).length;
    const advertencia =
      sinFicha > 0
        ? `\n\nOJO: ${sinFicha} de estas causas todavía no tienen carátula cargada. En esas, el nombre en negrita es un texto automático sacado de la primera línea del relato, así que puede no parecer una carátula ("El 3 de julio de 2026, cerca de las 04:15" es un título, no una fecha suelta): guiate por el extracto para reconocerla y no se lo leas al abogado como si fuera el nombre del expediente. Y si te pregunta por los datos del expediente de una de esas causas, decile que todavía no están cargados y que los puede completar en la ficha de la causa.`
        : "";
    partes.push(
      `## Causas de ${datos.nombre} (${datos.casos.length})\n\n` +
        `Estas son TODAS las causas sobre las que podés trabajar. Usá los caso_id tal cual: no inventes ninguno.${advertencia}\n\n${filas}${extra}`,
    );
  }

  // — Agenda —
  const ev = datos.resumen.enVentana;
  if (ev.length === 0) {
    partes.push(
      `## Agenda\n\nNo hay nada agendado en los próximos 7 días.`,
    );
  } else {
    const lineas = ev
      .map((e) => {
        const cuando = e.todo_el_dia
          ? etiquetaDia(claveDia(e.fecha_inicio))
          : `${etiquetaDia(claveDia(e.fecha_inicio))}, ${fmtHora(e.fecha_inicio)}`;
        return `- **${e.titulo}** — ${e.tipo.replace(/_/g, " ")} · ${cuando}`;
      })
      .join("\n");
    partes.push(`## Agenda — próximos 7 días\n\n${lineas}`);
  }

  return partes.join("\n\n");
}

/**
 * Una causa, como la ve el modelo.
 *
 * El extracto del relato existía porque la app no sabía NADA del expediente:
 * sin él, LEXIE no podía decir de qué se trataba una causa sin abrirla entera
 * con `leer_caso` (~2.300 tokens contra ~40). Con la ficha cargada el extracto
 * pasa a ser el plan B: si hay carátula, delitos u organismo, eso identifica la
 * causa mejor y más corto que 160 caracteres de relato.
 *
 * Los campos que faltan simplemente NO se emiten. Nunca se escribe
 * "juzgado: no informado": una línea así en el contexto le da al modelo un
 * dato para repetir, y "el juzgado figura como no informado" suena a que el
 * sistema sabe algo cuando en realidad no sabe nada.
 */
function filaDeCausa(c: CasoLexie): string {
  const cabecera = `- **${nombreCaso(c)}** — ${c.rol} · actualizada ${c.actualizado_en.slice(0, 10)}`;

  const ficha: string[] = [];
  if (c.expediente_numero) ficha.push(`exp. ${c.expediente_numero}`);
  if (c.organismo) ficha.push(c.organismo);
  if (c.fuero) ficha.push(`fuero ${c.fuero}`);
  if (c.delitos && c.delitos.length > 0) ficha.push(c.delitos.join(", "));
  if (c.estado_seguimiento && c.estado_seguimiento !== "activa") {
    ficha.push(`causa ${c.estado_seguimiento.replace(/_/g, " ")}`);
  }
  const lineaFicha = ficha.length > 0 ? `\n  ${ficha.join(" · ")}` : "";

  // El extracto solo cuando la ficha no alcanza para reconocer la causa: sin
  // carátula (el nombre no dice nada) o sin ningún dato de expediente.
  const necesitaExtracto = ficha.length === 0 || sinCaratula(c);
  const relato = necesitaExtracto
    ? (c.caso_descripcion ?? "").replace(/\s+/g, " ").trim()
    : "";
  const corte = relato.slice(0, CHARS_RELATO);
  const extracto = corte
    ? `\n  ${corte}${relato.length > CHARS_RELATO ? "…" : ""}`
    : "";

  return `${cabecera}\n  caso_id: ${c.id}${lineaFicha}${extracto}`;
}
