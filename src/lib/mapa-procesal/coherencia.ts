// Validador de coherencia del mapa procesal. Es el corazón de la conexión
// chat ↔ mapa: el abogado le pide cambios al agente sin tener el mapa a la
// vista, así que ANTES de mutar hay que verificar que el cambio tenga sentido
// procesal — y si no lo tiene, rechazarlo con una explicación que el agente
// pueda relatarle en prosa.
//
// Módulo PURO: sin IO, sin `server-only`, sin dependencias de Supabase ni del
// SDK. Recibe el snapshot de nodos y devuelve un veredicto. Se puede testear
// standalone con `npx tsx`.
//
// Un rechazo NO es una excepción: es un dato que el dispatcher convierte en
// tool_result y el modelo le explica al abogado. Los rechazos marcados con
// `requiere_confirmacion` se levantan si el abogado confirma y el modelo
// vuelve a llamar la tool con `confirmar: true`.

import {
  etapaAncla,
  ETAPA_LABEL,
  normalizarTitulo,
  type Etapa,
} from "./etapas";
import { FLUJO_POR_FUERO } from "./plantilla-base";
import { FUERO_LABEL, type Fuero, type NodoProcesalDB } from "./types";

// Reexportada: vive en etapas.ts (junto a la tabla de anclas, que es lo que
// define el match), pero el resto del sistema la conoce desde acá.
export { normalizarTitulo };

// Tope de tamaño. El briefing del mapa dice que un mapa típico tiene 15-40
// nodos y que más que eso "se vuelve ruido": pasado este número el árbol deja
// de ser legible de un vistazo, que es todo el punto de la vista.
//
// R10 lo chequea acá para poder explicárselo al modelo con una sugerencia, pero
// el tope se ENFORCEA en queries.ts (crearNodoHijo / crearRamasSimuladas), que
// es por donde pasan los tres caminos de escritura: chat, alta manual desde la
// UI y botón "Simular". Este validador solo cubre el primero.
export const MAX_NODOS_POR_CASO = 60;
export const MAX_PROFUNDIDAD = 12;

export type ReglaCoherencia =
  | "R1_PADRE_INEXISTENTE"
  | "R1_NODO_INEXISTENTE"
  | "R1_REFERENCIA_AMBIGUA"
  | "R2_TITULO_DUPLICADO_HERMANO"
  | "R3_REGRESION_DE_ETAPA"
  | "R4_HIJO_DE_TERMINAL"
  | "R5_ANCESTROS_NO_OCURRIDOS"
  | "R6_RAIZ_PROTEGIDA"
  | "R7_ELIMINA_HISTORIA_REAL"
  | "R8_ELIMINA_DESCENDIENTES"
  | "R9_RIESGO_EN_DESENLACE_FAVORABLE"
  | "R10_TOPE_DE_NODOS"
  | "R11_PROFUNDIDAD_MAXIMA";

export type AccionValidable =
  | {
      tipo: "crear";
      padre_ref: string;
      titulo: string;
      riesgo_alto?: boolean;
    }
  | {
      tipo: "editar";
      nodo_ref: string;
      titulo?: string;
      riesgo_alto?: boolean;
    }
  | { tipo: "eliminar"; nodo_ref: string }
  | { tipo: "marcar_ocurrido"; nodo_ref: string }
  | { tipo: "simular"; nodo_ref: string };

export type ValidacionOk = {
  ok: true;
  advertencias: string[];
  // Nodo resuelto por la validación (el objetivo, o el padre en 'crear'). El
  // dispatcher lo necesita para tener el uuid COMPLETO: el modelo referencia
  // por prefijo corto y jamás debe llegar un prefijo a una query.
  nodo: NodoProcesalDB | null;
  // Cupo de nodos que todavía entra en el mapa (lo usa 'simular' para recortar
  // las ramas que propone el modelo en vez de romper el tope).
  cupoRestante: number;
};

export type ValidacionRechazo = {
  ok: false;
  motivo: string;
  regla: ReglaCoherencia;
  sugerencia: string;
  requiere_confirmacion?: boolean;
  // Presente cuando la regla que falló ya había resuelto el nodo (todas menos
  // las R1): permite ejecutar igual si el abogado confirma.
  nodo?: NodoProcesalDB | null;
  advertencias?: string[];
  cupoRestante?: number;
};

export type ResultadoValidacion = ValidacionOk | ValidacionRechazo;

// === Desenlaces favorables al imputado (R9) ===
// El briefing es explícito: el rojo (riesgo_alto) es SOLO para lo adverso al
// cliente; sobreseimiento, absolución y probation jamás llevan rojo. Match por
// subcadena normalizada para tolerar títulos compuestos del estilo
// "Sobreseimiento parcial por prescripción".
const DESENLACES_FAVORABLES = [
  "absolucion",
  "sobreseimiento",
  "probation",
  "suspension del juicio a prueba",
  "suspension del proceso a prueba",
  "falta de merito",
  "nulidad",
  "prescripcion",
];

