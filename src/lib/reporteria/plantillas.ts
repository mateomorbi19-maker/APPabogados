// Las seis plantillas de reportería al cliente del estudio, tal como las
// redactó BraCar («Sistema de Reportería al Cliente v1.0»), con lo que el
// sistema necesita saber de cada una para armar el borrador: qué variables
// tiene, de dónde sale cada una, qué bloques son condicionales y qué le hace
// falta preguntarle al abogado.
//
// Módulo PURO: lo leen el server (render, prompt), los diálogos de la ficha
// (el formulario de criterio se dibuja desde `campos_criterio`) y el script de
// verificación.
//
// === Las tres fuentes de una variable ===
//
//   sistema   lo calcula la app (etapa, último movimiento, fechas, resumen del
//             mes). El abogado no tipea nada.
//   ficha     sale de la ficha, las partes o el perfil (nombre del cliente, juez,
//             tribunal, firma). Si falta, queda [FALTA: …] y se carga en la ficha.
//   criterio  es criterio profesional (el próximo paso, por qué es buena
//             noticia, qué tiene que hacer el cliente). Lo escribe el abogado
//             en el formulario corto; el sistema nunca lo inventa.
//
// === Una sola desviación del texto del estudio, documentada ===
//
// P-02 y P-04 prometían el recurso por el solo tipo de resolución («vamos a
// apelar porque…», «vamos a presentar casación dentro de los X días»). El
// análisis de agosto (REPORTERIA_AL_CLIENTE_PARA_DECIDIR.md §5, riesgo 2) pidió
// que la promesa saliera de una decisión cargada, no de la plantilla: esas
// frases van detrás de la condición SE_RECURRE, que es un checkbox.

import type { CanalReporte, PlantillaReporte } from "./types";

export type FuenteVariable = "sistema" | "ficha" | "criterio";

export type VariableReporte = {
  /** Sin llaves: `NOMBRE_CLIENTE`. */
  clave: string;
  /** Lo que se lee en `[FALTA: label]`. */
  label: string;
  fuente: FuenteVariable;
  /** La descripción de la ficha del estudio. */
  ayuda: string;
  /** Una opcional que falta se omite en vez de dejar la marca. */
  opcional?: boolean;
};

export type CondicionReporte = {
  /** Sin `#`: `SI_HAY_PROXIMO_PASO`. */
  tag: string;
  label: string;
  /**
   * Cómo se decide: por la presencia de una variable, por la variante elegida
   * o por un checkbox del formulario.
   */
  fuente: "variable" | "variante" | "criterio";
  variable?: string;
  /** `CLIENTE_SIN_ACCION` es la negación de «hay acción del cliente». */
  negada?: boolean;
};

export type VarianteReporte = {
  id: string;
  label: string;
  descripcion: string;
  /** Tags que enciende cuando el estudio actúa como defensa. */
  condiciones: string[];
  /** Tags que enciende cuando el estudio actúa como querella (si difiere). */
  condiciones_querella?: string[];
  /** Valores por defecto de variables cuando aplica la variante (defensa). */
  valores?: Record<string, string>;
  /** Idem, cuando el estudio actúa como querella. */
  valores_querella?: Record<string, string>;
  /**
   * Las variantes de peores noticias (prisión preventiva, condena) no pasan por
   * el modelo: la app escribe la cabecera y el cierre, el cuerpo lo escribe el
   * abogado. Decisión 6 de docs/PLAN_REPORTERIA.md.
   */
  sin_ia?: { cabecera: string; cierre: string };
};

export type OpcionCriterio = {
  valor: string;
  label: string;
  /** Lo que se escribe en la variable cuando se elige esta opción. */
  texto: string;
};

export type CampoCriterio = {
  /** Coincide con la clave de la variable o el tag de la condición que alimenta. */
  clave: string;
  label: string;
  tipo: "texto" | "textarea" | "opciones" | "checkbox";
  opciones?: OpcionCriterio[];
  ayuda?: string;
  placeholder?: string;
  /** Sólo aparece (y se exige) con estas variantes. */
  solo_variantes?: string[];
  /** Sólo aparece si este checkbox está marcado. */
  solo_si?: string;
  /** Sin valor, el borrador queda con [FALTA: …]. Las no requeridas se omiten. */
  requerido?: boolean;
};

export type DefinicionPlantilla = {
  id: PlantillaReporte;
  /** «P-01». */
  codigo: string;
  titulo: string;
  /** La etiqueta de uso de la ficha: «USO RECURRENTE | CUALQUIER ETAPA». */
  etiqueta: string;
  cuando: string;
  canal_sugerido: CanalReporte;
  /** Asunto por defecto cuando sale por correo. Admite variables. */
  asunto: string;
  /** El texto del estudio, con {{VARIABLES}} y bloques {{#TAG}}…{{/TAG}}. */
  texto: string;
  variables: VariableReporte[];
  condiciones: CondicionReporte[];
  variantes: VarianteReporte[];
  campos_criterio: CampoCriterio[];
};

// ————————————————————————————————————————————————————————————————
// Variables comunes
// ————————————————————————————————————————————————————————————————

const NOMBRE_CLIENTE: VariableReporte = {
  clave: "NOMBRE_CLIENTE",
  label: "nombre del cliente",
  fuente: "ficha",
  ayuda: "Nombre de pila del cliente (Partes de la causa).",
};

const NOMBRE_ABOGADO: VariableReporte = {
  clave: "NOMBRE_ABOGADO",
  label: "nombre del abogado",
  fuente: "ficha",
  ayuda: "Nombre del profesional que firma el reporte (perfil profesional).",
};

// ————————————————————————————————————————————————————————————————
// Glosario: la etapa del mapa en lenguaje llano
// ————————————————————————————————————————————————————————————————
//
// La etapa procesal se deriva del mapa (etapa-actual.ts) y acá se traduce. Es
// la «tabla de traducción» de la ficha del estudio aplicada a las seis
// macro-etapas comunes a los tres fueros. Sin punto final: las plantillas lo
// ponen.

export const ETAPA_COLOQUIAL: Record<
  1 | 2 | 3 | 4 | 5 | 6,
  { nombre: string; explicacion: string }
