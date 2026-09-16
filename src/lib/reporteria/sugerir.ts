// Qué plantilla conviene, según lo último que pasó en la causa. Módulo PURO.
//
// Es una SUGERENCIA con su motivo, nunca una decisión: el diálogo la muestra
// preseleccionada y el abogado la cambia si quiere. Es determinística a
// propósito (palabras clave sobre el último evento y la agenda), porque
// pedirle al modelo que elija sería pagar por una inferencia que además no
// se puede auditar.
//
// Sigue la instrucción 1 de la ficha del estudio:
//   · Sin evento puntual reciente                          → P-01
//   · Resolución (proc., sobreseimiento, falta de mérito, elevación) → P-02
//   · Debate fijado o próximo (< 20 días)                  → P-03
//   · Sentencia dictada                                    → P-04
//   · Recurso presentado                                   → P-05
//   · Frecuencia mensual configurada                       → P-06 (la elige el abogado)

import type { DatosReporte } from "./datos";
import { DIAS_PREDEBATE } from "./datos";
import type { PlantillaReporte } from "./types";

export type SugerenciaPlantilla = {
  plantilla: PlantillaReporte;
  motivo: string;
};

/** Un evento cuenta como «reciente» para sugerir una plantilla de hito. */
const DIAS_EVENTO_RECIENTE = 21;

const RE_SENTENCIA = /\b(sentencia|condena|conden[óo]|absolu|absolvi|veredicto)\b/i;
const RE_RESOLUCION =
  /\b(procesamiento|proces[óo]|sobreseimiento|sobrese|falta de m[ée]rito|elevaci[óo]n a juicio|prisi[óo]n preventiva)\b/i;
const RE_RECURSO =
  /\b(apelaci[óo]n|apel[óo]|casaci[óo]n|queja|extraordinario|recurso)\b/i;

export function sugerirPlantilla(
  d: DatosReporte,
  ahora: Date = new Date(),
): SugerenciaPlantilla {
  if (d.debate && d.dias_hasta_debate !== null && d.dias_hasta_debate <= DIAS_PREDEBATE) {
    return {
      plantilla: "P03",
      motivo: `Hay una audiencia de debate en la agenda ${d.debate.fecha} (en ${d.dias_hasta_debate} días).`,
    };
  }

  const u = d.ultimo_movimiento;
  if (u) {
    const dias = Math.floor(
      (ahora.getTime() - new Date(u.fecha_iso).getTime()) / 86_400_000,
    );
    if (dias <= DIAS_EVENTO_RECIENTE) {
      const texto = u.descripcion;
      if (u.categoria === "resolucion_recibida" && RE_SENTENCIA.test(texto)) {
        return {
          plantilla: "P04",
          motivo: `El último movimiento (${u.fecha}) es una resolución que menciona una sentencia.`,
        };
      }
      if (u.categoria === "resolucion_recibida" && RE_RESOLUCION.test(texto)) {
        return {
          plantilla: "P02",
          motivo: `El último movimiento (${u.fecha}) es una resolución sobre la situación procesal.`,
        };
      }
      if (u.categoria === "escrito_presentado" && RE_RECURSO.test(texto)) {
        return {
          plantilla: "P05",
          motivo: `El último movimiento (${u.fecha}) es la presentación de un recurso.`,
        };
      }
      if (u.categoria === "resolucion_recibida") {
        return {
          plantilla: "P02",
          motivo: `El último movimiento (${u.fecha}) es una resolución recibida.`,
        };
      }
    }
  }

  return {
    plantilla: "P01",
    motivo: u
      ? "No hay un hito reciente que pida otra plantilla: una actualización general."
      : "La causa no tiene movimientos registrados: una actualización general.",
  };
}