// Negadores: el instituto favorable aparece en el título, pero NEGADO o
// REVOCADO — y eso es justamente lo adverso al imputado. "Rechazo del pedido
// de excarcelación", "Revocación de la suspensión del juicio a prueba" o
// "Denegatoria del sobreseimiento" contienen la subcadena favorable y son los
// nodos que MÁS merecen el rojo. Sin este chequeo el match por subcadena los
// daba vuelta y R9 impedía marcarlos.
const NEGADORES_DE_DESENLACE = [
  "rechazo",
  "rechaza",
  "denegatoria",
  "denegacion",
  "deniega",
  "revocacion",
  "revocatoria",
  "revoca",
  "no hace lugar",
  "sin efecto",
];

function esDesenlaceFavorable(titulo: string): string | null {
  const n = normalizarTitulo(titulo);
  if (NEGADORES_DE_DESENLACE.some((neg) => n.includes(neg))) return null;
  return DESENLACES_FAVORABLES.find((d) => n.includes(d)) ?? null;
}

// === Esquema canónico del fuero ===
// Se derivan del template (FLUJO_POR_FUERO) — fuente única de verdad. NO hay
// listas paralelas hardcodeadas: si mañana se agrega un desenlace al flujo de
// un fuero, estas reglas lo toman solas.

function titulosCanonicos(fuero: Fuero): Set<string> {
  return new Set(
    FLUJO_POR_FUERO[fuero].map((n) => normalizarTitulo(n.titulo)),
  );
}

// Terminales = HOJAS del árbol canónico (nodos del template que no son padre
// de ningún otro): absolución, condena, sobreseimiento, ejecución, etc.
//
// `fuero` puede ser null: hay casos en la DB creados antes de que la columna
// existiera. En ese caso NO podemos apagar la regla — un mapa sin fuero es
// justamente el más expuesto a que el chat le cuelgue ramas de cualquier lado.
// Usamos la UNIÓN de las hojas de los tres fueros: es un superconjunto, y como
// R4 solo pide confirmación (no bloquea), el modo de falla correcto es pedir
// confirmación de más, nunca de menos.
function titulosTerminales(fuero: Fuero | null): Set<string> {
  const flujos =
    fuero === null ? Object.values(FLUJO_POR_FUERO) : [FLUJO_POR_FUERO[fuero]];
  const terminales = new Set<string>();
  for (const flujo of flujos) {
    const conHijos = new Set(
      flujo.map((n) => n.padre).filter((p): p is string => p !== null),
    );
    for (const n of flujo) {
      if (!conHijos.has(n.key)) terminales.add(normalizarTitulo(n.titulo));
    }
  }
  return terminales;
}

// Etiqueta del fuero para los mensajes al modelo, tolerante a `fuero: null`.
function refFuero(fuero: Fuero | null): string {
  return fuero ? `del fuero ${FUERO_LABEL[fuero]}` : "del proceso penal";
}

// === Índices sobre el snapshot ===

function indexar(nodos: NodoProcesalDB[]) {
  const porId = new Map(nodos.map((n) => [n.id, n]));
  const hijosPorPadre = new Map<string, NodoProcesalDB[]>();
  for (const n of nodos) {
    if (!n.padre_id) continue;
    const arr = hijosPorPadre.get(n.padre_id) ?? [];
    arr.push(n);
    hijosPorPadre.set(n.padre_id, arr);
  }
  return { porId, hijosPorPadre };
}

// Cadena de ancestros del nodo, de la RAÍZ hacia abajo (sin incluirlo). El
// `vistos` corta ante un ciclo imposible-por-construcción antes que colgar.
function ancestrosDe(
  nodo: NodoProcesalDB,
  porId: Map<string, NodoProcesalDB>,
): NodoProcesalDB[] {
  const cadena: NodoProcesalDB[] = [];
  const vistos = new Set<string>([nodo.id]);
  let actual = nodo.padre_id ? porId.get(nodo.padre_id) : undefined;
  while (actual && !vistos.has(actual.id)) {
    vistos.add(actual.id);
    cadena.push(actual);
    actual = actual.padre_id ? porId.get(actual.padre_id) : undefined;
  }
  return cadena.reverse();
}

function profundidadDe(
  nodo: NodoProcesalDB,
  porId: Map<string, NodoProcesalDB>,
): number {
  return ancestrosDe(nodo, porId).length;
}

function descendientesDe(
  nodoId: string,
  hijosPorPadre: Map<string, NodoProcesalDB[]>,
): NodoProcesalDB[] {
  const acumulado: NodoProcesalDB[] = [];
  const pendientes = [nodoId];
  const vistos = new Set<string>([nodoId]);
  while (pendientes.length > 0) {
    const actual = pendientes.pop();
    if (actual === undefined) break;
    for (const h of hijosPorPadre.get(actual) ?? []) {
      if (vistos.has(h.id)) continue;
      vistos.add(h.id);
      acumulado.push(h);
      pendientes.push(h.id);
    }
  }
  return acumulado;
}