> = {
  1: {
    nombre: "el inicio de la causa",
    explicacion:
      "la denuncia recién se presentó y el juzgado o la fiscalía está organizando la investigación",
  },
  2: {
    nombre: "la etapa de investigación",
    explicacion:
      "la fiscalía y el juzgado están reuniendo pruebas para decidir si hay elementos para llevar el caso a juicio",
  },
  3: {
    nombre: "la etapa intermedia, entre la investigación y el juicio",
    explicacion:
      "la investigación terminó y se está definiendo si la causa va a juicio oral o se cierra antes",
  },
  4: {
    nombre: "la etapa de juicio oral",
    explicacion:
      "un tribunal va a escuchar las pruebas y a las partes, y después va a decidir",
  },
  5: {
    nombre: "la etapa de recursos",
    explicacion:
      "hay una decisión que se está revisando en una instancia superior; la causa no está terminada",
  },
  6: {
    nombre: "la etapa de ejecución",
    explicacion:
      "la condena quedó firme y lo que se discute ahora es cómo se cumple",
  },
};

// La tabla de traducción de la ficha del estudio (instrucción 2), tal cual.
// Va al system prompt del redactor como ejemplos del registro que se espera.
export const GLOSARIO_TRADUCCION: ReadonlyArray<{
  tecnico: string;
  coloquial: string;
  regla: string;
}> = [
  {
    tecnico: "Etapa: art. 306 CPPN",
    coloquial: "Estás procesado, la investigación sigue",
    regla: "Explicar el efecto práctico",
  },
  {
    tecnico: "Decreto de prisión preventiva",
    coloquial: "Lamentablemente el juez ordenó tu detención preventiva",
    regla: "Sin eufemismos pero con contención",
  },
  {
    tecnico: "Falta de mérito s/ art. 309 CPPN",
    coloquial:
      "El juez no te procesó ni te sobreseyó: la causa sigue pero sin definirte la situación todavía",
    regla: "Explicar la incertidumbre",
  },
  {
    tecnico: "Requerimiento de elevación a juicio",
    coloquial: "La Fiscalía pidió que vayas a juicio oral",
    regla: "Actor + acción + consecuencia",
  },
  {
    tecnico: "Art. 76 bis CP — probation",
    coloquial:
      "La suspensión del juicio a prueba (probation): te permite evitar el juicio si cumplís ciertas condiciones",
    regla: "Nombre coloquial + explicación",
  },
];

// ————————————————————————————————————————————————————————————————
// P-01 · Actualización general de la causa
// ————————————————————————————————————————————————————————————————

const P01: DefinicionPlantilla = {
  id: "P01",
  codigo: "P-01",
  titulo: "Actualización general de la causa",
  etiqueta: "Uso recurrente · cualquier etapa",
  cuando:
    "Envío periódico (semanal, quincenal o mensual) para mantener al cliente informado sin que haya un hito puntual. La más usada.",
  canal_sugerido: "whatsapp",
  asunto: "Novedades de tu causa",
  texto: [
    "Hola {{NOMBRE_CLIENTE}}, te mando estas líneas para que estés al tanto de cómo va tu causa.",
    "",
    "En este momento el expediente está en {{ETAPA_PROCESAL_COLOQUIAL}}. En pocas palabras, eso significa que {{EXPLICACION_ETAPA}}.",
    "",
    "Lo último que se movió en la causa fue {{ULTIMO_MOVIMIENTO}} ({{FECHA_ULTIMO_MOVIMIENTO}}). {{DETALLE_ADICIONAL_MOVIMIENTO}}",
    "",
    "{{#SI_HAY_PROXIMO_PASO}}Lo que sigue es {{PROXIMO_PASO_COLOQUIAL}}, que está estimado para {{FECHA_O_PLAZO_ESTIMADO}}.{{/SI_HAY_PROXIMO_PASO}}",
    "",
    "{{#CLIENTE_DEBE_ACTUAR}}Importante: de tu parte necesitamos que {{ACCION_CLIENTE}}. Si tenés alguna duda, escribime.{{/CLIENTE_DEBE_ACTUAR}}{{#CLIENTE_SIN_ACCION}}Por tu parte no hay nada que hacer por ahora — nosotros manejamos todo.{{/CLIENTE_SIN_ACCION}}",
    "",
    "La causa está avanzando {{RITMO_COLOQUIAL}}. Ante cualquier novedad te aviso de inmediato.",
    "",
    "Saludos, {{NOMBRE_ABOGADO}}",
  ].join("\n"),
  variables: [
    NOMBRE_CLIENTE,
    {
      clave: "ETAPA_PROCESAL_COLOQUIAL",
      label: "etapa procesal",
      fuente: "sistema",
      ayuda: "La etapa del mapa procesal traducida a lenguaje llano.",
    },
    {
      clave: "EXPLICACION_ETAPA",
      label: "qué significa la etapa",
      fuente: "sistema",
      ayuda: "Una oración que describe qué significa esa etapa para alguien sin conocimientos legales.",
    },
    {
      clave: "ULTIMO_MOVIMIENTO",
      label: "último movimiento",
      fuente: "sistema",
      ayuda: "Último acto procesal registrado en el timeline de la causa.",
    },
    {
      clave: "FECHA_ULTIMO_MOVIMIENTO",
      label: "fecha del último movimiento",
      fuente: "sistema",
      ayuda: "Fecha del último movimiento en formato coloquial.",
    },
    {
      clave: "DETALLE_ADICIONAL_MOVIMIENTO",
      label: "detalle del movimiento",
      fuente: "criterio",
      ayuda: "Una oración opcional que da contexto del movimiento.",
      opcional: true,
    },
    {
      clave: "PROXIMO_PASO_COLOQUIAL",
      label: "próximo paso",
      fuente: "criterio",
      ayuda: "Próxima audiencia, vencimiento o acto procesal relevante. El sistema propone el próximo evento de la agenda.",
      opcional: true,
    },
    {
      clave: "FECHA_O_PLAZO_ESTIMADO",
      label: "fecha o plazo del próximo paso",
      fuente: "criterio",
      ayuda: "Fecha o plazo estimado del próximo paso.",
      opcional: true,
    },
    {
      clave: "ACCION_CLIENTE",
      label: "qué tiene que hacer el cliente",
      fuente: "criterio",
      ayuda: "Qué tiene que hacer el cliente, si aplica: juntar documentación, estar disponible, etc.",
      opcional: true,
    },
    {
      clave: "RITMO_COLOQUIAL",
      label: "ritmo de la causa",
      fuente: "criterio",
      ayuda: "«con normalidad» / «más lento de lo esperado (es habitual)» / «más rápido de lo previsto».",
    },
    NOMBRE_ABOGADO,
  ],
  condiciones: [
    {
      tag: "SI_HAY_PROXIMO_PASO",
      label: "Hay un próximo paso",
      fuente: "variable",
      variable: "PROXIMO_PASO_COLOQUIAL",
    },
    {
      tag: "CLIENTE_DEBE_ACTUAR",
      label: "El cliente tiene que hacer algo",
      fuente: "variable",
      variable: "ACCION_CLIENTE",
    },
    {
      tag: "CLIENTE_SIN_ACCION",
      label: "El cliente no tiene que hacer nada",
      fuente: "variable",
      variable: "ACCION_CLIENTE",
      negada: true,
    },
  ],
  variantes: [],
  campos_criterio: [
    {
      clave: "DETALLE_ADICIONAL_MOVIMIENTO",
      label: "Contexto del último movimiento",
      tipo: "textarea",
      ayuda: "Una oración completa, con punto. Opcional.",
      placeholder: "Es el paso previo a que el fiscal decida si pide el juicio.",
    },
    {
      clave: "PROXIMO_PASO_COLOQUIAL",
      label: "Próximo paso",
      tipo: "texto",
      ayuda: "Si lo dejás vacío, el párrafo del próximo paso no aparece.",
      placeholder: "la audiencia donde el juez decide sobre la excarcelación",
    },
    {
      clave: "FECHA_O_PLAZO_ESTIMADO",
      label: "Fecha o plazo estimado",
      tipo: "texto",
      placeholder: "la segunda quincena de octubre",
    },
    {
      clave: "ACCION_CLIENTE",
      label: "Qué necesitamos del cliente",
      tipo: "texto",
      ayuda: "Vacío = «no hay nada que hacer de tu parte».",
      placeholder: "nos mandes el recibo de sueldo de agosto",
    },
    {
      clave: "RITMO_COLOQUIAL",
      label: "Ritmo de la causa",
      tipo: "opciones",
      requerido: true,
      opciones: [
        { valor: "normal", label: "Con normalidad", texto: "con normalidad" },
        {
          valor: "lento",
          label: "Más lento de lo esperado",
          texto: "más lento de lo esperado (es habitual)",
        },
        {
          valor: "rapido",
          label: "Más rápido de lo previsto",
          texto: "más rápido de lo previsto",
        },
      ],
    },
  ],
};

