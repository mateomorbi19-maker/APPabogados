// El esqueleto de datos de un reporte: lo que el sistema sabe de la causa sin
// que el abogado tipee nada. Módulo PURO, como datos-causa.ts de los escritos
// y por la misma razón: lo que el abogado ve en la vista previa («esto es lo
// que se va a usar, esto falta») tiene que ser exactamente lo que el render y
// el modelo reciben.
//
// De dónde sale cada cosa:
//   - la persona:      partes_caso (nombre, contacto)
//   - la etapa:        el mapa procesal (etapa-actual.ts), traducida por el glosario
//   - los movimientos: eventos_caso `sucedido`, ordenados por fecha
//   - lo que viene:    eventos_agenda futuros de la causa
//   - la firma:        el perfil profesional, o el nombre de usuario si no está
//
// La regla del dato faltante rige: lo que no está, va como null y el render lo
// convierte en [FALTA: …]. Nada se rellena con un valor verosímil.

import type { Caso, EventoCaso, ParteCaso, RolCaso } from "@/lib/types";
import type { PerfilProfesional } from "@/lib/escritos/types";
import { CATEGORIA_LABEL, type CategoriaEvento } from "@/lib/casos/categorias";
import { nombreCaso, sinCaratula } from "@/lib/casos/nombre";
import { ETAPA_COLOQUIAL } from "./plantillas";
import { NOMBRE_ESTUDIO } from "./types";

const TZ = "America/Argentina/Buenos_Aires";
const MS_DIA = 86_400_000;
/** «Movimientos del mes»: los últimos 30 días corridos. */
export const DIAS_RESUMEN_MES = 30;
/** Hasta cuándo se mira la agenda para «lo que viene». */
export const DIAS_AGENDA_PROXIMOS = 60;
/** Un debate en la agenda dentro de esta ventana sugiere P-03. */
export const DIAS_PREDEBATE = 20;

export type EventoAgendaLite = {
  id: string;
  titulo: string;
  tipo: string;
  fecha_inicio: string;
  todo_el_dia: boolean;
};

export type EtapaLite = {
  etapa: 1 | 2 | 3 | 4 | 5 | 6;
  label: string;
  nodoTitulo: string;
};

export type EntradaDatosReporte = {
  caso: Caso;
  partes: ParteCaso[];
  /** La persona a la que se le escribe. Null = todavía no se eligió. */
  parteId: string | null;
  /** Timeline de la causa (eventos_caso), en cualquier orden. */
  eventos: EventoCaso[];
  /** Agenda de la causa (eventos_agenda), sólo futuros. */
  agenda: EventoAgendaLite[];
  etapa: EtapaLite | null;
  perfil: PerfilProfesional;
  /** `usuarios.nombre`: la firma si el perfil no tiene nombre completo. */
  nombreUsuario: string;
  ahora?: Date;
};

export type MovimientoReporte = {
  fecha_iso: string;
  fecha: string;
  categoria: string | null;
  categoria_label: string | null;
  descripcion: string;
};

export type ProximoReporte = {
  id: string;
  fecha_iso: string;
  fecha: string;
  hora: string | null;
  tipo: string;
  titulo: string;
};

export type DestinatarioReporte = {
  parte_id: string;
  nombre: string;
  nombre_pila: string;
  rol: ParteCaso["rol"];
  es_cliente: boolean;
  email: string | null;
  telefono: string | null;
};

export type DatosReporte = {
  destinatario: DestinatarioReporte | null;
  /** Todas las personas marcadas como cliente, para el selector. */
  clientes: DestinatarioReporte[];
  rol_estudio: RolCaso;
  etapa: {
    numero: number;
    label: string;
    coloquial: string;
    explicacion: string;
  } | null;
  ultimo_movimiento: MovimientoReporte | null;
  movimientos_mes: MovimientoReporte[];
  proximos: ProximoReporte[];
  /** La próxima audiencia de debate/juicio, si hay una cargada. */
  debate: ProximoReporte | null;
  /** La próxima reunión con el cliente, si hay una cargada. */
  reunion: ProximoReporte | null;
  /** Días hasta el debate, si hay. */
  dias_hasta_debate: number | null;
  /**
   * Los valores por clave de variable que el sistema y la ficha pueden
   * aportar. Null = falta. El render los combina con la variante y el
   * criterio del abogado.
   */
  valores: Record<string, string | null>;
  caratula_provisoria: boolean;
};