// Etapa derivada de un nodo YA existente: ancla por título, o herencia del
// ancestro más cercano con ancla (misma regla que etapas.ts / calcularLayout).
function etapaDe(
  nodo: NodoProcesalDB,
  porId: Map<string, NodoProcesalDB>,
): Etapa {
  const propia = etapaAncla(nodo.titulo);
  if (propia) return propia;
  const ancestros = ancestrosDe(nodo, porId);
  for (let i = ancestros.length - 1; i >= 0; i--) {
    const a = etapaAncla(ancestros[i].titulo);
    if (a) return a;
  }
  return 1;
}

// Descendientes cuya etapa la manda DIRECTAMENTE este nodo: el recorrido corta
// en el primer descendiente con ancla propia (de ahí para abajo la etapa ya no
// se hereda del renombrado). Lo usa R3 en `validarEditar` para mirar hacia
// abajo, no solo hacia el padre.
function anclasQueHeredanDe(
  nodoId: string,
  hijosPorPadre: Map<string, NodoProcesalDB[]>,
): NodoProcesalDB[] {
  const conAncla: NodoProcesalDB[] = [];
  const pendientes = [nodoId];
  const vistos = new Set<string>([nodoId]);
  while (pendientes.length > 0) {
    const actual = pendientes.pop();
    if (actual === undefined) break;
    for (const h of hijosPorPadre.get(actual) ?? []) {
      if (vistos.has(h.id)) continue;
      vistos.add(h.id);
      if (etapaAncla(h.titulo) !== undefined) conAncla.push(h);
      else pendientes.push(h.id);
    }
  }
  return conAncla;
}

// === R1: resolución de referencia por prefijo de uuid ===
// El modelo referencia los nodos por los 8 primeros chars del uuid (es lo que
// ve en el árbol serializado). Aceptamos también el uuid completo. Un prefijo
// que matchea 2+ nodos NO se adivina: se rechaza pidiendo el uuid entero.

export type ResolucionRef =
  | { ok: true; nodo: NodoProcesalDB }
  | { ok: false; motivo: "no_encontrado" }
  | { ok: false; motivo: "ambiguo"; candidatos: NodoProcesalDB[] };

export function resolverRef(
  ref: string,
  nodos: NodoProcesalDB[],
): ResolucionRef {
  const limpia = ref.trim().toLowerCase();
  if (limpia.length === 0) return { ok: false, motivo: "no_encontrado" };

  const exacto = nodos.find((n) => n.id.toLowerCase() === limpia);
  if (exacto) return { ok: true, nodo: exacto };

  const candidatos = nodos.filter((n) => n.id.toLowerCase().startsWith(limpia));
  if (candidatos.length === 0) return { ok: false, motivo: "no_encontrado" };
  if (candidatos.length > 1) return { ok: false, motivo: "ambiguo", candidatos };
  return { ok: true, nodo: candidatos[0] };
}

function rechazoRef(
  res: Exclude<ResolucionRef, { ok: true }>,
  ref: string,
  esPadre: boolean,
): ValidacionRechazo {
  if (res.motivo === "ambiguo") {
    return {
      ok: false,
      regla: "R1_REFERENCIA_AMBIGUA",
      motivo: `El identificador "${ref}" coincide con ${res.candidatos.length} nodos del mapa: ${res.candidatos
        .map((c) => `"${c.titulo}"`)
        .join(", ")}.`,
      sugerencia:
        "Volvé a llamar la herramienta con el uuid COMPLETO del nodo que corresponde, no con el id corto.",
    };
  }
  return {
    ok: false,
    regla: esPadre ? "R1_PADRE_INEXISTENTE" : "R1_NODO_INEXISTENTE",
    motivo: `No existe ningún nodo con el identificador "${ref}" en el mapa de este caso.`,
    sugerencia:
      "Releé el árbol del mapa que tenés en el contexto (o el `arbol_actualizado` de la última herramienta) y usá uno de los identificadores que figuran entre corchetes.",
  };
}

// === Validador principal ===