// ————————————————————————————————————————————————————————————————
// P-02 · Resolución judicial
// ————————————————————————————————————————————————————————————————

const P02: DefinicionPlantilla = {
  id: "P02",
  codigo: "P-02",
  titulo: "Resolución judicial (procesamiento, sobreseimiento, falta de mérito, elevación)",
  etiqueta: "Evento puntual · dictado de resolución clave",
  cuando:
    "Cuando el juez dicta una resolución que define la situación procesal del cliente. Son los momentos de mayor impacto emocional: tiene que saberlo rápido y entenderlo bien.",
  canal_sugerido: "whatsapp",
  asunto: "Resolución en tu causa",
  texto: [
    "Hola {{NOMBRE_CLIENTE}}, te escribo porque acaba de salir una resolución importante en tu causa.",
    "",
    "El juez {{NOMBRE_JUEZ}} resolvió {{TIPO_RESOLUCION_COLOQUIAL}}. En concreto, eso significa {{EXPLICACION_COLOQUIAL_RESOLUCION}}.",
    "",
    "{{#FAVORABLE}}Es una buena noticia: {{RAZON_FAVORABLE}}.{{/FAVORABLE}}",
    "",
    "{{#DESFAVORABLE}}La resolución nos va en contra, pero no te preocupés todavía: {{RESPUESTA_ESTRATEGICA}}. {{#SE_RECURRE}}Vamos a apelar porque {{ARGUMENTO_RECURSO}}.{{/SE_RECURRE}}{{/DESFAVORABLE}}",
    "",
    "{{#ELEVACION_JUICIO}}Esto quiere decir que la causa pasa a la etapa del juicio oral. Te voy a explicar con más detalle lo que esto implica cuando hablemos.{{/ELEVACION_JUICIO}}",
    "",
    "El paso siguiente es {{PROXIMO_PASO}}. Esto debería pasar {{PLAZO_ESTIMADO}}.",
    "",
    "Te llamo en breve para charlar. Saludos, {{NOMBRE_ABOGADO}}",
  ].join("\n"),
  variables: [
    NOMBRE_CLIENTE,
    {
      clave: "NOMBRE_JUEZ",
      label: "nombre del juez",
      fuente: "ficha",
      ayuda: "Nombre del magistrado o tribunal (campo Juez de la ficha).",
    },
    {
      clave: "TIPO_RESOLUCION_COLOQUIAL",
      label: "tipo de resolución",
      fuente: "sistema",
      ayuda: "«procesarte» / «sobreseerte» / «dictar la falta de mérito» / «elevar la causa a juicio». Sale de la variante elegida.",
    },
    {
      clave: "EXPLICACION_COLOQUIAL_RESOLUCION",
      label: "qué significa la resolución",
      fuente: "sistema",
      ayuda: "El efecto práctico de la resolución para el cliente, en una oración. La variante trae una por defecto; se puede reemplazar.",
    },
    {
      clave: "RAZON_FAVORABLE",
      label: "por qué es buena noticia",
      fuente: "criterio",
      ayuda: "«cierra la investigación en tu contra», «quedás libre de toda culpa», etc.",
    },
    {
      clave: "RESPUESTA_ESTRATEGICA",
      label: "qué va a hacer la defensa",
      fuente: "criterio",
      ayuda: "Qué va a hacer la defensa ante la resolución adversa.",
    },
    {
      clave: "ARGUMENTO_RECURSO",
      label: "argumento del recurso",
      fuente: "criterio",
      ayuda: "Fundamento del recurso en lenguaje simple. Sólo si se decidió recurrir.",
    },
    {
      clave: "PROXIMO_PASO",
      label: "próximo paso",
      fuente: "criterio",
      ayuda: "Qué viene después de esta resolución.",
    },
    {
      clave: "PLAZO_ESTIMADO",
      label: "plazo estimado del próximo paso",
      fuente: "criterio",
      ayuda: "Cuánto puede tardar el próximo paso.",
    },
    NOMBRE_ABOGADO,
  ],
  condiciones: [
    { tag: "FAVORABLE", label: "Resolución favorable", fuente: "variante" },
    { tag: "DESFAVORABLE", label: "Resolución desfavorable", fuente: "variante" },
    { tag: "ELEVACION_JUICIO", label: "Elevación a juicio", fuente: "variante" },
    { tag: "SE_RECURRE", label: "Se decidió recurrir", fuente: "criterio" },
  ],
  variantes: [
    {
      id: "procesamiento",
      label: "Procesamiento (sin prisión preventiva)",
      descripcion: "El juez procesó al imputado y sigue en libertad.",
      condiciones: ["DESFAVORABLE"],
      condiciones_querella: ["FAVORABLE"],
      valores: {
        TIPO_RESOLUCION_COLOQUIAL: "procesarte",
        EXPLICACION_COLOQUIAL_RESOLUCION:
          "que para el juez hay elementos para seguir investigándote como sospechoso; no es una condena, la causa sigue y la defensa también",
      },
      valores_querella: {
        TIPO_RESOLUCION_COLOQUIAL: "procesar a {{NOMBRE_IMPUTADO}}",
        EXPLICACION_COLOQUIAL_RESOLUCION:
          "que el juez entendió que hay elementos suficientes para seguir la investigación contra esa persona",
        RAZON_FAVORABLE:
          "la causa avanza y la persona denunciada queda formalmente sospechada",
      },
    },
    {
      id: "prision_preventiva",
      label: "Procesamiento con prisión preventiva",
      descripcion:
        "La peor noticia de esta etapa. La app arma el encabezado y el cierre; el cuerpo lo escribís vos, sin IA.",
      condiciones: ["DESFAVORABLE"],
      condiciones_querella: ["FAVORABLE"],
      valores: {
        TIPO_RESOLUCION_COLOQUIAL: "procesarte con prisión preventiva",
      },
      sin_ia: {
        cabecera:
          "Hola {{NOMBRE_CLIENTE}}, te escribo porque acaba de salir una resolución importante en tu causa: el juez {{NOMBRE_JUEZ}} dictó tu procesamiento con prisión preventiva.",
        cierre: "Te llamo hoy mismo para explicarte todo con calma. Saludos, {{NOMBRE_ABOGADO}}",
      },
    },
    {
      id: "sobreseimiento",
      label: "Sobreseimiento",
      descripcion: "El juez cerró la causa a favor del imputado.",
      condiciones: ["FAVORABLE"],
      condiciones_querella: ["DESFAVORABLE"],
      valores: {
        TIPO_RESOLUCION_COLOQUIAL: "sobreseerte",
        EXPLICACION_COLOQUIAL_RESOLUCION:
          "que la causa se cierra en tu contra: el juez entendió que no hay motivo para seguir el proceso contra vos",
        RAZON_FAVORABLE: "cierra la investigación en tu contra",
      },
      valores_querella: {
        TIPO_RESOLUCION_COLOQUIAL: "sobreseer a {{NOMBRE_IMPUTADO}}",
        EXPLICACION_COLOQUIAL_RESOLUCION:
          "que el juez cerró la causa contra esa persona por ahora",
      },
    },
    {
      id: "falta_de_merito",
      label: "Falta de mérito",
      descripcion: "Ni procesamiento ni sobreseimiento: la situación sigue sin definirse.",
      condiciones: [],
      valores: {
        TIPO_RESOLUCION_COLOQUIAL: "dictar la falta de mérito",
        EXPLICACION_COLOQUIAL_RESOLUCION:
          "que el juez no te procesó ni te sobreseyó: la causa sigue, pero todavía sin definir tu situación",
      },
      valores_querella: {
        TIPO_RESOLUCION_COLOQUIAL: "dictar la falta de mérito respecto de {{NOMBRE_IMPUTADO}}",
        EXPLICACION_COLOQUIAL_RESOLUCION:
          "que el juez no procesó ni sobreseyó a esa persona: la causa sigue, pero sin definir su situación todavía",
      },
    },
    {
      id: "elevacion_juicio",
      label: "Elevación a juicio",
      descripcion: "La investigación terminó y la causa pasa al juicio oral.",
      condiciones: ["ELEVACION_JUICIO"],
      valores: {
        TIPO_RESOLUCION_COLOQUIAL: "elevar la causa a juicio",
        EXPLICACION_COLOQUIAL_RESOLUCION:
          "que la etapa de investigación terminó y la causa va a ser juzgada en un juicio oral",
      },
    },
  ],
  campos_criterio: [
    {
      clave: "EXPLICACION_COLOQUIAL_RESOLUCION",
      label: "Qué significa en la práctica (opcional, reemplaza la explicación por defecto)",
      tipo: "textarea",
      placeholder: "que…",
    },
    {
      clave: "RAZON_FAVORABLE",
      label: "Por qué es buena noticia",
      tipo: "texto",
      solo_variantes: ["sobreseimiento"],
      requerido: true,
      placeholder: "cierra la investigación en tu contra",
    },
    {
      clave: "RESPUESTA_ESTRATEGICA",
      label: "Qué va a hacer la defensa",
      tipo: "textarea",
      solo_variantes: ["procesamiento"],
      requerido: true,
      placeholder: "el procesamiento no es una condena y tenemos varios caminos para revertirlo",
    },
    {
      clave: "SE_RECURRE",
      label: "Decidimos apelar / recurrir esta resolución",
      tipo: "checkbox",
      solo_variantes: ["procesamiento"],
      ayuda: "Sólo si ya está decidido con el cliente. Sin esto el mensaje no promete ningún recurso.",
    },
    {
      clave: "ARGUMENTO_RECURSO",
      label: "Argumento del recurso, en lenguaje simple",
      tipo: "textarea",
      solo_variantes: ["procesamiento"],
      solo_si: "SE_RECURRE",
      requerido: true,
      placeholder: "el juez tomó como prueba una declaración que no se puede usar",
    },
    {
      clave: "PROXIMO_PASO",
      label: "Próximo paso",
      tipo: "texto",
      requerido: true,
      placeholder: "que la fiscalía decida si pide el juicio",
    },
    {
      clave: "PLAZO_ESTIMADO",
      label: "Cuándo debería pasar",
      tipo: "texto",
      requerido: true,
      placeholder: "en las próximas semanas",
    },
  ],
};