// ————————————————————————————————————————————————————————————————
// Fechas en lenguaje llano
// ————————————————————————————————————————————————————————————————

const FMT_DIA_LARGO = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: TZ,
});
const FMT_DIA_MES = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "long",
  timeZone: TZ,
});
const FMT_HORA = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TZ,
});
const FMT_MES_AÑO = new Intl.DateTimeFormat("es-AR", {
  month: "long",
  year: "numeric",
  timeZone: TZ,
});
const FMT_FECHA_LARGA = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: TZ,
});
const FMT_DIA_CLAVE = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TZ,
});

/** «el martes 19 de agosto» (con año si no es el año en curso). */
export function fechaColoquial(iso: string, ahora: Date = new Date()): string {
  const d = new Date(iso);
  const mismoAño =
    FMT_DIA_CLAVE.format(d).slice(0, 4) === FMT_DIA_CLAVE.format(ahora).slice(0, 4);
  // Intl escribe «martes, 19 de agosto»; en un mensaje va sin la coma.
  const base = FMT_DIA_LARGO.format(d).replace(",", "");
  return mismoAño ? `el ${base}` : `el ${base} de ${FMT_DIA_CLAVE.format(d).slice(0, 4)}`;
}

function capitalizar(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** «3 de agosto». */
export function fechaCorta(iso: string): string {
  return FMT_DIA_MES.format(new Date(iso));
}

export function horaDe(iso: string): string {
  return FMT_HORA.format(new Date(iso));
}

/** «Agosto 2026». */
export function mesAño(fecha: Date): string {
  const s = FMT_MES_AÑO.format(fecha).replace(" de ", " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** «15 de septiembre de 2026». */
export function fechaLarga(fecha: Date): string {
  return FMT_FECHA_LARGA.format(fecha);
}

// ————————————————————————————————————————————————————————————————
// Personas
// ————————————————————————————————————————————————————————————————

/**
 * El nombre de pila. «Rodríguez, Carlos Alberto» → «Carlos»; «Carlos
 * Rodríguez» → «Carlos». Si el nombre es una sola palabra, esa.
 */
export function nombreDePila(nombre: string): string {
  const t = nombre.trim();
  if (!t) return t;
  const coma = t.indexOf(",");
  const candidato = coma >= 0 ? t.slice(coma + 1) : t;
  const primera = candidato.trim().split(/\s+/)[0] ?? "";
  return primera || t;
}

function limpio(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

export function aDestinatario(p: ParteCaso): DestinatarioReporte {
  return {
    parte_id: p.id,
    nombre: p.nombre.trim(),
    nombre_pila: nombreDePila(p.nombre),
    rol: p.rol,
    es_cliente: p.es_cliente,
    email: limpio(p.email),
    telefono: limpio(p.telefono),
  };
}

// ————————————————————————————————————————————————————————————————
// Movimientos y agenda
// ————————————————————————————————————————————————————————————————

const RE_DEBATE = /\b(debate|juicio oral|juicio|audiencia de juicio|vista de causa)\b/i;

function aMovimiento(e: EventoCaso, ahora: Date): MovimientoReporte {
  const cat = e.categoria as CategoriaEvento | null;
  return {
    fecha_iso: e.ocurrido_en,
    fecha: fechaColoquial(e.ocurrido_en, ahora),
    categoria: cat,
    categoria_label: cat ? (CATEGORIA_LABEL[cat] ?? cat) : null,
    descripcion: e.descripcion.trim(),
  };
}

function aProximo(e: EventoAgendaLite, ahora: Date): ProximoReporte {
  return {
    id: e.id,
    fecha_iso: e.fecha_inicio,
    fecha: fechaColoquial(e.fecha_inicio, ahora),
    hora: e.todo_el_dia ? null : horaDe(e.fecha_inicio),
    tipo: e.tipo,
    titulo: e.titulo.trim(),
  };
}

/** Descripción corta de un movimiento para «lo último que se movió fue …». */
function describirMovimiento(m: MovimientoReporte): string {
  const d = m.descripcion.replace(/\s+/g, " ");
  const corto = d.length > 160 ? `${d.slice(0, 157).trimEnd()}…` : d;
  // La categoría ya dice qué clase de acto fue; se antepone cuando la
  // descripción no la nombra.
  if (m.categoria_label && !corto.toLowerCase().includes(m.categoria_label.toLowerCase())) {
    return `${m.categoria_label.toLowerCase()}: ${corto}`;
  }
  return corto;
}

function resumenMovimientosMes(movs: MovimientoReporte[]): string {
  if (movs.length === 0) {
    return "Este mes no hubo movimientos procesales. Eso es normal en esta etapa — la causa sigue su curso y estamos atentos a cualquier novedad.";
  }
  return movs.map((m) => `- ${fechaCorta(m.fecha_iso)}: ${describirMovimiento(m)}`).join("\n");
}

function caratulaColoquial(caso: Caso): string | null {
  const delitos = (caso.delitos ?? []).map((d) => d.trim()).filter(Boolean);
  if (delitos.length > 0) return `por ${delitos.slice(0, 2).join(" y ").toLowerCase()}`;
  if (!sinCaratula(caso)) return `«${nombreCaso(caso)}»`;
  return null;
}

// ————————————————————————————————————————————————————————————————
// Armado
// ————————————————————————————————————————————————————————————————

export function armarDatosReporte(e: EntradaDatosReporte): DatosReporte {
  const ahora = e.ahora ?? new Date();
  const t0 = ahora.getTime();

  const clientes = e.partes.filter((p) => p.es_cliente).map(aDestinatario);
  const parte = e.parteId ? e.partes.find((p) => p.id === e.parteId) : undefined;
  const destinatario = parte ? aDestinatario(parte) : null;

  // Movimientos: sólo lo sucedido y en el pasado, más nuevo primero.
  const sucedidos = e.eventos
    .filter((ev) => ev.estado === "sucedido" && new Date(ev.ocurrido_en).getTime() <= t0)
    .sort((a, b) => (a.ocurrido_en < b.ocurrido_en ? 1 : -1))
    .map((ev) => aMovimiento(ev, ahora));
  const ultimo = sucedidos[0] ?? null;
  const desdeMes = t0 - DIAS_RESUMEN_MES * MS_DIA;
  const movimientosMes = sucedidos
    .filter((m) => new Date(m.fecha_iso).getTime() >= desdeMes)
    .slice()
    .reverse();

  // Agenda: futuros dentro de la ventana, en orden.
  const hasta = t0 + DIAS_AGENDA_PROXIMOS * MS_DIA;
  const proximos = e.agenda
    .filter((a) => {
      const t = new Date(a.fecha_inicio).getTime();
      return t >= t0 && t <= hasta;
    })
    .sort((a, b) => (a.fecha_inicio < b.fecha_inicio ? -1 : 1))
    .map((a) => aProximo(a, ahora));
  const debate =
    proximos.find((p) => p.tipo === "audiencia" && RE_DEBATE.test(p.titulo)) ?? null;
  const reunion = proximos.find((p) => p.tipo === "reunion_cliente") ?? null;
  const diasHastaDebate = debate
    ? Math.ceil((new Date(debate.fecha_iso).getTime() - t0) / MS_DIA)
    : null;

  const etapa = e.etapa
    ? {
        numero: e.etapa.etapa,
        label: e.etapa.label,
        coloquial: ETAPA_COLOQUIAL[e.etapa.etapa].nombre,
        explicacion: ETAPA_COLOQUIAL[e.etapa.etapa].explicacion,
      }
    : null;

  const imputados = e.partes.filter((p) => p.rol === "imputado");
  const tribunal = limpio(e.caso.organismo);
  const proximoPaso = proximos[0] ?? null;

  const valores: Record<string, string | null> = {
    NOMBRE_CLIENTE: destinatario?.nombre_pila ?? null,
    NOMBRE_ABOGADO: limpio(e.perfil.nombre_completo) ?? limpio(e.nombreUsuario),
    ESTUDIO: NOMBRE_ESTUDIO,
    FECHA_REPORTE: fechaLarga(ahora),
    MES_AÑO: mesAño(ahora),
    NOMBRE_JUEZ: limpio(e.caso.juez),
    JUZGADO_O_TRIBUNAL: tribunal,
    COMPOSICION_TRIBUNAL: tribunal,
    CARATULA_COLOQUIAL: caratulaColoquial(e.caso),
    ETAPA_PROCESAL_COLOQUIAL: etapa?.coloquial ?? null,
    EXPLICACION_ETAPA: etapa?.explicacion ?? null,
    // En P-06 arranca oración («… ante el juzgado. La fiscalía y …»).
    EXPLICACION_ETAPA_BREVE: etapa ? capitalizar(etapa.explicacion) : null,
    ULTIMO_MOVIMIENTO: ultimo ? describirMovimiento(ultimo) : null,
    FECHA_ULTIMO_MOVIMIENTO: ultimo?.fecha ?? null,
    RESUMEN_MOVIMIENTOS_MES: resumenMovimientosMes(movimientosMes),
    // Propuestas desde la agenda: el abogado las pisa desde el formulario.
    PROXIMO_PASO_COLOQUIAL: proximoPaso ? proximoPaso.titulo.toLowerCase() : null,
    FECHA_O_PLAZO_ESTIMADO: proximoPaso
      ? proximoPaso.hora
        ? `${proximoPaso.fecha} a las ${proximoPaso.hora}`
        : proximoPaso.fecha
      : null,
    PROXIMOS_PASOS_COLOQUIALES: proximoPaso ? proximoPaso.titulo : null,
    FECHA_PROXIMO_PASO_ESTIMADA: proximoPaso
      ? `Está previsto para ${proximoPaso.fecha}${proximoPaso.hora ? ` a las ${proximoPaso.hora}` : ""}.`
      : null,
    FECHA_DEBATE: debate ? debate.fecha.replace(/^el /, "") : null,
    HORA_INICIO: debate?.hora ?? null,
    FECHA_REUNION_PREPARATORIA: reunion
      ? `${reunion.fecha.replace(/^el /, "")}${reunion.hora ? ` a las ${reunion.hora}` : ""}`
      : null,
    NOMBRE_IMPUTADO: imputados.length > 0 ? imputados.map((p) => p.nombre.trim()).join(" y ") : null,
  };

  return {
    destinatario,
    clientes,
    rol_estudio: e.caso.rol,
    etapa,
    ultimo_movimiento: ultimo,
    movimientos_mes: movimientosMes,
    proximos,
    debate,
    reunion,
    dias_hasta_debate: diasHastaDebate,
    valores,
    caratula_provisoria: sinCaratula(e.caso),
  };
}

/**
 * El bloque de datos crudos tal como lo lee el modelo. Se declara lo que
 * falta en vez de omitirlo, para que el modelo sepa que NO tiene ese dato
 * y no lo invente.
 */
export function serializarDatosReporte(d: DatosReporte): string {
  const lineas: string[] = ["## Datos de la causa (crudos, del sistema)"];
  lineas.push(
    `- Rol del estudio en la causa: ${d.rol_estudio === "querellante" ? "QUERELLA (nuestro cliente es la víctima o el querellante)" : "DEFENSA (nuestro cliente es el imputado)"}`,
  );
  lineas.push(
    `- Destinatario: ${d.destinatario ? `${d.destinatario.nombre} (${d.destinatario.rol})` : "SIN ELEGIR"}`,
  );
  lineas.push(
    `- Etapa procesal (del mapa): ${d.etapa ? `${d.etapa.label} → «${d.etapa.coloquial}»` : "SIN MAPA — no se sabe"}`,
  );
  lineas.push(
    `- Último movimiento del expediente: ${d.ultimo_movimiento ? `${d.ultimo_movimiento.fecha} — ${d.ultimo_movimiento.descripcion}` : "ninguno registrado"}`,
  );
  if (d.movimientos_mes.length > 0) {
    lineas.push("- Movimientos de los últimos 30 días:");
    for (const m of d.movimientos_mes) lineas.push(`  - ${m.fecha}: ${m.descripcion}`);
  } else {
    lineas.push("- Movimientos de los últimos 30 días: ninguno");
  }
  if (d.proximos.length > 0) {
    lineas.push("- Próximos eventos en la agenda de la causa:");
    for (const p of d.proximos) {
      lineas.push(`  - ${p.fecha}${p.hora ? ` ${p.hora}` : ""} — ${p.tipo}: ${p.titulo}`);
    }
  } else {
    lineas.push("- Próximos eventos en la agenda de la causa: ninguno cargado");
  }
  for (const k of ["NOMBRE_JUEZ", "JUZGADO_O_TRIBUNAL", "NOMBRE_ABOGADO"] as const) {
    lineas.push(`- ${k}: ${d.valores[k] ?? "FALTA"}`);
  }
  if (d.caratula_provisoria) {
    lineas.push("- La causa no tiene carátula cargada: no nombres el expediente por su carátula.");
  }
  return lineas.join("\n");
}