export function validarAccion(
  accion: AccionValidable,
  nodos: NodoProcesalDB[],
  fuero: Fuero | null,
): ResultadoValidacion {
  const { porId, hijosPorPadre } = indexar(nodos);
  const cupoRestante = Math.max(0, MAX_NODOS_POR_CASO - nodos.length);
  const advertencias: string[] = [];

  if (nodos.length === 0) {
    return {
      ok: false,
      regla: "R1_NODO_INEXISTENTE",
      motivo: "El mapa procesal de este caso no está inicializado (0 nodos).",
      sugerencia:
        'Explicale al abogado que primero tiene que inicializar el mapa desde la vista "Mapa procesal" del caso, eligiendo el fuero. Hasta entonces no se puede modificar.',
    };
  }
  if (fuero === null) {
    advertencias.push(
      "El caso no tiene fuero asignado: no se pudo validar el cambio contra el esquema canónico de ningún código procesal.",
    );
  }

  const ref = accion.tipo === "crear" ? accion.padre_ref : accion.nodo_ref;
  const res = resolverRef(ref, nodos);
  if (!res.ok) return rechazoRef(res, ref, accion.tipo === "crear");
  const objetivo = res.nodo;

  switch (accion.tipo) {
    case "crear":
      return validarCrear(accion, objetivo, {
        nodos,
        fuero,
        porId,
        hijosPorPadre,
        cupoRestante,
        advertencias,
      });
    case "editar":
      return validarEditar(accion, objetivo, {
        nodos,
        fuero,
        porId,
        hijosPorPadre,
        cupoRestante,
        advertencias,
      });
    case "eliminar":
      return validarEliminar(objetivo, {
        hijosPorPadre,
        cupoRestante,
        advertencias,
      });
    case "marcar_ocurrido":
      return validarMarcarOcurrido(objetivo, {
        porId,
        cupoRestante,
        advertencias,
      });
    case "simular":
      return validarSimular(objetivo, {
        nodos,
        fuero,
        porId,
        cupoRestante,
        advertencias,
      });
  }
}

type Ctx = {
  nodos: NodoProcesalDB[];
  fuero: Fuero | null;
  porId: Map<string, NodoProcesalDB>;
  hijosPorPadre: Map<string, NodoProcesalDB[]>;
  cupoRestante: number;
  advertencias: string[];
};