// ————————————————————————————————————————————————————————————————
// P-03 · Pre-debate oral
// ————————————————————————————————————————————————————————————————

const P03: DefinicionPlantilla = {
  id: "P03",
  codigo: "P-03",
  titulo: "Pre-debate oral: aviso y preparación del cliente",
  etiqueta: "Evento crítico · antes del juicio oral",
  cuando:
    "Entre 10 y 20 días antes del debate oral. El momento de mayor ansiedad del cliente: el mensaje transmite preparación, claridad y contención.",
  canal_sugerido: "email",
  asunto: "Tu juicio oral: fecha, lugar y cómo nos preparamos",
  texto: [
    "Hola {{NOMBRE_CLIENTE}}, necesito que leas esto con atención porque se viene la instancia más importante de tu causa.",
    "",
    "El juicio oral está fijado para el {{FECHA_DEBATE}}, a las {{HORA_INICIO}}, en {{LUGAR_SEDE_DEBATE}}. El tribunal que va a juzgar es {{COMPOSICION_TRIBUNAL}}.",
    "",
    "Este es el momento donde se juega todo: acá el tribunal va a escuchar las pruebas, los testigos y los argumentos de ambas partes, y después va a decidir. Tu presencia es obligatoria, no opcional.",
    "",
    "Necesito que estés en {{PUNTO_ENCUENTRO}} a las {{HORA_CONCENTRACION}} para que hablemos antes de entrar. Vestite {{INDICACIONES_PRESENTACION}}.",
    "",
    "Las pruebas que presentamos a tu favor son: {{LISTA_PRUEBAS_COLOQUIAL}}. El argumento central de tu defensa es {{ARGUMENTO_DEFENSA_SIMPLE}}.",
    "",
    "{{#HAY_TESTIGOS}}Vamos a declarar {{CANTIDAD_TESTIGOS}} testigos: {{LISTA_TESTIGOS_COLOQUIAL}}. Eso va a fortalecer mucho tu posición.{{/HAY_TESTIGOS}}",
    "",
    "Vamos a coordinar una reunión previa el {{FECHA_REUNION_PREPARATORIA}} para repasar todo juntos. Estoy trabajando en esto y estamos bien preparados.",
    "",
    "Cualquier duda que te surja, escribime. Saludos, {{NOMBRE_ABOGADO}}",
  ].join("\n"),
  variables: [
    NOMBRE_CLIENTE,
    {
      clave: "FECHA_DEBATE",
      label: "fecha del debate",
      fuente: "sistema",
      ayuda: "Fecha del debate en formato coloquial. Sale de la audiencia cargada en la agenda; si no hay, se pide.",
    },
    {
      clave: "HORA_INICIO",
      label: "hora de inicio del debate",
      fuente: "sistema",
      ayuda: "Hora de inicio del debate (agenda).",
    },
    {
      clave: "LUGAR_SEDE_DEBATE",
      label: "sede del debate",
      fuente: "criterio",
      ayuda: "Dirección o nombre de la sede del tribunal oral.",
    },
    {
      clave: "COMPOSICION_TRIBUNAL",
      label: "tribunal",
      fuente: "ficha",
      ayuda: "Tribunal Oral en lo Criminal N° X / TOF N° X, etc. (campo Organismo de la ficha).",
    },
    {
      clave: "PUNTO_ENCUENTRO",
      label: "punto de encuentro",
      fuente: "criterio",
      ayuda: "Dónde encontrarse antes del debate: «en la puerta del tribunal», «en mi estudio».",
    },
    {
      clave: "HORA_CONCENTRACION",
      label: "hora de encuentro",
      fuente: "criterio",
      ayuda: "Hora de encuentro previo: habitualmente 30-45 minutos antes.",
    },
    {
      clave: "INDICACIONES_PRESENTACION",
      label: "cómo vestirse",
      fuente: "criterio",
      ayuda: "Ropa formal o semiformal, sobria, sin exceso de accesorios, según el caso.",
    },
    {
      clave: "LISTA_PRUEBAS_COLOQUIAL",
      label: "pruebas a favor",
      fuente: "criterio",
      ayuda: "Listado de pruebas en lenguaje simple: «tus mensajes de WhatsApp», «el video de la cámara», «el informe pericial».",
    },
    {
      clave: "ARGUMENTO_DEFENSA_SIMPLE",
      label: "argumento central de la defensa",
      fuente: "criterio",
      ayuda: "La teoría del caso en una oración coloquial.",
    },
    {
      clave: "CANTIDAD_TESTIGOS",
      label: "cantidad de testigos",
      fuente: "criterio",
      ayuda: "Número de testigos ofrecidos.",
      opcional: true,
    },
    {
      clave: "LISTA_TESTIGOS_COLOQUIAL",
      label: "testigos",
      fuente: "criterio",
      ayuda: "Nombre y relación de cada testigo con el caso.",
      opcional: true,
    },
    {
      clave: "FECHA_REUNION_PREPARATORIA",
      label: "fecha de la reunión preparatoria",
      fuente: "sistema",
      ayuda: "Sale de la próxima reunión con el cliente cargada en la agenda; si no hay, se pide.",
    },
    NOMBRE_ABOGADO,
  ],
  condiciones: [
    {
      tag: "HAY_TESTIGOS",
      label: "Hay testigos",
      fuente: "variable",
      variable: "LISTA_TESTIGOS_COLOQUIAL",
    },
  ],
  variantes: [],
  campos_criterio: [
    {
      clave: "FECHA_DEBATE",
      label: "Fecha del debate (si no está en la agenda)",
      tipo: "texto",
      placeholder: "martes 19 de agosto",
    },
    {
      clave: "HORA_INICIO",
      label: "Hora de inicio (si no está en la agenda)",
      tipo: "texto",
      placeholder: "9:30",
    },
    {
      clave: "LUGAR_SEDE_DEBATE",
      label: "Sede del debate",
      tipo: "texto",
      requerido: true,
      placeholder: "Comodoro Py 2002, sala AMIA, 1° piso",
    },
    {
      clave: "COMPOSICION_TRIBUNAL",
      label: "Tribunal (si no está en la ficha)",
      tipo: "texto",
      placeholder: "el Tribunal Oral en lo Criminal N° 12",
    },
    {
      clave: "PUNTO_ENCUENTRO",
      label: "Dónde nos encontramos",
      tipo: "texto",
      requerido: true,
      placeholder: "la puerta del tribunal",
    },
    {
      clave: "HORA_CONCENTRACION",
      label: "A qué hora",
      tipo: "texto",
      requerido: true,
      placeholder: "8:45",
    },
    {
      clave: "INDICACIONES_PRESENTACION",
      label: "Cómo vestirse",
      tipo: "texto",
      requerido: true,
      placeholder: "de manera formal o semiformal, sobrio y sin exceso de accesorios",
    },
    {
      clave: "LISTA_PRUEBAS_COLOQUIAL",
      label: "Pruebas a favor, en lenguaje simple",
      tipo: "textarea",
      requerido: true,
      placeholder: "tus mensajes de WhatsApp con Marta, el video de la cámara del garaje y el informe del perito contador",
    },
    {
      clave: "ARGUMENTO_DEFENSA_SIMPLE",
      label: "El argumento central de la defensa, en una oración",
      tipo: "textarea",
      requerido: true,
      placeholder: "que vos no estabas en el lugar cuando pasó el hecho",
    },
    {
      clave: "CANTIDAD_TESTIGOS",
      label: "Cantidad de testigos",
      tipo: "texto",
      placeholder: "dos",
    },
    {
      clave: "LISTA_TESTIGOS_COLOQUIAL",
      label: "Quiénes son los testigos y qué relación tienen con el caso",
      tipo: "textarea",
      ayuda: "Vacío = el párrafo de testigos no aparece.",
      placeholder: "tu vecino Ramón, que te vio llegar a tu casa, y tu jefa, que confirma que estabas trabajando",
    },
    {
      clave: "FECHA_REUNION_PREPARATORIA",
      label: "Fecha de la reunión preparatoria (si no está en la agenda)",
      tipo: "texto",
      placeholder: "jueves 14 de agosto a las 17",
    },
  ],
};

