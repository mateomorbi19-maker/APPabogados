// Dónde está parado el abogado cuando le escribe a LEXIE.
//
// Módulo PURO y sin dependencias: lo importan el cliente (para mandar el
// pathname) y la ruta de API (para traducirlo). Nada de React, nada de
// Supabase.
//
// === Por qué no reusa seccionActiva() de nav-items.ts ===
//
// Ese helper existe y hace la mitad del trabajo, pero vive en un módulo que
// importa `lucide-react` para los íconos del menú: usarlo desde la ruta de API
// arrastraría la librería de íconos al bundle del servidor para leer un string.
// Y además NAV_ITEMS no alcanza: no conoce las tres vistas inmersivas
// (chat, mapa procesal, simulador) porque no están en la sidebar, y son justo
// las pantallas donde más sentido tiene preguntarle algo a LEXIE sin salir.
//
// === Por qué el cliente manda SOLO el pathname ===
//
// Misma regla que gobierna lexie-tools.ts: el nombre de la entidad lo resuelve
// el servidor, después de verificar propiedad. Si el cliente mandara la
// carátula, un pathname manipulado le pondría en la boca a LEXIE el nombre de
// una causa ajena.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9-]{1,80}$/;

export type TipoEntidad = "caso" | "documento";

export type Ubicacion = {
  /** Nombre de la sección tal como la ve el abogado en el menú. */
  seccion: string;
  /** Qué está mirando dentro de la sección. Null si es la vista principal. */
  detalle: string | null;
  /**
   * El recurso abierto, si la ruta apunta a uno. El `id` viene del pathname y
   * NO está verificado acá: quien lo use tiene que chequear propiedad antes de
   * leer nada con él.
   */
  entidad: { tipo: TipoEntidad; id: string } | null;
};

type Regla = {
  test: (segmentos: string[], pathname: string) => boolean;
  ubicacion: (segmentos: string[]) => Ubicacion;
};

// El orden importa: la primera que matchea gana, así que las rutas con
// parámetro van antes que su vista de listado.
const REGLAS: Regla[] = [
  {
    test: (_s, p) => p === "/",
    ubicacion: () => ({ seccion: "Inicio", detalle: null, entidad: null }),
  },
  {
    test: (s) => s[0] === "analisis",
    ubicacion: () => ({
      seccion: "Nuevo análisis",
      detalle: "el formulario para analizar un caso nuevo",
      entidad: null,
    }),
  },
  {
    test: (s) => s[0] === "consumo",
    ubicacion: () => ({
      seccion: "Mi consumo",
      detalle: "su consumo de tokens del mes y el historial de ejecuciones",
      entidad: null,
    }),
  },
  {
    test: (s) =>
      s[0] === "dashboard" && s[1] === "mis-casos" && UUID_RE.test(s[2] ?? ""),
    ubicacion: (s) => ({
      seccion: "Mis casos",
      detalle: "la ficha de una causa (datos del expediente, partes, timeline)",
      entidad: { tipo: "caso", id: s[2] },
    }),
  },
  {
    test: (s) => s[0] === "dashboard" && s[1] === "mis-casos",
    ubicacion: () => ({
      seccion: "Mis casos",
      detalle: "la lista de sus causas, sin ninguna abierta",
      entidad: null,
    }),
  },
  {
    test: (s) =>
      s[0] === "dashboard" && s[1] === "chat" && UUID_RE.test(s[2] ?? ""),
    ubicacion: (s) => ({
      seccion: "Chat de la causa",
      detalle:
        "el chat con el agente de esa causa — el que sí puede modificar el mapa procesal",
      entidad: { tipo: "caso", id: s[2] },
    }),
  },
  {
    test: (s) =>
      s[0] === "dashboard" &&
      s[1] === "mapa-procesal" &&
      UUID_RE.test(s[2] ?? ""),
    ubicacion: (s) => ({
      seccion: "Mapa procesal",
      detalle: "el árbol de etapas y caminos posibles de esa causa",
      entidad: { tipo: "caso", id: s[2] },
    }),
  },
  {
    test: (s) =>
      s[0] === "dashboard" && s[1] === "simulador" && UUID_RE.test(s[2] ?? ""),
    ubicacion: (s) => ({
      seccion: "Simulador",
      detalle: "la audiencia simulada de esa causa",
      entidad: { tipo: "caso", id: s[2] },
    }),
  },
  {
    test: (s) => s[0] === "dashboard" && s[1] === "agenda",
    ubicacion: () => ({
      seccion: "Agenda",
      detalle: "sus audiencias, vencimientos y tareas",
      entidad: null,
    }),
  },
  {
    test: (s) => s[0] === "dashboard" && s[1] === "bandeja",
    ubicacion: () => ({
      seccion: "Bandeja de entrada",
      detalle: "su correo",
      entidad: null,
    }),
  },
  {
    test: (s) =>
      s[0] === "dashboard" &&
      s[1] === "repositorio" &&
      SLUG_RE.test(s[2] ?? ""),
    ubicacion: (s) => ({
      seccion: "Repositorio",
      detalle: "un fallo o un texto de doctrina abierto en el lector",
      entidad: { tipo: "documento", id: s[2] },
    }),
  },
  {
    test: (s) => s[0] === "dashboard" && s[1] === "repositorio",
    ubicacion: () => ({
      seccion: "Repositorio",
      detalle: "la biblioteca de jurisprudencia y doctrina del estudio",
      entidad: null,
    }),
  },
  {
    test: (s) => s[0] === "admin",
    ubicacion: () => ({
      seccion: "Admin",
      detalle: "el panel de métricas y ejecuciones de todo el estudio",
      entidad: null,
    }),
  },
];

/**
 * Traduce un pathname a una ubicación legible. Devuelve `null` si la ruta no
 * corresponde a ninguna pantalla de trabajo (sign-in, forbidden, o una ruta que
 * no existe): en ese caso el turno viaja sin línea de ubicación, que es mejor
 * que inventarle al modelo una pantalla que no está mirando.
 */
export function describirUbicacion(pathname: string): Ubicacion | null {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return null;
  // Sin query ni hash, y sin la barra final: "/consumo/" y "/consumo" son la
  // misma pantalla.
  const limpio = pathname.split(/[?#]/)[0];
  const segmentos = limpio.split("/").filter((s) => s.length > 0);
  for (const r of REGLAS) {
    if (r.test(segmentos, limpio)) return r.ubicacion(segmentos);
  }
  return null;
}

/**
 * La línea que se le antepone al mensaje del turno.
 *
 * `nombreEntidad` lo resuelve el servidor DESPUÉS de verificar propiedad; si es
 * null (no se pudo verificar, o la ruta no tiene entidad) la línea sale igual
 * con la sección, que ya es la mitad del valor.
 */
export function lineaDeUbicacion(
  ubicacion: Ubicacion,
  nombreEntidad: string | null,
): string {
  const donde = nombreEntidad
    ? `${ubicacion.seccion} → «${nombreEntidad}»`
    : ubicacion.seccion;
  const que = ubicacion.detalle ? `. Está viendo ${ubicacion.detalle}` : "";
  return `[Pantalla actual: ${donde}${que}]`;
}