function validarCrear(
  accion: Extract<AccionValidable, { tipo: "crear" }>,
  padre: NodoProcesalDB,
  ctx: Ctx,
): ResultadoValidacion {
  const { nodos, fuero, porId, hijosPorPadre, cupoRestante, advertencias } = ctx;
  const tituloNorm = normalizarTitulo(accion.titulo);

  // R10 — tope de tamaño. Va primero porque no depende de nada más y es el
  // único límite que protege la legibilidad del mapa entero.
  if (nodos.length >= MAX_NODOS_POR_CASO) {
    return {
      ok: false,
      regla: "R10_TOPE_DE_NODOS",
      motivo: `El mapa ya tiene ${nodos.length} nodos y el máximo es ${MAX_NODOS_POR_CASO}.`,
      sugerencia:
        "Antes de agregar más ramas, proponele al abogado podar las hipótesis que ya se descartaron. Un mapa de 15-40 nodos se lee de un vistazo; uno de 60 es ruido.",
      nodo: padre,
    };
  }

  // R11 — profundidad.
  const profundidadNueva = profundidadDe(padre, porId) + 1;
  if (profundidadNueva > MAX_PROFUNDIDAD) {
    return {
      ok: false,
      regla: "R11_PROFUNDIDAD_MAXIMA",
      motivo: `Colgar el nodo de "${padre.titulo}" lo dejaría en el nivel ${profundidadNueva} y el máximo es ${MAX_PROFUNDIDAD}.`,
      sugerencia:
        "Colgá el nodo de un ancestro más alto, o replanteá la rama: una cadena de más de 12 niveles ya no describe un proceso penal, describe una especulación encadenada.",
      nodo: padre,
    };
  }

  // R9 — riesgo_alto solo para desenlaces adversos al imputado. NO es bloqueo
  // duro: la regla del briefing es real, pero el servidor no puede decidir la
  // semántica jurídica de un título arbitrario ("Sobreseimiento parcial: se
  // rechaza respecto del hecho 2"). Se frena el primer intento para que el
  // modelo se lo consulte al abogado y, si él confirma, se aplica.
  const favorable = esDesenlaceFavorable(accion.titulo);
  if (accion.riesgo_alto === true && favorable) {
    return {
      ok: false,
      regla: "R9_RIESGO_EN_DESENLACE_FAVORABLE",
      motivo: `"${accion.titulo}" parece un desenlace FAVORABLE al imputado (coincide con "${favorable}") y se pidió marcarlo como riesgo alto.`,
      sugerencia:
        "La marca de riesgo alto (rojo) está reservada a los desenlaces adversos al imputado — prisión preventiva, condena, agravamiento de la coerción. Creá el nodo sin riesgo_alto. Si el título describe en realidad algo adverso (el RECHAZO o la REVOCACIÓN de ese instituto), confirmalo con el abogado y, en tu PRÓXIMO mensaje (una vez que él haya respondido), volvé a llamar la herramienta con confirmar: true.",
      requiere_confirmacion: true,
      nodo: padre,
      advertencias,
      cupoRestante,
    };
  }

  // R3 — regresión de etapa: no se puede colgar una etapa anterior de una
  // posterior (una IPP no cuelga de un Juicio Oral).
  const etapaPadre = etapaDe(padre, porId);
  const anclaNueva = etapaAncla(accion.titulo);
  const etapaNueva: Etapa = anclaNueva ?? etapaPadre;
  if (etapaNueva < etapaPadre) {
    const mejorPadre = sugerirPadrePorEtapa(nodos, porId, etapaNueva);
    return {
      ok: false,
      regla: "R3_REGRESION_DE_ETAPA",
      motivo: `"${accion.titulo}" pertenece a la etapa ${etapaNueva} (${ETAPA_LABEL[etapaNueva]}) y "${padre.titulo}" ya está en la etapa ${etapaPadre} (${ETAPA_LABEL[etapaPadre]}). El proceso no vuelve atrás.`,
      sugerencia: mejorPadre
        ? `Colgalo de "${mejorPadre.titulo}" (etapa ${etapaNueva}), que es el punto del mapa donde corresponde esa fase.`
        : `Buscá en el mapa un nodo de la etapa ${etapaNueva} o anterior para usarlo como padre.`,
      nodo: padre,
    };
  }

  // R2 — duplicado entre hermanos: bloqueo. En otra rama: solo advertencia
  // (un "Sobreseimiento" puede aparecer legítimamente colgando de la IPP y de
  // la etapa intermedia — de hecho la plantilla ya lo hace).
  const hermanos = hijosPorPadre.get(padre.id) ?? [];
  const hermanoDup = hermanos.find(
    (h) => normalizarTitulo(h.titulo) === tituloNorm,
  );
  if (hermanoDup) {
    return {
      ok: false,
      regla: "R2_TITULO_DUPLICADO_HERMANO",
      motivo: `"${padre.titulo}" ya tiene un hijo llamado "${hermanoDup.titulo}".`,
      sugerencia:
        "Si querés reflejar algo distinto, usá un título que lo diferencie; si querés cambiar lo que ya está, editá el nodo existente en vez de crear uno nuevo.",
      nodo: padre,
    };
  }
  const enOtraRama = nodos.find(
    (n) => normalizarTitulo(n.titulo) === tituloNorm && n.padre_id !== padre.id,
  );
  if (enOtraRama) {
    advertencias.push(
      `Ya existe otro nodo "${enOtraRama.titulo}" en otra rama del mapa. Es válido (un mismo desenlace puede alcanzarse por caminos distintos), pero verificá con el abogado que no sea una duplicación por error.`,
    );
  }

  // R12 — fuera del esquema canónico: advertencia, nunca bloqueo. El abogado
  // puede estar modelando una incidencia real y atípica de ESTE caso.
  if (fuero && !titulosCanonicos(fuero).has(tituloNorm)) {
    advertencias.push(
      `"${accion.titulo}" no forma parte del flujo canónico del fuero ${FUERO_LABEL[fuero]}: queda como rama hipotética o incidencia propia de este caso.`,
    );
  }

  // R4 — hijos de un desenlace terminal. Advertencia fuerte + confirmación:
  // el proceso ya terminó por esa rama, así que colgarle algo suele ser un
  // error de lectura del mapa; pero hay incidencias legítimas post-desenlace.
  if (titulosTerminales(fuero).has(normalizarTitulo(padre.titulo))) {
    return {
      ok: false,
      regla: "R4_HIJO_DE_TERMINAL",
      motivo: `"${padre.titulo}" es un desenlace terminal del flujo ${refFuero(fuero)}: el proceso se cierra ahí, no continúa.`,
      sugerencia: `Confirmá con el abogado que realmente quiere colgar "${accion.titulo}" de un desenlace terminal (puede tener sentido para una incidencia posterior). Si confirma, volvé a llamar la herramienta con confirmar: true en tu PRÓXIMO mensaje. Si no, buscá el nodo de la etapa que corresponde.`,
      requiere_confirmacion: true,
      nodo: padre,
      advertencias,
      cupoRestante,
    };
  }

  return { ok: true, advertencias, nodo: padre, cupoRestante };
}

// Mejor candidato a padre para una etapa dada: el nodo de esa etapa que es
// ancla troncal (la etapa "de verdad", no un desenlace que la heredó); si no
// hay ancla, cualquier nodo de esa etapa.
function sugerirPadrePorEtapa(
  nodos: NodoProcesalDB[],
  porId: Map<string, NodoProcesalDB>,
  etapa: Etapa,
): NodoProcesalDB | null {
  const deLaEtapa = nodos.filter((n) => etapaDe(n, porId) === etapa);
  const troncal = deLaEtapa.find((n) => etapaAncla(n.titulo) !== undefined);
  return troncal ?? deLaEtapa[0] ?? null;
}