// ————————————————————————————————————————————————————————————————
// P-04 · Sentencia dictada
// ————————————————————————————————————————————————————————————————

const P04: DefinicionPlantilla = {
  id: "P04",
  codigo: "P-04",
  titulo: "Sentencia dictada",
  etiqueta: "Evento definitorio · resultado del juicio",
  cuando:
    "Inmediatamente después de que el tribunal dicte sentencia. El mensaje más esperado: claro, sin adornos, qué pasó y qué viene.",
  canal_sugerido: "email",
  asunto: "Sentencia en tu causa",
  texto: [
    "Hola {{NOMBRE_CLIENTE}}, te escribo de inmediato para contarte la resolución del tribunal.",
    "",
    "El tribunal resolvió {{TIPO_SENTENCIA_COLOQUIAL}}.",
    "",
    "{{#ABSOLUTORIA}}Esto significa que quedás completamente libre de toda culpa y cargo. {{EFECTOS_PRACTICOS_ABSOLUCION}}. Es el mejor resultado posible.{{/ABSOLUTORIA}}",
    "",
    "{{#CONDENATORIA}}Te condenaron a {{PENA_COLOQUIAL}}. {{EXPLICACION_PENA}}. {{#SE_RECURRE}}Ante esta resolución, vamos a presentar recurso de casación dentro de los {{PLAZO_RECURSO}} días. El argumento principal va a ser {{FUNDAMENTO_RECURSO_COLOQUIAL}}. La condena no está firme mientras el recurso esté pendiente.{{/SE_RECURRE}}{{/CONDENATORIA}}",
    "",
    "{{#SOBRESEIMIENTO}}Quedás sobreseído, lo que cierra definitivamente la causa en tu contra. {{EFECTOS_SOBRESEIMIENTO}}.{{/SOBRESEIMIENTO}}",
    "",
    "En los próximos días te llamo para explicarte todo con calma. Saludos, {{NOMBRE_ABOGADO}}",
  ].join("\n"),
  variables: [
    NOMBRE_CLIENTE,
    {
      clave: "TIPO_SENTENCIA_COLOQUIAL",
      label: "tipo de sentencia",
      fuente: "sistema",
      ayuda: "«absolverte» / «condenarte» / «sobreseerte». Sale de la variante.",
    },
    {
      clave: "PENA_COLOQUIAL",
      label: "la pena",
      fuente: "criterio",
      ayuda: "«X años de prisión en suspenso», «X años de prisión efectiva», «multa de $X».",
    },
    {
      clave: "EXPLICACION_PENA",
      label: "qué implica la pena",
      fuente: "criterio",
      ayuda: "Qué implica prácticamente esa pena para el cliente.",
    },
    {
      clave: "PLAZO_RECURSO",
      label: "plazo del recurso (en días)",
      fuente: "criterio",
      ayuda: "Días para interponer el recurso según el código aplicable. LO TIPEA EL ABOGADO: el sistema no calcula plazos.",
    },
    {
      clave: "FUNDAMENTO_RECURSO_COLOQUIAL",
      label: "fundamento del recurso",
      fuente: "criterio",
      ayuda: "El argumento central del recurso en una oración clara.",
    },
    {
      clave: "EFECTOS_PRACTICOS_ABSOLUCION",
      label: "efectos prácticos de la absolución",
      fuente: "criterio",
      ayuda: "Qué pasa concretamente: libertad, cese de restricciones, restitución de bienes.",
    },
    {
      clave: "EFECTOS_SOBRESEIMIENTO",
      label: "efectos del sobreseimiento",
      fuente: "criterio",
      ayuda: "Cese de medidas cautelares, etc.",
    },
    NOMBRE_ABOGADO,
  ],
  condiciones: [
    { tag: "ABSOLUTORIA", label: "Absolución", fuente: "variante" },
    { tag: "CONDENATORIA", label: "Condena", fuente: "variante" },
    { tag: "SOBRESEIMIENTO", label: "Sobreseimiento", fuente: "variante" },
    { tag: "SE_RECURRE", label: "Se decidió recurrir", fuente: "criterio" },
  ],
  variantes: [
    {
      id: "absolutoria",
      label: "Absolución",
      descripcion: "El tribunal absolvió al cliente.",
      condiciones: ["ABSOLUTORIA"],
      valores: { TIPO_SENTENCIA_COLOQUIAL: "absolverte" },
    },
    {
      id: "condenatoria",
      label: "Condena",
      descripcion:
        "La peor noticia. La app arma el encabezado y el cierre; el cuerpo (pena, qué implica, si se recurre) lo escribís vos, sin IA.",
      condiciones: ["CONDENATORIA"],
      valores: { TIPO_SENTENCIA_COLOQUIAL: "condenarte" },
      sin_ia: {
        cabecera:
          "Hola {{NOMBRE_CLIENTE}}, te escribo de inmediato para contarte la resolución del tribunal: el tribunal resolvió condenarte.",
        cierre: "En los próximos días te llamo para explicarte todo con calma. Saludos, {{NOMBRE_ABOGADO}}",
      },
    },
    {
      id: "sobreseimiento",
      label: "Sobreseimiento",
      descripcion: "El tribunal sobreseyó al cliente.",
      condiciones: ["SOBRESEIMIENTO"],
      valores: { TIPO_SENTENCIA_COLOQUIAL: "sobreseerte" },
    },
  ],
  campos_criterio: [
    {
      clave: "EFECTOS_PRACTICOS_ABSOLUCION",
      label: "Qué pasa concretamente ahora",
      tipo: "textarea",
      solo_variantes: ["absolutoria"],
      requerido: true,
      placeholder: "Se levantan todas las restricciones que tenías y te devuelven el auto",
    },
    {
      clave: "EFECTOS_SOBRESEIMIENTO",
      label: "Efectos del sobreseimiento",
      tipo: "textarea",
      solo_variantes: ["sobreseimiento"],
      requerido: true,
      placeholder: "Cesan todas las medidas que pesaban sobre vos",
    },
  ],
};

