// Las columnas de `casos`, en un solo lugar.
//
// Por qué existe este módulo: hasta la Fase 9 la lista de columnas estaba
// copiada a mano en trece call sites, y ya había divergido. Los tres que leen
// el caso completo —`GET /api/casos/[id]`, el detalle y el chat— repetían la
// MISMA lista literal de 12 columnas y los tres se habían olvidado de `fuero`
// desde que se agregó en julio (20260706120000). El síntoma de esa clase de
// bug es el peor posible: `caso.fuero` sale `undefined` sin un solo error de
// TypeScript, porque el tipo dice que la columna existe y el SELECT nunca la
// pidió. La ficha de causa sumaba ocho columnas más a ese problema.
//
// Regla: ningún archivo vuelve a escribir una lista de columnas de `casos` a
// mano. Si hace falta un subconjunto nuevo, se agrega acá.
//
// ⚠️ Van como STRING LITERAL con `as const`, no como array `.join(", ")`.
// supabase-js parsea el argumento de `.select()` en tipos: si recibe un
// `string` ancho en vez de un literal, colapsa la fila a `GenericStringError`
// y todo downstream deja de tipar. Es feo de leer y es la única forma.
//
// ⚠️ Agregar una columna a alguna de estas listas SIN correr antes la
// migración devuelve 42703, que PostgREST traduce a 500 en todos los reads del
// caso. Ver MIGRATION_LOG.md, entrada de `20260822120000_ficha_de_causa.sql`.

// Identidad + ficha + estrategia: todo lo que el tipo `Caso` declara.
// Lo usan el detalle del caso, el chat y `GET /api/casos/[id]`.
// prettier-ignore
export const COLS_CASO =
  "id, usuario_id, titulo, caso_descripcion, contexto, rol, ejecucion_origen_id, estrategia_seleccionada_rol, estrategia_seleccionada_idx, estrategia_snapshot, creado_en, actualizado_en, fuero, caratula, expediente_numero, organismo, secretaria, juez, fiscalia, delitos, estado_seguimiento";

// Lo que necesita una FILA DE LISTA: nombrarla, ubicarla y ordenarla. Sin
// `caso_descripcion` ni `estrategia_snapshot`, que son los dos campos pesados
// (el relato entero y el JSON de la estrategia) y no se muestran en una lista.
// prettier-ignore
export const COLS_CASO_LISTA =
  "id, titulo, caratula, expediente_numero, organismo, rol, fuero, estado_seguimiento, contexto, creado_en, actualizado_en";

// El mínimo para escribir el nombre de una causa en un header o un breadcrumb.
// Lo consumen las vistas inmersivas (mapa, simulador) y la agenda. Incluye
// `titulo` además de `caratula` porque `nombreCaso()` cae al título cuando la
// carátula todavía no se cargó.
export const COLS_CASO_NOMBRE = "id, titulo, caratula";

// Igual que el anterior más el fuero, que el simulador necesita para elegir el
// guion de la audiencia. Va como constante propia y no como template
// `${COLS_CASO_NOMBRE}, fuero` porque una interpolación se ensancha a `string`
// y supabase-js pierde el tipo de la fila.
export const COLS_CASO_NOMBRE_FUERO = "id, titulo, caratula, fuero";

// Todas las columnas de `partes_caso`. La tabla es chica y siempre se lee
// entera; no hay subconjuntos.
export const COLS_PARTE =
  "id, caso_id, nombre, rol, es_cliente, situacion_libertad, creado_en";