function validarEditar(
  accion: Extract<AccionValidable, { tipo: "editar" }>,
  nodo: NodoProcesalDB,
  ctx: Ctx,
): ResultadoValidacion {
  const { fuero, porId, hijosPorPadre, cupoRestante, advertencias } = ctx;
  const tituloFinal = accion.titulo ?? nodo.titulo;

  // R9 — el riesgo_alto se evalúa contra el título FINAL (el nuevo si se está
  // renombrando, el actual si no). Confirmable, igual que en `validarCrear`.
  const favorable = esDesenlaceFavorable(tituloFinal);
  if (accion.riesgo_alto === true && favorable) {
    return {
      ok: false,
      regla: "R9_RIESGO_EN_DESENLACE_FAVORABLE",
      motivo: `"${tituloFinal}" parece un desenlace FAVORABLE al imputado (coincide con "${favorable}") y se pidió marcarlo como riesgo alto.`,
      sugerencia:
        "La marca de riesgo alto (rojo) está reservada a los desenlaces adversos al imputado. Si el título describe en realidad algo adverso (el RECHAZO o la REVOCACIÓN de ese instituto), confirmalo con el abogado y, en tu PRÓXIMO mensaje (una vez que él haya respondido), volvé a llamar la herramienta con confirmar: true.",
      requiere_confirmacion: true,
      nodo,
      advertencias,
      cupoRestante,
    };
  }
  // Caso inverso: se renombra a un desenlace favorable un nodo que ya venía
  // marcado en rojo, sin limpiar la marca. No bloquea (el cambio de título es
  // legítimo) pero el mapa quedaría mintiendo.
  if (favorable && nodo.riesgo_alto && accion.riesgo_alto !== false) {
    advertencias.push(
      `El nodo queda con el título "${tituloFinal}" (desenlace favorable al imputado) pero conserva la marca de RIESGO ALTO. Proponele al abogado sacarla: el rojo es solo para lo adverso al imputado.`,
    );
  }

  if (accion.titulo !== undefined) {
    const tituloNorm = normalizarTitulo(accion.titulo);
    const anclaNueva = etapaAncla(accion.titulo);
    const padre = nodo.padre_id ? porId.get(nodo.padre_id) ?? null : null;

    if (nodo.tipo === "raiz") {
      advertencias.push(
        "Estás renombrando la raíz del mapa (el origen del caso). Verificá que sea lo que el abogado pidió.",
      );
    }

    // R3 hacia ARRIBA — renombrar puede meter una regresión de etapa igual que
    // crear.
    if (padre) {
      const etapaPadre = etapaDe(padre, porId);
      if (anclaNueva && anclaNueva < etapaPadre) {
        return {
          ok: false,
          regla: "R3_REGRESION_DE_ETAPA",
          motivo: `Renombrar el nodo a "${accion.titulo}" lo movería a la etapa ${anclaNueva} (${ETAPA_LABEL[anclaNueva]}), pero cuelga de "${padre.titulo}", que ya está en la etapa ${etapaPadre} (${ETAPA_LABEL[etapaPadre]}).`,
          sugerencia:
            "Elegí un título de la etapa que corresponde a esta posición del árbol, o creá el nodo nuevo colgando del punto correcto en vez de renombrar este.",
          nodo,
        };
      }
    }

    // R3 hacia ABAJO — la etapa se DERIVA del título, así que un renombre es un
    // movimiento de etapa sobre todo el subárbol que hereda de este nodo. Sin
    // esto, renombrar era la puerta de atrás para dejar un hijo de etapa 4
    // colgando de un padre de etapa 5, que es justo lo que R3 declara imposible.
    // Confirmable (no bloqueo duro): a diferencia de `crear` —donde alcanza con
    // elegir otro padre— acá el renombre puede ser exactamente lo que el
    // abogado pidió, y desde el chat no hay forma de re-colgar la rama.
    const etapaNuevaEfectiva: Etapa =
      anclaNueva ?? (padre ? etapaDe(padre, porId) : 1);
    const descolocado = anclasQueHeredanDe(nodo.id, hijosPorPadre).find((h) => {
      const e = etapaAncla(h.titulo);
      return e !== undefined && e < etapaNuevaEfectiva;
    });
    if (descolocado) {
      const etapaHijo = etapaAncla(descolocado.titulo) as Etapa;
      return {
        ok: false,
        regla: "R3_REGRESION_DE_ETAPA",
        motivo: `Renombrar el nodo a "${accion.titulo}" lo dejaría en la etapa ${etapaNuevaEfectiva} (${ETAPA_LABEL[etapaNuevaEfectiva]}), pero de él cuelga "${descolocado.titulo}", que es de la etapa ${etapaHijo} (${ETAPA_LABEL[etapaHijo]}): esa rama quedaría volviendo atrás en el proceso.`,
        sugerencia: `Elegí un título de una etapa anterior o igual a la ${etapaHijo}, o contale al abogado que "${descolocado.titulo}" y lo que cuelga de él quedan descolocados y confirmá con él antes de insistir (volvé a llamar la herramienta con confirmar: true en tu PRÓXIMO mensaje, solo si confirma).`,
        requiere_confirmacion: true,
        nodo,
        advertencias,
        cupoRestante,
      };
    }

    // R2 — duplicado entre hermanos (excluyéndose a sí mismo).
    if (nodo.padre_id) {
      const hermanos = (hijosPorPadre.get(nodo.padre_id) ?? []).filter(
        (h) => h.id !== nodo.id,
      );
      const dup = hermanos.find((h) => normalizarTitulo(h.titulo) === tituloNorm);
      if (dup) {
        return {
          ok: false,
          regla: "R2_TITULO_DUPLICADO_HERMANO",
          motivo: `Ya hay otro hijo del mismo padre llamado "${dup.titulo}".`,
          sugerencia:
            "Usá un título que distinga las dos ramas, o eliminá la que sobra en vez de dejarlas iguales.",
          nodo,
        };
      }
    }

    if (fuero && !titulosCanonicos(fuero).has(tituloNorm)) {
      advertencias.push(
        `"${accion.titulo}" no forma parte del flujo canónico del fuero ${FUERO_LABEL[fuero]}: el nodo queda como rama hipotética o incidencia propia de este caso.`,
      );
    }

    const hijos = hijosPorPadre.get(nodo.id) ?? [];
    // R4 en el camino de edición: renombrar a un desenlace terminal un nodo que
    // TIENE hijos deja el proceso "cerrado" con trámite colgando. Mismo criterio
    // que en `validarCrear`: no se bloquea, se pide confirmación.
    if (hijos.length > 0 && titulosTerminales(fuero).has(tituloNorm)) {
      return {
        ok: false,
        regla: "R4_HIJO_DE_TERMINAL",
        motivo: `"${accion.titulo}" es un desenlace terminal del flujo ${refFuero(fuero)} (el proceso se cierra ahí), pero este nodo tiene ${hijos.length} ${hijos.length === 1 ? "hijo colgando" : "hijos colgando"}.`,
        sugerencia:
          "Confirmá con el abogado que el nodo realmente pasó a ser un desenlace terminal y que lo que cuelga son incidencias posteriores. Si confirma, volvé a llamar la herramienta con confirmar: true en tu PRÓXIMO mensaje.",
        requiere_confirmacion: true,
        nodo,
        advertencias,
        cupoRestante,
      };
    }
    if (hijos.length > 0) {
      advertencias.push(
        `El nodo tiene ${hijos.length} ${hijos.length === 1 ? "hijo que cuelga" : "hijos que cuelgan"} de él y hereda${hijos.length === 1 ? "" : "n"} su etapa: revisá que el cambio de título no descoloque esa rama.`,
      );
    }
  }

  return { ok: true, advertencias, nodo, cupoRestante };
}