// ————————————————————————————————————————————————————————————————
// P-05 · Recurso interpuesto
// ————————————————————————————————————————————————————————————————

const P05: DefinicionPlantilla = {
  id: "P05",
  codigo: "P-05",
  titulo: "Recurso interpuesto (apelación, casación, queja, extraordinario)",
  etiqueta: "Impugnación · se presentó recurso",
  cuando:
    "Cuando se interpone un recurso. El cliente suele pensar que «perdió»: hay que explicar que el proceso continúa y la defensa sigue activa.",
  canal_sugerido: "whatsapp",
  asunto: "Presentamos el recurso en tu causa",
  texto: [
    "Hola {{NOMBRE_CLIENTE}}, te aviso que acabamos de presentar el recurso de {{TIPO_RECURSO}} ante {{TRIBUNAL_SUPERIOR}}.",
    "",
    "Con este recurso estamos impugnando {{RESOLUCION_IMPUGNADA_COLOQUIAL}} y pedimos que {{OBJETO_RECURSO_COLOQUIAL}}.",
    "",
    "Los argumentos principales son: {{FUNDAMENTOS_COLOQUIALES}}.",
    "",
    "Ahora el expediente pasa a {{TRIBUNAL_SUPERIOR}} para que lo analicen y resuelvan. Eso puede llevar {{ESTIMACION_PLAZO_COLOQUIAL}}: no es rápido, pero es parte del proceso normal.",
    "",
    "{{#RECURSO_CON_EFECTO_SUSPENSIVO}}Mientras el recurso esté pendiente, {{EFECTO_PRACTICO_SUSPENSION}}.{{/RECURSO_CON_EFECTO_SUSPENSIVO}}",
    "",
    "Tu causa no está terminada, seguimos peleando. Cuando haya resolución te aviso de inmediato. Saludos, {{NOMBRE_ABOGADO}}",
  ].join("\n"),
  variables: [
    NOMBRE_CLIENTE,
    {
      clave: "TIPO_RECURSO",
      label: "tipo de recurso",
      fuente: "criterio",
      ayuda: "«apelación» / «casación» / «queja por casación denegada» / «recurso extraordinario federal».",
    },
    {
      clave: "TRIBUNAL_SUPERIOR",
      label: "tribunal superior",
      fuente: "criterio",
      ayuda: "Cámara de Apelaciones / CFCP / Cámara de Casación PBA / CSJN.",
    },
    {
      clave: "RESOLUCION_IMPUGNADA_COLOQUIAL",
      label: "resolución impugnada",
      fuente: "criterio",
      ayuda: "«el procesamiento», «la condena», «la prisión preventiva».",
    },
    {
      clave: "OBJETO_RECURSO_COLOQUIAL",
      label: "qué se pide",
      fuente: "criterio",
      ayuda: "«te sobresean», «te reduzcan la pena», «declaren la nulidad del juicio».",
    },
    {
      clave: "FUNDAMENTOS_COLOQUIALES",
      label: "argumentos del recurso",
      fuente: "criterio",
      ayuda: "Los argumentos del recurso en lenguaje simple, sin citas legales.",
    },
    {
      clave: "ESTIMACION_PLAZO_COLOQUIAL",
      label: "cuánto puede tardar",
      fuente: "criterio",
      ayuda: "«entre 3 y 6 meses» / «entre 6 meses y un año» / «más de un año en la CSJN».",
    },
    {
      clave: "EFECTO_PRACTICO_SUSPENSION",
      label: "efecto suspensivo",
      fuente: "criterio",
      ayuda: "Qué implica el efecto suspensivo: no cumple pena, sigue con domiciliaria, etc. Opcional.",
      opcional: true,
    },
    NOMBRE_ABOGADO,
  ],
  condiciones: [
    {
      tag: "RECURSO_CON_EFECTO_SUSPENSIVO",
      label: "El recurso tiene efecto suspensivo",
      fuente: "variable",
      variable: "EFECTO_PRACTICO_SUSPENSION",
    },
  ],
  variantes: [],
  campos_criterio: [
    {
      clave: "TIPO_RECURSO",
      label: "Tipo de recurso",
      tipo: "opciones",
      requerido: true,
      opciones: [
        { valor: "apelacion", label: "Apelación", texto: "apelación" },
        { valor: "casacion", label: "Casación", texto: "casación" },
        {
          valor: "queja",
          label: "Queja por casación denegada",
          texto: "queja por casación denegada",
        },
        {
          valor: "extraordinario",
          label: "Recurso extraordinario federal",
          texto: "recurso extraordinario federal",
        },
      ],
    },
    {
      clave: "TRIBUNAL_SUPERIOR",
      label: "Ante qué tribunal",
      tipo: "texto",
      requerido: true,
      placeholder: "la Cámara Nacional de Apelaciones en lo Criminal y Correccional",
    },
    {
      clave: "RESOLUCION_IMPUGNADA_COLOQUIAL",
      label: "Qué resolución impugnamos",
      tipo: "texto",
      requerido: true,
      placeholder: "el procesamiento",
    },
    {
      clave: "OBJETO_RECURSO_COLOQUIAL",
      label: "Qué pedimos",
      tipo: "texto",
      requerido: true,
      placeholder: "te sobresean",
    },
    {
      clave: "FUNDAMENTOS_COLOQUIALES",
      label: "Los argumentos, en lenguaje simple",
      tipo: "textarea",
      requerido: true,
      placeholder: "que la prueba principal se obtuvo en un allanamiento sin orden, y que no hay ningún testigo que te ubique en el lugar",
    },
    {
      clave: "ESTIMACION_PLAZO_COLOQUIAL",
      label: "Cuánto puede tardar",
      tipo: "texto",
      requerido: true,
      placeholder: "entre 3 y 6 meses",
    },
    {
      clave: "EFECTO_PRACTICO_SUSPENSION",
      label: "Qué implica para el cliente mientras se resuelve (efecto suspensivo)",
      tipo: "texto",
      ayuda: "Vacío = el párrafo no aparece.",
      placeholder: "no tenés que cumplir ninguna pena y seguís en libertad",
    },
  ],
};

