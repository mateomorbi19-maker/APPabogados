// Los datos del expediente que van en el encabezado de todo escrito.
//
// Módulo PURO: lo consumen el diálogo (para mostrarle al abogado qué se va a
// usar y qué falta ANTES de gastar en una generación) y el server (para
// escribir el mismo bloque en el prompt). Que sea la misma función es lo que
// garantiza que lo que el abogado vio en la vista previa es lo que el redactor
// recibió.
//
// === La regla del dato faltante ===
//
// Un dato que la ficha no tiene se declara como faltante, y el redactor lo
// escribe como `[COMPLETAR: DNI del imputado]` en el texto. Nunca se inventa
// ni se rellena con algo verosímil: el escrito sale firmado por el abogado y
// se presenta en un portal judicial. Es la misma regla que rige la ficha, con
// más razón acá.

import { FUERO_LABEL, type Fuero } from "@/lib/mapa-procesal/types";
import { nombreCaso, sinCaratula } from "@/lib/casos/nombre";
import type { Caso, ParteCaso } from "@/lib/types";
import type { PerfilProfesional } from "./types";

export type DatoEscrito = {
  /** Nombre del placeholder en los modelos ({{TRIBUNAL}}, {{IMPUTADO}}...). */
  clave: string;
  label: string;
  valor: string | null;
  /** De dónde sale, para que el abogado sepa dónde cargarlo si falta. */
  fuente: "ficha" | "partes" | "perfil" | "sistema";
};

export type DatosEscrito = {
  datos: DatoEscrito[];
  /** Los que quedaron sin valor. */
  faltantes: DatoEscrito[];
  /** `true` si el nombre de la causa es un título provisorio, no la carátula. */
  caratulaProvisoria: boolean;
};

const FECHA_LARGA_AR = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires",
});

function limpio(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

/**
 * Quién es "mi asistido" depende del rol del estudio en la causa: el
 * imputado marcado como cliente si actuamos como defensa; la víctima o el
 * querellante marcado como cliente si actuamos como querella. Si nadie está
 * marcado, se toma el primero del rol que corresponde — y si hay varios, se
 * listan todos: un escrito por dos imputados los nombra a los dos.
 */
function personasPrincipales(
  partes: ParteCaso[],
  rolCaso: Caso["rol"],
): ParteCaso[] {
  const rolesBuscados: ParteCaso["rol"][] =
    rolCaso === "querellante"
      ? ["querellante", "victima", "denunciante"]
      : ["imputado"];
  const delRol = partes.filter((p) => rolesBuscados.includes(p.rol));
  const clientes = delRol.filter((p) => p.es_cliente);
  return clientes.length > 0 ? clientes : delRol;
}

export function armarDatosEscrito(
  caso: Caso,
  partes: ParteCaso[],
  perfil: PerfilProfesional,
  ahora: Date = new Date(),
): DatosEscrito {
  const principales = personasPrincipales(partes, caso.rol);
  const imputados = partes.filter((p) => p.rol === "imputado");
  const caratulaProvisoria = sinCaratula(caso);

  const tribunal = [limpio(caso.organismo), limpio(caso.secretaria)]
    .filter(Boolean)
    .join(", ");

  const datos: DatoEscrito[] = [
    {
      clave: "TRIBUNAL",
      label: "Juzgado / Tribunal",
      valor: tribunal || null,
      fuente: "ficha",
    },
    {
      clave: "CARATULA",
      label: "Carátula",
      // La carátula provisoria se pasa igual —es el único nombre que hay— pero
      // marcada, para que el redactor la escriba y avise que es provisoria.
      valor: caratulaProvisoria ? null : nombreCaso(caso),
      fuente: "ficha",
    },
    {
      clave: "NRO_CAUSA",
      label: "Nº de expediente",
      valor: limpio(caso.expediente_numero),
      fuente: "ficha",
    },
    {
      clave: "FISCALIA",
      label: "Fiscalía",
      valor: limpio(caso.fiscalia),
      fuente: "ficha",
    },
    {
      clave: "JUEZ",
      label: "Juez",
      valor: limpio(caso.juez),
      fuente: "ficha",
    },
    {
      clave: "DELITO",
      label: "Delitos",
      valor: caso.delitos && caso.delitos.length > 0 ? caso.delitos.join(", ") : null,
      fuente: "ficha",
    },
    {
      clave: "FUERO",
      label: "Fuero",
      valor: caso.fuero ? FUERO_LABEL[caso.fuero as Fuero] : null,
      fuente: "ficha",
    },
    {
      clave: caso.rol === "querellante" ? "VICTIMA" : "IMPUTADO",
      label: caso.rol === "querellante" ? "Cliente (víctima / querellante)" : "Imputado",
      valor:
        principales.length > 0
          ? principales.map((p) => p.nombre.trim()).join(" y ")
          : null,
      fuente: "partes",
    },
    {
      clave: "DNI",
      label: "Documento",
      valor:
        principales.length > 0
          ? principales
              .map((p) => limpio(p.documento))
              .filter((d): d is string => d !== null)
              .join(" y ") || null
          : null,
      fuente: "partes",
    },
    {
      clave: "DEFENSOR",
      label: "Abogado (firma)",
      valor: limpio(perfil.nombre_completo),
      fuente: "perfil",
    },
    {
      clave: "TOMO_FOLIO",
      label: "Matrícula (T° F°)",
      valor: limpio(perfil.matricula),
      fuente: "perfil",
    },
    {
      clave: "DOMICILIO_CONSTITUIDO",
      label: "Domicilio constituido",
      valor: limpio(perfil.domicilio_constituido),
      fuente: "perfil",
    },
    {
      clave: "DOMICILIO_ELECTRONICO",
      label: "Domicilio electrónico",
      valor: limpio(perfil.domicilio_electronico),
      fuente: "perfil",
    },
    {
      clave: "FECHA",
      label: "Fecha",
      valor: FECHA_LARGA_AR.format(ahora),
      fuente: "sistema",
    },
  ];

  // Cuando actuamos como querella, el imputado sigue siendo un dato del
  // escrito (es la contraparte), pero no el principal.
  if (caso.rol === "querellante" && imputados.length > 0) {
    datos.push({
      clave: "IMPUTADO",
      label: "Imputado (contraparte)",
      valor: imputados.map((p) => p.nombre.trim()).join(" y "),
      fuente: "partes",
    });
  }

  return {
    datos,
    faltantes: datos.filter((d) => d.valor === null),
    caratulaProvisoria,
  };
}

/** El bloque tal como lo lee el redactor. Los faltantes se declaran, no se omiten. */
export function serializarDatosEscrito(
  d: DatosEscrito,
  nombreProvisorio: string,
): string {
  const lineas = ["## Datos del expediente para el encabezado"];
  for (const x of d.datos) {
    lineas.push(
      `- {{${x.clave}}} (${x.label}): ${x.valor ?? "FALTA — escribí [COMPLETAR: " + x.label + "]"}`,
    );
  }
  if (d.caratulaProvisoria) {
    lineas.push(
      `- NOTA: la causa no tiene carátula cargada. Su nombre de trabajo es «${nombreProvisorio}», que NO es la carátula oficial: donde va {{CARATULA}} escribí [COMPLETAR: carátula].`,
    );
  }
  return lineas.join("\n");
}