function validarEliminar(
  nodo: NodoProcesalDB,
  ctx: Pick<Ctx, "hijosPorPadre" | "cupoRestante" | "advertencias">,
): ResultadoValidacion {
  const { hijosPorPadre, cupoRestante, advertencias } = ctx;

  // R6 — la raíz no se borra nunca. Bloqueo duro, sin confirmación posible:
  // hay un índice único por caso (WHERE tipo='raiz') y borrarla dejaría el
  // mapa entero huérfano.
  if (nodo.tipo === "raiz") {
    return {
      ok: false,
      regla: "R6_RAIZ_PROTEGIDA",
      motivo: `"${nodo.titulo}" es la raíz del mapa (el origen del caso) y no se puede eliminar.`,
      sugerencia:
        'Si el abogado quiere rehacer el mapa desde cero, tiene que usar "Reiniciar mapa" desde la vista del mapa procesal.',
      nodo,
    };
  }

  const descendientes = descendientesDe(nodo.id, hijosPorPadre);
  const ocurridos = [nodo, ...descendientes].filter(
    (n) => n.estado === "ocurrido",
  );

  // R7 + R8 — ambos requieren confirmación. Si aplican los dos, se reportan
  // juntos (el abogado tiene que decidir con la foto completa, no en dos
  // pasos), y el código de regla lo fija el más grave: borrar historia real.
  const motivos: string[] = [];
  if (nodo.estado === "ocurrido") {
    motivos.push(
      `"${nodo.titulo}" está marcado como OCURRIDO: es historia real del caso, no una hipótesis`,
    );
  }
  if (descendientes.length > 0) {
    motivos.push(
      `el borrado arrastra ${descendientes.length} ${descendientes.length === 1 ? "nodo descendiente" : "nodos descendientes"} (${descendientes
        .slice(0, 6)
        .map((d) => `"${d.titulo}"`)
        .join(", ")}${descendientes.length > 6 ? ", …" : ""})`,
    );
  }
  if (ocurridos.length > 0 && nodo.estado !== "ocurrido") {
    motivos.push(
      `entre los descendientes hay ${ocurridos.length} ${ocurridos.length === 1 ? "nodo ya ocurrido" : "nodos ya ocurridos"}`,
    );
  }

  if (motivos.length > 0) {
    return {
      ok: false,
      regla:
        nodo.estado === "ocurrido" || ocurridos.length > 0
          ? "R7_ELIMINA_HISTORIA_REAL"
          : "R8_ELIMINA_DESCENDIENTES",
      motivo: `${motivos.join("; ")}.`,
      sugerencia:
        "Contale al abogado exactamente qué se pierde y esperá su confirmación. Si confirma, volvé a llamar la herramienta con confirmar: true en tu PRÓXIMO mensaje: el servidor rechaza el confirmar si la advertencia no viajó antes.",
      requiere_confirmacion: true,
      nodo,
      advertencias,
      cupoRestante,
    };
  }

  return { ok: true, advertencias, nodo, cupoRestante };
}