// ————————————————————————————————————————————————————————————————
// P-06 · Reporte mensual ejecutivo
// ————————————————————————————————————————————————————————————————

const P06: DefinicionPlantilla = {
  id: "P06",
  codigo: "P-06",
  titulo: "Reporte mensual ejecutivo",
  etiqueta: "Reporte periódico · causas de larga duración",
  cuando:
    "Causas complejas o largas (corrupción, lavado, defraudación, evasión) donde pasan semanas sin movimientos visibles. Mantiene la relación activa y muestra que el abogado está encima del expediente.",
  canal_sugerido: "email",
  asunto: "Reporte mensual de tu causa — {{MES_AÑO}}",
  texto: [
    "─── REPORTE MENSUAL DE CAUSA ─── {{MES_AÑO}}",
    "",
    "Hola {{NOMBRE_CLIENTE}}, te mando el resumen mensual de tu causa para que tengas todo en un solo lugar.",
    "",
    "📌 DÓNDE ESTAMOS",
    "Tu causa {{CARATULA_COLOQUIAL}} está en {{ETAPA_PROCESAL_COLOQUIAL}} ante {{JUZGADO_O_TRIBUNAL}}. {{EXPLICACION_ETAPA_BREVE}}.",
    "",
    "📋 QUÉ PASÓ ESTE MES",
    "{{RESUMEN_MOVIMIENTOS_MES}}",
    "",
    "⏭ QUÉ VIENE",
    "{{PROXIMOS_PASOS_COLOQUIALES}}. {{FECHA_PROXIMO_PASO_ESTIMADA}}",
    "",
    "✅ ¿TENÉS QUE HACER ALGO?",
    "{{#HAY_ACCION_CLIENTE}}{{ACCION_CLIENTE_MES}}{{/HAY_ACCION_CLIENTE}}{{#SIN_ACCION_CLIENTE}}Por ahora no hay nada que hacer de tu parte. Nosotros manejamos todo y te avisamos cuando sea necesario.{{/SIN_ACCION_CLIENTE}}",
    "",
    "─────────────────────────────────────",
    "{{NOMBRE_ABOGADO}} · {{ESTUDIO}} · {{FECHA_REPORTE}}",
    "Ante cualquier consulta, respondé este mensaje o escribime directamente.",
  ].join("\n"),
  variables: [
    {
      clave: "MES_AÑO",
      label: "mes y año",
      fuente: "sistema",
      ayuda: "Mes y año del reporte: «Agosto 2026».",
    },
    NOMBRE_CLIENTE,
    {
      clave: "CARATULA_COLOQUIAL",
      label: "nombre coloquial de la causa",
      fuente: "sistema",
      ayuda: "«tu causa por defraudación», «el caso de la empresa X». Sale de los delitos o la carátula.",
    },
    {
      clave: "ETAPA_PROCESAL_COLOQUIAL",
      label: "etapa procesal",
      fuente: "sistema",
      ayuda: "Etapa actual en lenguaje simple.",
    },
    {
      clave: "JUZGADO_O_TRIBUNAL",
      label: "juzgado o tribunal",
      fuente: "ficha",
      ayuda: "Juzgado o tribunal interviniente (campo Organismo de la ficha).",
    },
    {
      clave: "EXPLICACION_ETAPA_BREVE",
      label: "qué significa la etapa",
      fuente: "sistema",
      ayuda: "Una oración de qué significa estar en esa etapa.",
    },
    {
      clave: "RESUMEN_MOVIMIENTOS_MES",
      label: "movimientos del mes",
      fuente: "sistema",
      ayuda: "Los movimientos de los últimos 30 días en lenguaje llano; si no hubo, la frase acordada.",
    },
    {
      clave: "PROXIMOS_PASOS_COLOQUIALES",
      label: "próximos pasos",
      fuente: "criterio",
      ayuda: "Qué viene en el próximo mes o período.",
    },
    {
      clave: "FECHA_PROXIMO_PASO_ESTIMADA",
      label: "cuándo",
      fuente: "criterio",
      ayuda: "Fecha o período estimado, como oración completa.",
      opcional: true,
    },
    {
      clave: "ACCION_CLIENTE_MES",
      label: "qué tiene que hacer el cliente este mes",
      fuente: "criterio",
      ayuda: "Si el cliente tiene que hacer algo este mes.",
      opcional: true,
    },
    NOMBRE_ABOGADO,
    {
      clave: "ESTUDIO",
      label: "estudio",
      fuente: "sistema",
      ayuda: "Nombre del estudio.",
    },
    {
      clave: "FECHA_REPORTE",
      label: "fecha del reporte",
      fuente: "sistema",
      ayuda: "Fecha de emisión del reporte.",
    },
  ],
  condiciones: [
    {
      tag: "HAY_ACCION_CLIENTE",
      label: "El cliente tiene que hacer algo",
      fuente: "variable",
      variable: "ACCION_CLIENTE_MES",
    },
    {
      tag: "SIN_ACCION_CLIENTE",
      label: "El cliente no tiene que hacer nada",
      fuente: "variable",
      variable: "ACCION_CLIENTE_MES",
      negada: true,
    },
  ],
  variantes: [],
  campos_criterio: [
    {
      clave: "PROXIMOS_PASOS_COLOQUIALES",
      label: "Qué viene",
      tipo: "textarea",
      requerido: true,
      ayuda: "El sistema propone el próximo evento de la agenda; podés reemplazarlo.",
      placeholder: "Esperamos que la fiscalía conteste el pedido de pericia",
    },
    {
      clave: "FECHA_PROXIMO_PASO_ESTIMADA",
      label: "Cuándo (oración completa)",
      tipo: "texto",
      placeholder: "Estimamos que sea durante la primera quincena de octubre.",
    },
    {
      clave: "ACCION_CLIENTE_MES",
      label: "Qué tiene que hacer el cliente este mes",
      tipo: "textarea",
      ayuda: "Vacío = «por ahora no hay nada que hacer de tu parte».",
      placeholder: "Necesitamos que nos acerques los extractos bancarios de julio.",
    },
  ],
};

export const PLANTILLAS: readonly DefinicionPlantilla[] = [
  P01,
  P02,
  P03,
  P04,
  P05,
  P06,
];

export function plantillaPorId(id: string): DefinicionPlantilla | null {
  return PLANTILLAS.find((p) => p.id === id) ?? null;
}

export function variantePorId(
  p: DefinicionPlantilla,
  id: string | null | undefined,
): VarianteReporte | null {
  if (!id) return null;
  return p.variantes.find((v) => v.id === id) ?? null;
}

/** Los campos del formulario que aplican a la variante elegida (y a sus checkboxes). */
export function camposAplicables(
  p: DefinicionPlantilla,
  varianteId: string | null,
  criterio: Record<string, unknown>,
): CampoCriterio[] {
  return p.campos_criterio.filter((c) => {
    if (c.solo_variantes && (!varianteId || !c.solo_variantes.includes(varianteId))) {
      return false;
    }
    if (c.solo_si && criterio[c.solo_si] !== true) return false;
    return true;
  });
}