function validarMarcarOcurrido(
  nodo: NodoProcesalDB,
  ctx: Pick<Ctx, "porId" | "cupoRestante" | "advertencias">,
): ResultadoValidacion {
  const { porId, cupoRestante, advertencias } = ctx;

  // La raíz arranca 'ocurrido' por diseño de la plantilla y marcarComoOcurrido
  // la excluye explícitamente (.neq tipo raiz): sin este guard la query
  // devolvería null y el modelo leería un fallo sin explicación.
  if (nodo.tipo === "raiz") {
    return {
      ok: false,
      regla: "R6_RAIZ_PROTEGIDA",
      motivo: `"${nodo.titulo}" es la raíz del mapa y ya figura como ocurrida por definición (es el hecho que da origen al caso).`,
      sugerencia:
        "No hace falta marcarla. Elegí el nodo del hito procesal que efectivamente sucedió.",
      nodo,
    };
  }

  if (nodo.estado === "ocurrido") {
    advertencias.push(
      `"${nodo.titulo}" ya estaba marcado como ocurrido: la acción no cambió nada.`,
    );
    return { ok: true, advertencias, nodo, cupoRestante };
  }

  // R5 — la línea de tiempo real no puede tener agujeros: si un hito ocurrió,
  // todo lo que lo precede en el árbol también ocurrió.
  const faltantes = ancestrosDe(nodo, porId).filter(
    (a) => a.estado !== "ocurrido",
  );
  if (faltantes.length > 0) {
    return {
      ok: false,
      regla: "R5_ANCESTROS_NO_OCURRIDOS",
      motivo: `Para marcar "${nodo.titulo}" como ocurrido, primero tienen que estar marcados sus ${faltantes.length === 1 ? "antecedente" : "antecedentes"}: ${faltantes
        .map((f) => `"${f.titulo}"`)
        .join(" → ")}.`,
      sugerencia: `Marcá primero ${faltantes
        .map((f) => `"${f.titulo}"`)
        .join(", luego ")}, en ese orden, y recién después "${nodo.titulo}". Si alguno de esos hitos NO sucedió, entonces "${nodo.titulo}" tampoco pudo suceder por este camino: revisá con el abogado por qué rama avanzó realmente el caso.`,
      nodo,
    };
  }

  return { ok: true, advertencias, nodo, cupoRestante };
}

function validarSimular(
  nodo: NodoProcesalDB,
  ctx: Pick<Ctx, "nodos" | "fuero" | "porId" | "cupoRestante" | "advertencias">,
): ResultadoValidacion {
  const { nodos, fuero, porId, cupoRestante, advertencias } = ctx;

  if (cupoRestante === 0) {
    return {
      ok: false,
      regla: "R10_TOPE_DE_NODOS",
      motivo: `El mapa ya tiene ${nodos.length} nodos y el máximo es ${MAX_NODOS_POR_CASO}: no entra ninguna rama nueva.`,
      sugerencia:
        "Proponele al abogado podar las hipótesis descartadas antes de simular ramas nuevas.",
      nodo,
    };
  }

  if (profundidadDe(nodo, porId) + 1 > MAX_PROFUNDIDAD) {
    return {
      ok: false,
      regla: "R11_PROFUNDIDAD_MAXIMA",
      motivo: `Las ramas hijas de "${nodo.titulo}" quedarían en el nivel ${profundidadDe(nodo, porId) + 1} y el máximo es ${MAX_PROFUNDIDAD}.`,
      sugerencia:
        "Simulá desde un nodo más alto del árbol, o discutí el escenario en prosa sin persistirlo como nodos.",
      nodo,
    };
  }

  // La simulación crea entre 1 y 5 ramas; si no entran todas, avisamos y el
  // dispatcher recorta a `cupoRestante` (mejor media simulación que romper el
  // tope o fallar entera).
  if (cupoRestante < 5) {
    advertencias.push(
      `Solo entran ${cupoRestante} ${cupoRestante === 1 ? "nodo nuevo" : "nodos nuevos"} antes de llegar al tope de ${MAX_NODOS_POR_CASO}: si la simulación propone más ramas, se van a guardar solo las primeras.`,
    );
  }

  // R4 — simular desde un terminal: solo advertencia. A diferencia de 'crear'
  // acá no hay parámetro `confirmar` con el cual levantar un bloqueo, y el
  // resultado sigue siendo revisable por el abogado antes de quedarse.
  if (titulosTerminales(fuero).has(normalizarTitulo(nodo.titulo))) {
    advertencias.push(
      `"${nodo.titulo}" es un desenlace terminal del flujo ${refFuero(fuero)}: el proceso se cierra ahí. Las ramas que salgan van a ser incidencias posteriores, no continuación del trámite.`,
    );
  }

  return { ok: true, advertencias, nodo, cupoRestante };
}
